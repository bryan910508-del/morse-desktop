import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { closeMessagePoll, setMessagePollVote } from '../../src/main/network/attachment-api'
import { MessageMutationFailure, NotEmitted } from '../../src/main/network/contracts'
import type { ReadCredentials } from '../../src/main/network/firestore-rpc'

// 투표 callable 클라이언트. 서버는 MorseIOS firebase/functions/morse-release-authority.js 다.
const uid = 'me', chat = 'g1', message = 'm1'
const auth = (): ReadCredentials => ({
  signal: new AbortController().signal,
  authorize: async () => ({ idToken: 'id', appCheckToken: 'check' }) as never,
})
const live = new AbortController().signal
let sent: { url: string; body: Record<string, unknown> }[] = []
const original = globalThis.fetch

function answer(payload: unknown, ok = true, status = 200): void {
  globalThis.fetch = (async (url: string, init: { body: string }) => {
    sent.push({ url: String(url), body: JSON.parse(init.body).data })
    return new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json' } }) as never
  }) as never
}
afterEach(() => { globalThis.fetch = original; sent = [] })

test('a vote carries the tally the server answered with', async () => {
  // setMorseMessagePollVote·closeMorseMessagePoll 은 2026-09-24 14:02 KST 에 배포됐다 (Firebase 2136a973).
  answer({ result: { ok: true, chatId: chat, messageId: message, actorUid: uid, optionIndexes: [1],
    pollVoteCounts: [0, 3], pollTotalVoters: 3 } })
  const result = await setMessagePollVote(auth(), uid, chat, message, [1], 'rev1', live)
  assert.deepEqual(result, { optionIndexes: [1], voteCounts: [0, 3], totalVoters: 3, alreadyApplied: false })
  assert.deepEqual(sent[0]!.body, { chatId: chat, messageId: message, optionIndexes: [1], clientRevision: 'rev1', expectedUid: uid })
})

test('an answer for another message or another account is refused', async () => {
  answer({ result: { ok: true, chatId: 'other', messageId: message, actorUid: uid, pollVoteCounts: [1], pollTotalVoters: 1 } })
  await assert.rejects(() => setMessagePollVote(auth(), uid, chat, message, [0], 'rev', live), MessageMutationFailure)
  answer({ result: { ok: true, chatId: chat, messageId: message, actorUid: 'someone', pollVoteCounts: [1], pollTotalVoters: 1 } })
  await assert.rejects(() => setMessagePollVote(auth(), uid, chat, message, [0], 'rev', live), MessageMutationFailure)
})

test('the same revision twice is reported as already applied', async () => {
  answer({ result: { ok: true, chatId: chat, messageId: message, actorUid: uid, optionIndexes: [0],
    pollVoteCounts: [2], pollTotalVoters: 2, alreadyApplied: true } })
  assert.equal((await setMessagePollVote(auth(), uid, chat, message, [0], 'rev1', live)).alreadyApplied, true)
})

test('a refusal the server will repeat is told as such; anything else stays uncertain', async () => {
  answer({ error: { status: 'PERMISSION_DENIED' } }, false, 403)
  await assert.rejects(() => closeMessagePoll(auth(), uid, chat, message, live),
    (error: unknown) => error instanceof MessageMutationFailure && error.definitive === true)
  answer({ error: { status: 'UNAVAILABLE' } }, false, 503)
  await assert.rejects(() => closeMessagePoll(auth(), uid, chat, message, live),
    (error: unknown) => error instanceof MessageMutationFailure && error.definitive !== true)
})

test('an account that cannot be authorized never reaches the network', async () => {
  let called = false
  globalThis.fetch = (async () => { called = true; return new Response('{}') as never }) as never
  const broken: ReadCredentials = { signal: new AbortController().signal, authorize: async () => { throw new Error('no token') } }
  await assert.rejects(() => closeMessagePoll(broken, uid, chat, message, live), NotEmitted)
  assert.equal(called, false)
})
