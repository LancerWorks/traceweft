import type { AppSettings, DailySummary } from "./types"
import { createNetworkScope, SUMMARY_TIMEOUT_MS } from "./network"

type FeishuFetch = typeof fetch

type FeishuResponse = {
  code?: number
  msg?: string
  tenant_access_token?: string
}

type FeishuBlock = {
  block_type: 2
  text: {
    elements: Array<{ text_run: { content: string } }>
  }
}

const FEISHU_API = "https://open.feishu.cn/open-apis"

export function extractFeishuDocumentId(value: string): string {
  const input = value.trim()
  if (!input) return ""

  try {
    const url = new URL(input)
    const parts = url.pathname.split("/").filter(Boolean)
    const markerIndex = parts.findIndex((part) => part === "docx" || part === "document")
    if (markerIndex >= 0 && parts[markerIndex + 1]) return parts[markerIndex + 1]
    const queryId = url.searchParams.get("docx_token") ?? url.searchParams.get("document_id")
    if (queryId) return queryId
  } catch {
    // The setting may be a raw document ID instead of a URL.
  }

  return input.replace(/^\/+|\/+$/g, "")
}

function responseError(response: FeishuResponse, fallback: string): Error {
  return new Error(`飞书接口失败：${response.msg || fallback}（错误码 ${response.code ?? "未知"}）`)
}

async function readJson(response: Response): Promise<FeishuResponse> {
  try { return await response.json() as FeishuResponse } catch { return {} }
}

async function getTenantAccessToken(settings: AppSettings, request: FeishuFetch): Promise<string> {
  const response = await request(`${FEISHU_API}/auth/v3/tenant_access_token/internal`, {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify({ app_id: settings.feishuAppId.trim(), app_secret: settings.feishuAppSecret.trim() }),
  })
  const data = await readJson(response)
  if (!response.ok || data.code !== 0 || !data.tenant_access_token) throw responseError(data, "无法获取应用访问令牌")
  return data.tenant_access_token
}

function cleanLine(line: string): string {
  return line
    .replace(/^#{1,6}\s+/, "")
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .trim()
}

function splitLongLine(line: string, maxLength = 1500): string[] {
  if (line.length <= maxLength) return [line]
  const chunks: string[] = []
  for (let index = 0; index < line.length; index += maxLength) chunks.push(line.slice(index, index + maxLength))
  return chunks
}

export function summaryToFeishuBlocks(summary: DailySummary): FeishuBlock[] {
  const lines = [`AI Session Summary · ${summary.date}`, ...summary.markdown.split("\n")]
    .map(cleanLine)
    .filter((line) => line && !/^---+$/.test(line))
  return lines.flatMap((line) => splitLongLine(line).map((content) => ({
    block_type: 2 as const,
    text: { elements: [{ text_run: { content } }] },
  })))
}

export async function appendSummaryToFeishu(summary: DailySummary, settings: AppSettings, request: FeishuFetch = fetch, signal?: AbortSignal): Promise<string> {
  const scope = createNetworkScope("飞书同步", SUMMARY_TIMEOUT_MS, signal)
  try {
    return await scope.run(() => appendBlocks(summary, settings, (url, init) => request(url, { ...init, signal: scope.signal })))
  } finally { scope.dispose() }
}

async function appendBlocks(summary: DailySummary, settings: AppSettings, request: FeishuFetch): Promise<string> {
  if (!settings.feishuEnabled) return ""
  if (!settings.feishuAppId.trim() || !settings.feishuAppSecret.trim()) throw new Error("请先填写飞书 App ID 和 App Secret")

  const documentId = extractFeishuDocumentId(settings.feishuDocumentId)
  if (!documentId) throw new Error("请先填写飞书文档链接或文档 ID")

  const token = await getTenantAccessToken(settings, request)
  const blocks = summaryToFeishuBlocks(summary)
  const endpoint = `${FEISHU_API}/docx/v1/documents/${encodeURIComponent(documentId)}/blocks/${encodeURIComponent(documentId)}/children`

  // Keep each request below the block count accepted by the Docx API.
  for (let index = 0; index < blocks.length; index += 40) {
    const response = await request(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ index: -1, children: blocks.slice(index, index + 40) }),
    })
    const data = await readJson(response)
    if (!response.ok || data.code !== 0) throw responseError(data, "无法写入飞书文档")
  }

  return documentId
}
