export type Source = "codex" | "claude-code" | "doubao" | "deepseek"
export type MessageRole = "user" | "assistant"

export type Message = {
  id: string
  role: MessageRole
  content: string
  timestamp?: string
}

export type Conversation = {
  source: Source
  sessionId: string
  title: string
  projectPath?: string
  startedAt?: string
  endedAt?: string
  messages: Message[]
  sourcePath?: string
}

export type SummaryOptions = {
  date?: string
  apiBaseUrl: string
  apiKey: string
  model: string
  summaryPrompt?: string
  language?: string
  maxCharacters?: number
}

export type DailySummary = {
  date: string
  accomplishments: string[]
  knowledgeAbsorbed: string[]
  tomorrow: string[]
  sourceBreakdown: Record<Source, number>
  markdown: string
}

export type AppSettings = {
  codexPaths: string[]
  claudePaths: string[]
  outputPath: string
  apiBaseUrl: string
  apiKey: string
  model: string
  summaryPrompt: string
  autoReadEnabled: boolean
  autoSummaryEnabled: boolean
  autoSummaryTime: string
  feishuEnabled: boolean
  feishuAppId: string
  feishuAppSecret: string
  feishuDocumentId: string
}

export type DetectedSessionPaths = { codexPaths: string[]; claudePaths: string[] }

export type DoubaoReadResult = {
  conversations: Conversation[]
  connected: boolean
  needsLogin?: boolean
  error?: string
}

export type DeepSeekReadResult = {
  conversations: Conversation[]
  connected: boolean
  needsLogin?: boolean
  error?: string
}

export type ElectronApi = {
  scanLocalSessions: (date: string) => Promise<Conversation[]>
  readDoubaoSessions: (date: string) => Promise<DoubaoReadResult>
  readDeepSeekSessions: (date: string) => Promise<DeepSeekReadResult>
  showDoubao: () => Promise<void>
  hideDoubao: () => Promise<void>
  onDoubaoVisibilityChanged: (listener: (visible: boolean) => void) => () => void
  showDeepSeek: () => Promise<void>
  hideDeepSeek: () => Promise<void>
  onDeepSeekVisibilityChanged: (listener: (visible: boolean) => void) => () => void
  generateDailySummary: (conversations: Conversation[], options: SummaryOptions) => Promise<DailySummary>
  cancelNetworkRequests: () => Promise<void>
  writeMarkdownSummary: (summary: DailySummary, outputPath?: string, automatic?: boolean) => Promise<string>
  appendFeishuSummary: (summary: DailySummary) => Promise<string>
  getSettings: () => Promise<AppSettings>
  saveSettings: (settings: AppSettings) => Promise<void>
  chooseDirectory: () => Promise<string | null>
  detectSessionPaths: () => Promise<DetectedSessionPaths>
}
