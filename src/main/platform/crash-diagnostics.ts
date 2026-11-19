// Portions of this file follow Telegram Desktop (https://github.com/telegramdesktop/tdesktop, 7.3.1),
// Copyright (c) 2014-2026 The Telegram Desktop Authors. Licensed under GPL-3.0-or-later; see LEGAL.
import { app } from 'electron'
import { clearOldDumps, recordProblem } from './problem-report'
import { appendFile, mkdir, rename, stat } from 'node:fs/promises'
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

// 0.241.36: what ended the app or one of its processes, kept on this device only (crash-check.log). tdesktop starts
// its crash catching before anything else (core/sandbox.cpp:515 CrashReports::Start, core/crash_reports.cpp:403·:323),
// learns of a crash at the next launch from the file the last run left (tdata/working), and asks before it sends
// anything (core/crash_report_window.cpp:571). Here nothing is sent, and no native dump is made (F-ST-004 §2-3: a dump
// can hold message text from memory, so crashReporter is not started): each line names the kind, the reason and an exit
// code or an error's class — never a message or a path — and the next launch only says so, with the logs folder one
// press away for an inquiry. The stack's frames, masked, go to problem-report.ts for the «문제 보고» box.
const seen = new Set<string>()
let written = 0, tail: Promise<unknown> = Promise.resolve()
let marker = '', previous = false

export function recordCrashStep(step: string, detail = ''): void {
  if (written >= 200) return
  const short = detail.replace(/[A-Za-z0-9_-]{12,}/gu, '*').slice(0, 120), key = `${step}|${short}`
  if (seen.has(key)) return
  seen.add(key); written++
  const line = JSON.stringify({ at: new Date().toISOString(), version: app.getVersion(), step, detail: short })
  tail = tail.then(async () => {
    try {
      const directory = app.getPath('logs'), file = join(directory, 'crash-check.log')
      await mkdir(directory, { recursive: true })
      const size = await stat(file).then(value => value.size, () => 0)
      if (size > 128 * 1024) await rename(file, `${file}.1`).catch(() => {})
      await appendFile(file, `${line}\n`, { encoding: 'utf8', mode: 0o600 })
    } catch { /* Diagnostics are best effort. */ }
  })
}

// B483: settles once every line recorded so far is on disk, or failed to get there. The quit waits for it before the
// app ends (index.ts before-quit), so a line recorded while shutting down is kept; the unit tests read the log after
// it instead of after a fixed time.
export function crashStepsWritten(): Promise<void> { return tail.then(() => {}, () => {}) }

// Only the single running instance calls this, before the app is ready.
export function startCrashRecording(): void {
  // tdata/working: a run that ends cleanly removes its marker; one still there at launch ended some other way.
  marker = join(app.getPath('userData'), 'running')
  try {
    if (existsSync(marker)) {
      previous = true
      recordCrashStep('previous-run-ended', `version=${readFileSync(marker, 'utf8').trim().slice(0, 32)}`)
    }
    writeFileSync(marker, app.getVersion(), { mode: 0o600 })
  } catch { /* A folder that cannot be written records nothing. */ }
  app.on('will-quit', markCleanExit)
  // F-ST-004 §2-3: dumps an earlier version left (crashReporter ran 0.241.36–0.241.52) go once; only a count is written.
  try { void clearOldDumps(app.getPath('crashDumps')).then(count => { if (count) recordCrashStep('old-dumps-cleared', String(count)) }, () => {}) } catch { /* No such folder. */ }
  // Monitor only: the default handling (Electron's own dialog) stays as it is.
  process.on('uncaughtExceptionMonitor', (error, origin) => {
    recordCrashStep('main-exception', `${origin} ${error instanceof Error ? error.name : typeof error}`)
    recordProblem('main-exception', error instanceof Error ? error : null)
  })
  app.on('render-process-gone', (_event, _contents, details) => {
    recordCrashStep('renderer-gone', `${details.reason} exit=${details.exitCode}`)
    recordProblem('renderer-gone', { name: `RendererGone_${details.reason}`.replace(/[^\w]/g, '_') })
  })
  app.on('child-process-gone', (_event, details) => recordCrashStep('child-gone', `${details.type} ${details.reason} exit=${details.exitCode}`))
}
// The quit finished its saving (before-quit) or the app is quitting (will-quit): not a crash.
export function markCleanExit(): void {
  if (!marker) return
  try { rmSync(marker, { force: true }) } catch { /* ignored */ }
}
// Whether the last run ended without quitting, told once (the renderer's notice).
export function takeCrashNotice(): boolean { const value = previous; previous = false; return value }
