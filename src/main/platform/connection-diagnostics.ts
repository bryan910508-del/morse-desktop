import { app } from 'electron'
import { appendFile, mkdir, rename, stat } from 'node:fs/promises'
import { join } from 'node:path'

// Local diagnostics for the account connection: when it goes down or comes back, and why (Socket.IO's reason, the
// server's registration refusal, a renewal). Only the step and that reason are written — no account, token, chat or
// address. Every line is kept, since how often it happens is the point.
let written = 0, tail: Promise<unknown> = Promise.resolve()

export function recordConnectionStep(step: string, detail = ''): void {
  if (written >= 2000) return
  written++
  const line = JSON.stringify({ at: new Date().toISOString(), version: app.getVersion(), step, detail: detail.replace(/[A-Za-z0-9_-]{16,}/g, '*').slice(0, 80) })
  tail = tail.then(async () => {
    try {
      const directory = app.getPath('logs'), file = join(directory, 'connection-check.log')
      await mkdir(directory, { recursive: true })
      const size = await stat(file).then(value => value.size, () => 0)
      if (size > 256 * 1024) await rename(file, `${file}.1`).catch(() => {})
      await appendFile(file, `${line}\n`, { encoding: 'utf8', mode: 0o600 })
    } catch { /* Diagnostics are best effort. */ }
  })
}
