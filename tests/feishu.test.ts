import { describe, expect, it, vi } from "vitest"
import { appendSummaryToFeishu, extractFeishuDocumentId, summaryToFeishuBlocks } from "../core/feishu"
import type { AppSettings, DailySummary } from "../core/types"

const summary: DailySummary = {
  date: "2026-09-24",
  accomplishments: ["完成飞书同步：日报生成后自动追加到云文档。"],
  knowledgeAbsorbed: ["了解飞书文档写入接口。"],
  tomorrow: [],
  sourceBreakdown: { codex: 1, "claude-code": 0, doubao: 0, deepseek: 0 },
  markdown: "## 今日完成事项\n\n1. **完成飞书同步**：日报自动追加。\n\n## 重点学习\n\n1. 了解 `docx` 接口。",
}

const settings: AppSettings = {
  codexPaths: [],
  claudePaths: [],
  outputPath: "",
  apiBaseUrl: "",
  apiKey: "",
  model: "",
  summaryPrompt: "",
  autoReadEnabled: true,
  autoSummaryEnabled: true,
  autoSummaryTime: "19:00",
  feishuEnabled: true,
  feishuAppId: "cli_test",
  feishuAppSecret: "secret_test",
  feishuDocumentId: "https://example.feishu.cn/docx/doxcn_test123?from=from_copylink",
}

describe("feishu integration", () => {
  it("extracts a document ID from a Feishu URL or raw ID", () => {
    expect(extractFeishuDocumentId(settings.feishuDocumentId)).toBe("doxcn_test123")
    expect(extractFeishuDocumentId("doxcn_raw123")).toBe("doxcn_raw123")
  })

  it("converts the generated Markdown into plain text blocks", () => {
    const blocks = summaryToFeishuBlocks(summary)
    expect(blocks.map((block) => block.text.elements[0].text_run.content)).toEqual([
      "Traceweft · 2026-09-24",
      "今日完成事项",
      "1. 完成飞书同步：日报自动追加。",
      "重点学习",
      "1. 了解 docx 接口。",
    ])
  })

  it("gets a tenant token and appends blocks to the document root", async () => {
    const request = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ code: 0, tenant_access_token: "tenant_test" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ code: 0 }), { status: 200 }))

    await expect(appendSummaryToFeishu(summary, settings, request)).resolves.toBe("doxcn_test123")
    expect(request).toHaveBeenNthCalledWith(1, expect.stringContaining("auth/v3/tenant_access_token/internal"), expect.objectContaining({ method: "POST" }))
    expect(request).toHaveBeenNthCalledWith(2, expect.stringContaining("docx/v1/documents/doxcn_test123/blocks/doxcn_test123/children"), expect.objectContaining({
      headers: expect.objectContaining({ Authorization: "Bearer tenant_test" }),
    }))
  })
})
