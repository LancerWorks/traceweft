<div align="center">

<img src="build/icon.png" width="112" alt="AI Session Summary icon" />

# AI Session Summary

### 把散落在不同 AI 工具里的对话，整理成每天都能回看的工程日志。

一个面向 macOS 和 Windows 的本地 AI 会话日报应用。读取 Codex、Claude Code、豆包和 DeepSeek 的当天会话，通过 OpenAI 兼容模型生成简洁日报，最终保存为 Markdown。

<p>
  <img src="https://img.shields.io/badge/platform-macOS-111827?style=flat-square" alt="macOS" />
  <img src="https://img.shields.io/badge/platform-Windows-0078D6?style=flat-square&logo=windows&logoColor=white" alt="Windows" />
  <img src="https://img.shields.io/badge/Electron-44-47848F?style=flat-square&logo=electron&logoColor=white" alt="Electron 44" />
  <img src="https://img.shields.io/badge/React-18-149ECA?style=flat-square&logo=react&logoColor=white" alt="React 18" />
  <img src="https://img.shields.io/badge/TypeScript-5-3178C6?style=flat-square&logo=typescript&logoColor=white" alt="TypeScript" />
  <img src="https://img.shields.io/badge/license-MIT-0F766E?style=flat-square" alt="MIT License" />
</p>

</div>

---

## 为什么做它

一天里可能在 Codex 里写代码，在 Claude Code 里排查问题，在豆包或 DeepSeek 里查资料。对话分散在不同应用和网页中，真正值得留下的工作结论却很容易被淹没。

> 读取当天发生过的 AI 会话，提炼完成事项、重点学习和明日建议，形成一页轻量的个人工作日志。

它不是聊天客户端，也不是后台监控工具。它更像一个安静的日终整理器。

## 下载与安装

已完成 **Apple Silicon Mac（M 系列芯片）** 和 **Windows x64** 的 GitHub Actions 双平台构建，并准备了包含两端安装包和 SHA256 清单的 Release 草稿。实机验收结果见 [Windows 验收记录](docs/WINDOWS_ACCEPTANCE.md)。发布后，前往 [GitHub Releases](https://github.com/kfcLJH-HUB/summary_app/releases)，在对应版本的 **Assets** 中按下面的文件名下载：

| 平台 | 文件 | 用途 |
| --- | --- | --- |
| macOS | `AI-Session-Summary-0.1.0-arm64.dmg` | 推荐：打开 DMG，将应用拖入“应用程序”文件夹 |
| macOS | `AI-Session-Summary-0.1.0-arm64.zip` | 备用：解压后将 `.app` 拖入“应用程序”文件夹 |
| Windows x64 | `AI-Session-Summary-0.1.0-win-x64-setup.exe` | 推荐：运行安装程序，按向导完成安装 |
| Windows x64 | `AI-Session-Summary-0.1.0-win-x64.zip` | 备用：解压后直接运行应用程序 |

macOS 安装包使用 ad-hoc 本地签名保证包内签名一致，但尚未进行 Apple Developer ID 签名或公证；Windows 安装包也未进行 Authenticode 签名，因此首次运行可能提示来源未验证。确认下载来源可信后再按系统提示处理，不建议关闭系统安全保护。无需安装 Node.js 即可运行已打包的应用。如果仓库仍为私有仓库，下载者需要获得访问权限。

每个平台同时提供 `SHA256SUMS-*.txt`，可检查下载文件是否完整，方法见 [发布与校验指南](docs/RELEASING.md)。文件名中的 `0.1.0` 以实际发布版本为准。

**当前 Release 仍为未公开草稿。** 草稿中的旧安装包不会随源码提交自动更新；发布前须替换为包含最新修复、且对应同一提交的双平台安装包及校验文件。

## 核心能力

| 能力 | 说明 |
| --- | --- |
| 本地会话读取 | 扫描 Codex 与 Claude Code 的 JSONL 会话文件，支持跨文件合并、标题读取和消息去重 |
| 网页会话接入 | 在应用内登录豆包、DeepSeek，使用持久化网页 Session 读取当天对话 |
| 多来源统一 | 将不同工具转换为统一的会话、消息和来源模型 |
| 智能日报 | 支持 OpenAI、DeepSeek、智谱、硅基流动等 OpenAI 兼容 API |
| 本地降级 | 未填写 API Key 时，使用本地规则生成基础日报 |
| 自动整理 | 设置中可关闭自动读取；开启时启动读取一次、此后每 5 分钟读取；可独立启用或关闭每日自动生成，并自定义时间（默认 19:00） |
| Markdown 输出 | 手动生成保存为 `YYYY-MM-DD.md`；自动生成保存为带本地时间戳的新文件，避免覆盖已有日报 |
| 可定制提示词 | 在设置中修改日报生成提示词和输出格式 |
| 路径自动检测 | 自动检查默认的 Codex、Claude Code 会话目录，也支持手动添加路径 |
| 飞书同步 | 集成代码已预留，当前版本暂未启用 |

## 日报长什么样

默认日报只保留高价值信息：

1. **今日完成事项**：每个有实质内容的会话通常归纳为一条，先给结论，再补充关键细节。
2. **重点学习**：只提取真正学到的技术概念、工作方法和可复用结论。
3. **明日建议**：只保留有明确依据的后续动作，最多一条。
4. **来源统计与会话清单**：记录 Codex、Claude Code、豆包和 DeepSeek 的使用情况。

默认 LLM 提示词会忽略寒暄、感谢、单个英语单词查询和无实质信息的短问答。未配置 API Key 时的基础日报仅列出部分会话标题，不具备同等的语义归纳能力。

自动生成的文件形如 `2026-10-12-20261012-190000-123.md`（日报日期 + 保存时的本地日期/时分秒/毫秒）；同名碰撞时追加序号，绝不覆盖已有文件。手动生成仍会覆盖对应日期的文件，请先保留自己的修改。

网页会话读取的总超时为 60 秒，涵盖首次网页加载、列表和消息读取；模型生成的总超时为 120 秒，涵盖响应正文读取。处理期间可点击“取消操作”，取消会停止本次后续读取、生成和保存，之后可手动重试。取消定时日报后，本次应用运行期间当天不再自动重试；重启应用仍会按设置补生成。

## 工作方式

```text
Codex JSONL ─┐
Claude JSONL ─┼─> 统一解析与去重 ─> 当日会话 ─> 日报生成 ─> Markdown 文件
豆包网页 ────┤
DeepSeek 网页┘
```

### 本地工具

默认读取：

```text
~/.codex/sessions/**/*.jsonl
~/.codex/archived_sessions/**/*.jsonl
~/.claude/projects/**/*.jsonl
```

Codex 会优先使用 `~/.codex/session_index.jsonl` 中的原生标题；Claude Code 会读取 `ai-title` 记录。读取器过滤系统注入、思考过程和原始工具输出，保留当天的用户与助手文本。

### 网页工具

豆包和 DeepSeek 使用 Electron `WebContentsView` 内嵌官方网页：

1. 第一次勾选工具时，如果未登录，会打开对应登录页。
2. 登录状态保存在应用的持久化 Session 中。
3. 后续读取通过网页上下文获取会话数据，无需向主进程传递 Cookie。
4. 网页改版或接口变化可能导致读取失败，应用会显示连接状态与错误提示。

网页接入依赖第三方网页当前实现，不代表相关服务的官方 API 或稳定开放接口。

## 快速开始

### 环境要求

- macOS（Apple Silicon，M 系列芯片）或 Windows x64
- Node.js 22 LTS，至少 22.12.0（仅开发和自行构建时需要）
- npm

### 安装与开发

```bash
git clone https://github.com/kfcLJH-HUB/summary_app.git
cd summary_app
npm ci
npm run dev
```

开发模式会同时启动 Vite 渲染器和 Electron 主进程。

### 生产构建并运行

```bash
npm run typecheck
npm test
npm run build
npm start
```

### 打包 macOS 安装包

```bash
npm run package:mac
```

生成 Apple Silicon 版 DMG 和 ZIP，文件位于 `release/`。仅生成 `.app` 目录可运行 `npm run package:mac:dir`。

### 打包 Windows 安装包

```bash
npm run package:win
```

生成 Windows x64 版 NSIS 安装程序和 ZIP，文件位于 `release/`。仅生成未安装的 Windows 应用目录可运行 `npm run package:win:dir`。

推荐直接在目标平台上打包。macOS 交叉构建 Windows NSIS 安装程序可能需要额外安装 Wine；如果只是发布 Windows 版本，建议在 Windows 机器或 CI 中执行 `npm run package:win`。

### 自动构建与发布

- **试用构建**：提交工作流后，打开 **Actions → Build installers → Run workflow**，同时构建 macOS arm64 和 Windows x64；成功后可在该次运行的 Artifacts 下载两端安装包与校验文件，保留 14 天。
- **版本发布**：推送与 `package.json` 版本一致的标签（如 `v0.1.0`），两端构建和校验都成功后自动创建 **Release 草稿**，附上 DMG、Mac ZIP、Windows 安装程序、Windows ZIP 和两个 SHA256 校验文件。
- **人工确认**：草稿不会自动公开。完成安装、启动和会话读取验收后，由维护者点击 Publish release。已发布的版本不会被工作流覆盖。

普通构建不需要配置发布密钥，也不会自动上传到 Releases。本地 `release/` 仍被 Git 忽略；仅推送源码不会发布安装包。完整步骤和验收清单见 [发布指南](docs/RELEASING.md)。

## 飞书同步（暂未启用）

当前版本暂时隐藏飞书同步入口，相关代码已保留，后续恢复入口后可以按以下方式配置：

1. 在[飞书开放平台](https://open.feishu.cn/)创建企业自建应用，记录 App ID 和 App Secret。
2. 为应用开通云文档读写权限，并根据飞书后台要求发布或启用应用。
3. 将目标云文档共享给该应用，或确保应用对文档所在空间有访问权限。
4. 打开应用设置，勾选“生成日报后同步到飞书”，填写 App ID、App Secret 和飞书文档链接。
5. 点击“生成日报”。本地 Markdown 保存成功后，日报会追加到该飞书文档末尾。

支持直接填写 `https://xxx.feishu.cn/docx/...` 文档链接，也支持填写文档 ID。飞书凭证只保存在本机用户配置中，不会写入项目目录；同步请求由 Electron 主进程发起。重复生成同一天的日报会再次追加一份内容，请避免重复点击，或在飞书文档中手动删除重复段落。

## 配置日报模型

设置中的“自动读取会话”默认开启，启动时读取一次，此后每 5 分钟读取；关闭并保存后停止自动读取（正在进行的读取会完成），仍可手动读取。启动时会先加载已保存设置，避免关闭后仍读取一次。

“自动生成日报”支持独立开关和时间选择，保存后生效。使用电脑本地时间，应用需保持打开；错过时间后打开会补生成。当日没有会话时跳过，每天最多自动生成一次。自动生成日报前会读取当天会话，即使关闭了自动读取；如不希望应用主动读取，请同时关闭两个开关。关闭自动生成不影响手动生成日报，或已开启的每 5 分钟读取。

打开应用右上角设置，填写：

| 配置 | 示例 |
| --- | --- |
| API Base URL | `https://api.openai.com` |
| API Key | 你的服务密钥 |
| 模型 | `gpt-4o-mini`、`deepseek-chat` 等 |
| 日报提示词 | 可按个人偏好修改归纳规则 |

支持兼容 `/v1/chat/completions` 的服务。API Key 不会写入项目目录；应用将配置保存在 Electron 用户数据目录下的隐藏 `.settings.json`，并设为当前用户可读写。当前版本尚未接入 macOS Keychain，配置仍是本机明文文件，请妥善保管设备与密钥。

## 数据与隐私

- 不使用 SQLite、向量数据库或后台同步服务。
- 原始会话只在读取和生成过程中以内存对象处理，不另建会话数据库。
- 本地工具的原始 JSONL 保留在其原有目录，不会复制到项目目录。
- 生成后的 Markdown 日报按用户配置写入磁盘。
- 豆包和 DeepSeek 的登录状态由 Electron 持久化 Session 保存。
- 使用外部 LLM 时，选定日期的会话内容会发送到用户配置的 API 服务。
- 不配置 API Key 时不会请求外部 LLM，而是生成基础日报。

在使用第三方模型服务前，请确认其数据处理政策符合你的需求。

## 项目结构

```text
summary_app/
├── electron/
│   ├── main.ts                 # Electron 主进程与 IPC
│   ├── preload.ts              # 渲染进程安全桥接
│   ├── doubao-preload.ts       # 豆包网页上下文读取
│   └── deepseek-preload.ts     # DeepSeek 网页上下文读取
├── core/
│   ├── codex-reader.ts         # Codex JSONL 读取
│   ├── claude-reader.ts        # Claude Code JSONL 读取
│   ├── normalizer.ts           # 会话合并与去重
│   ├── summarizer.ts           # LLM 调用与本地降级摘要
│   ├── markdown-writer.ts      # Markdown 写入
│   └── types.ts                # 统一数据类型
├── src/
│   ├── App.tsx                 # 主界面
│   └── styles/                 # 应用样式
├── tests/                      # 读取、去重、总结和路径检测测试
└── build/icon.png              # macOS 和 Windows 应用图标源文件
```

## 当前边界

当前版本刻意保持轻量，暂不包含后台常驻监听、向量数据库、本地 RAG、全文搜索、Notion 同步或多人协作。本地 JSONL 格式、网页 DOM 和网页内部接口都可能随着上游工具更新而变化，因此读取器需要持续维护。

## 开源参考与致谢

本项目独立实现，参考了 Engineering Notebook 的工程日志工作流、AgentHUD 的 Codex/Claude Code 会话结构资料，以及 [VESTI](https://github.com/abraxas914/VESTI) 的豆包网页接入思路。没有直接复制上述项目源码。相关说明见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

## 许可证

本项目自有代码采用 [MIT 许可证](LICENSE)，版权署名为 `kfcLJH-HUB`。第三方依赖、品牌图标和商标不因本项目采用 MIT 而变更其原有权利，详见 [第三方声明](THIRD_PARTY_NOTICES.md)。

## 参与与反馈

- 开始贡献前请阅读 [贡献指南](CONTRIBUTING.md)。
- 问题反馈与功能建议可使用仓库的 Issue 模板，提交前请移除私人会话、密钥和用户名路径。
- 版本变化见 [更新日志](CHANGELOG.md)，未发布内容列在 Unreleased。
- 安全问题与当前数据处理边界见 [安全说明](SECURITY.md)。

---

<div align="center"><sub>让对话留在工具里，让成果留在每天的记录里。</sub></div>
