import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { AuthenticationFailure } from '../../src/main/auth/contracts'
import { endingList } from '../../src/main/auth/credential-vault'
import { SessionEnders, endingOutcome, endingRetryDelay, type EndingSession } from '../../src/main/auth/session-enders'

// tdesktop's keys to destroy (Main::Account::destroyMtpKeys, mtp_instance.cpp scheduleKeyDestroy/performKeyDestroy): a
// sign-in this device left behind is ended with its own credential, written down so a restart goes on, taken off the
// list by any answer and kept only while the request does not get through.
const entry = (sessionId: string, uid = 'u1'): EndingSession => ({ uid, sessionId, refreshToken: `refresh-${sessionId}`, authTime: 1700000000 })
function memory(initial: EndingSession[] = []) {
  const state = { list: [...initial], writes: 0 }
  return { state, store: { read: async () => [...state.list], write: async (list: EndingSession[]) => { state.list = [...list]; state.writes++ } } }
}
function api(answers: Record<string, (() => void) | undefined> = {}) {
  const ended: string[] = [], refreshed: string[] = []
  return { ended, refreshed, value: {
    refresh: async (refreshToken: string) => { refreshed.push(refreshToken); return { idToken: `id-${refreshToken}` } },
    signOutSession: async (_idToken: string, sessionId: string) => { answers[sessionId]?.(); ended.push(sessionId) }
  } }
}
const opened: SessionEnders[] = []
after(() => { for (const enders of opened) enders.close() })
const make = (...args: ConstructorParameters<typeof SessionEnders>) => { const value = new SessionEnders(...args); opened.push(value); return value }
const settle = () => new Promise(resolve => setTimeout(resolve, 30))

test('the wait before the list is tried again is 2 s doubling to 10 minutes', () => {
  assert.deepEqual([1, 2, 3, 9, 10, 20].map(endingRetryDelay), [2000, 4000, 8000, 512000, 600000, 600000])
})

test('an answer takes a session off the list; only a request that did not get through keeps it', () => {
  for (const code of ['revoked', 'invalid-credential', 'banned', 'protocol'] as const) assert.equal(endingOutcome(new AuthenticationFailure(code)), 'ended', code)
  for (const code of ['network', 'unavailable', 'rate-limited', 'app-proof'] as const) assert.equal(endingOutcome(new AuthenticationFailure(code)), 'later', code)
  assert.equal(endingOutcome(new TypeError('fetch failed')), 'later')
})

test('each session is ended with its own refreshed credential, then leaves the list', async () => {
  const m = memory(), a = api()
  const enders = make(m.store, a.value, async () => null)
  await enders.add(entry('old-session-1'))
  await enders.add(entry('old-session-2', 'u2'))
  enders.runNow(); await settle()
  assert.deepEqual(a.refreshed, ['refresh-old-session-1', 'refresh-old-session-2'])
  assert.deepEqual(a.ended, ['old-session-1', 'old-session-2'])
  assert.deepEqual(m.state.list, [])
})

test('not through: kept, and tried again — also by a new instance after a restart', async () => {
  const m = memory(), offline = () => { throw new AuthenticationFailure('network') }
  const first = make(m.store, api({ 'old-session-1': offline }).value, async () => null)
  await first.add(entry('old-session-1'))
  first.runNow(); await settle()
  assert.deepEqual(m.state.list.map(item => item.sessionId), ['old-session-1'])
  first.close()
  const a = api(), restarted = make(m.store, a.value, async () => null)
  restarted.runNow(); await settle()
  assert.deepEqual(a.ended, ['old-session-1'])
  assert.deepEqual(m.state.list, [])
})

test('a refused credential or an ended session leaves the list without anything else to do', async () => {
  const m = memory([entry('gone-1'), entry('gone-2')])
  const a = api({ 'gone-1': () => { throw new AuthenticationFailure('revoked') } })
  a.value.refresh = async (refreshToken: string) => {
    if (refreshToken === 'refresh-gone-2') throw new AuthenticationFailure('invalid-credential')
    return { idToken: 'x' }
  }
  make(m.store, a.value, async () => null).runNow(); await settle()
  assert.deepEqual(m.state.list, [])
})

test('the session a saved account of this device uses now is never ended from here', async () => {
  const m = memory([entry('live-session')]), a = api()
  make(m.store, a.value, async who => who === 'u1' ? 'live-session' : null).runNow(); await settle()
  assert.deepEqual(a.ended, [])
  assert.deepEqual(m.state.list, [], 'signed in again with it: nothing is left behind')
})

test('the same session written down twice is one entry, with the newer credential', async () => {
  const m = memory()
  const enders = make(m.store, null, async () => null)
  await enders.add(entry('old-session-1'))
  await enders.add({ ...entry('old-session-1'), refreshToken: 'newer' })
  assert.deepEqual(m.state.list.map(item => item.refreshToken), ['newer'])
  await enders.add({ ...entry('bad'), refreshToken: '' })
  assert.equal(m.state.list.length, 1, 'an entry with no credential is not written')
})

test('the stored list keeps well-formed entries only, once each, at most 64', () => {
  const good = { uid: 'u1', sessionId: '0123456789abcdef0123456789abcdef', refreshToken: 'r', authTime: 1 }
  assert.deepEqual(endingList([good, { ...good }, { ...good, sessionId: 'short' }, { ...good, uid: 'a/b' }, { ...good, sessionId: 'x'.repeat(20), authTime: 0 }, null, 'x']), [good])
  assert.deepEqual(endingList('not a list'), [])
  const many = Array.from({ length: 70 }, (_, index) => ({ ...good, sessionId: `session-${String(index).padStart(4, '0')}` }))
  assert.deepEqual(endingList(many).map(item => item.sessionId), many.slice(-64).map(item => item.sessionId))
})
