# 构建、验收与发布

支持目标：**Apple Silicon Mac（arm64）** 与 **Windows x64**。不提供 Intel Mac 或 Windows ARM 安装包。

## 1. 先构建测试包

将源码和工作流提交到 GitHub 后，在 **Actions → Build installers → Run workflow** 选择分支并运行。`main` 上相关源码变化和 Pull Request 也会触发构建。

两个独立 runner 分别执行 `npm ci`、类型检查、测试和目标平台打包：

| 目标 | Runner | Artifact |
| --- | --- | --- |
| macOS arm64 | `macos-15`，检查实际架构为 arm64 | `installers-macos-arm64` |
| Windows x64 | `windows-2022`，检查实际架构为 x64 | `installers-windows-x64` |

成功后在该次运行的 **Artifacts** 下载压缩包，解压可见两个安装文件和一份 SHA256 清单。Actions artifact 是外层下载压缩包，不是应用本身的 ZIP。默认保留 14 天。

macOS 使用固定 `identity: "-"` 进行 ad-hoc 签名，不导入证书、不使用签名密钥，且明确关闭公证。PR 构建也仅执行这种本地签名。

工作流会检查 macOS 深度代码签名、应用可执行文件、`app.asar` 内版本号、MIT 许可证与第三方声明，以及安装文件非空。**这些是构建校验，不代表已在桌面环境完成安装和业务验收。**

本地打包也可用：

```bash
npm ci
npm run typecheck
npm test
npm run package:mac    # 在 Apple Silicon Mac 上执行
# 或 npm run package:win，在 Windows x64 上执行
```

安装文件名使用 `AI-Session-Summary-<版本>…`（不含空格），方便命令行校验及 Release 上传；应用显示名称仍为 AI Session Summary。

所有 `package:*` 脚本使用 `--publish never`，不会自动发布。可在对应平台执行下面的命令，为本地完整安装包生成校验清单：

```bash
node scripts/release.cjs verify macos-arm64
# Windows: node scripts/release.cjs verify windows-x64
```

## 2. 准备版本

1. 完成下方的双平台验收；解决第三方资产的来源与再分发权限问题。
2. 在 [CHANGELOG](../CHANGELOG.md) 写清本次变更。正式发布日期仅在确定发布时填写。
3. 检查 `package.json` 和 `package-lock.json` 版本一致；需升级时，可执行 `npm version 0.2.0 --no-git-tag-version`，不会自动提交或创建标签。
4. 运行类型检查、测试和构建，检查 Git 差异，不包含密钥、Cookie、用户配置、私人会话或日报。
5. 将本次版本源码提交并推送，再创建版本标签。

以下仅为手动发布示例，**不会由文档自动执行**；确认包内版本是 `0.1.0` 且该标签尚不存在后再使用：

```bash
npm run typecheck
npm test
npm run build
git diff --check
# 先检查、提交本次版本的变更，保证工作区干净，再执行：
git push origin main
git tag -a v0.1.0 -m "AI Session Summary v0.1.0"
git push origin v0.1.0
```

版本标签必须严格等于 `v` + `package.json` 版本，例如 `v0.1.0` 或 `v0.2.0-beta.1`。不匹配会直接失败。已发布版本不要移动标签或覆盖安装包，应升级版本重新发布。

## 3. 自动准备 Release 草稿

推送 `v*` 标签会触发 **Prepare release draft**：

1. 调用相同的双平台构建流程；任何一端失败，都不会创建 Release。
2. 下载当前运行的四个安装文件和两个校验文件。
3. 检查文件白名单、SHA256 与标签版本，然后创建 **draft** 并上传这六份附件。
4. 草稿自带安装验收清单、未签名说明和隐私提醒。预发布版本（如 `-beta.1`）会标记为 prerelease。
5. 维护者填写变更与实际验证情况，验收通过后在 Releases 页面手动点击 **Publish release**。

发布 job 使用 GitHub 自带 `GITHUB_TOKEN`，仅该 job 获得 `contents: write`；普通打包只有读取权限，不需要额外 PAT 或发布密钥。代码签名尚未配置。

重跑失败任务时可以更新**同名草稿**的匹配附件，保留维护者编辑的说明和其他附件。若上传中途失败，草稿可能只有部分附件；完成重跑并确认六份附件齐全后再发布。遇到已公开 Release 会拒绝覆盖。

私有仓库的 Release 不会因为创建或发布而变成公共下载。Actions 的可用额度和权限由仓库及账户配置决定；如果未生成附件，先检查 workflow 日志，不要把构建失败当成已发布。

## 4. 发布前验收

请使用测试配置和虚构会话，不要把真实密钥或私人聊天记录作为测试附件。

| 检查 | Mac | Windows |
| --- | --- | --- |
| DMG 拖拽安装 / NSIS 安装向导，安装目录与图标正常 | 待确认 | 静默安装通过；向导与图标待确认 |
| 安装版首次启动无白屏，关闭后可重新打开 | 待确认 | 本地同源码包通过 |
| ZIP 解压后独立启动，未安装 Node.js 也可运行 | 待确认 | ZIP 启动通过；干净无 Node 系统待确认 |
| 当日 Codex / Claude Code 读取、标题、去重、详情正确 | 待确认 | 读取、标题、详情通过；去重由自动测试覆盖 |
| 首次登录网页工具、返回日报、重启后登录保留 | 待确认 | 未登录检测及返回通过；真实登录待确认 |
| 无会话不生成，基础日报和模型错误提示正常 | 待确认 | 通过；含 120 秒超时、主动取消与重试 |
| Markdown 输出、自定义目录与自动生成设置保存正常 | 待确认 | 通过；自动生成保留手工编辑，写新时间戳文件 |
| 窄窗口布局、设置页面与系统路径分隔符正常 | 待确认 | 设置与中文空格路径通过；长提示溢出待改进 |

记录实际 OS 版本、芯片/架构和安装包版本；未测试的项不要标记通过。源码单元测试、CI 打包或 `.app` 目录构建，不能代替 Windows 实机安装验收。

Windows 的实际结果与测试范围维护在 [WINDOWS_ACCEPTANCE.md](WINDOWS_ACCEPTANCE.md)。表格记录 2026-10-12 对 `f3ea377` 的本地实测；每次发布应重做检查，不能沿用旧包的通过记录。云端附件还须单独复验。自动日报还应验证：已有手动编辑文件保持原样、新文件带时间戳、同名碰撞不覆盖；网络测试应验证取消后无日报写入、超时后按钮恢复、重新读取或生成可用。

2026-10-12，修复提交 `f3ea3770e55d9c27dea3bc15729ded946130aded` 的 [双平台构建](https://github.com/kfcLJH-HUB/summary_app/actions/runs/38256998285) 成功，六份下载文件的 SHA256 已核对。草稿原包来自 `689eba750719b52d7d4790744cb951fdf35141ee`，全部附件/校验清单须刷新并验证后才能发布。最终版本标签应指向实际构建源码，不应指向只更新验收文档的提交或旧包提交。

## 5. 验证下载文件

将该平台的两个安装文件和对应 `SHA256SUMS-*.txt` 放在同一目录，进入该目录后执行。

macOS：

```bash
shasum -a 256 -c SHA256SUMS-macos-arm64.txt
```

Windows PowerShell：

```powershell
Get-Content .\SHA256SUMS-windows-x64.txt | ForEach-Object {
  if ($_ -notmatch '^([a-f0-9]{64})  (.+)$') { throw 'Invalid checksum line' }
  $expected = $Matches[1]
  $file = $Matches[2]
  $actual = (Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($actual -ne $expected) { throw "Checksum mismatch: $file" }
  Write-Host "OK: $file"
}
```

SHA256 用来检测文件损坏或与清单不一致，**不能代替开发者签名，也不能证明下载源可信**。只从可信仓库下载。

## 6. 尚未完成

- 完成最新构建的双平台实机验收，并将最新修复对应的安装包替换到草稿；Windows 的未验证项以验收记录为准。
- Apple Developer ID 签名与 notarization、Windows Authenticode 签名；当前只使用 ad-hoc 本地签名，流水线不会读取签名证书。
- 品牌图标和应用图标的来源/授权确认，详见 [第三方声明](../THIRD_PARTY_NOTICES.md)。
- 内置自动更新。本流程只提供下载安装包，不会自动更新用户设备上的应用。
