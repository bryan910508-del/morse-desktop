import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { lookupContact, lookupRetryWait, type LookupWays } from '../../src/main/network/contact-lookup'
import { MorseCallableFailure } from '../../src/main/network/morse-callable'
import type { ReadCredentials } from '../../src/main/network/firestore-rpc'

// A5 (reports/desktop/2026-11-06-a5-lookup-plan.md, review 11-06 12:00): the ID look-up reads only, so a failure that
// may pass is asked again within 35 s (1 s, 2 s) before the «could not finish» words; a definite answer ends it.
const auth = {} as ReadCredentials
const found = { found: true, uid: 'Ab3dEf6hIj9kLm2nOp5qRs8tUv1w', userId: 'abcdefgh', displayName: 'Morse Test', photoURL: '' }
const cut = () => new MorseCallableFailure('unknown', 'UNKNOWN', '', 'ECONNRESET')
const answered = (status: string, retryAfterSec = 0) => new MorseCallableFailure(status === 'INTERNAL' ? 'unknown' : 'answered', status, '', '', retryAfterSec)
function ways(answers: (Error | Record<string, unknown>)[]) {
  const calls: { timeout?: number; refresh?: boolean }[] = [], waits: number[] = [], logs: string[] = []
  let clock = 0
  const how: LookupWays = {
    call: async (_auth, name, _data, _signal, options) => { assert.equal(name, 'lookupUserByTalkyId'); calls.push({ timeout: options?.timeout, refresh: options?.refreshUnauthenticated }); clock += 100
      const next = answers.shift()!; if (next instanceof Error) throw next; return next },
    pause: async ms => { waits.push(ms); clock += ms },
    record: (step, detail) => { logs.push(`${step} ${detail}`) },
    now: () => clock
  }
  return { how, calls, waits, logs }
}
const run = (how: LookupWays, signal = new AbortController().signal) => lookupContact(auth, 'abcdefgh', signal, false, how).then(value => value?.displayName ?? null, (error: Error) => `error: ${error.message}`)

test('A5: a connection cut once, then an answer — the profile, no words; two log lines, codes only', async () => {
  const w = ways([cut(), found])
  assert.equal(await run(w.how), 'Morse Test')
  assert.deepEqual(w.waits, [1000])
  assert.deepEqual(w.logs, ['lookup-failed unknown:UNKNOWN:ECONNRESET', 'lookup-retried answered #2'])
  assert.ok(w.calls.every(call => call.refresh === true), 'a stale proof is renewed (401)')
  assert.ok(w.calls[1]!.timeout! < 35000, 'the second try has only what is left of the 35 s')
})
test('A5: server INTERNAL twice, then an answer — asked three times in all', async () => {
  const w = ways([answered('INTERNAL'), answered('INTERNAL'), found])
  assert.equal(await run(w.how), 'Morse Test')
  assert.deepEqual(w.waits, [1000, 2000])
})
test('A5: three failures — the same words as before, and the last line says how it ended', async () => {
  const w = ways([cut(), cut(), cut()])
  assert.match(await run(w.how), /^error: ID 검색을 완료하지 못했습니다/)
  assert.equal(w.calls.length, 3)
  assert.deepEqual(w.logs, ['lookup-failed unknown:UNKNOWN:ECONNRESET', 'lookup-retried failed #3 unknown:UNKNOWN:ECONNRESET'])
})
test('A5 (review 3): a definite refusal (NOT_FOUND, INVALID_ARGUMENT, PERMISSION_DENIED) ends at once — one try, one line', async () => {
  for (const status of ['NOT_FOUND', 'INVALID_ARGUMENT', 'PERMISSION_DENIED', 'FAILED_PRECONDITION']) {
    const w = ways([answered(status), found])
    assert.match(await run(w.how), /^error:/, status)
    assert.deepEqual([w.calls.length, w.waits.length, w.logs.length], [1, 0, 1], status)
  }
})
test('A5 (review 1): RESOURCE_EXHAUSTED without a wait is not asked again; with one, once, after that wait if it fits', async () => {
  let w = ways([answered('RESOURCE_EXHAUSTED'), found])
  assert.match(await run(w.how), /^error:/); assert.equal(w.calls.length, 1)
  w = ways([answered('RESOURCE_EXHAUSTED', 3), answered('RESOURCE_EXHAUSTED', 3), found])
  assert.match(await run(w.how), /^error:/); assert.deepEqual([w.calls.length, w.waits], [2, [3000]], 'once only')
  w = ways([answered('RESOURCE_EXHAUSTED', 60), found])
  assert.match(await run(w.how), /^error:/); assert.deepEqual([w.calls.length, w.waits], [1, []], 'a wait past the 35 s is not waited')
  assert.equal(lookupRetryWait(answered('RESOURCE_EXHAUSTED', 3), 0, 35000, false), 3000)
})
test('A5: the owner going away stops it — no further try', async () => {
  const owner = new AbortController()
  const w = ways([cut(), found])
  w.how.pause = async () => { owner.abort(); throw new Error('aborted') }
  assert.match(await lookupContact(auth, 'abcdefgh', owner.signal, false, w.how).then(() => 'ok', (error: Error) => `error: ${error.message}`), /^error:/)
  assert.equal(w.calls.length, 1)
})
test('A5: only the look-up — the shared callable layer and its writes are unchanged', () => {
  const callable = readFileSync('src/main/network/morse-callable.ts', 'utf8')
  assert.match(callable, /const resendDelays: readonly number\[\] = \[1000, 2000, 4000\]/)
  assert.match(callable, /if \(!unsentReason\(error\)\) throw new MorseCallableFailure\('unknown', 'UNKNOWN', '', causeCode\(error\)\)/)
})
