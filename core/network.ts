export const WEB_READ_TIMEOUT_MS = 60_000
export const SUMMARY_TIMEOUT_MS = 120_000

// Keep the deadline active through response-body parsing and multi-step reads.
export function createNetworkScope(label: string, timeoutMs: number, parent?: AbortSignal) {
  const controller = new AbortController()
  const cancel = () => controller.abort(new Error("操作已取消"))
  if (parent?.aborted) cancel()
  else parent?.addEventListener("abort", cancel, { once: true })
  const timer = setTimeout(() => controller.abort(new Error(`${label}超时，请检查网络后重试。`)), timeoutMs)
  const signal = controller.signal
  function check() { if (signal.aborted) throw signal.reason }
  async function run<T>(work: () => Promise<T>): Promise<T> {
    check()
    return new Promise<T>((resolve, reject) => {
      const aborted = () => reject(signal.reason)
      signal.addEventListener("abort", aborted, { once: true })
      Promise.resolve().then(() => { check(); return work() }).then(resolve, reject)
        .finally(() => signal.removeEventListener("abort", aborted))
    })
  }
  return {
    signal, cancel, check, run,
    dispose() { clearTimeout(timer); parent?.removeEventListener("abort", cancel) },
  }
}

export type NetworkScope = ReturnType<typeof createNetworkScope>
