import { useEffect, useRef, useState } from "react"
import { ArrowLeft, Bot, Check, ChevronDown, ChevronRight, Clock3, FileText, LoaderCircle, PanelRight, RefreshCw, Settings2, Sparkles, X } from "lucide-react"
import type { AppSettings, Conversation, DailySummary, Source } from "../core/types"
import { normalizeConversations } from "../core/normalizer"
import { normalizeSummarySchedule, shouldGenerateDailySummary, summaryScheduleNote } from "../core/summary-schedule"
import type { SummarySchedule } from "../core/summary-schedule"
import { normalizeAutoReadEnabled, startAutoReadTimer } from "../core/auto-read"
import { AutoReadSettings } from "./components/AutoReadSettings"
import { AutoSummarySettings } from "./components/AutoSummarySettings"
import codexIcon from "./assets/codex.png"
import claudeIcon from "./assets/claude.png"
import doubaoIcon from "./assets/doubao.png"
import deepseekIcon from "./assets/deepseek.svg"

const today = () => new Intl.DateTimeFormat("en-CA").format(new Date())
const sourceName: Record<Source, string> = { codex: "Codex", "claude-code": "Claude Code", doubao: "豆包", deepseek: "DeepSeek" }
const DAILY_SUMMARY_STORAGE_KEY = "ai-session-summary:last-auto-summary-date"
const ENABLED_SOURCES_STORAGE_KEY = "ai-session-summary:enabled-sources"
const DEFAULT_SOURCES: Source[] = ["codex", "claude-code"]

export function parseEnabledSources(raw: string | null): Source[] {
  if (!raw) return DEFAULT_SOURCES
  try {
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? (Object.keys(sourceName) as Source[]).filter((source) => parsed.includes(source)) : DEFAULT_SOURCES
  } catch { return DEFAULT_SOURCES }
}

function storedEnabledSources(): Source[] {
  try { return parseEnabledSources(window.localStorage.getItem(ENABLED_SOURCES_STORAGE_KEY)) }
  catch { return DEFAULT_SOURCES }
}

export function webSyncStatus(label: string, count: number): string {
  return count ? `已同步${count}个${label}会话` : `${label}已连接，当天暂无会话`
}

function storedDailySummaryDate(): string {
  try { return window.localStorage.getItem(DAILY_SUMMARY_STORAGE_KEY) ?? "" } catch { return "" }
}

function saveDailySummaryDate(value: string): void {
  try { window.localStorage.setItem(DAILY_SUMMARY_STORAGE_KEY, value) } catch { /* Optional browser storage. */ }
}

function loadedStatus(action: string, conversations: Conversation[]): string {
  const sources = (Object.keys(sourceName) as Source[])
    .filter((source) => conversations.some((conversation) => conversation.source === source))
    .map((source) => sourceName[source])
  const cleanAction = action.replace(/(?:，?包含)+$/, "")
  return `${cleanAction}${sources.length ? `，包含${sources.join("、")}` : ""}`
}

function SourceIcon({ source, size = 14 }: { source: Source; size?: number }) {
  const iconPath = source === "codex" ? codexIcon : source === "claude-code" ? claudeIcon : source === "doubao" ? doubaoIcon : deepseekIcon
  return <img className="source-icon" src={iconPath} width={size} height={size} alt="" aria-hidden="true" />
}

function App() {
  const [date, setDate] = useState(today())
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [selected, setSelected] = useState<Conversation | null>(null)
  const [summary, setSummary] = useState<DailySummary | null>(null)
  const [settings, setSettings] = useState<AppSettings | null>(null)
  // Keep the active schedule separate from unsaved edits in the settings dialog.
  const [savedAutoReadEnabled, setSavedAutoReadEnabled] = useState<boolean | null>(null)
  const [savedSchedule, setSavedSchedule] = useState<SummarySchedule | null>(null)
  const [loading, setLoading] = useState(false)
  const [sessionStatus, setSessionStatus] = useState("")
  const [showSettings, setShowSettings] = useState(false)
  const [detectingPaths, setDetectingPaths] = useState(false)
  const [pathDetectionStatus, setPathDetectionStatus] = useState("")
  const [embeddedSource, setEmbeddedSource] = useState<"doubao" | "deepseek" | null>(null)
  const [webConnections, setWebConnections] = useState<Partial<Record<"doubao" | "deepseek", { needsLogin?: boolean; error?: string } | null>>>({})
  const [toolMenuOpen, setToolMenuOpen] = useState(false)
  const [enabledSources, setEnabledSources] = useState<Source[]>(storedEnabledSources)
  const conversationsRef = useRef(conversations)
  const loadingRef = useRef(loading)
  const embeddedSourceRef = useRef(embeddedSource)
  const toolPickerRef = useRef<HTMLDivElement>(null)
  const initialReadStartedRef = useRef(false)
  const dailySummaryDayRef = useRef(storedDailySummaryDate())
  const operationRef = useRef<{ cancelled: boolean } | null>(null)
  const scheduledRunRef = useRef(false)
  const scheduledCancelledRef = useRef(false)

  function beginOperation() {
    const operation = { cancelled: false }
    operationRef.current = operation
    loadingRef.current = true
    setLoading(true)
    return operation
  }
  function checkOperation(operation: { cancelled: boolean }) {
    if (operation.cancelled) throw new Error("操作已取消")
  }
  function endOperation(operation: { cancelled: boolean }) {
    if (operationRef.current !== operation) return
    operationRef.current = null
    loadingRef.current = false
    setLoading(false)
  }
  async function cancelOperation() {
    if (!operationRef.current) return
    operationRef.current.cancelled = true
    if (scheduledRunRef.current) scheduledCancelledRef.current = true
    setSessionStatus("正在取消……")
    try { await window.summaryApi.cancelNetworkRequests() }
    catch { setSessionStatus("取消请求失败，请稍后重试。") }
  }

  conversationsRef.current = conversations
  loadingRef.current = loading
  embeddedSourceRef.current = embeddedSource

  useEffect(() => {
    void loadSettings()
    const removeDoubaoListener = window.summaryApi.onDoubaoVisibilityChanged((visible) => setEmbeddedSource(visible ? "doubao" : null))
    const removeDeepSeekListener = window.summaryApi.onDeepSeekVisibilityChanged((visible) => setEmbeddedSource(visible ? "deepseek" : null))
    return () => { removeDoubaoListener(); removeDeepSeekListener() }
  }, [])

  useEffect(() => {
    try { window.localStorage.setItem(ENABLED_SOURCES_STORAGE_KEY, JSON.stringify(enabledSources)) } catch { /* Optional preference storage. */ }
  }, [enabledSources])

  useEffect(() => {
    if (savedAutoReadEnabled !== true) {
      initialReadStartedRef.current = false
      return
    }
    if (!initialReadStartedRef.current) {
      initialReadStartedRef.current = true
      void scanSessions(true)
    }
    return startAutoReadTimer(savedAutoReadEnabled, () => { void scanSessions(true) },
      () => loadingRef.current || Boolean(embeddedSourceRef.current))
  }, [date, enabledSources, savedAutoReadEnabled])

  useEffect(() => {
    if (!savedSchedule?.autoSummaryEnabled) return
    const checkDailySummary = () => {
      const now = new Date()
      if (!shouldGenerateDailySummary(now, savedSchedule, dailySummaryDayRef.current,
        loadingRef.current || Boolean(embeddedSourceRef.current))) return
      const scheduledDate = today()
      dailySummaryDayRef.current = scheduledDate
      void runScheduledSummary(scheduledDate)
    }

    checkDailySummary()
    const timer = window.setInterval(checkDailySummary, 30 * 1000)
    return () => window.clearInterval(timer)
  }, [date, enabledSources, savedSchedule])

  useEffect(() => {
    function closeToolMenu(event: MouseEvent) {
      if (!toolPickerRef.current?.contains(event.target as Node)) setToolMenuOpen(false)
    }
    document.addEventListener("mousedown", closeToolMenu)
    return () => document.removeEventListener("mousedown", closeToolMenu)
  }, [])

  useEffect(() => {
    function closeSettings(event: KeyboardEvent) {
      if (event.key === "Escape") setShowSettings(false)
    }
    if (showSettings) document.addEventListener("keydown", closeSettings)
    return () => document.removeEventListener("keydown", closeSettings)
  }, [showSettings])

  async function loadSettings() {
    if (!window.summaryApi) return
    try {
      const loaded = await window.summaryApi.getSettings()
      const enabled = normalizeAutoReadEnabled(loaded)
      setSettings({ ...loaded, autoReadEnabled: enabled })
      setSavedAutoReadEnabled(enabled)
      setSavedSchedule(normalizeSummarySchedule(loaded))
    } catch {
      setSessionStatus("读取设置失败，自动读取未启动；请重启应用或手动读取会话。")
    }
  }

  async function scanSessions(automatic = false, targetDate = date, sources = enabledSources) {
    if (loadingRef.current) return null
    const operation = beginOperation()
    try {
      await closeEmbedded()
      checkOperation(operation)
      setSessionStatus(automatic ? "正在自动读取会话……" : "正在读取会话……")
      const local = sources.some((source) => source === "codex" || source === "claude-code")
        ? await window.summaryApi.scanLocalSessions(targetDate)
        : []
      checkOperation(operation)
      let doubao = conversationsRef.current.filter((item) => item.source === "doubao")
      let deepseek = conversationsRef.current.filter((item) => item.source === "deepseek")
      let doubaoResult: Awaited<ReturnType<typeof window.summaryApi.readDoubaoSessions>> | null = null
      let deepseekResult: Awaited<ReturnType<typeof window.summaryApi.readDeepSeekSessions>> | null = null
      if (sources.includes("doubao")) {
        setSessionStatus("正在连接豆包并读取会话……")
        doubaoResult = await window.summaryApi.readDoubaoSessions(targetDate)
        checkOperation(operation)
        if (!doubaoResult.connected) {
          setWebConnections((current) => ({ ...current, doubao: { needsLogin: doubaoResult!.needsLogin, error: doubaoResult!.error } }))
        } else {
          doubao = doubaoResult.conversations
          setWebConnections((current) => ({ ...current, doubao: null }))
        }
      }
      if (sources.includes("deepseek")) {
        setSessionStatus("正在连接 DeepSeek 并读取会话……")
        deepseekResult = await window.summaryApi.readDeepSeekSessions(targetDate)
        checkOperation(operation)
        if (!deepseekResult.connected) {
          setWebConnections((current) => ({ ...current, deepseek: { needsLogin: deepseekResult!.needsLogin, error: deepseekResult!.error } }))
        } else {
          deepseek = deepseekResult.conversations
          setWebConnections((current) => ({ ...current, deepseek: null }))
        }
      }
      const updated = normalizeConversations([
        ...local.filter((conversation) => sources.includes(conversation.source)),
        ...(sources.includes("doubao") ? doubao : []),
        ...(sources.includes("deepseek") ? deepseek : []),
      ])
      setConversations(updated)
      setSelected((current) => current && updated.some((item) => item.source === current.source && item.sessionId === current.sessionId) ? current : updated[0] ?? null)
      if (!automatic) setSummary(null)
      if (doubaoResult?.connected === false || deepseekResult?.connected === false) {
        const pending = [doubaoResult?.connected === false && "豆包", deepseekResult?.connected === false && "DeepSeek"].filter(Boolean).join("、")
        setSessionStatus(`${automatic ? "自动读取" : "读取"}完成，${updated.length}个会话；${pending}需在下方连接`)
      } else if (doubaoResult?.error || deepseekResult?.error) {
        setSessionStatus(doubaoResult?.error ?? deepseekResult?.error ?? "网页会话读取失败")
      } else {
        const suffix = automatic ? `（${new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit" }).format(new Date())}）` : ""
        setSessionStatus(`${automatic ? "自动读取完成" : `已读取${updated.length}个会话`}${suffix}${automatic ? `，共${updated.length}个会话` : ""}${loadedStatus("", updated)}`)
      }
      return updated
    } catch (error) { setSessionStatus(operation.cancelled ? "操作已取消" : error instanceof Error ? error.message : "读取会话失败"); return null } finally { endOperation(operation) }
  }

  async function generateForConversations(items: Conversation[], targetDate: string, automatic = false) {
    if (loadingRef.current) return false
    if (!items.length) {
      setSessionStatus(automatic ? "未自动生成日报：今天没有会话" : "请先读取会话")
      return false
    }
    const operation = beginOperation()
    setSessionStatus("正在生成日报……")
    try {
      await closeEmbedded()
      checkOperation(operation)
      const activeSettings = await window.summaryApi.getSettings()
      checkOperation(operation)
      const result = await window.summaryApi.generateDailySummary(items, { ...activeSettings, date: targetDate })
      checkOperation(operation)
      const path = await window.summaryApi.writeMarkdownSummary(result, activeSettings.outputPath, automatic)
      setSummary(result)
      // Feishu sync is intentionally disabled for now. The integration remains
      // in core/feishu.ts and can be re-enabled when the document flow is ready.
      setSessionStatus(`日报已保存：${path}`)
      return true
    } catch (error) { setSessionStatus(operation.cancelled ? "操作已取消" : error instanceof Error ? error.message : "生成日报失败"); return false } finally { endOperation(operation) }
  }

  async function generate() {
    await generateForConversations(conversations, date)
  }

  async function runScheduledSummary(scheduledDate: string) {
    scheduledRunRef.current = true
    scheduledCancelledRef.current = false
    try {
      setDate(scheduledDate)
      const updated = await scanSessions(true, scheduledDate)
      if (updated === null) {
        if (!scheduledCancelledRef.current) dailySummaryDayRef.current = ""
        return
      }
      if (scheduledCancelledRef.current) return
      const generated = await generateForConversations(updated, scheduledDate, true)
      // A failed run can be retried while the app remains open. A successful
      // run stays marked for the rest of the day to avoid duplicate files.
      if (!generated && updated.length) {
        if (!scheduledCancelledRef.current) dailySummaryDayRef.current = ""
        return
      }
      saveDailySummaryDate(scheduledDate)
    } finally { scheduledRunRef.current = false }
  }


  async function closeEmbedded(refresh = false) {
    // Hide first so returning to the journal is immediate. The hidden
    // WebContentsView stays alive and can finish synchronization in background.
    const activeSource = embeddedSourceRef.current
    await window.summaryApi.hideDoubao()
    await window.summaryApi.hideDeepSeek()
    setEmbeddedSource(null)
    if (!refresh) return

    if (!activeSource) return

    if (loadingRef.current) return
    const operation = beginOperation()
    const sourceLabel = activeSource === "doubao" ? "豆包" : "DeepSeek"
    setSessionStatus(`正在后台同步刚刚产生的${sourceLabel}会话……`)
    try {
      // Give the web client a brief moment to persist a newly-created conversation.
      await new Promise((resolve) => window.setTimeout(resolve, 800))
      checkOperation(operation)
      const result = activeSource === "doubao"
        ? await window.summaryApi.readDoubaoSessions(date)
        : await window.summaryApi.readDeepSeekSessions(date)
      checkOperation(operation)
      if (!result.connected) {
        setWebConnections((current) => ({ ...current, [activeSource]: { needsLogin: result.needsLogin, error: result.error } }))
        setSessionStatus(result.error ?? `${sourceLabel}未连接，请先登录后重试`)
        return
      }
      setWebConnections((current) => ({ ...current, [activeSource]: null }))
      const updated = normalizeConversations([
        ...conversationsRef.current.filter((item) => item.source !== activeSource),
        ...result.conversations,
      ])
      setConversations(updated)
      setSelected((current) => current ?? result.conversations[0] ?? null)
      if (result.error) setSessionStatus(result.error)
      else setSessionStatus(webSyncStatus(sourceLabel, result.conversations.length))
    } catch (error) {
      setSessionStatus(operation.cancelled ? "操作已取消" : error instanceof Error ? error.message : `${sourceLabel}会话同步失败`)
    } finally {
      endOperation(operation)
    }
  }

  async function openWebSource(source: "doubao" | "deepseek") {
    await closeEmbedded()
    if (source === "doubao") await window.summaryApi.showDoubao()
    else await window.summaryApi.showDeepSeek()
    setEmbeddedSource(source)
    setToolMenuOpen(false)
  }

  async function toggleSource(source: Source) {
    if (loadingRef.current) return
    const next = enabledSources.includes(source)
      ? enabledSources.filter((item) => item !== source)
      : [...enabledSources, source]
    setEnabledSources(next)

    if (!next.includes(source)) {
      const updated = conversationsRef.current.filter((item) => item.source !== source)
      setConversations(updated)
      setSelected((current) => current?.source === source ? updated[0] ?? null : current)
      if (source === "doubao" || source === "deepseek") setWebConnections((current) => ({ ...current, [source]: null }))
      setSessionStatus(`已取消${sourceName[source]}会话读取`)
      return
    }

    if (source === "codex" || source === "claude-code") {
      await scanSessions(false, date, next)
      return
    }

    const operation = beginOperation()
    setSessionStatus(`正在检查${sourceName[source]}登录状态……`)
    try {
      const result = source === "doubao"
        ? await window.summaryApi.readDoubaoSessions(date)
        : await window.summaryApi.readDeepSeekSessions(date)
      checkOperation(operation)
      if (!result.connected) {
        setWebConnections((current) => ({ ...current, [source]: { needsLogin: result.needsLogin, error: result.error } }))
        if (result.needsLogin) {
          setSessionStatus(`${sourceName[source]}尚未登录，请在打开的页面登录`)
          await openWebSource(source)
        } else setSessionStatus(result.error ?? `${sourceName[source]}连接失败，请稍后重试`)
        return
      }
      setWebConnections((current) => ({ ...current, [source]: null }))
      const updated = normalizeConversations([...conversationsRef.current.filter((item) => item.source !== source), ...result.conversations])
      setConversations(updated)
      setSelected((current) => current ?? result.conversations[0] ?? null)
      setSessionStatus(result.error ?? (result.conversations.length ? `已读取${result.conversations.length}个${sourceName[source]}会话` : `${sourceName[source]}已连接，当天暂无会话`))
    } catch (error) {
      setSessionStatus(operation.cancelled ? "操作已取消" : error instanceof Error ? error.message : `${sourceName[source]}连接失败`)
    } finally { endOperation(operation) }
  }

  async function saveSettings() {
    if (!settings) return
    try {
      const schedule = normalizeSummarySchedule(settings)
      const enabled = normalizeAutoReadEnabled(settings)
      await window.summaryApi.saveSettings({ ...settings, ...schedule, autoReadEnabled: enabled })
      setSettings({ ...settings, ...schedule, autoReadEnabled: enabled })
      setSavedAutoReadEnabled(enabled)
      setSavedSchedule(schedule)
      setShowSettings(false); setSessionStatus("设置已保存")
    } catch (error) {
      setSessionStatus(error instanceof Error ? error.message : "保存设置失败")
    }
  }

  async function autoDetectPaths() {
    if (!settings || detectingPaths) return
    setDetectingPaths(true)
    setPathDetectionStatus("")
    try {
      const detected = await window.summaryApi.detectSessionPaths()
      setSettings((current) => current ? {
        ...current,
        codexPaths: [...new Set([...current.codexPaths, ...detected.codexPaths])],
        claudePaths: [...new Set([...current.claudePaths, ...detected.claudePaths])],
      } : current)
      const total = detected.codexPaths.length + detected.claudePaths.length
      setPathDetectionStatus(total ? `找到 Codex ${detected.codexPaths.length} 个目录、Claude Code ${detected.claudePaths.length} 个目录。请确认后保存。` : "未找到常见会话目录，请手动填写路径。")
    } catch {
      setPathDetectionStatus("检测失败，请手动填写路径或重试。")
    } finally {
      setDetectingPaths(false)
    }
  }

  return <div className="app-shell">
    {embeddedSource && <div className="embedded-toolbar">
      <div className="embedded-toolbar-label"><SourceIcon source={embeddedSource} size={20} /><strong>{sourceName[embeddedSource]}</strong><span>登录后返回即可同步会话</span></div>
      <button type="button" className="ghost" onClick={() => void closeEmbedded(true)}><ArrowLeft size={16} />返回日报</button>
    </div>}
    <main className="main-column">
      <header className="topbar">
        <div className="page-heading">
          <div className="brand-mark" aria-hidden="true"><Sparkles size={16} /></div>
          <div className="page-heading-copy">
            <h1>{date === today() ? "今日会话" : `${date} 会话`}</h1>
            <p>{date} · {savedAutoReadEnabled === null ? "正在加载设置" : savedAutoReadEnabled ? "自动读取已开启" : "自动读取已关闭"}</p>
          </div>
        </div>
        <div className="toolbar">
          <label className="date-control">
            <span className="sr-only">选择日期</span>
            <input type="date" value={date} disabled={loading} onChange={(event) => setDate(event.target.value)} />
          </label>
          <button type="button" className="primary" onClick={() => void generate()} disabled={loading} aria-busy={loading}><Sparkles size={16} />生成日报</button>
          {loading && <button type="button" className="ghost" onClick={() => void cancelOperation()}><X size={16} />取消操作</button>}
          <button type="button" className="icon-button settings-button" title="打开设置" aria-label="打开设置" onClick={() => { void closeEmbedded(); setShowSettings(true) }}><Settings2 size={16} /></button>
        </div>
      </header>

      {summary ? <article className="summary-card" aria-labelledby="summary-title">
        <div className="summary-card-top">
          <div>
            <h2 id="summary-title">今日日报</h2>
            <p>把今天的对话整理成一页可回顾的记录。</p>
          </div>
          <button type="button" className="ghost summary-back" onClick={() => setSummary(null)}><ArrowLeft size={15} />返回会话</button>
        </div>
        <div className="summary-content">
          <SummarySection title="今日完成事项" items={summary.accomplishments} />
          <SummarySection title="重点学习" items={summary.knowledgeAbsorbed} />
          <SummarySection title="明日建议" items={summary.tomorrow} />
        </div>
      </article> : <section className="empty-summary" aria-labelledby="empty-title">
        <div className="empty-icon" aria-hidden="true"><FileText size={22} /></div>
        <h2 id="empty-title">今天做了什么？</h2>
        <p>先读取会话，再生成日报。</p>
        <div className="empty-actions">
          <button type="button" className="primary" onClick={() => void scanSessions()} disabled={loading}><RefreshCw size={16} className={loading ? "spin" : ""} />读取会话</button>
          <div className="tool-picker" ref={toolPickerRef}>
            <button type="button" className="ghost" onClick={() => setToolMenuOpen((open) => !open)} aria-expanded={toolMenuOpen} aria-haspopup="true"><Bot size={16} />AI 工具<ChevronDown size={14} /></button>
            {toolMenuOpen && <div className="tool-menu" role="menu">
              {(Object.keys(sourceName) as Source[]).map((source) => <label key={source} role="menuitemcheckbox" aria-checked={enabledSources.includes(source)}><input type="checkbox" checked={enabledSources.includes(source)} disabled={loading} onChange={() => void toggleSource(source)} /><span>{sourceName[source]}</span></label>)}
            </div>}
          </div>
        </div>
      </section>}

      {(enabledSources.includes("doubao") || enabledSources.includes("deepseek")) && (webConnections.doubao || webConnections.deepseek) && <section className="connection-list" aria-label="网页工具连接状态">
        {(["doubao", "deepseek"] as const).map((source) => enabledSources.includes(source) && webConnections[source] && <div className="connection-row" key={source}>
          <span className={`source-badge ${source}`}><SourceIcon source={source} size={22} /></span>
          <div className="connection-copy"><strong>{sourceName[source]} {webConnections[source]?.needsLogin ? "尚未登录" : "暂时无法读取"}</strong><span>{webConnections[source]?.needsLogin ? "取消勾选后重新勾选即可登录。" : webConnections[source]?.error ?? "请稍后重新读取会话。"}</span></div>
        </div>)}
      </section>}

      <section className="session-section" aria-labelledby="sessions-title">
        <div className="section-heading">
          <div className="section-title-line">
            <h2 id="sessions-title">会话记录</h2>
            {sessionStatus && <div className="session-status" title={sessionStatus}>{loading && <LoaderCircle className="spin" size={15} />}{sessionStatus}</div>}
          </div>
          <span className="auto-refresh-note"><Clock3 size={13} />{summaryScheduleNote(savedSchedule, savedAutoReadEnabled)}</span>
        </div>
        <div className="session-list">
          {conversations.map((conversation) => <button type="button" className={`session-row ${selected?.source === conversation.source && selected?.sessionId === conversation.sessionId ? "selected" : ""}`} key={`${conversation.source}-${conversation.sessionId}`} onClick={() => setSelected(conversation)} aria-pressed={selected?.source === conversation.source && selected?.sessionId === conversation.sessionId}>
            <span className={`source-badge ${conversation.source}`} title={sourceName[conversation.source]} aria-label={sourceName[conversation.source]}><SourceIcon source={conversation.source} /><span className="sr-only">{sourceName[conversation.source]}</span></span>
            <span className="session-copy"><strong title={conversation.title}>{conversation.title}</strong><small>{conversation.projectPath ?? "无项目路径"}</small></span>
            <ChevronRight size={16} aria-hidden="true" />
          </button>)}
          {conversations.length === 0 && <div className="small-empty">还没有读取到会话。</div>}
        </div>
      </section>
    </main>

    <aside className="detail-column" aria-label="会话详情">
      {selected ? <>
        <div className="detail-header">
          <span className={`pill ${selected.source}`}><SourceIcon source={selected.source} /><span>{sourceName[selected.source]}</span></span>
          <button type="button" className="icon-button" title="关闭详情" aria-label="关闭详情" onClick={() => setSelected(null)}><X size={16} /></button>
        </div>
        <h2>{selected.title}</h2>
        {selected.projectPath && <div className="detail-meta"><span>项目路径</span><strong title={selected.projectPath}>{selected.projectPath}</strong></div>}
        <div className="transcript">
          {selected.messages.length ? selected.messages.map((message) => <div className={`message ${message.role}`} key={message.id}>
            <span className="message-role">{message.role === "user" ? "你" : "AI"}</span>
            <div className="message-body"><strong>{message.role === "user" ? "你的消息" : "AI 回复"}</strong><p>{message.content}</p></div>
          </div>) : <div className="detail-empty">这个会话没有可展示的文本消息。</div>}
        </div>
      </> : <div className="detail-placeholder"><PanelRight size={26} aria-hidden="true" /><p>选择一个会话查看详情</p></div>}
    </aside>

    {showSettings && settings && <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setShowSettings(false) }}>
      <section className="settings-modal" role="dialog" aria-modal="true" aria-labelledby="settings-title">
        <div className="modal-heading">
          <div><h2 id="settings-title">设置</h2><p>配置总结服务、日报格式和本地会话目录。</p></div>
          <button type="button" className="icon-button" title="关闭设置" aria-label="关闭设置" onClick={() => setShowSettings(false)}><X size={17} /></button>
        </div>
        <AutoReadSettings enabled={settings.autoReadEnabled} onChange={(enabled) => setSettings({ ...settings, autoReadEnabled: enabled })} />
        <AutoSummarySettings schedule={settings} onChange={(schedule) => setSettings({ ...settings, ...schedule })} />
        <div className="settings-group">
          <div className="settings-group-heading"><h3>总结服务</h3><p>支持 OpenAI 兼容接口；留空 API Key 时使用本地规则摘要。</p></div>
          <div className="field-grid">
            <label className="field">API Base URL<input value={settings.apiBaseUrl} onChange={(event) => setSettings({ ...settings, apiBaseUrl: event.target.value })} /></label>
            <label className="field">模型<input value={settings.model} onChange={(event) => setSettings({ ...settings, model: event.target.value })} /></label>
          </div>
          <label className="field">API Key<input type="password" value={settings.apiKey} onChange={(event) => setSettings({ ...settings, apiKey: event.target.value })} placeholder="可留空" /></label>
        </div>
        <div className="settings-group">
          <div className="settings-group-heading"><h3>日报格式</h3><p>提示词会直接影响“今日完成事项、重点学习、明日建议”的内容。</p></div>
          <label className="field">日报提示词<textarea rows={10} value={settings.summaryPrompt} onChange={(event) => setSettings({ ...settings, summaryPrompt: event.target.value })} placeholder="留空则使用默认提示词" /><span className="settings-hint">支持 {"{{date}}"} 和 {"{{conversations}}"}；建议保留 JSON 输出结构。</span></label>
        </div>
        <div className="settings-group">
          <div className="settings-group-heading"><h3>文件位置</h3><p>原始会话只在内存中处理，日报保存为 Markdown 文件。</p></div>
          <label className="field">日报输出目录<div className="path-input"><input value={settings.outputPath} onChange={(event) => setSettings({ ...settings, outputPath: event.target.value })} /><button type="button" className="ghost" onClick={async () => { const path = await window.summaryApi.chooseDirectory(); if (path) setSettings({ ...settings, outputPath: path }) }}>选择</button></div></label>
          <div className="field-grid">
            <label className="field">Codex 路径（每行一个）<textarea rows={3} value={settings.codexPaths.join("\n")} onChange={(event) => setSettings({ ...settings, codexPaths: event.target.value.split("\n").map((value) => value.trim()).filter(Boolean) })} /></label>
            <label className="field">Claude Code 路径（每行一个）<textarea rows={3} value={settings.claudePaths.join("\n")} onChange={(event) => setSettings({ ...settings, claudePaths: event.target.value.split("\n").map((value) => value.trim()).filter(Boolean) })} /></label>
          </div>
          <div className="path-detection-row"><button type="button" className="ghost" onClick={() => void autoDetectPaths()} disabled={detectingPaths}><RefreshCw size={14} className={detectingPaths ? "spin" : undefined} />{detectingPaths ? "检测中" : "自动检测路径"}</button><span role="status" className="settings-hint">{pathDetectionStatus}</span></div>
        </div>
        {/* Feishu sync is temporarily hidden; keep the implementation for a later release.
        <div className="settings-group">
          <div className="settings-group-heading"><h3>飞书同步</h3><p>生成日报后，自动把内容追加到指定的飞书云文档。</p></div>
          <label className="toggle-field"><input type="checkbox" checked={settings.feishuEnabled} onChange={(event) => setSettings({ ...settings, feishuEnabled: event.target.checked })} /><span>生成日报后同步到飞书</span></label>
          <span className="settings-hint">需要在飞书开放平台创建企业自建应用，并为应用开通云文档读写权限。</span>
          <div className="field-grid feishu-fields">
            <label className="field">App ID<input value={settings.feishuAppId} onChange={(event) => setSettings({ ...settings, feishuAppId: event.target.value })} placeholder="cli_..." /></label>
            <label className="field">App Secret<input type="password" value={settings.feishuAppSecret} onChange={(event) => setSettings({ ...settings, feishuAppSecret: event.target.value })} placeholder="仅保存在本机" /></label>
          </div>
          <label className="field">飞书文档链接或文档 ID<input value={settings.feishuDocumentId} onChange={(event) => setSettings({ ...settings, feishuDocumentId: event.target.value })} placeholder="https://xxx.feishu.cn/docx/..." /><span className="settings-hint">请先把该文档共享给飞书应用，否则接口会返回无权限。</span></label>
        </div>
        */}
        <div className="modal-actions"><button type="button" className="ghost" onClick={() => setShowSettings(false)}>取消</button><button type="button" className="primary" onClick={() => void saveSettings()}><Check size={16} />保存设置</button></div>
      </section>
    </div>}
  </div>
}

function SummarySection({ title, items }: { title: string; items: string[] }) {
  return <section className="summary-section"><h3>{title}</h3>{items.length ? <ol>{items.map((item, index) => <li key={`${title}-${index}-${item}`}>{item}</li>)}</ol> : <p className="muted">无</p>}</section>
}

export default App
