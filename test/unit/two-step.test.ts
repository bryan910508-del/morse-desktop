import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createHash, randomBytes } from 'node:crypto'
import golden from './a13-srp-golden.json'
import { fromBytes, goodModExp, modPow, newPasswordSettings, srpGenerator, srpPrime, srpProof, srpProofWith, toBytes } from '../../src/main/auth/srp'
import { TwoStepApi, TwoStepFailure } from '../../src/main/api/two-step'
import { TwoStepSettingsApi, decodeTwoStepSettings } from '../../src/main/api/two-step-settings'
import { MorseCallableFailure } from '../../src/main/network/morse-callable'
import { setLanguage } from '../../src/shared/i18n'
import { hintProblem, newPasswordProblem, twoStepReasonText } from '../../src/shared/two-step'

// A13-2 ① (contracts A13 §5, A13-2): Desktop proves the two-step password as tdesktop does (core_cloud_password.cpp:59-157)
// and as the server checks it (morse-srp.js) — the shared values (handoff/a13-srp-golden.json, = the server's
// testdata/morse-srp-golden.json; one is gotd/td's) and the salt sizes the server issues (64/32 bytes, not the vectors' 40/16).

const big = (hex: string) => BigInt(`0x${hex}`)
const buf = (hex: string) => Buffer.from(hex, 'hex')
type Case = { id: string; password: string; salt1: string; salt2: string; x: string; v?: string; B: string; a: string; A: string; M1: string }

test('A13-2: every shared SRP case gives the same x, verifier, A and M1', async () => {
  assert.equal(big(golden.p), srpPrime)
  assert.equal(BigInt(golden.g), srpGenerator)
  for (const item of golden.cases as Case[]) {
    const proof = await srpProofWith(item.password, buf(item.salt1), buf(item.salt2), big(item.B), big(item.a))
    assert.equal(proof.x, big(item.x), `${item.id}: x`)
    if (item.v) assert.equal(modPow(srpGenerator, proof.x, srpPrime), big(item.v), `${item.id}: v`)
    assert.equal(proof.A, big(item.A), `${item.id}: A`)
    assert.equal(proof.M1.toString('hex'), item.M1.toLowerCase(), `${item.id}: M1`)
  }
})

// The server's side (morse-srp.js serverB / serverCheck), to see a proof made with the production salt sizes pass.
const sha256 = (...parts: Buffer[]) => createHash('sha256').update(Buffer.concat(parts)).digest()
function serverPasses(v: bigint, b: bigint, B: bigint, A: bigint, M1: Buffer, salt1: Buffer, salt2: Buffer): boolean {
  const u = fromBytes(sha256(toBytes(A), toBytes(B)))
  const S = modPow((A * modPow(v, u, srpPrime)) % srpPrime, b, srpPrime), K = sha256(toBytes(S))
  const hp = sha256(toBytes(srpPrime)), hg = sha256(toBytes(srpGenerator)), xor = Buffer.alloc(32)
  for (let i = 0; i < 32; i++) xor[i] = hp[i]! ^ hg[i]!
  return sha256(xor, sha256(salt1), sha256(salt2), toBytes(A), toBytes(B), K).equals(M1)
}

test('A13-2: a password set with the salts the server issues (64/32 bytes) is proved, and a wrong one is not', async () => {
  const issued1 = randomBytes(32), issued2 = randomBytes(32)
  const made = await newPasswordSettings('비밀번호-ok-6', issued1, issued2)
  assert.equal(made.salt1.length, 64)
  assert.ok(made.salt1.subarray(0, 32).equals(issued1), 'the issued salt leads (Telegram new_salt1)')
  assert.ok(made.salt2.equals(issued2))
  const k = fromBytes(sha256(toBytes(srpPrime), toBytes(srpGenerator)))
  const b = fromBytes(randomBytes(256)) % srpPrime, B = (k * made.v + modPow(srpGenerator, b, srpPrime)) % srpPrime
  const right = await srpProof('비밀번호-ok-6', made.salt1, made.salt2, B)
  assert.equal(serverPasses(made.v, b, B, right.A, right.M1, made.salt1, made.salt2), true)
  const wrong = await srpProof('비밀번호-no-6', made.salt1, made.salt2, B)
  assert.equal(serverPasses(made.v, b, B, wrong.A, wrong.M1, made.salt1, made.salt2), false)
})

test('A13-2: a B that is not a good value is refused before anything is sent (tdesktop IsGoodModExpFirst)', async () => {
  assert.equal(goodModExp(3n), false)
  assert.equal(goodModExp(srpPrime - 1n), false)
  assert.equal(goodModExp(srpPrime), false)
  await assert.rejects(srpProof('password', randomBytes(64), randomBytes(32), 2n), /bad B/)
})

test('A13-2: the API reads the state, proves with a fresh check, and sets a password from the issued salts', async () => {
  const calls: { name: string; data: Record<string, unknown> }[] = []
  const issued = { salt1: randomBytes(32).toString('hex'), salt2: randomBytes(32).toString('hex') }
  let on = false
  const made = await newPasswordSettings('secret-1', randomBytes(32), randomBytes(32))
  const k = fromBytes(sha256(toBytes(srpPrime), toBytes(srpGenerator)))
  const B = (k * made.v + modPow(srpGenerator, 12345678901234567890n ** 20n % srpPrime, srpPrime)) % srpPrime
  const api = new TwoStepApi(async (name, data) => {
    calls.push({ name, data })
    if (name === 'getMorsePasswordCheck') return on
      ? { enabled: true, algo: { name: 'x', salt1: made.salt1.toString('hex'), salt2: made.salt2.toString('hex') }, srpB: toBytes(B).toString('hex'), srpId: 'ab'.repeat(16), hint: 'cat', resetAt: 1_800_000_000_000, newAlgo: issued }
      : { enabled: false, newAlgo: issued }
    if (name === 'checkMorsePassword') return { customToken: 'token', sessionId: 's1' }
    return { ok: true }
  })
  assert.deepEqual((await api.state()).enabled, false)
  await api.enable('secret-1', ' a hint ', 'session-1')
  const enable = calls.find(call => call.name === 'updateMorsePassword')!.data as { action: string; hint: string; next: { salt1: string; salt2: string; v: string } }
  assert.equal(enable.action, 'enable')
  assert.equal(enable.hint, 'a hint')
  assert.ok(enable.next.salt1.startsWith(issued.salt1) && enable.next.salt1.length === 128)
  assert.equal(enable.next.salt2, issued.salt2)
  assert.equal(enable.next.v.length, 512)
  on = true
  const state = await api.state()
  assert.ok(state.enabled && state.hint === 'cat' && state.resetAt === 1_800_000_000_000)
  assert.deepEqual(await api.signIn('secret-1', 'q'.repeat(43)), { customToken: 'token', sessionId: 's1' })
  const check = calls.filter(call => call.name === 'checkMorsePassword').at(-1)!.data as Record<string, string>
  assert.equal(check.srpId, 'ab'.repeat(16))
  assert.equal(check.A.length, 512)
  assert.equal(check.M1.length, 64)
  assert.equal(check.qrSecret, 'q'.repeat(43))
})

test('A13-2: a refusal is worded by its reason, with the lock\'s time; no answer is uncertain', async () => {
  setLanguage('ko')
  const refused = new TwoStepApi(async () => { throw new MorseCallableFailure('answered', 'PERMISSION_DENIED', 'password-wrong', '', 300) })
  await assert.rejects(refused.requestReset(), (error: unknown) => error instanceof TwoStepFailure && error.reason === 'password-wrong' && error.message === '비밀번호가 틀렸어요. 5분 뒤 다시 해 주세요.' && !error.uncertain)
  const lost = new TwoStepApi(async () => { throw new MorseCallableFailure('unknown', 'UNKNOWN') })
  await assert.rejects(lost.cancelReset(), (error: unknown) => error instanceof TwoStepFailure && error.uncertain)
  setLanguage('ru')
  assert.equal(twoStepReasonText('password-flood', 60), 'Слишком много попыток. Повторите через 1 минуту.')
  assert.equal(twoStepReasonText('fresh-session'), 'Это можно изменить через 24 часа после входа на этом устройстве.')
  setLanguage('en')
  assert.equal(twoStepReasonText('password-wrong', 3600), 'Invalid password. Try again in 1 hour.')
  setLanguage('ko')
})

test('A13-2 / A13-4: a new password is at least 6 characters and confirmed; a hint is short and not the password', () => {
  setLanguage('ko')
  assert.equal(newPasswordProblem('', ''), '비밀번호를 입력해 주세요.')
  assert.equal(newPasswordProblem('1234', '1234'), '비밀번호는 6자 이상이어야 해요.', 'a 4-digit PIN is below the line')
  assert.equal(newPasswordProblem('비밀번호한글', '비밀번호한글'), null, '6 characters, not 6 bytes')
  assert.equal(newPasswordProblem('abcdef', 'abcdeg'), '비밀번호가 서로 달라요. 다시 입력해 주세요.')
  assert.equal(hintProblem('abcdef', 'abcdef'), '힌트는 비밀번호와 달라야 해요.')
  assert.equal(hintProblem('x'.repeat(65), 'abcdef'), '힌트는 64자까지 쓸 수 있어요.')
  assert.equal(hintProblem('', 'abcdef'), null, 'no hint is fine')
})

test('A13-2 ②: a reset request carries a QR attempt\'s secret, and «done» names the session kept back for it', async () => {
  const sent: Record<string, unknown>[] = []
  const api = new TwoStepApi(async (_name, data) => { sent.push(data); return { state: 'done', sessionId: 'held-qr-session' } })
  assert.deepEqual(await api.requestReset('q'.repeat(43)), { state: 'done', resetAt: null, sessionId: 'held-qr-session' })
  assert.deepEqual(await api.requestReset(), { state: 'done', resetAt: null, sessionId: 'held-qr-session' })
  assert.deepEqual(sent, [{ qrSecret: 'q'.repeat(43) }, {}])
})

// A13-2 ③: the settings screen's state and requests (api/two-step-settings).
test('A13-2 ③: the state document and the switch read as the screen shows them', () => {
  const doc = (fields: Record<string, unknown>) => ({ name: 'x', fields }) as never
  assert.deepEqual(decodeTwoStepSettings(null, null), { available: false, enabled: false, hint: '', resetAt: null }, 'no document: off, and not offered')
  assert.deepEqual(decodeTwoStepSettings(doc({ enabled: { booleanValue: true }, hint: { stringValue: '고양이' }, resetAt: { timestampValue: { seconds: '1800000000', nanos: 5000000 } } }), doc({ enabled: { booleanValue: false } })),
    { available: false, enabled: true, hint: '고양이', resetAt: 1_800_000_000_005 }, 'an account that has one sees it while the switch is off')
  assert.deepEqual(decodeTwoStepSettings(doc({ enabled: { booleanValue: false }, hint: { stringValue: 'left over' } }), doc({ enabled: { booleanValue: true } })),
    { available: true, enabled: false, hint: '', resetAt: null })
})

test('A13-2 ③: a refusal comes back with its reason; the rules hold before anything is sent', async () => {
  setLanguage('ko')
  const calls: string[] = []
  const auth = { storageScope: 'session-1:uid' } as never
  const settings = new TwoStepSettingsApi('uid', auth, () => {}, async name => {
    calls.push(name)
    if (name === 'getMorsePasswordCheck') return { enabled: false, newAlgo: { salt1: 'aa'.repeat(32), salt2: 'bb'.repeat(32) } }
    throw new MorseCallableFailure('answered', 'FAILED_PRECONDITION', 'two-step-disabled')
  })
  assert.deepEqual(await settings.update({ action: 'enable', password: 'secret-1', hint: '' }),
    { ok: false, reason: 'two-step-disabled', message: '지금은 2단계 인증을 켤 수 없어요.' })
  assert.deepEqual(calls, ['getMorsePasswordCheck', 'updateMorsePassword'])
  calls.length = 0
  await assert.rejects(settings.update({ action: 'enable', password: '1234', hint: '' }), /6자 이상/)
  await assert.rejects(settings.update({ action: 'enable', password: 'secret-1', hint: 'secret-1' }), /힌트는 비밀번호와 달라야/)
  assert.deepEqual(calls, [], 'nothing is sent for a password the rules refuse')
  assert.equal((await settings.update({ action: 'nothing' })).ok, false)
})

test('A13-2 ③: Manage opens on a password checked by verifyMorsePassword; a wrong one is told with the lock\'s time', async () => {
  setLanguage('ko')
  const made = await newPasswordSettings('secret-1', randomBytes(32), randomBytes(32))
  const k = fromBytes(sha256(toBytes(srpPrime), toBytes(srpGenerator)))
  const B = (k * made.v + modPow(srpGenerator, 98765432109876543210n ** 20n % srpPrime, srpPrime)) % srpPrime
  const check = { enabled: true, algo: { salt1: made.salt1.toString('hex'), salt2: made.salt2.toString('hex') }, srpB: toBytes(B).toString('hex'), srpId: 'cd'.repeat(16), newAlgo: { salt1: 'aa'.repeat(32), salt2: 'bb'.repeat(32) } }
  const sent: { name: string; data: Record<string, unknown> }[] = []
  let right = true
  const call = async (name: string, data: Record<string, unknown>): Promise<Record<string, unknown>> => {
    sent.push({ name, data })
    if (name === 'getMorsePasswordCheck') return check
    if (right) return { ok: true }
    throw new MorseCallableFailure('answered', 'PERMISSION_DENIED', 'password-wrong', '', 300)
  }
  await new TwoStepApi(call).verify('secret-1')
  const proof = sent.find(item => item.name === 'verifyMorsePassword')!.data as Record<string, string>
  assert.deepEqual(Object.keys(proof).sort(), ['A', 'M1', 'srpId'], 'the SRP answer only — nothing else goes')
  assert.equal(proof.srpId, 'cd'.repeat(16))
  assert.equal(proof.A.length, 512)
  right = false
  const settings = new TwoStepSettingsApi('uid', { storageScope: 'session-1:uid' } as never, () => {}, call)
  assert.deepEqual(await settings.update({ action: 'verify', current: 'secret-2' }),
    { ok: false, reason: 'password-wrong', message: '비밀번호가 틀렸어요. 5분 뒤 다시 해 주세요.' })
  await assert.rejects(new TwoStepApi(async name => name === 'getMorsePasswordCheck' ? check : {}).verify('secret-1'),
    (error: unknown) => error instanceof TwoStepFailure && error.uncertain, 'an answer without ok:true is not a pass')
})

test('A13-2 ②: a reset answer is read strictly — «none», «waiting», «done», or not an answer at all', async () => {
  const answering = (state: unknown) => new TwoStepApi(async () => ({ state, resetAt: 1_800_000_000_000 }))
  assert.equal((await answering('none').requestReset()).state, 'none')
  assert.equal((await answering('waiting').requestReset()).state, 'waiting')
  await assert.rejects(answering('pending').requestReset(), (error: unknown) => error instanceof TwoStepFailure && error.uncertain)
  await assert.rejects(answering(undefined).requestReset(), (error: unknown) => error instanceof TwoStepFailure && error.uncertain)
})
