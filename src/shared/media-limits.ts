// B308, first release (contracts/B308-video-limit-storage.md §1, plan reports/desktop/2026-10-11-b308-video-limit-plan.md
// §8 A): this app takes in media up to 200 MiB — the video limit the three apps are moving to — before any of them sends
// one that large, so a release that still sends 50 MB already shows what the next one sends.
export const maxReceivedMediaBytes = 200 * 1024 * 1024
// A download is given up when nothing has come for this long, not after a fixed time for the whole file: 200 MiB on a
// slow line takes minutes and is still moving (tdesktop's loaders have no whole-file deadline either).
export const mediaIdleMs = 30_000

// An abort signal that fires once `touch` has not been called for `ms`; `stop` lets it go.
export function idleTimeout(ms: number, reason: () => Error): { signal: AbortSignal; touch(): void; stop(): void } {
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  const touch = (): void => { clearTimeout(timer); timer = setTimeout(() => controller.abort(reason()), ms) }
  touch()
  return { signal: controller.signal, touch, stop: () => clearTimeout(timer) }
}
