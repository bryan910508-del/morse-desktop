import { app } from 'electron'
import { appendFile, mkdir, rename, stat } from 'node:fs/promises'
import { join } from 'node:path'

// F5 and rh-3 (2026-10-12): two questions this device answers for itself, in tap-check.log beside the other *-check.log
// files — kept here only, never sent anywhere. F5: a press on a file, a video or a link that did nothing until it was
// pressed again — which step it was lost at. rh-3: a shown notification taken back with no reason seen — which check
// took it. Lines hold steps, element kinds, times and outcomes; no words, names or ids. A run writes at most maxLines.
const maxLines = 400
let written = 0, tail: Promise<unknown> = Promise.resolve()

export function recordTapStep(step: string, detail: string): void {
  if (written >= maxLines) return
  written++
  const line = JSON.stringify({ at: new Date().toISOString(), version: app.getVersion(), step: tapDetail(step).slice(0, 40), detail: tapDetail(detail) })
  tail = tail.then(async () => {
    try {
      const directory = app.getPath('logs'), file = join(directory, 'tap-check.log')
      await mkdir(directory, { recursive: true })
      const size = await stat(file).then(value => value.size, () => 0)
      if (size > 256 * 1024) await rename(file, `${file}.1`).catch(() => {})
      await appendFile(file, `${line}\n`, { encoding: 'utf8', mode: 0o600 })
    } catch { /* Diagnostics are best effort. */ }
  })
}
// Only the characters a step, a class name, a count or a time is made of; anything else is dropped.
export function tapDetail(detail: string): string { return detail.replace(/[^\w:/=.,| -]/g, '').slice(0, 300) }

// The mouse presses the window itself was given (webContents input-event), the last few of them, with whether the window
// was focused then: whether a lost press reached the window at all.
const inputs: { at: number; kind: 'down' | 'up'; focused: boolean }[] = []
export function noteWindowInput(kind: 'down' | 'up', focused: boolean, at = Date.now()): void {
  inputs.push({ at, kind, focused })
  if (inputs.length > 32) inputs.splice(0, inputs.length - 32)
}
export function windowInputsAround(at: number): string {
  const near = inputs.filter(input => input.at >= at - 1500 && input.at <= at + 1500)
  const down = near.filter(input => input.kind === 'down')
  return `win-down=${down.length} win-up=${near.length - down.length} win-focused=${down.length ? down.every(input => input.focused) ? 1 : 0 : '-'}`
}
// What the window reports of a lost press, checked before it is written.
export function recordLostTap(value: unknown): void {
  if (!value || typeof value !== 'object') return
  const { at, detail } = value as { at?: unknown; detail?: unknown }
  if (typeof at !== 'number' || !Number.isFinite(at) || typeof detail !== 'string' || detail.length > 400) return
  recordTapStep('first-tap-lost', `${detail} | ${windowInputsAround(at)}`)
}
