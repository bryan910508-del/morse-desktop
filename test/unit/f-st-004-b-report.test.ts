import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { supportTarget } from '../../src/main/accounts/support-account'
import { directChatId } from '../../src/main/messaging/direct-chat-id'
import { buildProblemReport, deviceModel, maskNumbers, maskReportText, reportBytesLimit, reportsPerDay, sentToday, type ProblemEntry, type ReportHeader } from '../../src/main/platform/problem-report'

// F-ST-004 B (contracts/F-ST-004-problem-report.md §7-2): the file the «문제 보고» box shows and sends.
const header = (account: string | null = null): ReportHeader => ({ app: 'desktop', version: '0.241.53', device: 'MacBookPro18,3', os: 'macOS 15.4 (arm64)', created: new Date('2026-11-19T04:12:30.456Z'), account })
const entry = (at: string, name = 'TypeError', frames = ['at send (out/main/index.js:4211:13)']): ProblemEntry => ({ at, version: '0.241.53', kind: 'main-exception', name, frames })

test('§7-2: the header, then each report under its number, oldest first', () => {
  const report = buildProblemReport(header(), [entry('2026-11-18T22:02:00Z', 'RangeError'), entry('2026-11-18T22:01:05Z')])
  assert.equal(report.name, 'morse-problem-report-desktop-0.241.53-20261119-0412.txt')
  assert.equal(report.text, ['Morse problem report', 'app: desktop', 'version: 0.241.53', 'device: MacBookPro18,3', 'os: macOS 15.4 (arm64)', 'created: 2026-11-19T04:12:30Z', 'reports: 2', '',
    '--- 1 ---', 'at: 2026-11-18T22:01:05Z', 'kind: main-exception', 'version: 0.241.53', 'name: TypeError', 'at send (out/main/index.js:4211:13)',
    '--- 2 ---', 'at: 2026-11-18T22:02:00Z', 'kind: main-exception', 'version: 0.241.53', 'name: RangeError', 'at send (out/main/index.js:4211:13)', ''].join('\n'))
  assert.deepEqual([report.included, report.leftOut], [2, 0])
})
test('§7-1 3: the account line only when turned on, and only the Morse ID; outside the masking', () => {
  assert.doesNotMatch(buildProblemReport(header(), [entry('2026-11-18T22:01:05Z')]).text, /^account:/m)
  assert.match(buildProblemReport(header('@morse_test'), [entry('2026-11-18T22:01:05Z')]).text, /^account: @morse_test\nreports: 1$/m)
})
test('§7-2: the body is masked again when sent (frames from an older version that kept more)', () => {
  const report = buildProblemReport(header(), [entry('2026-11-18T22:01:05Z', 'TypeError', ['at open (/Users/alice/x.js:1:2)', 'at q (main.js:3:4) uid=Ab3dEf6hIj9kLm2nOp5qRs8tUv1w'])])
  assert.match(report.text, /at open \(~\/x\.js:1:2\)\nat q \(main\.js:3:4\) uid=u1/)
  const body = report.text.slice(report.text.indexOf('--- 1 ---'))
  assert.equal(maskReportText(body, maskNumbers()), body, 'masking the sent body again changes nothing')
})
test('§7-2: over 256 KB the oldest reports go first and the count is written at the end; never empty of the header', () => {
  const big = Array.from({ length: 1000 }, (_, i) => `at frame${i} (out/main/index.js:${i}:1)`)
  const entries = Array.from({ length: 10 }, (_, i) => entry(`2026-11-18T22:${String(10 + i).padStart(2, '0')}:00Z`, 'TypeError', big))
  const report = buildProblemReport(header(), entries)
  assert.ok(Buffer.byteLength(report.text, 'utf8') <= reportBytesLimit, 'within 256 KB')
  assert.ok(report.leftOut > 0 && report.included + report.leftOut === 10)
  assert.match(report.text, new RegExp(`\\(older reports left out: ${report.leftOut}\\)\\n$`))
  assert.match(report.text, /at: 2026-11-18T22:19:00Z/, 'the newest stays')
  assert.match(report.text, new RegExp(`^reports: ${report.included}$`, 'm'))
  assert.equal(reportBytesLimit, 262_144)
})
test('§7-1 5: three a day, counted from local midnight', () => {
  const now = new Date(2026, 10, 19, 15, 0).getTime(), midnight = new Date(2026, 10, 19, 0, 0).getTime()
  assert.equal(sentToday([midnight - 1, midnight, now - 1000, now + 5000], now), 2, 'yesterday and the future do not count')
  assert.equal(reportsPerDay, 3)
})
test('§7-2: the device is the model identifier, never the computer\'s name', async () => {
  const model = await deviceModel(async (command, args) => command.endsWith('sysctl') ? 'MacBookPro18,3\n' : `\n    SystemProductName    REG_SZ    XPS 13 9310\n${args.length}`)
  assert.equal(model, process.platform === 'darwin' ? 'MacBookPro18,3' : process.platform === 'win32' ? 'XPS 13 9310' : 'unknown')
  assert.equal(await deviceModel(async () => { throw new Error('no') }), 'unknown')
})

// The box and its wiring (renderer and main), by their source: what is seen is what is sent; nothing goes unasked.
test('§7: the send takes the previewed file by its token — the same bytes; three a day and no empty report are checked in main', () => {
  const index = readFileSync('src/main/index.ts', 'utf8')
  const send = index.slice(index.indexOf("handle('send-problem-report'"), index.indexOf("// F-ST-004 A: a script error"))
  assert.match(send, /problemPreviews\.get\(token\)/)
  assert.match(send, /writeOutgoingReport\(preview\.report\)/, 'the very report the preview built')
  assert.match(send, /sentToday\(await readSentTimes\(\)\) >= reportsPerDay/)
  assert.match(send, /!preview\.count/)
  assert.match(send, /session\.sendFileToOpenChat\(target, path\)/)
  assert.match(send, /!session\.canAttachTo\(target\)/, 'a first conversation with support (a new 1:1, B548) is a target too')
})
test('§7-1: account info off by default and dimmed without a Morse ID; send only after consent; no window opens by itself', () => {
  const box = readFileSync('src/renderer/src/settings/problem-report-box.tsx', 'utf8')
  assert.match(box, /useState\(false\)\n  const \[agreed, setAgreed\] = useState\(false\)/, 'both start off')
  assert.match(box, /disabled=\{!preview\?\.hasMorseId \|\| empty\}/)
  assert.match(box, /const ready = preview !== null && !empty && !limited && agreed && !busy/)
  assert.match(box, /readOnly/)
  const main = readFileSync('src/renderer/src/main.tsx', 'utf8')
  assert.match(main, /label: tr\('문제 보고'\), run: \(\) => \{ const now = desktop\.value\?\.activeAccountUid; if \(now\) showProblemReportBox\(now\) \}/)
  const support = readFileSync('src/renderer/src/settings/support-boxes.tsx', 'utf8')
  assert.ok(support.indexOf("tr('문제 보고')") > support.indexOf("tr('채팅으로 문의하기')") && support.indexOf("tr('문제 보고')") < support.indexOf("tr('앱 정보')"), 'right under the chat, in «문의하기»')
})

// Review 11-05 15:4x: the report goes only into this account's 1:1 with support (§2-3) — main decides, not the window.
test('§2-3: only the 1:1 with support is a target; another room is refused; no support account is «not now»', () => {
  const me = 'Ab3dEf6hIj9kLm2nOp5qRs8tUv1w', support = 'Zz9yXx8wVv7uTt6sRr5qPp4oNn3m', friend = 'Qq1wWe2rRt3yYu4iIo5pPa6sSd7f'
  const facts = (chatId: string, extra = {}) => ({ chatId, uid: me, supportUid: support, ...extra })
  assert.equal(supportTarget(facts(directChatId(me, support)), directChatId), 'support', 'the pair\'s own room')
  assert.equal(supportTarget(facts('legacy_room', { dialog: { kind: 'direct', participantUids: [me, support] } }), directChatId), 'support', 'a listed 1:1 of the two')
  assert.equal(supportTarget(facts('pending_room', { pendingPeer: support }), directChatId), 'support', 'a new 1:1 with support not made yet')
  assert.equal(supportTarget(facts(directChatId(me, friend)), directChatId), 'other', 'another person\'s 1:1')
  assert.equal(supportTarget(facts('legacy_room', { dialog: { kind: 'direct', participantUids: [me, friend] } }), directChatId), 'other')
  assert.equal(supportTarget(facts('group_room', { dialog: { kind: 'group', participantUids: [me, support, friend] } }), directChatId), 'other', 'a group with support in it')
  assert.equal(supportTarget(facts('pending_room', { pendingPeer: friend }), directChatId), 'other')
  assert.equal(supportTarget({ chatId: 'x', uid: me, supportUid: null }, directChatId), 'unavailable')
  assert.equal(supportTarget({ chatId: 'x', uid: me, supportUid: me }, directChatId), 'unavailable', 'support itself has no one to report to')
  const index = readFileSync('src/main/index.ts', 'utf8')
  const send = index.slice(index.indexOf("handle('send-problem-report'"), index.indexOf("// F-ST-004 A: a script error"))
  assert.ok(send.indexOf('session.supportChatCheck(target)') < send.indexOf('writeOutgoingReport'), 'checked before anything is written or sent')
  assert.match(send, /if \(kind === 'unavailable'\) throw new Error\(tr\('지금은 채팅 문의를 쓸 수 없어요\.'\)\)/)
  assert.match(send, /if \(kind !== 'support'\) throw/)
})
