import assert from 'node:assert/strict'
import { test } from 'node:test'
import { sendAgain, unsentReason } from '../../src/main/network/resend'

// MTProto resends what its connection never carried (SessionPrivate::resend) and never hands that
// failure to the feature; anything the server may already have seen is not repeated.
const connectFailure = (code: string): TypeError => Object.assign(new TypeError('fetch failed'), { cause: Object.assign(new Error('Connect Timeout Error'), { code }) })
const answer = { ok: true } as unknown as Response

test('a request that never left is sent again, and the caller never sees the failure', async () => {
  let tries = 0
  const notes: string[] = []
  const response = await sendAgain(AbortSignal.timeout(20000), async () => {
    if (++tries < 3) throw connectFailure('UND_ERR_CONNECT_TIMEOUT')
    return answer
  }, (code, attempt) => notes.push(`${code} ${attempt}`))
  assert.equal(response, answer)
  assert.equal(tries, 3)
  assert.deepEqual(notes, ['UND_ERR_CONNECT_TIMEOUT 1', 'UND_ERR_CONNECT_TIMEOUT 2'])
})

test('a failure the server may have seen is not repeated', async () => {
  let tries = 0
  const server = Object.assign(new TypeError('fetch failed'), { cause: Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' }) })
  await assert.rejects(sendAgain(AbortSignal.timeout(20000), async () => { tries++; throw server }), (error: unknown) => error === server)
  assert.equal(tries, 1, 'a reset mid-request is not sent again')

  let refused = 0
  await assert.rejects(sendAgain(AbortSignal.timeout(20000), async () => { refused++; throw new Error('업로드 권한을 확인하지 못했습니다.') }))
  assert.equal(refused, 1, 'a refusal is the answer, not a lost connection')
})

test('it gives up after four tries, with the last failure', async () => {
  let tries = 0
  await assert.rejects(sendAgain(AbortSignal.timeout(30000), async () => { tries++; throw connectFailure('ENETUNREACH') }),
    (error: unknown) => error instanceof TypeError)
  assert.equal(tries, 4)
})

test('an aborted operation stops the resends', async () => {
  const control = new AbortController()
  let tries = 0
  const task = sendAgain(control.signal, async () => { tries++; control.abort(); throw connectFailure('ECONNREFUSED') })
  await assert.rejects(task)
  assert.equal(tries, 1)
})

test('only the codes that prove the request never left are resent', () => {
  assert.equal(unsentReason(connectFailure('UND_ERR_CONNECT_TIMEOUT')), 'UND_ERR_CONNECT_TIMEOUT')
  assert.equal(unsentReason(connectFailure('ENOTFOUND')), 'ENOTFOUND')
  assert.equal(unsentReason(connectFailure('UND_ERR_HEADERS_TIMEOUT')), '', 'a header timeout means the server had it')
  assert.equal(unsentReason(new Error('plain')), '')
})
