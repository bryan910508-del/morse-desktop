import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { finalizeDeviceModel, macModelFromIdentifier, macModelFromProfiler, macSystemVersion, windowsModel, windowsSystemVersion } from '../../src/main/platform/device-model'
import { decodeSignInSession } from '../../src/main/api/account-tools'
import { sessionTtlDays } from '../../src/shared/account-tools'
import { DeviceIdentity } from '../../src/main/auth/device-identity'
import { AuthenticationFailure, type DesktopAuthConfiguration } from '../../src/main/auth/contracts'
import { FirebaseAuthenticationAPI } from '../../src/main/auth/firebase-rest'
import { sessionActiveTime } from '../../src/renderer/src/app/format'
import { documents, type FirestoreDocument } from '../../src/main/network/firestore-values'

// A6 contract §3-3: the device and system a session row shows, by Telegram Desktop's own rules (lib_base de35c7ab
// base_info_mac.mm DeviceModelPretty / SystemVersionPretty, base_info_win.cpp, base_platform_info.cpp).
test('this computer is named as Telegram Desktop names it', () => {
  const profiler = (name: string, chip?: string): string => JSON.stringify({ SPHardwareDataType: [{ machine_name: name, ...(chip ? { chip_type: chip } : {}) }] })
  assert.equal(macModelFromProfiler(profiler('MacBook Air', 'Apple M1')), 'MacBook Air M1')
  assert.equal(macModelFromProfiler(profiler('Mac mini', 'Intel Core i7')), 'Mac mini', 'only an Apple chip is added')
  assert.equal(macModelFromProfiler('not json'), '')
  assert.equal(macModelFromIdentifier('MacBookPro18,3'), 'MacBook Pro')
  assert.equal(macModelFromIdentifier('iMac21,1'), 'iMac')
  assert.equal(macModelFromIdentifier('Mac14,2'), 'Mac', 'the M2 identifiers say no more than «Mac»')
  assert.equal(macModelFromIdentifier('VMware7,1'), '')
  assert.equal(finalizeDeviceModel('', true), 'Mac')
  assert.equal(finalizeDeviceModel('  ', false), 'Desktop')
  assert.equal(macSystemVersion('26.4.1'), 'macOS 26.4.1')
  assert.equal(macSystemVersion('26.4.0'), 'macOS 26.4')
  assert.equal(macSystemVersion('10.11.6'), 'OS X 10.11.6')
  assert.equal(windowsModel({ systemProductName: 'XPS 13 9310' }), 'XPS 13 9310')
  assert.equal(windowsModel({ systemProductName: 'HP EliteBook 840 G8 Notebook PC' }), 'HP EliteBook 840 G8', 'an HP name loses its kind words')
  assert.equal(windowsModel({ systemProductName: 'To Be Filled By O.E.M.', systemFamily: 'ROG', baseBoardProduct: 'B550-F' }), 'ROG B550-F')
  assert.equal(windowsModel({ systemProductName: 'System Product Name Long Enough', systemFamily: '', baseBoardProduct: '' }), '')
  assert.equal(windowsSystemVersion('10.0.22631'), 'Windows 11')
  assert.equal(windowsSystemVersion('10.0.19045'), 'Windows 10')
  assert.equal(windowsSystemVersion('6.1.7601'), 'Windows 7')
})

const sessionDoc = (id: string, fields: Record<string, unknown>): FirestoreDocument =>
  ({ name: `${documents}/users/me/signInSessions/${id}`, fields }) as unknown as FirestoreDocument
test('a session row shows the device, «app version» and system; one still marked ended is not shown', () => {
  const now = sessionDoc('s1', { deviceModel: { stringValue: 'MacBook Air M1' }, appName: { stringValue: 'Morse macOS' }, appVersion: { stringValue: '0.240.2' },
    systemVersion: { stringValue: 'macOS 26.4.1' }, platform: { stringValue: 'macOS' }, loginProvider: { stringValue: 'custom' },
    lastSeenAt: { timestampValue: '2026-09-30T06:00:00Z' }, createdAt: { timestampValue: '2026-09-01T00:00:00Z' } })
  assert.deepEqual(decodeSignInSession(now, 's1'), { id: 's1', platform: 'macOS', current: true, deviceModel: 'MacBook Air M1', appName: 'Morse macOS',
    appVersion: '0.240.2', systemVersion: 'macOS 26.4.1', lastSeenAt: Date.parse('2026-09-30T06:00:00Z'), createdAt: Date.parse('2026-09-01T00:00:00Z'),
    qr: null, ip: '', origin: null })
  // Written before A6: the model from the old label, the app from the platform the server verified.
  const old = decodeSignInSession(sessionDoc('s2', { deviceLabel: { stringValue: 'Morse · Android' }, platform: { stringValue: 'Android' }, appVersion: { stringValue: '1.0' } }), 's1')
  assert.equal(old?.deviceModel, 'Android'); assert.equal(old?.appName, 'Morse Android'); assert.equal(old?.current, false)
  assert.equal(decodeSignInSession(sessionDoc('s3', { platform: { stringValue: 'Plan9' } }), 's1')?.appName, 'Morse')
  // A gRPC read gives the timestamp as {seconds, nanos}.
  const grpc = decodeSignInSession(sessionDoc('s5', { lastSeenAt: { timestampValue: { seconds: '1790748000', nanos: 500000000 } } }), 's1')
  assert.equal(grpc?.lastSeenAt, 1790748000500)
  assert.equal(decodeSignInSession(sessionDoc('s4', { deviceModel: { stringValue: 'iPhone' }, revokeRequestedAt: { timestampValue: '2026-09-29T00:00:00Z' } }), 's1'), null)
})

test('the period for ending idle sessions is one of Telegram\'s four', () => {
  for (const days of [7, 90, 183, 365]) assert.equal(sessionTtlDays(days), days)
  for (const days of [0, 30, 180, '183', null]) assert.throws(() => sessionTtlDays(days))
})

// Api::Authorizations::ActiveDateString: today → time, this calendar week → weekday, older → date.
test('a session\'s last activity reads as Telegram shows it', () => {
  const wednesday = new Date(2026, 8, 30, 15, 0).getTime()
  const at = (day: number, hour = 9): number => new Date(2026, 8, day, hour, 5).getTime()
  const time = sessionActiveTime(at(30), wednesday), monday = sessionActiveTime(at(28), wednesday), sunday = sessionActiveTime(at(27), wednesday)
  assert.match(time, /\d/); assert.doesNotMatch(time, /2026|26\./)
  assert.doesNotMatch(monday, /\d/, 'Monday of this week is a weekday name')
  assert.match(sunday, /\d/, 'the Sunday before is last week: a date')
})

// A6 §4 Desktop: the session ID lives apart from the saved credential, so signing in again reuses it.
test('this Mac keeps one session ID per account, and an earlier build\'s ID is kept', async () => {
  const identity = new DeviceIdentity(mkdtempSync(join(tmpdir(), 'morse-a6-')))
  const first = await identity.sessionId('alice')
  assert.match(first, /^[0-9a-f-]{36}$/)
  assert.equal(await identity.sessionId('alice'), first, 'the same account gets the same ID again')
  assert.notEqual(await identity.sessionId('bob'), first, 'another account has its own')
  const earlier = '11111111-2222-4333-8444-555555555555'
  assert.equal(await identity.sessionId('carol', earlier), earlier)
  assert.equal(await identity.sessionId('carol'), earlier, 'and it is written down for later sign-ins')
})

// A6 §3-1 / §4 Desktop: signing out ends this device's session with `signOut: true`. An answer lost on the way is sent
// once more; the server then refuses the generation it has just ended («session-revoked») — the sign-out is done.
const appId = '1:123713400904:web:test'
function api(): FirebaseAuthenticationAPI {
  const configuration: DesktopAuthConfiguration = { apiKey: 'key', appId, projectId: 'talky-a38c3', projectNumber: '123713400904',
    platform: process.platform === 'win32' ? 'Windows' : 'macOS', proof: { getProof: async () => ({ token: 'proof', appId, expiresAt: Date.now() + 3600000 }) } }
  return new FirebaseAuthenticationAPI(configuration)
}
const lost = (): Error => Object.assign(new Error('socket hang up'), { cause: { code: 'ECONNRESET' } })
const revoked: [number, object] = [403, { error: { status: 'PERMISSION_DENIED', message: 'Sign in again.', details: { reason: 'session-revoked' } } }]
function serve(answers: Array<[number, object] | Error>): Record<string, unknown>[] {
  const sent: Record<string, unknown>[] = []
  globalThis.fetch = (async (_url: string, init: RequestInit) => {
    sent.push((JSON.parse(String(init.body)) as { data: Record<string, unknown> }).data)
    const answer = answers.shift()!
    if (answer instanceof Error) throw answer
    return new Response(JSON.stringify(answer[1]), { status: answer[0] })
  }) as typeof fetch
  return sent
}
test('signing out ends this session on the server, and a lost answer sent again ends as signed out', async () => {
  const signal = new AbortController().signal
  let sent = serve([[200, { result: { ok: true } }]])
  await api().signOutSession('a.b.c', 'sess-1', signal)
  assert.deepEqual(sent, [{ sessionId: 'sess-1', signOut: true }])
  sent = serve([lost(), revoked])
  await api().signOutSession('a.b.c', 'sess-1', signal)
  assert.equal(sent.length, 2, 'sent once more after the answer was lost')
  sent = serve([revoked])
  await api().signOutSession('a.b.c', 'sess-1', signal)
  assert.equal(sent.length, 1, 'a session already ended is a sign-out done')
  sent = serve([lost(), lost()])
  await assert.rejects(api().signOutSession('a.b.c', 'sess-1', signal), (error: unknown) => error instanceof AuthenticationFailure && error.code === 'network')
  assert.equal(sent.length, 2, 'not more than twice')
})
