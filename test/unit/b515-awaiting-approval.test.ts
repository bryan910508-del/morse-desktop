import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'

// B515 (user 11:4x «권장대로»): while the owner has not answered a join request, the button says «승인 대기 중» in all three
// apps, read from the server's joinRequests document (channel-membership-info.ts), with the note under it unchanged.
test('a pending join request shows «승인 대기 중» on the button and keeps its note', () => {
  const box = readFileSync('src/renderer/src/channels/channel-discovery-box.tsx', 'utf8')
  assert.match(box, /const requested = membership\?\.joinRequest === 'pending'/)
  assert.match(box, /disabled=\{joining \|\| requested\}[^\n]*\{requested \? tr\('승인 대기 중'\) : tr\('가입'\)\}/)
  assert.match(box, /\{requested && <p className="box-note">\{tr\('가입 요청을 보냈습니다\. 채널 소유자의 승인을 기다리고 있습니다\.'\)\}<\/p>\}/)
  assert.doesNotMatch(box, /가입 요청 보냄/)
  const en = JSON.parse(readFileSync('src/shared/i18n/en.json', 'utf8')) as Record<string, string>
  const ru = JSON.parse(readFileSync('src/shared/i18n/ru.json', 'utf8')) as Record<string, string>
  assert.equal(en['승인 대기 중'], 'Awaiting approval')
  assert.equal(ru['승인 대기 중'], 'Ожидает одобрения')
})

// The server's B515 (claude/b515-join-request-pushes 11dd704c, reports/server/2026-11-01-b515-join-request-server.md §5):
// pending → «승인 대기 중»; denied → «가입» again; the request gone with the subscription made → joined («채널 열기»).
test('denied asks again with «가입»; a joined channel opens; only pending waits', () => {
  const box = readFileSync('src/renderer/src/channels/channel-discovery-box.tsx', 'utf8')
  assert.match(box, /const requested = membership\?\.joinRequest === 'pending'\n/, 'denied and none are not waiting')
  assert.match(box, /\? listed\n\s*\? <button className="button flat" onClick=\{\(\) => open\(metadata\.id\)\}>\{tr\('채널 열기'\)\}<\/button>/)
})

test('an approval that appears while the window runs is announced once; the first look only records', async () => {
  const { newApprovals } = await import('../../src/main/accounts/channel-join-approvals')
  assert.deepEqual(newApprovals(null, ['a', 'b']).approved, [], 'an account opening does not announce its past approvals')
  const first = newApprovals(null, ['a']).known
  const next = newApprovals(first, ['a', 'c'])
  assert.deepEqual(next.approved, ['c'])
  assert.deepEqual(newApprovals(next.known, ['a', 'c']).approved, [])
  const approvals = readFileSync('src/main/accounts/channel-join-approvals.ts', 'utf8')
  assert.match(approvals, /fieldPath: 'joinedByRequest' \}, op: 'EQUAL', value: \{ booleanValue: true \}/)
  assert.match(approvals, /\(!preferences\.notifyChannel && !preferences\.notifyPersonal\)\) return/, 'off for one who turned both off, as the server push')
  const main = readFileSync('src/main/index.ts', 'utf8')
  assert.match(main, /openChannel: channelId => openNotificationChannel\(uid, channelId\)/)
  assert.match(main, /emit\(\{ type: 'open-notification-channel', accountUid: uid, channelId \}\)/)
  const renderer = readFileSync('src/renderer/src/main.tsx', 'utf8')
  assert.match(renderer, /else if \(target\?\.kind === 'channel'\) controller\.openChannel\(target\.channelId\)/)
})

test('a channel joined by an approved request shows its line once on this device', async () => {
  const store = new Map<string, string>()
  ;(globalThis as Record<string, unknown>).localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v) } }
  const { takeJoinApprovedLine } = await import('../../src/renderer/src/channels/join-approved-line')
  assert.equal(takeJoinApprovedLine('me', 'ch1', false), false, 'not joined by a request')
  assert.equal(takeJoinApprovedLine('me', 'ch1', true), true)
  assert.equal(takeJoinApprovedLine('me', 'ch1', true), false, 'once')
  assert.equal(takeJoinApprovedLine('other', 'ch1', true), true, 'each account its own')
  const channels = readFileSync('src/main/accounts/channels.ts', 'utf8')
  assert.match(channels, /fields\.joinedByRequest\?\.booleanValue === true \? \{ joinedByRequest: true as const \} : \{\}/)
  const section = readFileSync('src/renderer/src/channels/channel-section.tsx', 'utf8')
  assert.match(section, /\{approvedLine === channelId && <div className="channel-service-line" role="status"><span className="service-pill">\{tr\('가입 요청이 승인되었어요\.'\)\}<\/span><\/div>\}/)
  for (const file of ['src/shared/i18n/en.json', 'src/shared/i18n/ru.json']) {
    const words = JSON.parse(readFileSync(file, 'utf8')) as Record<string, string>
    assert.ok(words['가입 요청이 승인되었어요.'] && words['"{0}" 가입 요청이 승인되었어요.'], file)
  }
})
