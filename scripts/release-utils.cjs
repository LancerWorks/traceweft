const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const platforms = ['macos-arm64', 'windows-x64'];

function validateVersion(version) {
  assert.equal(typeof version, 'string', 'Version must be a string');
  assert.match(version, /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(-[0-9A-Za-z-]+(\.[0-9A-Za-z-]+)*)?$/, 'Use a version such as 0.1.0 or 0.2.0-beta.1');
  const prerelease = version.split('-').slice(1).join('-');
  if (prerelease) {
    for (const part of prerelease.split('.')) {
      assert(!/^0\d+$/.test(part), 'Numeric prerelease components cannot have leading zeroes');
    }
  }
  return version;
}

function packageVersion(root) {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
  validateVersion(pkg.version);
  assert.equal(lock.version, pkg.version, 'package-lock.json version must match package.json');
  assert.equal(lock.packages?.['']?.version, pkg.version, 'Lockfile root package version must match package.json');
  return pkg.version;
}

function validateTag(tag, version) {
  validateVersion(version);
  assert.equal(tag, `v${version}`, `Release tag must exactly match package.json: v${version}`);
  return tag;
}

function artifactNames(version, platform) {
  validateVersion(version);
  assert(platforms.includes(platform), `Unsupported platform: ${platform}`);
  const prefix = `Traceweft-${version}`;
  return platform === 'macos-arm64'
    ? [`${prefix}-arm64.dmg`, `${prefix}-arm64.zip`]
    : [`${prefix}-win-x64-setup.exe`, `${prefix}-win-x64.zip`];
}

function checksumName(platform) {
  assert(platforms.includes(platform), `Unsupported platform: ${platform}`);
  return `SHA256SUMS-${platform}.txt`;
}

async function sha256(file) {
  const stat = fs.lstatSync(file);
  assert(stat.isFile() && stat.size > 0, `Missing, empty or non-regular artifact: ${file}`);
  const hash = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

async function manifest(directory, names) {
  const lines = [];
  for (const name of names) lines.push(`${await sha256(path.join(directory, name))}  ${name}\n`);
  return lines.join('');
}

function verifyHost(platform) {
  const expected = platform === 'macos-arm64' ? ['darwin', 'arm64'] : ['win32', 'x64'];
  assert(platforms.includes(platform), `Unsupported platform: ${platform}`);
  assert.equal(process.platform, expected[0], 'Packaging must run on its target OS');
  assert.equal(process.arch, expected[1], 'Runner architecture does not match installer architecture');
}

function verifyMacSignature(appPath, run = execFileSync) {
  // Fail packaging instead of uploading an app with Electron's stale signature.
  run('codesign', ['--verify', '--deep', '--strict', '--verbose=2', appPath], { stdio: 'pipe' });
}

async function verifyPackage(root, version, platform) {
  const directory = path.join(root, 'release');
  const app = platform === 'macos-arm64'
    ? path.join(directory, 'mac-arm64', 'Traceweft.app', 'Contents')
    : path.join(directory, 'win-unpacked');
  const executable = platform === 'macos-arm64'
    ? path.join(app, 'MacOS', 'Traceweft')
    : path.join(app, 'Traceweft.exe');
  assert(fs.statSync(executable).size > 0, 'Packaged application executable is missing');
  if (platform === 'macos-arm64') verifyMacSignature(path.dirname(app));
  const asar = require('@electron/asar'); // Installed by electron-builder; not shipped with the app.
  const archive = path.join(app, platform === 'macos-arm64' ? 'Resources' : 'resources', 'app.asar');
  const pkg = JSON.parse(asar.extractFile(archive, 'package.json').toString());
  assert.equal(pkg.version, version, 'Packaged app version does not match source');
  assert.equal(pkg.license, 'MIT');
  assert(asar.extractFile(archive, 'LICENSE').toString().includes('Copyright (c) 2026 kfcLJH-HUB'), 'MIT copyright missing');
  assert(asar.extractFile(archive, 'THIRD_PARTY_NOTICES.md').length > 0, 'Third-party notices missing');
  const text = await manifest(directory, artifactNames(version, platform));
  fs.writeFileSync(path.join(directory, checksumName(platform)), text);
  return text;
}

async function verifyDownloads(directory, version) {
  const files = [];
  for (const platform of platforms) {
    const names = artifactNames(version, platform);
    const checksums = checksumName(platform);
    const expected = await manifest(directory, names);
    assert.equal(fs.readFileSync(path.join(directory, checksums), 'utf8'), expected, `Checksum verification failed for ${platform}`);
    files.push(...names, checksums);
  }
  assert.deepEqual(fs.readdirSync(directory).sort(), [...files].sort(), 'Unexpected files in release assets');
  return files;
}

function releaseNotes(version) {
  return `## Traceweft ${validateVersion(version)}

本地 AI 会话日报应用：读取 Codex、Claude Code、豆包与 DeepSeek 的会话，保存 Markdown 日报。

### 下载
- Apple Silicon Mac：\`Traceweft-${version}-arm64.dmg\`（推荐）或 ZIP。
- Windows x64：\`Traceweft-${version}-win-x64-setup.exe\`（推荐）或 ZIP。
- SHA256 校验值见各平台的 \`SHA256SUMS-*.txt\`。

### 发布前检查（维护者填写后再发布）
- [ ] Mac 安装、启动、当天会话读取和 Markdown 生成。
- [ ] Windows 安装、启动、当天会话读取和 Markdown 生成。
- [ ] 网页工具登录及登录状态保留。
- [ ] 补充本版本变更；确认第三方资产来源与再分发权限。

### 注意
Mac 安装包使用 ad-hoc 本地签名，但未使用 Apple Developer ID 签名/公证或 Windows Authenticode 签名，系统可能提示来源未验证。请只下载可信仓库的文件，不要关闭系统安全保护。
API Key 仍以明文保存在本机配置；使用外部模型会将选定会话发送到所配置服务。
支持范围为 Apple Silicon Mac 和 Windows x64；当前不提供 Intel Mac、Windows ARM 安装包。构建通过不代表实机验收完成。
`;
}

module.exports = { platforms, packageVersion, validateVersion, validateTag, artifactNames, checksumName, manifest, verifyHost, verifyMacSignature, verifyPackage, verifyDownloads, releaseNotes };
