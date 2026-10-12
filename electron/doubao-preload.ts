import { contextBridge, ipcRenderer } from "electron"
import { createNetworkScope, WEB_READ_TIMEOUT_MS, type NetworkScope } from "../core/network"

const ORIGIN = "https://www.doubao.com"
const CMD_RECENT = 3200
const CMD_INFO = 1110
const CMD_BATCH_GET = 1111
const CMD_SINGLE = 3100
const CONVERSATION_TYPE = 3
const FROM_LATEST = 3
const OLDER = 1

function cookieValue(name: string): string {
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`))
  return match ? decodeURIComponent(match[1]) : ""
}

function valueFromStorage(...names: string[]): string {
  for (const name of names) {
    try {
      const value = localStorage.getItem(name)
      if (value && value.length > 4) return value.replace(/^"|"$/g, "")
    } catch { /* ignore */ }
  }
  return ""
}

function queryString(): string {
  let best = ""
  try {
    const entries = performance.getEntriesByType("resource")
    // Query parameters may contain endpoint-specific anti-bot signatures.
    // Prefer a query captured from the exact history endpoint rather than
    // reusing the longer /alice/im/launch query (which returns 系统内部异常).
    for (const entry of entries) {
      if (!entry.name.includes("/im/chain/recent_conv")) continue
      const url = new URL(entry.name)
      if (url.hostname === "www.doubao.com") return url.search
    }
    for (const entry of entries) {
      if (!entry.name.includes("/im/")) continue
      const url = new URL(entry.name)
      if (url.hostname === "www.doubao.com" && !url.pathname.startsWith("/alice/") && url.search.length > best.length) best = url.search
    }
  } catch { /* fallback */ }
  if (best) return best
  let clientDevice: any = {}
  try { clientDevice = JSON.parse(localStorage.getItem("client_device_info") ?? "{}") } catch { /* ignore */ }
  const deviceId = valueFromStorage("device_id", "tea_device_id", "__tea_device_id") || String(clientDevice.device_id ?? clientDevice.deviceId ?? "")
  const webId = valueFromStorage("samantha_web_web_id", "web_id", "__tea_web_id", "tea_web_id") || cookieValue("s_v_web_id") || deviceId
  return `?${new URLSearchParams({ version_code: "20800", language: "zh", device_platform: "web", aid: "497858", real_aid: "497858", pkg_type: "release_version", device_id: deviceId, pc_version: "3.19.3", web_id: webId, tea_uuid: webId, region: "CN", sys_region: "CN", samantha_web: "1", "use-olympus-account": "1", web_tab_id: crypto.randomUUID() })}`
}

let cachedSearch = ""

async function getSearch(scope: NetworkScope): Promise<string> {
  scope.check()
  if (cachedSearch) return cachedSearch
  for (let attempt = 0; attempt < 25; attempt += 1) {
    const hasFirstPartyRecentRequest = performance.getEntriesByType("resource").some((entry) => entry.name.includes("/im/chain/recent_conv"))
    if (hasFirstPartyRecentRequest) {
      cachedSearch = queryString()
      return cachedSearch
    }
    await scope.run(() => new Promise<void>((resolve) => setTimeout(resolve, 200)))
  }
  // Do not cache fallback parameters: a later first-party request may provide
  // fresher device and web identifiers.
  return queryString()
}

async function post(scope: NetworkScope, path: string, cmd: number, uplinkKey: string, downlinkKey: string, payload: unknown): Promise<any> {
  const search = await getSearch(scope)
  const response = await scope.run(() => fetch(`${ORIGIN}${path}${search}`, {
    signal: scope.signal,
    method: "POST",
    credentials: "include",
    headers: { Accept: "application/json, text/plain, */*", "Content-Type": "application/json; encoding=utf-8", "agw-js-conv": "str" },
    body: JSON.stringify({ cmd, uplink_body: { [uplinkKey]: payload }, sequence_id: crypto.randomUUID(), channel: 2, version: "1" })
  }))
  if (!response.ok) throw new Error(`豆包接口 ${path} 返回 ${response.status}`)
  const data = await scope.run(() => response.json())
  if (data.status_code && data.status_code !== 0) throw new Error(data.status_desc || `豆包接口 ${path} 失败`)
  return data.downlink_body?.[downlinkKey] ?? {}
}

function wireVersion(value: unknown): number | string {
  if (value == null || value === "") return 0
  const text = String(value)
  if (/^\d+$/.test(text)) {
    const number = Number(text)
    if (Number.isSafeInteger(number)) return number
  }
  return text
}

function localDate(value: string): string {
  return new Intl.DateTimeFormat("en-CA").format(new Date(value))
}

function timestamp(value: unknown): string | undefined {
  const number = Number(value)
  if (!Number.isFinite(number) || number <= 0) return undefined
  return new Date(number < 10_000_000_000 ? number * 1000 : number).toISOString()
}

function parseContent(value: unknown): any {
  if (typeof value !== "string") return value
  try { return JSON.parse(value) } catch { return value }
}

function blockText(block: any): string {
  if (!block || Number(block.block_type) !== 10000) return ""
  const content = parseContent(block.content)
  return typeof content?.text_block?.text === "string" ? content.text_block.text.trim() : ""
}

function messageText(message: any): string {
  if (Number(message.content_type) === 1) {
    const content = parseContent(message.content)
    if (typeof content?.text === "string") return content.text.trim()
    return typeof content === "string" ? content.trim() : ""
  }
  if (Number(message.content_type) === 9999) {
    const parsed = parseContent(message.content)
    const blocks = Array.isArray(parsed) ? parsed : Array.isArray(message.content_block) ? message.content_block : []
    return blocks.map(blockText).filter(Boolean).join("\n\n").trim()
  }
  return ""
}

type ConversationRef = { id: string; title: string; updatedAt?: string; latestIndex?: number; recentMessages?: any[] }

function currentConversationId(): string {
  const match = location.pathname.match(/^\/chat\/([^/?#]+)/)
  const id = match?.[1] ?? ""
  return /^\d+$/.test(id) ? id : ""
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

function conversationInfoList(body: any): any[] {
  if (Array.isArray(body?.conversation_info_list)) return body.conversation_info_list
  if (Array.isArray(body?.conversation_infos)) return body.conversation_infos
  return []
}

async function batchGetConversationInfo(ids: string[], scope: NetworkScope): Promise<any[]> {
  if (!ids.length) return []
  const body = await post(
    scope,
    "/im/conversation/batch_get",
    CMD_BATCH_GET,
    "batch_get_conv_info_uplink_body",
    "batch_get_conv_info_downlink_body",
    {
      conversation_id: ids,
      option: { recent_message_count_per_conv: 1 },
      ext: {},
    },
  ).catch(() => { scope.check(); return {} })
  return conversationInfoList(body)
}

function mergeConversationInfo(refs: ConversationRef[], infos: any[]): void {
  const refsById = new Map(refs.map((ref) => [ref.id, ref]))
  for (const info of infos) {
    const id = String(info?.conversation_id ?? "").trim()
    const ref = refsById.get(id)
    if (!ref) continue
    if (typeof info.name === "string" && info.name.trim()) ref.title = info.name.trim()
    ref.updatedAt = timestamp(info.update_time) ?? ref.updatedAt
    const latestIndex = Number(info.latest_index)
    if (Number.isFinite(latestIndex) && latestIndex > 0) ref.latestIndex = latestIndex
    if (Array.isArray(info.messages)) ref.recentMessages = info.messages
  }
}

async function fetchConversation(ref: ConversationRef, date: string, scope: NetworkScope) {
  const infoBody = await post(scope, "/im/conversation/info", CMD_INFO, "get_conv_info_uplink_body", "get_conv_info_downlink_body", {
    conversation_id: ref.id,
    ext: {},
    bot_id: "",
    conversation_type: CONVERSATION_TYPE,
    option: { need_bot_info: true },
  }).catch(() => { scope.check(); return {} })
  const info = infoBody.conversation_info ?? {}
  const title = info.name || ref.title
  let cursor = Number(info.latest_index) || ref.latestIndex || 0
  const messages: any[] = []
  const seenMessages = new Set<string>()

  // batch_get returns one recent message per conversation. Keep it as a
  // fallback because the first sidebar item can have a stale conversation
  // info response until it is opened in Doubao.
  for (const item of ref.recentMessages ?? []) {
    if (typeof item.status === "number" && item.status !== 0) continue
    const content = messageText(item)
    const ts = timestamp(item.create_time)
    const id = String(item.message_id ?? `${ref.id}-recent-${messages.length}`)
    if (!content || !ts || localDate(ts) !== date || seenMessages.has(id)) continue
    seenMessages.add(id)
    messages.push({ id, role: Number(item.user_type) === 1 ? "user" : "assistant", content, timestamp: ts, index: Number(item.index_in_conv) || 0 })
  }

  for (let page = 0; page < 20; page += 1) {
    const body = await post(scope, "/im/chain/single", CMD_SINGLE, "pull_singe_chain_uplink_body", "pull_singe_chain_downlink_body", {
      conversation_id: ref.id,
      anchor_index: cursor,
      conversation_type: CONVERSATION_TYPE,
      direction: cursor > 0 ? OLDER : FROM_LATEST,
      limit: 50,
      ext: {},
      filter: { index_list: [] },
      evaluate_ab_params: "",
      evaluate_common_params: "",
    }).catch(() => { scope.check(); return null })
    const raw = Array.isArray(body?.messages) ? body.messages : []
    if (!raw.length) break
    for (const item of raw) {
      if (typeof item.status === "number" && item.status !== 0) continue
      const content = messageText(item)
      const ts = timestamp(item.create_time)
      const id = String(item.message_id ?? `${ref.id}-${messages.length}`)
      if (!content || !ts || localDate(ts) !== date || seenMessages.has(id)) continue
      seenMessages.add(id)
      messages.push({ id, role: Number(item.user_type) === 1 ? "user" : "assistant", content, timestamp: ts, index: Number(item.index_in_conv) || 0 })
    }
    const indexes = raw.map((item: any) => Number(item.index_in_conv)).filter(Number.isFinite)
    const minIndex = indexes.length ? Math.min(...indexes) : 0
    if (!Boolean(body?.has_more) || raw.length < 50 || minIndex <= 1) break
    cursor = minIndex - 1
  }

  messages.sort((a, b) => a.timestamp.localeCompare(b.timestamp) || a.index - b.index)
  const normalizedMessages = messages.map(({ index: _index, ...message }) => message)
  if (!normalizedMessages.length) return null
  return {
    source: "doubao",
    sessionId: ref.id,
    title,
    startedAt: normalizedMessages[0].timestamp,
    endedAt: normalizedMessages.at(-1).timestamp,
    messages: normalizedMessages,
  }
}

async function readHistory(date: string, scope: NetworkScope) {
  let connected = false
  try {
    const refs: ConversationRef[] = []
    const seenConversations = new Set<string>()
    let version: number | string = 0
    let hasMore = true

    // The first page contains the newest 50 conversations. For a daily report,
    // at most three pages are useful; scanning hundreds of old conversations
    // made the close action appear frozen.
    for (let page = 0; page < 3 && hasMore; page += 1) {
      const body = await post(scope, "/im/chain/recent_conv", CMD_RECENT, "pull_recent_conv_chain_uplink_body", "pull_recent_conv_chain_downlink_body", {
        limit: 50,
        filter: page === 0
          ? { conversation_type: [], project_filter: 0, device_filter: 1 }
          : { conversation_type: [], project_filter: 1 },
        message_count_per_conv: 0,
        api_version: 1,
        conv_version: version,
        direction: page === 0 ? FROM_LATEST : OLDER,
        option: {
          not_need_message: true,
          need_complete_conversation: true,
          need_coco_conversation: true,
          need_coco_bot: true,
          need_pc_pin_chain: true,
          pc_pin_query_type: 1,
          exclude_archive: true,
          only_archive: false,
        },
      })
      if (!body || !Array.isArray(body.cells)) {
        throw new Error("豆包会话接口未返回有效数据，请先登录豆包后重试。")
      }
      connected = true
      const cells = Array.isArray(body.cells) ? body.cells : []
      if (!cells.length) break
      let pageContainsTargetDate = false
      for (const cell of cells) {
        const conversation = cell.conversation ?? cell
        const id = String(conversation.conversation_id ?? "").trim()
        if (!id || seenConversations.has(id)) continue
        const updatedAt = timestamp(conversation.update_time)
        if (updatedAt && localDate(updatedAt) === date) pageContainsTargetDate = true
        seenConversations.add(id)
        refs.push({ id, title: conversation.name || "豆包会话", updatedAt })
      }
      const next = body.next_conv_version
      hasMore = Boolean(body.has_more) && next != null
      version = wireVersion(next) || version
      if (page > 0 && !pageContainsTargetDate) break
    }

    // A freshly-created chat can appear in the URL before the recent-list API
    // has indexed it. Include the active conversation directly so the first
    // item in the Doubao sidebar is not omitted.
    const activeId = currentConversationId()
    if (activeId && !seenConversations.has(activeId)) {
      refs.unshift({ id: activeId, title: "当前豆包会话" })
    }

    // The web client fills the sidebar with batch_get metadata. It also
    // contains latest_index and one recent message, which makes the first
    // conversation readable even when /conversation/info is stale.
    mergeConversationInfo(refs, await batchGetConversationInfo(refs.map((ref) => ref.id), scope))

    // Do not use the sidebar's update_time as the final date filter. Doubao
    // can leave that field stale until a conversation is opened, which used
    // to make the first sidebar item disappear. Fetch the first 60 refs and
    // let fetchConversation filter by the actual message timestamps.
    const relevant = refs.slice(0, 60)
    const fetched = await mapConcurrent(relevant, 4, (ref) => fetchConversation(ref, date, scope))
    const conversations = fetched
      .filter(Boolean)
      .sort((a: any, b: any) => String(b.endedAt ?? "").localeCompare(String(a.endedAt ?? "")))
    return { conversations, connected }
  } catch (error) {
    return { conversations: [], connected, error: error instanceof Error ? error.message : "豆包历史读取失败" }
  }
}

const requests = new Map<string, NetworkScope>()
ipcRenderer.on("doubao:cancel-history", (_event, requestId: string) => requests.get(requestId)?.cancel())
async function boundedReadHistory(date: string, requestId: string = crypto.randomUUID()) {
  const scope = createNetworkScope("豆包读取", WEB_READ_TIMEOUT_MS)
  requests.set(requestId, scope)
  try { return await scope.run(() => readHistory(date, scope)) }
  catch (error) { return { conversations: [], connected: false, error: error instanceof Error ? error.message : "豆包读取失败" } }
  finally { requests.delete(requestId); scope.dispose() }
}
ipcRenderer.on("doubao:read-history", async (_event, request: { requestId: string; date: string }) => {
  const result = await boundedReadHistory(request.date, request.requestId)
  ipcRenderer.send("doubao:read-history-result", { requestId: request.requestId, result })
})

contextBridge.exposeInMainWorld("doubaoSummaryBridge", { ready: true, readHistory: (date: string) => boundedReadHistory(date) })
