import { contextBridge, ipcRenderer } from "electron"
import type { ElectronApi } from "../core/types"

const api: ElectronApi = {
  scanLocalSessions: (date) => ipcRenderer.invoke("sessions:scan-local", date),
  readDoubaoSessions: (date) => ipcRenderer.invoke("doubao:read", date),
  readDeepSeekSessions: (date) => ipcRenderer.invoke("deepseek:read", date),
  showDoubao: () => ipcRenderer.invoke("doubao:show"),
  hideDoubao: () => ipcRenderer.invoke("doubao:hide"),
  onDoubaoVisibilityChanged: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, visible: boolean) => listener(visible)
    ipcRenderer.on("doubao:visibility-changed", handler)
    return () => ipcRenderer.removeListener("doubao:visibility-changed", handler)
  },
  showDeepSeek: () => ipcRenderer.invoke("deepseek:show"),
  hideDeepSeek: () => ipcRenderer.invoke("deepseek:hide"),
  onDeepSeekVisibilityChanged: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, visible: boolean) => listener(visible)
    ipcRenderer.on("deepseek:visibility-changed", handler)
    return () => ipcRenderer.removeListener("deepseek:visibility-changed", handler)
  },
  generateDailySummary: (conversations, options) => ipcRenderer.invoke("summary:generate", conversations, options),
  cancelNetworkRequests: () => ipcRenderer.invoke("network:cancel"),
  writeMarkdownSummary: (summary, outputPath, automatic) => ipcRenderer.invoke("summary:write", summary, outputPath, automatic),
  appendFeishuSummary: (summary) => ipcRenderer.invoke("summary:append-feishu", summary),
  getSettings: () => ipcRenderer.invoke("settings:get"),
  saveSettings: (settings) => ipcRenderer.invoke("settings:save", settings),
  chooseDirectory: () => ipcRenderer.invoke("settings:choose-directory"),
  detectSessionPaths: () => ipcRenderer.invoke("settings:detect-paths")
}

contextBridge.exposeInMainWorld("summaryApi", api)
