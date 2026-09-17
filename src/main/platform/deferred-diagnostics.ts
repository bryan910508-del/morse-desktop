import { app } from 'electron'
import { appendFile, mkdir, rename, stat } from 'node:fs/promises'
import { join } from 'node:path'

// Local diagnostics for the send menu's queued messages ("예약 전송", "온라인시 보내기"). Each line
// has the step and a short technical detail (a gRPC status number or the check that stopped the
// send). No uid, chat, message text or other account data is written. Identical lines are skipped.
const seen = new Set<string>()
let written = 0, tail: Promise<unknown> = Promise.resolve()

export function recordDeferredStep(step: string, detail = ''): void {
  if (written >= 200) return
  const short = detail.slice(0, 120), key = `${step}|${short}`
  if (seen.has(key)) return
  seen.add(key); written++
  const line = JSON.stringify({ at: new Date().toISOString(), version: app.getVersion(), step, detail: short })
  tail = tail.then(async () => {
    try {
      const directory = app.getPath('logs'), file = join(directory, 'deferred-check.log')
      await mkdir(directory, { recursive: true })
      const size = await stat(file).then(value => value.size, () => 0)
      if (size > 128 * 1024) await rename(file, `${file}.1`).catch(() => {})
      await appendFile(file, `${line}\n`, { encoding: 'utf8', mode: 0o600 })
    } catch { /* Diagnostics are best effort. */ }
  })
}
