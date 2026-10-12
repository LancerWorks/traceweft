import type { Conversation, DailySummary, Source, SummaryOptions } from "./types"
import { sourceCounts } from "./normalizer"
import { truncate } from "./utils"
import { createNetworkScope, SUMMARY_TIMEOUT_MS } from "./network"

export const DEFAULT_SUMMARY_PROMPT = `请根据下面的 AI 编程和聊天会话，生成 {{date}} 的中文日报。只返回 JSON，不要 Markdown 代码块，结构必须是：
{"accomplishments":["今日完成事项或重点学习"],"knowledgeAbsorbed":["重点学习"],"tomorrow":["明日建议"]}
不要生成 headline、overview、日报总标题、引言或“围绕……展开”之类的摘要。
整理要求：
1. 今日完成事项：按会话归纳当天真正完成的工作或真正吸收的重点内容。每个有实质内容的会话通常只生成 1 条；每条用 1-2 句话，先写结论，再用冒号补充关键细节，例如“完善豆包读取流程：读取前检查登录状态，未登录时打开登录页”。学习型会话也要放进这里，简短说明学到了什么；区分已完成/已掌握与计划中、尝试中或尚未验证的内容，不能仅凭用户提出了需求就认定已完成。
2. 重点学习：只提取真正学到的技术概念、工作方法、领域知识或可复用结论，简短表达，不要机械重复完成事项。不要把本应用自身的开发过程、文件路径、JSONL/会话存储、标题读取、监听实现、日报生成、API 配置或模型调用链路当作知识；没有值得记录的新知识就返回空数组。
3. 明日建议：只根据明确的未完成事项、后续步骤或仍待解决的问题提出建议，最多 1 条且只用一句话；没有明确依据就返回空数组。
4. 内容筛选：忽略寒暄、感谢、查单个普通英语单词、简单翻译、无实质信息的短问答等琐碎内容；但若短对话涉及当前工作且提供了重要信息，应保留。
5. 只依据会话中明确的信息，不要推测或编造；语言简洁、具体，避免重复、逐轮复述和长篇解释。

会话内容：
{{conversations}}`

function endpoint(base: string): string {
  const trimmed = base.trim().replace(/\/$/, "")
  return trimmed.endsWith("/v1") ? `${trimmed}/chat/completions` : `${trimmed}/v1/chat/completions`
}

function sourceLabel(source: Source): string {
  if (source === "claude-code") return "Claude Code"
  if (source === "codex") return "Codex"
  if (source === "doubao") return "豆包"
  return "DeepSeek"
}

function conversationText(conversations: Conversation[], maxCharacters: number): string {
  let used = 0
  const chunks: string[] = []
  for (const conversation of conversations) {
    const lines = conversation.messages.map((message) => `${message.role === "user" ? "用户" : "助手"}: ${message.content}`).join("\n")
    const chunk = `## [${sourceLabel(conversation.source)}] ${conversation.title}\n项目：${conversation.projectPath ?? "未知"}\n${lines}`
    const available = Math.max(0, maxCharacters - used)
    if (available <= 0) break
    chunks.push(truncate(chunk, available))
    used += Math.min(chunk.length, available)
  }
  return chunks.join("\n\n---\n\n")
}

function parseJsonObject(content: string): Record<string, unknown> | null {
  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1] ?? content
  try {
    const parsed = JSON.parse(fenced.trim()) as unknown
    return parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : null
  } catch { return null }
}

function listField(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    .map((item) => item.trim().replace(/^\s*(?:[-*•]|\d+[.)])\s+/, ""))
    .filter(Boolean)
}

function numbered(items: string[]): string {
  return items.length ? items.map((item, index) => `${index + 1}. ${item}`).join("\n") : "无"
}

function buildPrompt(date: string, conversations: Conversation[], customPrompt: string | undefined, maxCharacters: number): string {
  const content = conversationText(conversations, maxCharacters)
  const template = customPrompt?.trim() || DEFAULT_SUMMARY_PROMPT
  const withDate = template.split("{{date}}").join(date)
  if (withDate.includes("{{conversations}}")) return withDate.split("{{conversations}}").join(content)
  return `${withDate}\n\n会话内容：\n${content}`
}

function fallbackSummary(date: string, conversations: Conversation[]): DailySummary {
  const counts = sourceCounts(conversations)
  const titles = conversations.slice(0, 5).map((conversation) => conversation.title)
  const markdown = `## 今日完成事项\n\n${numbered(titles)}\n\n## 重点学习\n\n无\n\n## 明日建议\n\n无\n`
  return { date, accomplishments: titles, knowledgeAbsorbed: [], tomorrow: [], sourceBreakdown: counts, markdown }
}

export async function generateDailySummary(date: string, conversations: Conversation[], options: SummaryOptions, signal?: AbortSignal): Promise<DailySummary> {
  if (signal?.aborted) throw new Error("操作已取消")
  if (!conversations.length) return fallbackSummary(date, conversations)
  if (!options.apiKey.trim()) return fallbackSummary(date, conversations)

  const prompt = buildPrompt(date, conversations, options.summaryPrompt, options.maxCharacters ?? 70000)

  const scope = createNetworkScope("日报生成", SUMMARY_TIMEOUT_MS, signal)
  try {
  const response = await scope.run(() => fetch(endpoint(options.apiBaseUrl || "https://api.openai.com"), {
    signal: scope.signal,
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${options.apiKey}` },
    body: JSON.stringify({ model: options.model || "gpt-4o-mini", temperature: 0.2, messages: [
      { role: "system", content: "你是一个严谨的个人工程日志助手。" },
      { role: "user", content: prompt }
    ] })
  }))
  if (!response.ok) throw new Error(`LLM 请求失败：${response.status} ${await scope.run(() => response.text())}`)
  const body = await scope.run(() => response.json()) as { choices?: Array<{ message?: { content?: string } }> }
  const content = body.choices?.[0]?.message?.content ?? ""
  const data = parseJsonObject(content)
  if (!data) throw new Error("LLM 返回内容不是有效 JSON")

  const accomplishments = listField(data.accomplishments)
  const knowledgeAbsorbed = listField(data.knowledgeAbsorbed)
  const tomorrow = listField(data.tomorrow).slice(0, 1)
  const counts = sourceCounts(conversations)
  const section = (title: string, items: string[]) => `## ${title}\n\n${numbered(items)}`
  const sourceItems = [
    `Codex：${counts.codex} 个会话`,
    `Claude Code：${counts["claude-code"]} 个会话`,
    `豆包：${counts.doubao} 个会话`,
    `DeepSeek：${counts.deepseek} 个会话`,
  ]
  const sessionItems = conversations.map((conversation) => `**${sourceLabel(conversation.source)}** ${conversation.title}`)
  const markdown = `${section("今日完成事项", accomplishments)}\n\n${section("重点学习", knowledgeAbsorbed)}\n\n${section("明日建议", tomorrow)}\n\n## 来源统计\n\n${numbered(sourceItems)}\n\n## 会话清单\n\n${numbered(sessionItems)}`
  return { date, accomplishments, knowledgeAbsorbed, tomorrow, sourceBreakdown: counts, markdown }
  } finally { scope.dispose() }
}
