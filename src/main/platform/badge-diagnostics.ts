import { app } from 'electron'
import { appendFile, mkdir, rename, stat } from 'node:fs/promises'
import { join } from 'node:path'

// B348 (review 10-14 17:4x): the Windows taskbar and notification-area count never showed on a person's PC, and reading
// the code did not tell where it stops. Each step the count takes is written here — the count, which target, whether a
// picture came back, what the system call answered — as numbers and fixed words only: no uid, chat, name or text.
// A line that says what the last line of its step said is not written again; 400 lines a run at most.
export type BadgeDetail = Record<string, string | number | boolean>
let written = 0, tail: Promise<unknown> = Promise.resolve()
const last = new Map<string, string>()

export function badgeLine(step: string, detail: BadgeDetail): string | null {
  const body = JSON.stringify(detail)
  if (last.get(step) === body) return null
  last.set(step, body)
  return body
}
export function recordBadgeStep(step: string, detail: BadgeDetail): void {
  const body = badgeLine(step, detail)
  if (body === null || written >= 400) return
  written++
  const line = JSON.stringify({ at: new Date().toISOString(), version: app.getVersion(), step, ...detail })
  tail = tail.then(async () => {
    try {
      const directory = app.getPath('logs'), file = join(directory, 'badge-check.log')
      await mkdir(directory, { recursive: true })
      const size = await stat(file).then(value => value.size, () => 0)
      if (size > 128 * 1024) await rename(file, `${file}.1`).catch(() => {})
      await appendFile(file, `${line}\n`, { encoding: 'utf8', mode: 0o600 })
    } catch { /* Diagnostics are best effort. */ }
  })
}
// What an error was, by its name only.
export function errorName(error: unknown): string {
  return error instanceof Error ? error.name.slice(0, 40) : typeof error
}
