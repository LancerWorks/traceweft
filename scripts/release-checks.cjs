const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const utils = require('./release-utils.cjs');
const { version } = require('../package.json');

async function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'summary-release-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  for (const platform of utils.platforms) {
    const names = utils.artifactNames(version, platform);
    for (const name of names) fs.writeFileSync(path.join(directory, name), `fictional installer: ${name}`);
    fs.writeFileSync(path.join(directory, utils.checksumName(platform)), await utils.manifest(directory, names));
  }
  return directory;
}

test('release tags must exactly match a valid package version', () => {
  assert.equal(utils.validateTag('v0.1.0', '0.1.0'), 'v0.1.0');
  assert.equal(utils.validateTag('v0.2.0-beta.1', '0.2.0-beta.1'), 'v0.2.0-beta.1');
  for (const tag of ['', '0.1.0', 'v0.2.0', 'v0.1.0/../../bad']) {
    assert.throws(() => utils.validateTag(tag, '0.1.0'));
  }
  for (const invalid of ['01.0.0', '1.0', '../bad', '1.0.0-beta.01']) {
    assert.throws(() => utils.validateVersion(invalid));
  }
});

test('artifact whitelist covers both platforms and rejects unsupported targets', () => {
  assert.deepEqual(utils.artifactNames('0.1.0', 'macos-arm64'), ['Traceweft-0.1.0-arm64.dmg', 'Traceweft-0.1.0-arm64.zip']);
  assert.deepEqual(utils.artifactNames('0.1.0', 'windows-x64'), ['Traceweft-0.1.0-win-x64-setup.exe', 'Traceweft-0.1.0-win-x64.zip']);
  assert.throws(() => utils.artifactNames('0.1.0', 'linux'));
});

test('both platform manifests validate exactly six release assets', async t => {
  const directory = await fixture(t);
  const files = await utils.verifyDownloads(directory, version);
  assert.equal(files.length, 6);
  for (const platform of utils.platforms) {
    const text = fs.readFileSync(path.join(directory, utils.checksumName(platform)), 'utf8');
    assert.equal(text.split('\n').filter(Boolean).length, 2);
    assert.match(text, /^[a-f0-9]{64}  Traceweft-/);
  }
});

test('missing or empty installer blocks a release', async t => {
  const directory = await fixture(t);
  const file = path.join(directory, utils.artifactNames(version, 'windows-x64')[0]);
  fs.unlinkSync(file);
  await assert.rejects(utils.verifyDownloads(directory, version));
  fs.writeFileSync(file, '');
  await assert.rejects(utils.verifyDownloads(directory, version), /empty/);
});

test('modified installer or checksum blocks a release', async t => {
  const directory = await fixture(t);
  const file = path.join(directory, utils.artifactNames(version, 'macos-arm64')[0]);
  fs.appendFileSync(file, 'tampered');
  await assert.rejects(utils.verifyDownloads(directory, version), /Checksum verification failed/);
});

test('unexpected files cannot accidentally become release attachments', async t => {
  const directory = await fixture(t);
  fs.writeFileSync(path.join(directory, '.settings.json'), '{"fake":"fixture"}');
  await assert.rejects(utils.verifyDownloads(directory, version), /Unexpected files/);
});

test('CLI validates a tag and returns nonzero for mismatches', () => {
  const cli = path.join(__dirname, 'release.cjs');
  assert.match(execFileSync(process.execPath, [cli, 'tag', `v${version}`], { encoding: 'utf8' }), /Version verified/);
  assert.throws(() => execFileSync(process.execPath, [cli, 'tag', 'v999.0.0'], { stdio: 'pipe' }));
});

test('all local packaging scripts explicitly disable publication', () => {
  const pkg = require('../package.json');
  for (const name of ['package:mac', 'package:win', 'package:mac:dir', 'package:win:dir']) {
    assert(pkg.scripts[name].includes('--publish never'));
  }
  assert(pkg.build.files.includes('LICENSE'));
  assert(pkg.build.files.includes('THIRD_PARTY_NOTICES.md'));
});

test('release notes clearly disclose manual acceptance and unsigned installers', () => {
  const notes = utils.releaseNotes(version);
  assert(notes.includes('Windows 安装、启动'));
  assert(notes.includes('构建通过不代表实机验收完成'));
  assert(notes.includes('未使用 Apple Developer ID'));
  assert(notes.includes('明文'));
});

function mockGitHub({ release, lookupError, uploadError } = {}) {
  const calls = [];
  const assets = [
    { id: 10, name: utils.artifactNames(version, 'macos-arm64')[0] },
    { id: 11, name: 'maintainer-note.txt' },
  ];
  const github = {
    rest: { repos: {
      listReleases: async options => {
        calls.push(['lookup', options]);
        if (lookupError) throw lookupError;
        return { data: release ? [{ tag_name: `v${version}`, ...release }] : [] };
      },
      createRelease: async options => {
        calls.push(['create', options]);
        return { data: { id: 1, draft: options.draft, html_url: 'https://example.invalid/draft' } };
      },
      listReleaseAssets: async () => ({ data: release ? assets : [] }),
      deleteReleaseAsset: async options => { calls.push(['delete', options]); },
      uploadReleaseAsset: async options => {
        calls.push(['upload', options]);
        if (uploadError) throw uploadError;
      },
    } },
    paginate: async (method, options) => (await method(options)).data,
  };
  return { github, calls };
}

async function prepare(t, options = {}) {
  const directory = await fixture(t);
  const mock = mockGitHub(options);
  const input = {
    directory,
    github: mock.github,
    context: { ref: `refs/tags/v${version}`, sha: 'fictional-commit', repo: { owner: 'fixture', repo: 'fixture' } },
    core: { info: () => {} },
  };
  return { ...mock, input, publish: require('../.github/scripts/publish-release.cjs') };
}

test('new release is a draft with exactly six validated uploads', async t => {
  const { calls, input, publish } = await prepare(t);
  await publish(input);
  const creates = calls.filter(([name]) => name === 'create');
  assert.equal(creates.length, 1);
  assert.equal(creates[0][1].draft, true);
  assert.equal(creates[0][1].tag_name, `v${version}`);
  const uploads = calls.filter(([name]) => name === 'upload');
  assert.equal(uploads.length, 6);
  assert(uploads.every(([, options]) => Buffer.isBuffer(options.data) && options.data.length > 0));
});

test('rerun refreshes matching draft attachments without deleting unrelated assets', async t => {
  const { calls, input, publish } = await prepare(t, { release: { id: 2, draft: true, html_url: 'https://example.invalid/draft' } });
  await publish(input);
  assert.equal(calls.filter(([name]) => name === 'create').length, 0);
  assert.deepEqual(calls.filter(([name]) => name === 'delete').map(([, options]) => options.asset_id), [10]);
  assert.equal(calls.filter(([name]) => name === 'upload').length, 6);
});

test('already published releases can never be overwritten', async t => {
  const { calls, input, publish } = await prepare(t, { release: { id: 3, draft: false } });
  await assert.rejects(publish(input), /already published/);
  assert.deepEqual(calls.map(([name]) => name), ['lookup']);
});

test('a checksum failure performs no GitHub calls at all', async t => {
  const { calls, input, publish } = await prepare(t);
  fs.appendFileSync(path.join(input.directory, utils.artifactNames(version, 'macos-arm64')[0]), 'modified');
  await assert.rejects(publish(input), /Checksum verification failed/);
  assert.equal(calls.length, 0);
});

test('authorization errors are not mistaken for a missing release', async t => {
  const { calls, input, publish } = await prepare(t, { lookupError: Object.assign(new Error('forbidden'), { status: 403 }) });
  await assert.rejects(publish(input), /forbidden/);
  assert.deepEqual(calls.map(([name]) => name), ['lookup']);
});

test('failed upload stops the run and never publishes the draft', async t => {
  const { calls, input, publish } = await prepare(t, { uploadError: new Error('upload interrupted') });
  await assert.rejects(publish(input), /upload interrupted/);
  assert.equal(calls.find(([name]) => name === 'create')[1].draft, true);
  assert.equal(calls.filter(([name]) => name === 'upload').length, 1);
});

test('package and lockfile root versions must agree', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'summary-version-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ version: '0.1.0' }));
  const lock = { version: '0.1.0', packages: { '': { version: '0.1.0' } } };
  const write = () => fs.writeFileSync(path.join(root, 'package-lock.json'), JSON.stringify(lock));
  write();
  assert.equal(utils.packageVersion(root), '0.1.0');
  lock.version = '0.2.0'; write();
  assert.throws(() => utils.packageVersion(root), /package-lock.json version/);
  lock.version = '0.1.0'; lock.packages[''].version = '0.2.0'; write();
  assert.throws(() => utils.packageVersion(root), /root package version/);
});

test('installer names match electron-builder configuration and are URL-safe', () => {
  const pkg = require('../package.json');
  const expand = template => template.replace('${version}', version).replace('${arch}', 'arm64').replace('${ext}', 'dmg');
  assert.equal(expand(pkg.build.mac.artifactName), utils.artifactNames(version, 'macos-arm64')[0]);
  const windows = template => template.replace('${version}', version).replace('${arch}', 'x64');
  assert.equal(windows(pkg.build.win.artifactName).replace('${ext}', 'zip'), utils.artifactNames(version, 'windows-x64')[1]);
  assert.equal(windows(pkg.build.nsis.artifactName).replace('${ext}', 'exe'), utils.artifactNames(version, 'windows-x64')[0]);
  for (const platform of utils.platforms) {
    for (const file of utils.artifactNames(version, platform)) assert.match(file, /^[A-Za-z0-9._-]+$/);
  }
});

test('duplicate drafts for the same tag require manual resolution', async t => {
  const { calls, input, publish } = await prepare(t);
  input.github.rest.repos.listReleases = async () => ({ data: [
    { id: 1, tag_name: `v${version}`, draft: true },
    { id: 2, tag_name: `v${version}`, draft: true },
  ] });
  await assert.rejects(publish(input), /Multiple releases/);
  assert.equal(calls.length, 0);
});

test('macOS packaging uses explicit ad-hoc signing and never attempts notarization', () => {
  const { mac } = require('../package.json').build;
  assert.equal(mac.identity, '-');
  assert.equal(mac.notarize, false);
});

test('macOS signature checks include nested code and fail closed', () => {
  const calls = [];
  utils.verifyMacSignature('/fixture/Test.app', (...args) => calls.push(args));
  assert.deepEqual(calls[0].slice(0, 2), ['codesign', ['--verify', '--deep', '--strict', '--verbose=2', '/fixture/Test.app']]);
  assert.throws(() => utils.verifyMacSignature('/fixture/Test.app', () => { throw new Error('invalid signature'); }), /invalid signature/);
});
