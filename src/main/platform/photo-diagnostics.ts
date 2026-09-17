import { app } from 'electron'
import { appendFile, mkdir, rename, stat } from 'node:fs/promises'
import { join } from 'node:path'

// Local diagnostics for the pictures shown in a bubble without being asked for (Telegram's
// automatic media download). Each line has the step and a short technical detail: a size in bytes,
// a refusal reason or a status number. No uid, chat, message id or picture content is written.
const seen = new Set<string>()
let written = 0, tail: Promise<unknown> = Promise.resolve()

export function recordPhotoStep(step: string, detail = ''): void {
  if (written >= 200) return
  const short = detail.slice(0, 120), key = `${step}|${short}`
  if (seen.has(key)) return
  seen.add(key); written++
  const line = JSON.stringify({ at: new Date().toISOString(), version: app.getVersion(), step, detail: short })
  tail = tail.then(async () => {
    try {
      const directory = app.getPath('logs'), file = join(directory, 'photo-check.log')
      await mkdir(directory, { recursive: true })
      const size = await stat(file).then(value => value.size, () => 0)
      if (size > 128 * 1024) await rename(file, `${file}.1`).catch(() => {})
      await appendFile(file, `${line}\n`, { encoding: 'utf8', mode: 0o600 })
    } catch { /* Diagnostics are best effort. */ }
  })
}
