import assert from 'node:assert/strict'
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { app, crashReporter } from 'electron'
import { crashStepsWritten, markCleanExit, recordCrashStep, startCrashRecording, takeCrashNotice } from '../../src/main/platform/crash-diagnostics'

// 0.241.36: what ended the app is kept on this device only — dumps are never uploaded, each line has no message or
// path — and a run that did not quit is told once at the next launch (tdesktop core/crash_reports.cpp:403 tdata/working).
const marker = join(tmpdir(), 'running'), log = join(tmpdir(), 'crash-check.log')
const stub = app as unknown as { listeners: Map<string, ((...args: unknown[]) => void)[]> }

test('recording starts with nothing uploaded; a clean quit leaves no marker, a run that did not quit is told once', async () => {
  rmSync(marker, { force: true }); rmSync(log, { force: true })
  startCrashRecording()
  assert.deepEqual((crashReporter as unknown as { started: unknown[] }).started.at(-1), { uploadToServer: false, compress: true })
  assert.equal(takeCrashNotice(), false, 'a first run is not a crash')
  assert.ok(existsSync(marker), 'the running marker is there while the app runs')
  markCleanExit()
  assert.ok(!existsSync(marker), 'a clean quit removes it')
  writeFileSync(marker, '0.241.35')
  startCrashRecording()
  assert.equal(takeCrashNotice(), true, 'the last run left its marker: it ended without quitting')
  assert.equal(takeCrashNotice(), false, 'told once')
  // B483: the log is read once its writes are done, not after a fixed time (a busy Mac once took longer than 30 ms).
  await crashStepsWritten()
  assert.match(readFileSync(log, 'utf8'), /"step":"previous-run-ended","detail":"version=0\.241\.35"/)
  markCleanExit()
})

test('a process that ends is written by kind, reason and code only — never a message or an identifier', async () => {
  rmSync(log, { force: true })
  for (const listener of stub.listeners.get('render-process-gone') ?? []) listener({}, {}, { reason: 'crashed', exitCode: 11 })
  for (const listener of stub.listeners.get('child-process-gone') ?? []) listener({}, { type: 'GPU', reason: 'oom', exitCode: 5 })
  recordCrashStep('main-exception', 'uncaughtException TypeError users/RAk6jfkPEXhydeuUxG9U36UQP9m1/stories')
  await crashStepsWritten()
  const text = readFileSync(log, 'utf8')
  assert.match(text, /"step":"renderer-gone","detail":"crashed exit=11"/)
  assert.match(text, /"step":"child-gone","detail":"GPU oom exit=5"/)
  assert.ok(!text.includes('RAk6jfkPEXhydeuUxG9U36UQP9m1'), 'a long identifier is masked')
  rmSync(log, { force: true }); rmSync(marker, { force: true })
})
