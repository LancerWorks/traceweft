import { afterEach, describe, expect, it, vi } from "vitest"
import { generateDailySummary } from "../core/summarizer"
import type { Conversation } from "../core/types"
import { SUMMARY_TIMEOUT_MS } from "../core/network"

const conversations: Conversation[] = [{
  source: "codex",
  sessionId: "one",
  title: "实现日报功能",
  messages: [{ id: "m1", role: "user", content: "实现日报功能", timestamp: "2026-09-22T08:00:00Z" }]
}]

describe("summarizer", () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })

  it("times out even when the response body never finishes and aborts the request", async () => {
    vi.useFakeTimers()
    let signal: AbortSignal | undefined
    vi.stubGlobal("fetch", vi.fn((_url, init) => {
      signal = init.signal
      return Promise.resolve({ ok: true, json: () => new Promise(() => {}) })
    }))
    const pending = generateDailySummary("2026-10-12", conversations, { apiBaseUrl: "https://example.com", apiKey: "test", model: "test" })
    const assertion = expect(pending).rejects.toThrow("日报生成超时")
    await vi.advanceTimersByTimeAsync(SUMMARY_TIMEOUT_MS)
    await assertion
    expect(signal?.aborted).toBe(true)
    expect(vi.getTimerCount()).toBe(0)
  })

  it("cancels an in-flight request and permits a fresh generation", async () => {
    const controller = new AbortController()
    const request = vi.fn((_url, init) => new Promise((_resolve, reject) => {
      init.signal.addEventListener("abort", () => reject(init.signal.reason), { once: true })
    }))
    vi.stubGlobal("fetch", request)
    const pending = generateDailySummary("2026-10-12", conversations, { apiBaseUrl: "https://example.com", apiKey: "test", model: "test" }, controller.signal)
    await Promise.resolve()
    controller.abort()
    await expect(pending).rejects.toThrow("操作已取消")
    const result = await generateDailySummary("2026-10-12", conversations, { apiBaseUrl: "", apiKey: "", model: "" })
    expect(result.accomplishments).toEqual(["实现日报功能"])
  })

  it("returns a local fallback when no API key is configured", async () => {
    const summary = await generateDailySummary("2026-09-22", conversations, { apiBaseUrl: "https://api.openai.com", apiKey: "", model: "gpt-4o-mini" })
    expect(summary.date).toBe("2026-09-22")
    expect(summary.markdown).toContain("## 今日完成事项")
    expect(summary.markdown).toContain("## 重点学习")
    expect(summary.markdown).toContain("1. 实现日报功能")
    expect(summary.markdown).not.toContain("# 2026-09-22")
    expect(summary.sourceBreakdown.codex).toBe(1)
  })

  it("uses a custom prompt and replaces its template variables", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: JSON.stringify({
        accomplishments: ["完成日报功能：整理了当天会话。"],
        knowledgeAbsorbed: ["掌握了日报归纳方法。"],
        tomorrow: ["继续验证输出。", "检查历史记录。"],
      }) } }] }),
    })
    vi.stubGlobal("fetch", fetchMock)

    const summary = await generateDailySummary("2026-09-22", conversations, {
      apiBaseUrl: "https://api.openai.com",
      apiKey: "test-key",
      model: "test-model",
      summaryPrompt: "请按自定义规则处理 {{date}}。\n会话：\n{{conversations}}",
    })

    const request = fetchMock.mock.calls[0]?.[1] as RequestInit
    const body = JSON.parse(String(request.body)) as { messages: Array<{ content: string }> }
    expect(body.messages[1].content).toContain("2026-09-22")
    expect(body.messages[1].content).toContain("实现日报功能")
    expect(body.messages[1].content).toContain("请按自定义规则处理")
    expect(summary.tomorrow).toEqual(["继续验证输出。"])
  })

  it("includes DeepSeek conversations in the report and source breakdown", async () => {
    const summary = await generateDailySummary("2026-09-22", [{ ...conversations[0], source: "deepseek" }], {
      apiBaseUrl: "https://api.openai.com", apiKey: "", model: "gpt-4o-mini",
    })
    expect(summary.sourceBreakdown.deepseek).toBe(1)
  })
})
