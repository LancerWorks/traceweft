import { ipcRenderer } from "electron"
import { createNetworkScope, WEB_READ_TIMEOUT_MS, type NetworkScope } from "../core/network"
import { deepSeekMessageShape, deepSeekMilliseconds, deepSeekTimestamp, isDeepSeekPagePastDate, isDeepSeekSessionOnDate, selectDeepSeekMessages, type DeepSeekHistoryMessage, type DeepSeekSession } from "../core/deepseek-reader"

const ORIGIN = "https://chat.deepseek.com"
const APP_VERSION = "2025.04.25"

type ApiEnvelope<T> = {
  code?: number
  msg?: string
  data?: { biz_code?: number; biz_msg?: string; biz_data?: T }
}

function readUserToken(): string {
  try {
    const raw = localStorage.getItem("userToken")
    if (!raw) return ""
    try {
      const parsed = JSON.parse(raw) as unknown
      if (typeof parsed === "string") return parsed
      if (parsed && typeof parsed === "object") {
        const value = parsed as { value?: unknown; token?: unknown }
        if (typeof value.value === "string") return value.value
        if (typeof value.token === "string") return value.token
      }
    } catch {
      return raw
    }
  } catch { /* DeepSeek can block storage before login. */ }
  return ""
}

async function fetchBizData<T>(path: string, scope: NetworkScope): Promise<T> {
  const token = readUserToken()
  if (!token) throw new Error("DeepSeek 尚未登录")
  const response = await scope.run(() => fetch(`${ORIGIN}${path}`, {
    signal: scope.signal,
    credentials: "include",
    headers: { Accept: "application/json", Authorization: `Bearer ${token}`, "X-App-Version": APP_VERSION },
  }))
  if (!response.ok) throw new Error(`DeepSeek 接口返回 ${response.status}`)
  const envelope = await scope.run(() => response.json()) as ApiEnvelope<T>
  const code = envelope.code ?? 0
  const businessCode = envelope.data?.biz_code ?? 0
  if (code !== 0 || businessCode !== 0) throw new Error(envelope.data?.biz_msg || envelope.msg || "DeepSeek 登录状态已失效")
  if (envelope.data?.biz_data == null) throw new Error("DeepSeek 未返回有效数据")
  return envelope.data.biz_data
}

async function mapConcurrent<T, R>(items: T[], concurrency: number, worker: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length)
  let cursor = 0
  async function run() {
    while (cursor < items.length) {
      const index = cursor
      cursor += 1
      results[index] = await worker(items[index])
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, run))
  return results
}

async function readHistory(date: string, scope: NetworkScope) {
  try {
    if (!readUserToken()) return { conversations: [], connected: false, needsLogin: true, error: "DeepSeek 尚未登录" }
    const seen = new Set<string>()
    const relevant: DeepSeekSession[] = []
    let cursor: { pinned: number; updatedAt: number } | null = null
    let hasMore = true
    for (let pageNumber = 0; pageNumber < 10 && hasMore; pageNumber += 1) {
      const params = new URLSearchParams({ count: "50" })
      if (cursor) {
        params.set("lte_cursor.pinned", String(cursor.pinned))
        params.set("lte_cursor.updated_at", String(cursor.updatedAt))
      }
      const page = await fetchBizData<{ chat_sessions?: DeepSeekSession[]; has_more?: boolean }>(`/api/v0/chat_session/fetch_page?${params}`, scope)
      if (!Array.isArray(page.chat_sessions)) throw new Error("DeepSeek 会话列表格式已变化，无法读取历史记录")
      const sessions = page.chat_sessions
      if (!sessions.length) break
      for (const session of sessions) {
        if (!session.id || seen.has(session.id)) continue
        seen.add(session.id)
        if (isDeepSeekSessionOnDate(session, date)) relevant.push(session)
      }
      const last = sessions.at(-1)
      const updatedAt = deepSeekMilliseconds(last?.updated_at)
      if (updatedAt == null || relevant.length >= 100) break
      const nextCursor = { pinned: last?.pinned ? 1 : 0, updatedAt: updatedAt / 1000 }
      if (cursor?.pinned === nextCursor.pinned && cursor.updatedAt === nextCursor.updatedAt) break
      cursor = nextCursor
      hasMore = Boolean(page.has_more)
      if (isDeepSeekPagePastDate(sessions, date)) break
    }

    let failures = 0
    let textCount = 0
    let usedSessionDate = false
    let responseShape = ""
    let undatedOlderMessages = false
    const fetched = await mapConcurrent(relevant, 4, async (session) => {
      if (!session.id) return null
      try {
        const detail = await fetchBizData<{ chat_messages?: DeepSeekHistoryMessage[] }>(`/api/v0/chat/history_messages?chat_session_id=${encodeURIComponent(session.id)}`, scope)
        if (!Array.isArray(detail.chat_messages)) throw new Error("DeepSeek 消息格式已变化")
        if (!responseShape || responseShape.includes("消息列表为空")) responseShape = deepSeekMessageShape(detail.chat_messages)
        const selected = selectDeepSeekMessages(session, detail.chat_messages, date)
        textCount += selected.textCount
        usedSessionDate ||= selected.usedSessionDate
        undatedOlderMessages ||= !selected.messages.length && selected.textCount > 0 && !isDeepSeekSessionOnDate({ inserted_at: session.inserted_at }, date) &&
          detail.chat_messages.every((message) => message.inserted_at == null && message.updated_at == null)
        const messages = selected.messages
        if (!messages.length) return null
        return {
          source: "deepseek" as const,
          sessionId: String(session.id),
          title: session.title?.trim() || "DeepSeek 会话",
          startedAt: messages[0].timestamp ?? deepSeekTimestamp(session.inserted_at),
          endedAt: messages.at(-1)?.timestamp ?? deepSeekTimestamp(session.updated_at ?? session.inserted_at),
          messages,
        }
      } catch {
        scope.check()
        failures += 1
        return null
      }
    })
    const conversations = fetched.filter(Boolean)

    const warnings = [
      failures ? `DeepSeek 有 ${failures} 个会话读取失败，请稍后重试` : "",
      usedSessionDate ? "部分消息缺少时间，已按会话日期归档" : "",
      !seen.size ? "DeepSeek 接口没有返回历史会话，请确认内嵌网页登录的是同一个账号" : "",
      !conversations.length && relevant.length && !failures ?
        textCount ? `DeepSeek 今天有 ${relevant.length} 个更新过的会话，但${undatedOlderMessages ? "旧会话的消息缺少时间，无法确认哪些属于今天，未导入" : "没有可确认属于今天的消息"}` :
          `DeepSeek 今天有 ${relevant.length} 个会话，但未解析到用户或 AI 文本（${responseShape || "消息格式未知"}），请重新读取` : "",
    ].filter(Boolean)
    return { conversations, connected: true, ...(warnings.length ? { error: warnings.join("；") } : {}) }
  } catch (error) {
    const message = error instanceof Error ? error.message : "DeepSeek 历史读取失败"
    return { conversations: [], connected: false, needsLogin: message.includes("尚未登录") || message.includes("登录状态") || /\b(401|403)\b/.test(message), error: message }
  }
}

const requests = new Map<string, NetworkScope>()
ipcRenderer.on("deepseek:cancel-history", (_event, requestId: string) => requests.get(requestId)?.cancel())
ipcRenderer.on("deepseek:read-history", async (_event, request: { requestId: string; date: string }) => {
  const scope = createNetworkScope("DeepSeek 读取", WEB_READ_TIMEOUT_MS)
  requests.set(request.requestId, scope)
  try {
    const result = await scope.run(() => readHistory(request.date, scope))
    ipcRenderer.send("deepseek:read-history-result", { requestId: request.requestId, result })
  } catch (error) {
    ipcRenderer.send("deepseek:read-history-result", { requestId: request.requestId, result: {
      conversations: [], connected: false, error: error instanceof Error ? error.message : "DeepSeek 读取失败",
    } })
  } finally { requests.delete(request.requestId); scope.dispose() }
})
