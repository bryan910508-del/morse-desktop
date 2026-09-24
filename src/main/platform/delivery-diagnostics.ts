import { app } from 'electron'
import { appendFile, mkdir, rename, stat } from 'node:fs/promises'
import { join } from 'node:path'

// Local diagnostics for the account's delivery storage — the store that holds what is being sent, the
// drafts, the read marks and the local caches. Until now a storage that would not open said only
// «앱을 다시 열어 주세요» and left nothing behind, so there was no way to tell a refused keychain from a
// worker that never started. Telegram's cache answers every operation with an error that names its kind
// (Storage::Cache::Error{Type: None, IO, WrongKey, LockFailed}) instead of dropping the reason.
//
// Each line has the step and a short technical detail: a command kind, an exit code, a failure code. No
// uid, chat, message, draft or key is ever written.
const seen = new Set<string>()
let written = 0, tail: Promise<unknown> = Promise.resolve()

export function recordDeliveryStep(step: string, detail = ''): void {
  if (written >= 200) return
  const short = detail.slice(0, 120), key = `${step}|${short}`
  if (seen.has(key)) return
  seen.add(key); written++
  const line = JSON.stringify({ at: new Date().toISOString(), version: app.getVersion(), step, detail: short })
  tail = tail.then(async () => {
    try {
      const directory = app.getPath('logs'), file = join(directory, 'delivery-check.log')
      await mkdir(directory, { recursive: true })
      const size = await stat(file).then(value => value.size, () => 0)
      if (size > 128 * 1024) await rename(file, `${file}.1`).catch(() => {})
      await appendFile(file, `${line}\n`, { encoding: 'utf8', mode: 0o600 })
    } catch { /* Diagnostics are best effort. */ }
  })
}
