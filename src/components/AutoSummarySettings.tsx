import type { SummarySchedule } from "../../core/summary-schedule"

export function AutoSummarySettings({ schedule, onChange }: {
  schedule: SummarySchedule
  onChange: (value: SummarySchedule) => void
}) {
  return <div className="settings-group">
    <div className="settings-group-heading"><h3>自动生成日报</h3><p>开启后，每天按设定时间整理当天会话，保存为带时间戳的新文件。</p></div>
    <div className="summary-schedule-controls">
      <label className="toggle-field"><input type="checkbox" checked={schedule.autoSummaryEnabled} onChange={(event) => onChange({ ...schedule, autoSummaryEnabled: event.target.checked })} /><span>每天自动生成日报</span></label>
      <label className="field summary-time-field">生成时间<input type="time" step={60} required value={schedule.autoSummaryTime} disabled={!schedule.autoSummaryEnabled} onChange={(event) => {
        if (event.target.value) onChange({ ...schedule, autoSummaryTime: event.target.value })
      }} /></label>
    </div>
    <span className="settings-hint">使用电脑的本地时间，保存设置后生效。应用须保持打开；错过时间后打开会补生成。生成前会读取当天会话，不受“自动读取会话”开关影响；没有会话时跳过，每天最多自动生成一次。</span>
  </div>
}
