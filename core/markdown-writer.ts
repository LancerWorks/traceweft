import { mkdirSync, writeFileSync } from "node:fs"
import { dirname, join, extname } from "node:path"
import { homedir } from "node:os"
import type { DailySummary } from "./types"

export function defaultOutputPath(date: string): string {
  return join(homedir(), "Documents", "AI-Daily-Summaries", `${date}.md`)
}

export function writeSummaryMarkdown(summary: DailySummary, outputPath = defaultOutputPath(summary.date), automatic = false, now = new Date()): string {
  mkdirSync(dirname(outputPath), { recursive: true })
  if (automatic) {
    const pad = (value: number, length = 2) => String(value).padStart(length, "0")
    const timestamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}-${pad(now.getMilliseconds(), 3)}`
    const extension = extname(outputPath)
    const base = outputPath.slice(0, extension ? -extension.length : undefined)
    for (let attempt = 0; ; attempt += 1) {
      const candidate = `${base}-${timestamp}${attempt ? `-${attempt}` : ""}${extension || ".md"}`
      try {
        writeFileSync(candidate, summary.markdown, { encoding: "utf8", flag: "wx" })
        return candidate
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error
      }
    }
  }
  writeFileSync(outputPath, summary.markdown, "utf8")
  return outputPath
}
