import { afterEach, expect, it, vi } from "vitest"
import { createNetworkScope } from "../core/network"

afterEach(() => vi.useRealTimers())

it("bounds readiness waits and rejects late replies after cancellation", async () => {
  const scope = createNetworkScope("网页读取", 60000)
  let reply!: (value: string) => void
  const pending = scope.run(() => new Promise<string>((resolve) => { reply = resolve }))
  await Promise.resolve()
  scope.cancel()
  reply("迟到的结果")
  await expect(pending).rejects.toThrow("操作已取消")
  await expect(scope.run(async () => "后续读取")).rejects.toThrow("操作已取消")
  scope.dispose()
})

it("times out a webpage that never finishes loading and cleans the timer", async () => {
  vi.useFakeTimers()
  const scope = createNetworkScope("网页读取", 60000)
  const pending = scope.run(() => new Promise<void>(() => {}))
  const assertion = expect(pending).rejects.toThrow("网页读取超时")
  await vi.advanceTimersByTimeAsync(60000)
  await assertion
  scope.dispose()
  expect(vi.getTimerCount()).toBe(0)
})
