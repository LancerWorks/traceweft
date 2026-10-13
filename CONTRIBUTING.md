# 参与贡献

感谢你帮助 Traceweft 变得更好。欢迎提交问题、提出建议或贡献代码。

## 开始之前

1. 搜索已有 Issue，避免重复反馈；较大的功能修改请先开 Issue 讨论。
2. 本项目希望保持轻量：本地读取会话、生成 Markdown 日报，不建立原始会话数据库。
3. 豆包与 DeepSeek 的接入依赖网页内部实现，请勿绕过登录、权限检查或访问控制。
4. 提交的代码与文档适用本项目 MIT 许可证。引入第三方资源时，请附上来源和许可证，不要假定品牌图标属于 MIT。

## 本地开发

- Node.js 22 LTS，版本至少为 22.12.0。
- npm；macOS 或 Windows。Windows 安装包尚待真实 Windows 环境验收。

```bash
git clone https://github.com/kfcLJH-HUB/traceweft.git
cd traceweft
npm ci
npm run dev
```

仓库若仍为私有仓库，需先获得访问权限；请不要将此说明理解为仓库已公开。

## 提交前检查

```bash
npm run typecheck
npm test
npm run build
git diff --check
```

- 保持现有 TypeScript、React 与 CSS 风格，小范围、单一目的地修改。
- 修复读取器或日期筛选时补充回归测试；使用虚构或已脱敏的 JSONL 示例。
- 若修改设置字段，兼容旧配置并补充默认值。
- 修改界面时检查 900×640 和 760×520 窗口，以及加载、失败、空数据状态。
- 更新相关 README、第三方声明和 CHANGELOG 的 Unreleased 部分。
- 打包命令见 [README](README.md)，版本流程见 [发布指南](docs/RELEASING.md)；不要将 `release/`、`dist/` 或 `dist-electron/` 放进 Git。

## Pull Request

说明改了什么、为什么改、如何验证，并关联对应 Issue。界面调整可附脱敏截图；Windows 相关修改请说明是否在 Windows 实机验证。

不要提交 API Key、App Secret、Cookie、Token、真实会话、私人日报、本机配置或带真实用户名的绝对路径。即便 `.gitignore` 已有规则，也请检查暂存文件与截图。

## 反馈与安全

一般问题和功能建议可使用仓库的 Issue 模板。请提供版本、系统/架构、复现步骤与已脱敏错误信息。

安全漏洞、密钥泄漏等问题请先阅读 [SECURITY.md](SECURITY.md)，不要在公开 Issue 中贴敏感信息。
