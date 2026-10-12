import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, expect, it } from "vitest"
import { writeSummaryMarkdown } from "../core/markdown-writer"
import type { DailySummary } from "../core/types"

const dirs: string[] = []
afterEach(() => { for (const path of dirs.splice(0)) rmSync(path, { recursive: true, force: true }) })
const summary: DailySummary = { date: "2026-10-12", markdown: "新的日报", accomplishments: [], knowledgeAbsorbed: [], tomorrow: [], sourceBreakdown: { codex: 0, "claude-code": 0, doubao: 0, deepseek: 0 } }
function target() { const dir = mkdtempSync(join(tmpdir(), "summary-writer-")); dirs.push(dir); return join(dir, "中文 目录", "2026-10-12.md") }

it("automatic generation preserves edited journals and existing timestamp files, including collisions", () => {
  const file = target()
  writeSummaryMarkdown({ ...summary, markdown: "用户修改" }, file)
  const now = new Date(2026, 9, 12, 19, 0, 1, 123)
  const first = writeSummaryMarkdown(summary, file, true, now)
  writeFileSync(first, "先前自动日报")
  const second = writeSummaryMarkdown(summary, file, true, now)
  expect(first).toMatch(/2026-10-12-20261012-190001-123\.md$/)
  expect(second).toMatch(/-123-1\.md$/)
  expect(readFileSync(file, "utf8")).toBe("用户修改")
  expect(readFileSync(first, "utf8")).toBe("先前自动日报")
  expect(readFileSync(second, "utf8")).toBe(summary.markdown)
})

it("manual generation retains its configured path", () => {
  const file = target()
  expect(writeSummaryMarkdown(summary, file)).toBe(file)
  expect(readFileSync(file, "utf8")).toBe(summary.markdown)
})
