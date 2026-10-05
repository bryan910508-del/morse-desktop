import assert from 'node:assert/strict'
import { test } from 'node:test'
import { heldForPassword, passPassword, profileAfterPassword, type PasswordAction, type PasswordGate } from '../../src/main/auth/password-gate'
import { TwoStepFailure } from '../../src/main/api/two-step'
import type { PasswordStep } from '../../src/shared/auth'
import type { AuthTokens } from '../../src/main/auth/contracts'
import { setLanguage } from '../../src/shared/i18n'

// A13-2 ② (contract §6, server answer 10-04): the sign-in's password step — the proof, «Forgot?» and the 7-day reset.
const tokens = (name: string) => ({ idToken: name, refreshToken: `r-${name}`, uid: 'u1', authTime: 1, expiresAt: Date.now() + 3600000 }) as unknown as AuthTokens
type Reset = { state: 'none' | 'waiting' | 'done'; resetAt: number | null; sessionId: string | null }
function gate(actions: PasswordAction[], twoStep: Partial<PasswordGate['twoStep']>) {
  const log: string[] = [], shown: PasswordStep[] = []
  const value: PasswordGate = {
    twoStep: {
      state: async () => { log.push('state'); return { enabled: true, hint: 'from-state', resetAt: null } as never },
      signIn: async () => { throw new Error('unused') },
      requestReset: async () => { throw new Error('unused') },
      ...twoStep
    } as PasswordGate['twoStep'],
    exchange: async token => { log.push(`exchange:${token}`); return tokens('passed') },
    refresh: async () => { log.push('refresh'); return tokens('refreshed') },
    show: step => { shown.push(step) },
    action: async () => { const next = actions.shift(); if (!next) throw new Error('cancelled'); log.push(`action:${next.kind}`); return next },
    current: () => {}
  }
  return { value, log, shown }
}

test('A13-2 ②: a right password goes on with the token it answers; a QR attempt\'s secret goes with the proof', async () => {
  const sent: (string | undefined)[] = []
  const { value, log } = gate([{ kind: 'submit', password: 'secret-1' }], { signIn: async (_password, qrSecret) => { sent.push(qrSecret); return { customToken: 'ct', sessionId: 's-qr' } } })
  const passed = await passPassword(value, { hint: '', resetAt: null }, 'q'.repeat(43))
  assert.deepEqual(sent, ['q'.repeat(43)])
  assert.equal(passed.sessionId, 's-qr')
  assert.equal((passed.tokens as unknown as { idToken: string }).idToken, 'passed')
  assert.deepEqual(log, ['state', 'action:submit', 'exchange:ct'], 'QR reads the state first (no reset date in its answer)')
})

test('A13-2 ②: a wrong password stays on the step with its words; the hint and a waiting reset are shown', async () => {
  setLanguage('ko')
  let tries = 0
  const { value, shown } = gate([{ kind: 'submit', password: 'no' }, { kind: 'submit', password: 'yes' }],
    { signIn: async () => { if (tries++ === 0) throw new TwoStepFailure('password-wrong'); return { customToken: 'ct', sessionId: null } } })
  await passPassword(value, { hint: '고양이', resetAt: 1_800_000_000_000 })
  assert.equal(shown[0]!.hint, '고양이')
  assert.equal(shown[0]!.resetAt, 1_800_000_000_000)
  assert.ok(shown.some(step => step.error === '비밀번호가 틀렸어요.' && !step.busy))
})

test('A13-2 ②: «Forgot?» waits 7 days; once done the ID token is refreshed before the session, and QR goes on with the named session', async () => {
  const resets: Reset[] = [{ state: 'waiting', resetAt: 1_800_000_000_000, sessionId: null }, { state: 'done', resetAt: null, sessionId: 'held-qr-session' }]
  const secrets: (string | undefined)[] = []
  const { value, log, shown } = gate([{ kind: 'reset' }, { kind: 'reset' }], { requestReset: async qrSecret => { secrets.push(qrSecret); return resets.shift()! } })
  const passed = await passPassword(value, { hint: '', resetAt: null }, 's'.repeat(43))
  assert.deepEqual(secrets, ['s'.repeat(43), 's'.repeat(43)], 'a QR attempt\'s secret rides on every reset request')
  assert.ok(shown.some(step => step.resetAt === 1_800_000_000_000 && !step.busy), 'waiting: its date is shown')
  assert.deepEqual(log, ['state', 'action:reset', 'action:reset', 'refresh'], 'done → forced refresh, then the caller asks for the session')
  assert.equal(passed.sessionId, 'held-qr-session')
  assert.equal((passed.tokens as unknown as { idToken: string }).idToken, 'refreshed')
})

test('A13-2 ②: another way in sends no secret; a password found off goes on with a refreshed token and this session', async () => {
  const secrets: (string | undefined)[] = []
  const done = gate([{ kind: 'reset' }], { requestReset: async qrSecret => { secrets.push(qrSecret); return { state: 'done', resetAt: null, sessionId: null } } })
  const passed = await passPassword(done.value, { hint: '', resetAt: 1 })
  assert.deepEqual(secrets, [undefined])
  assert.deepEqual(done.log, ['action:reset', 'refresh'])
  assert.equal(passed.sessionId, null, 'the caller keeps its own session')
  const off = gate([{ kind: 'submit', password: 'x' }], { signIn: async () => { throw new TwoStepFailure('password-off') } })
  assert.equal((await passPassword(off.value, { hint: '', resetAt: null })).sessionId, null)
  assert.deepEqual(off.log, ['action:submit', 'refresh'])
})

test('A13-2 ②: a reset answered «none» — the password is already off — goes on like password-off, not left waiting', async () => {
  const secrets: (string | undefined)[] = []
  const none = gate([{ kind: 'reset' }], { requestReset: async qrSecret => { secrets.push(qrSecret); return { state: 'none', resetAt: null, sessionId: null } } })
  const passed = await passPassword(none.value, { hint: '', resetAt: null })
  assert.deepEqual(none.log, ['action:reset', 'refresh'], 'none → forced refresh, then the caller asks for the session')
  assert.equal(passed.sessionId, null, 'the caller keeps its own session')
  assert.equal((passed.tokens as unknown as { idToken: string }).idToken, 'refreshed')
  assert.ok(!none.shown.some(step => step.resetAt !== null), 'no waiting date was shown')
})

// Android found, the review confirmed against firestore.rules twoStepPassed: a held generation reads nothing, its own
// users document included — so a provider's sign-in passes the password step before it reads the Morse profile.
const claims = (value: object): string => ['h', Buffer.from(JSON.stringify(value)).toString('base64url'), 's'].join('.')
test('A13-2 ②: a token is held as the rules hold it — password on, generation after it, not passed', () => {
  assert.equal(heldForPassword(claims({ auth_time: 200, morsePwdSince: 100 })), true, 'a provider\'s new sign-in (no morseAuthTime)')
  assert.equal(heldForPassword(claims({ morseAuthTime: 300, auth_time: 50, morsePwdSince: 100 })), true)
  assert.equal(heldForPassword(claims({ morseAuthTime: 300, morsePwdSince: 100, morsePwdOk: true })), false, 'passed')
  assert.equal(heldForPassword(claims({ morseAuthTime: 100, morsePwdSince: 100 })), false, 'made before the password (<=)')
  assert.equal(heldForPassword(claims({ auth_time: 200 })), false, 'no password')
  assert.equal(heldForPassword('not-a-jwt'), false)
})

test('A13-2 ②: a held provider sign-in passes the password before the profile is read; the profile is read only with the passed token', async () => {
  const held = { ...tokens('held'), idToken: claims({ auth_time: 200, morsePwdSince: 100 }) }
  const order: string[] = []
  const result = await profileAfterPassword(held, async token => { order.push(`pass:${token === held}`); return tokens('passed') },
    async token => { order.push(`read:${(token as unknown as { idToken: string }).idToken}`); return 'profile' })
  assert.deepEqual(order, ['pass:true', 'read:passed'], 'no Firestore read with the held token')
  assert.equal(result.profile, 'profile')
  const free = { ...tokens('free'), idToken: claims({ auth_time: 200 }) }
  const direct: string[] = []
  await profileAfterPassword(free, async () => { direct.push('pass'); return free }, async () => { direct.push('read'); return null })
  assert.deepEqual(direct, ['read'], 'no password: straight to the profile')
})

test('A13-2 ②: a step found by the token reads its hint and waiting reset first', async () => {
  const { value, log, shown } = gate([{ kind: 'submit', password: 'p' }], { signIn: async () => ({ customToken: 'ct', sessionId: null }) })
  await passPassword(value, null)
  assert.deepEqual(log, ['state', 'action:submit', 'exchange:ct'])
  assert.ok(shown.some(step => step.hint === 'from-state'))
})
