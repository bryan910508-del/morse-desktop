import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createHash, randomBytes } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { fromBytes, modPow, newPasswordSettings, srpGenerator, srpPrime, toBytes } from '../../src/main/auth/srp'
import { TwoStepApi } from '../../src/main/api/two-step'
import { deleteOwnAccount, type PasswordAnswer } from '../../src/main/api/account-deletion'
import { MorseCallableFailure } from '../../src/main/network/morse-callable'
import { setLanguage } from '../../src/shared/i18n'

// B525 (contract B525-in-app-delete-2fa §3, §9): the account's own deletion says it can send the two-step password
// (twoStepCapable), carries the password's answer from a fresh check when the account has one, makes a run-out check again
// once, and gives the screen each refusal with its own words instead of one line for every failure.
const answer: PasswordAnswer = { srpId: 'ab'.repeat(16), A: 'cd'.repeat(256), M1: 'ef'.repeat(32) }
const refused = (reason: string, retryAfterSec = 0) => new MorseCallableFailure('answered', 'FAILED_PRECONDITION', reason, '', retryAfterSec)

test('every request says it can send the password; an account without one sends none', async () => {
  const sent: Record<string, unknown>[] = []
  const outcome = await deleteOwnAccount('u1', null, async () => { throw new Error('not asked') }, async data => { sent.push(data); return { ok: true, deletedUid: 'u1' } })
  assert.deepEqual(outcome, { ok: true })
  assert.deepEqual(sent, [{ expectedUid: 'u1', twoStepCapable: true }])
})

test('an account with a password sends its answer, from a check made for this request', async () => {
  const sent: Record<string, unknown>[] = [], proved: string[] = []
  const outcome = await deleteOwnAccount('u1', 'secret-1', async password => { proved.push(password); return answer }, async data => { sent.push(data); return { ok: true, deletedUid: 'u1' } })
  assert.deepEqual(outcome, { ok: true })
  assert.deepEqual(proved, ['secret-1'])
  assert.deepEqual(sent, [{ expectedUid: 'u1', twoStepCapable: true, password: answer }])
})

test('a check that ran out is made again once, never more', async () => {
  setLanguage('ko')
  let proved = 0, sends = 0
  const once = await deleteOwnAccount('u1', 'secret-1', async () => { proved++; return answer }, async () => { if (++sends === 1) throw refused('check-expired'); return { ok: true, deletedUid: 'u1' } })
  assert.deepEqual(once, { ok: true }); assert.equal(proved, 2); assert.equal(sends, 2)
  proved = 0; sends = 0
  const twice = await deleteOwnAccount('u1', 'secret-1', async () => { proved++; return answer }, async () => { sends++; throw refused('check-expired') })
  assert.deepEqual(twice, { ok: false, reason: 'check-expired', message: '시간이 지났어요. 다시 시도해 주세요.' })
  assert.equal(sends, 2)
})

test('each password refusal comes back with the two-step box\'s own words; the screen goes back to the password', async () => {
  setLanguage('ko')
  const refusal = async (error: unknown) => deleteOwnAccount('u1', 'secret-1', async () => answer, async () => { throw error })
  assert.deepEqual(await refusal(refused('password-needed')), { ok: false, reason: 'password-needed', message: '계정을 삭제하려면 2단계 인증 비밀번호를 입력해 주세요.' })
  assert.deepEqual(await refusal(refused('password-wrong')), { ok: false, reason: 'password-wrong', message: '비밀번호가 틀렸어요.' })
  assert.equal((await refusal(refused('password-wrong', 300))).ok, false)
  assert.match((await refusal(refused('password-wrong', 300)) as { message: string }).message, /^비밀번호가 틀렸어요\. 5분 뒤/)
  assert.match((await refusal(refused('password-flood', 3600)) as { message: string }).message, /^시도가 너무 많아요\. 1시간 뒤/)
  assert.equal((await refusal(refused('rate-limited', 60)) as { reason: string }).reason, 'rate-limited')
})

test('a failure that is not about the password is told as what it is, not as one line for all', async () => {
  setLanguage('ko')
  const failing = (error: unknown) => deleteOwnAccount('u1', null, async () => answer, async () => { throw error })
  await assert.rejects(failing(new MorseCallableFailure('not-sent', 'UNAVAILABLE')), /연결을 확인한 뒤 다시 시도해 주세요/)
  await assert.rejects(failing(new MorseCallableFailure('unknown', 'DEADLINE_EXCEEDED')), /계정 삭제 결과를 확인하지 못했습니다/)
  await assert.rejects(failing(refused('expected-uid')), /^Error: 계정을 삭제하지 못했습니다\.$/)
  await assert.rejects(deleteOwnAccount('u1', null, async () => answer, async () => ({ ok: true, deletedUid: 'u2' })), /계정 삭제 결과를 확인하지 못했습니다/)
})

test('the answer comes from a fresh check; a password turned off meanwhile sends none', async () => {
  const sha256 = (...parts: Buffer[]) => createHash('sha256').update(Buffer.concat(parts)).digest()
  const made = await newPasswordSettings('secret-1', randomBytes(32), randomBytes(32))
  const k = fromBytes(sha256(toBytes(srpPrime), toBytes(srpGenerator)))
  const B = (k * made.v + modPow(srpGenerator, 13579246801357924680n ** 20n % srpPrime, srpPrime)) % srpPrime
  const issued = { salt1: 'aa'.repeat(32), salt2: 'bb'.repeat(32) }
  let on = true, checks = 0
  const api = new TwoStepApi(async name => {
    assert.equal(name, 'getMorsePasswordCheck'); checks++
    return on ? { enabled: true, algo: { salt1: made.salt1.toString('hex'), salt2: made.salt2.toString('hex') }, srpB: toBytes(B).toString('hex'), srpId: 'cd'.repeat(16), newAlgo: issued } : { enabled: false, newAlgo: issued }
  })
  const given = await api.deletionAnswer('secret-1')
  assert.equal(given?.srpId, 'cd'.repeat(16)); assert.equal(given?.A.length, 512); assert.equal(given?.M1.length, 64); assert.equal(checks, 1)
  on = false
  assert.equal(await api.deletionAnswer('secret-1'), null)
})

test('the screen checks the password first, then asks for the last confirmation, then deletes; no «Forgot?» there', () => {
  const box = readFileSync('src/renderer/src/settings/security-boxes.tsx', 'utf8')
  const flow = box.slice(box.indexOf('function DeletionPasswordBox'), box.indexOf('export async function deleteAccount') + 2400)
  assert.match(flow, /updateTwoStep\(accountUid, \{ action: 'verify', current: password \}\)/)
  assert.ok(flow.indexOf('askDeletionPassword(accountUid, hint, note)', flow.indexOf('export async function deleteAccount')) < flow.indexOf("tr('이 계정을 영구 삭제할까요?')"), 'the password before the last confirmation')
  assert.ok(flow.indexOf("tr('이 계정을 영구 삭제할까요?')") < flow.indexOf('window.morse.deleteAccount(accountUid, password)'))
  assert.doesNotMatch(flow, /비밀번호를 잊으셨나요/)
  const main = readFileSync('src/main/index.ts', 'utf8')
  assert.match(main, /const outcome = await session\.accountTools\.deleteAccount\(password, answer => session\.twoStep\.deletionAnswer\(answer\)\)\n\s*if \(outcome\.ok\) await authentication\.forgetDeleted/)
  for (const language of ['en', 'ru']) {
    const words = JSON.parse(readFileSync(`src/shared/i18n/${language}.json`, 'utf8')) as Record<string, string>
    assert.ok(words['계정을 삭제하려면 2단계 인증 비밀번호를 입력해 주세요.'], language)
  }
})
