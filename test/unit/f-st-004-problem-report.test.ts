import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readdir, rm, utimes, writeFile } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { clearOldDumps, maskNumbers, messageKeys, personKeys, roomKeys, secretKeys, maskReportText, problemLimits, problemsPerRun, problemsThisRun, problemsWritten, pruneProblems, readProblems, recordProblem, resetProblemRun, stackFrames } from '../../src/main/platform/problem-report'

// F-ST-004 §6 (contracts/F-ST-004-problem-report.md): the masking table every app's unit tests carry, row by row, fake
// values only.
const mask = (text: string, known = {}) => maskReportText(text, maskNumbers(), known)

test('§6 1–2: a person is a number, the same value the same number within one report', () => {
  const numbers = maskNumbers()
  assert.equal(maskReportText('uid=Ab3dEf6hIj9kLm2nOp5qRs8tUv1w', numbers), 'uid=u1')
  assert.equal(maskReportText('peer Zz9yXx8wVv7uTt6sRr5qPp4oNn3m then Ab3dEf6hIj9kLm2nOp5qRs8tUv1w', numbers), 'peer u2 then u1')
})
test('§6 3: rooms and messages by their key', () => {
  assert.equal(mask('chatId=dm_fakeRoom0001 roomId=grp_fake02 messageId=msg_fake01 inquiryId=chan_x_fake'),
    'chatId=c1 roomId=c2 messageId=m1 inquiryId=c3')
  assert.equal(mask('chatId=dm_fakeRoom0001 again chatId=dm_fakeRoom0001'), 'chatId=c1 again chatId=c1')
})
test('§6 4: what the app knows as its own uid and rooms, bare, gets the same numbers', () => {
  const numbers = maskNumbers(), known = { uids: ['Ab3dEf6hIj9kLm2nOp5qRs8tUv1w'], rooms: ['dm_fakeRoom0001'] }
  assert.equal(maskReportText('chatId=dm_fakeRoom0001 uid=Ab3dEf6hIj9kLm2nOp5qRs8tUv1w', numbers, known), 'chatId=c1 uid=u1')
  assert.equal(maskReportText('opening dm_fakeRoom0001 for Ab3dEf6hIj9kLm2nOp5qRs8tUv1w', numbers, known), 'opening c1 for u1')
})
test('§6 5: tokens', () => {
  assert.equal(mask('token=abc123 fcmToken=xyz apnsToken=q1w2'), 'token=[가림] fcmToken=[가림] apnsToken=[가림]')
  assert.equal(mask('Authorization: Bearer abcdef.123'), 'Authorization: Bearer [가림]')
  assert.equal(mask('jwt eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.sig_part'), 'jwt [토큰]')
})
test('§6 6–8: mail, phone, IP', () => {
  assert.equal(mask('mail a.b@example.com here'), 'mail [메일] here')
  assert.equal(mask('call +82 10-1234-5678 or 010-1234-5678'), 'call [전화] or [전화]')
  assert.equal(mask('from 203.0.113.7 and 2001:db8::1'), 'from [IP] and [IP]')
})
test('§6 9–10: paths keep their shape, the person\'s folder becomes ~ (macOS, Windows, Linux) and an iOS container <app>', () => {
  assert.equal(mask('/Users/alice/Library/Logs/x.log'), '~/Library/Logs/x.log')
  assert.equal(mask('C:\\Users\\alice\\AppData\\Roaming\\morse'), '~\\AppData\\Roaming\\morse')
  assert.equal(mask('/home/alice/.config/morse'), '~/.config/morse')
  assert.equal(mask('/var/mobile/Containers/Data/Application/0F1E2D3C-4B5A-6978-8796-A5B4C3D2E1F0/Documents/a'), '<app>/Documents/a')
})
test('§6 11: an exception\'s message goes, its class stays', () => {
  assert.equal(mask('IllegalStateException: room 3 text "hi"'), 'IllegalStateException')
  assert.equal(mask('TypeError: cannot read «hello» of undefined'), 'TypeError')
  assert.equal(mask('Uncaught RangeError: bad length 12'), 'Uncaught RangeError')
})
test('§6 12: stack frames stay as they are', () => {
  for (const frame of ['at com.morse.messenger.ChatRoom.send(ChatRoom.kt:120)', 'MorseMessenger AppState.swift:853', 'at send (main.js:42:7)', 'at async Session.open (out/main/index.js:1201:15)'])
    assert.equal(mask(frame), frame)
  assert.equal(mask('at 14:45:02 open'), 'at 14:45:02 open', 'a time is not an IP')
})
test('§6 13: 32 hex characters or more (contract §6 «맞춤»)', () => {
  assert.equal(mask(`hash ${'a1'.repeat(17)} end`), 'hash [가림] end')
  assert.equal(mask(`hash ${'a1'.repeat(16)} end`), 'hash [가림] end', 'exactly 32 is masked')
  assert.equal(mask(`short ${'a1'.repeat(15)}f end`), `short ${'a1'.repeat(15)}f end`, '31 stays')
})
test('§6 14: masking twice is masking once', () => {
  const raw = ['TypeError: x', 'uid=Ab3dEf6hIj9kLm2nOp5qRs8tUv1w chatId=dm_fakeRoom0001 messageId=msg_fake01', 'token=abc Bearer zz a.b@example.com',
    '+82 10-1234-5678 203.0.113.7 2001:db8::1 /Users/alice/x C:\\Users\\alice\\y', `${'f'.repeat(40)}`, 'at send (main.js:42:7)'].join('\n')
  const once = mask(raw)
  assert.equal(maskReportText(once, maskNumbers()), once)
})

test('F-ST-004 A: only the stack\'s frame lines are kept from an error', () => {
  const stack = 'TypeError: secret text "hello"\n    at send (main.js:42:7)\n    at open (index.js:9:1)\nnot a frame'
  assert.deepEqual(stackFrames(stack), ['at send (main.js:42:7)', 'at open (index.js:9:1)'])
  assert.deepEqual(stackFrames(undefined), [])
})

test('F-ST-004 A: at most 10 reports, none older than 7 days, 1 MB in all', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'morse-problems-'))
  try {
    const now = Date.now()
    for (let i = 0; i < 12; i++) {
      const file = join(directory, `${i}.json`)
      await writeFile(file, '{}')
      const at = (now - i * 1000) / 1000
      await utimes(file, at, at)
    }
    const old = join(directory, 'old.json'); await writeFile(old, '{}')
    await utimes(old, (now - problemLimits.ageMs - 60_000) / 1000, (now - problemLimits.ageMs - 60_000) / 1000)
    await pruneProblems(directory, now)
    const left = (await readdir(directory)).sort()
    assert.equal(left.length, 10, 'ten kept')
    assert.ok(!left.includes('old.json') && !left.includes('10.json') && !left.includes('11.json'), 'the oldest go')
    const big = join(directory, 'big.json'); await writeFile(big, 'x'.repeat(problemLimits.bytes + 1))
    await pruneProblems(directory, now + 5000)
    assert.ok(!(await readdir(directory)).includes('big.json'), 'past 1 MB in all goes')
  } finally { await rm(directory, { recursive: true, force: true }) }
})

test('F-ST-004 A: no native dumps — crashReporter is not started; main and window errors are recorded, handling unchanged', () => {
  const crash = readFileSync('src/main/platform/crash-diagnostics.ts', 'utf8')
  assert.doesNotMatch(crash, /crashReporter\.start/)
  assert.match(crash, /recordProblem\('main-exception'/)
  assert.match(crash, /process\.on\('uncaughtExceptionMonitor'/, 'a monitor: Electron\'s own handling stays')
  const preload = readFileSync('src/preload/index.ts', 'utf8')
  assert.match(preload, /window\.addEventListener\('error', event => reportProblem\(event\.error\)\)/)
  assert.doesNotMatch(preload.slice(preload.indexOf('const reportProblem')), /preventDefault/)
})

// Review 11-05 15:0x (a)–(c). Under the test stub the app data folder is the system temp folder.
const store = join(tmpdir(), 'problem-reports')
test('(a) a window error with no frames is not kept; a window that went away is', async () => {
  resetProblemRun(); await rm(store, { recursive: true, force: true })
  recordProblem('renderer-error', { name: 'Error', stack: '' })
  recordProblem('renderer-error', { name: 'TypeError', stack: 'TypeError: secret' })
  await problemsWritten()
  assert.deepEqual(await readProblems(store), [], 'nothing from errors without frames')
  recordProblem('renderer-gone', { name: 'RendererGone_crashed' })
  recordProblem('renderer-error', { name: 'TypeError', stack: 'TypeError: secret "hi"\n    at send (main.js:42:7)' })
  await problemsWritten()
  const kept = await readProblems(store)
  assert.deepEqual(kept.map(entry => [entry.kind, entry.name, entry.frames]).sort(), [['renderer-error', 'TypeError', ['at send (main.js:42:7)']], ['renderer-gone', 'RendererGone_crashed', []]])
  assert.ok(!JSON.stringify(kept).includes('secret'), 'no message')
  await rm(store, { recursive: true, force: true })
})
test('(b) at most 50 a run, however many different errors come', async () => {
  resetProblemRun(); await rm(store, { recursive: true, force: true })
  for (let i = 0; i < 80; i++) recordProblem('main-exception', { name: 'Error', stack: `Error\n    at loop${i} (main.js:${i}:1)` })
  await problemsWritten()
  assert.equal(problemsThisRun(), problemsPerRun)
  assert.equal(problemsPerRun, 50)
  assert.ok((await readProblems(store)).length <= problemLimits.count, 'the disk keeps its own limit too')
  resetProblemRun(); await rm(store, { recursive: true, force: true })
})
test('(c) dumps an earlier version left go once; only the crash folder by its name, only its dump files', async () => {
  const base = await mkdtemp(join(tmpdir(), 'morse-dumps-'))
  try {
    const crash = join(base, 'Crashpad')
    for (const sub of ['completed', 'pending', 'new']) await mkdir(join(crash, sub), { recursive: true })
    await writeFile(join(crash, 'completed', 'a1b2.dmp'), 'x'); await writeFile(join(crash, 'pending', 'c3.dmp'), 'x')
    await writeFile(join(crash, 'pending', 'c3.meta'), 'x'); await writeFile(join(crash, 'settings.dat'), 'x')
    assert.equal(await clearOldDumps(crash), 3)
    assert.deepEqual((await readdir(join(crash, 'completed'))), [])
    assert.deepEqual((await readdir(crash)).sort(), ['completed', 'new', 'pending', 'settings.dat'], 'other files stay')
    const other = join(base, 'elsewhere'); await mkdir(other); await writeFile(join(other, 'keep.dmp'), 'x')
    assert.equal(await clearOldDumps(other), 0, 'a folder not named as the crash folder is never touched')
    assert.deepEqual(await readdir(other), ['keep.dmp'])
    assert.match(readFileSync('src/main/platform/crash-diagnostics.ts', 'utf8'), /clearOldDumps\(app\.getPath\('crashDumps'\)\)\.then\(count => \{ if \(count\) recordCrashStep\('old-dumps-cleared', String\(count\)\)/)
  } finally { await rm(base, { recursive: true, force: true }) }
})

test('§6 «맞춤»: the three apps\' key lists — people, rooms, messages numbered; secret keys masked; as key=value and as JSON', () => {
  const numbers = maskNumbers()
  const people = personKeys.map((key, i) => `${key}=person_${i}`).join(' ')
  assert.equal(maskReportText(people, numbers), personKeys.map((key, i) => `${key}=u${i + 1}`).join(' '))
  assert.equal(maskReportText(roomKeys.map((key, i) => `${key}=room_${i}`).join(' '), numbers), roomKeys.map((key, i) => `${key}=c${i + 1}`).join(' '))
  assert.equal(maskReportText(messageKeys.map((key, i) => `${key}=msg_${i}`).join(' '), numbers), messageKeys.map((key, i) => `${key}=m${i + 1}`).join(' '))
  assert.equal(maskReportText(secretKeys.map(key => `${key}=s3cr3t`).join(' '), numbers), secretKeys.map(key => `${key}=[가림]`).join(' '))
  assert.equal(mask('sessionToken=abc'), 'sessionToken=[가림]', 'any key ending in Token')
  assert.equal(mask('{"chatId":"dm_fake01","senderId":"person_x","password":"hunter2"}'), '{"chatId":"c1","senderId":"u1","password":"[가림]"}')
  const once = mask('{"chatId":"dm_fake01","password":"hunter2"} postId=p_1 apiKey=k')
  assert.equal(maskReportText(once, maskNumbers()), once, 'twice is once')
  assert.deepEqual([personKeys.length, roomKeys.length, messageKeys.length, secretKeys.length], [12, 5, 4, 13])
})
