import assert from 'node:assert/strict'
import { test } from 'node:test'
import { setMessageReaction } from '../../src/main/network/message-reaction-api'
import { MessageMutationFailure } from '../../src/main/network/contracts'
import { ReactionUpdates } from '../../src/main/accounts/reaction-updates'
import type { FirestoreDocument } from '../../src/main/network/firestore-values'

// docs/reaction-socket-contract-2026-09-22.md: setReaction on the socket first, the callable when the socket cannot
// answer or refuses for a reason another route may not share; reactionUpdated's state until the document catches up.
const action = { id: 'rev1', chatId: 'c1', messageId: 'm1', reactions: ['❤️'] }
const answer = { ok: true, chatId: 'c1', roomId: 'c1', messageId: 'm1', actorUid: 'me1', clientRevision: 'rev1', reactionVersion: 3, reactions: { '❤️': ['me1'] } }
function credentials(react: ((payload: Record<string, unknown>) => Promise<unknown>) | null) {
  return { signal: new AbortController().signal, authorize: async () => ({ idToken: 't', appCheckToken: 'a', expiresAt: Date.now() + 3600000 }),
    sender: { ready: true, reactions: react !== null, react: react ?? undefined } } as never
}
async function withFetch(run: (calls: unknown[]) => Promise<void>): Promise<void> {
  const original = globalThis.fetch, calls: unknown[] = []
  globalThis.fetch = (async (_url: unknown, init: { body: string }) => { calls.push(JSON.parse(init.body).data); return new Response(JSON.stringify({ result: answer })) }) as typeof fetch
  try { await run(calls) } finally { globalThis.fetch = original }
}

test('a reaction goes on the socket when the server offers it, and the callable is not called', async () => withFetch(async calls => {
  const sent: Record<string, unknown>[] = []
  await setMessageReaction(credentials(async payload => { sent.push(payload); return { ...answer, persistedByServer: true } }), 'me1', action, new AbortController().signal)
  assert.equal(calls.length, 0)
  assert.deepEqual(sent[0], { chatId: 'c1', messageId: 'm1', expectedUid: 'me1', reactionProtocolVersion: 2, clientRevision: 'rev1', reactions: ['❤️'] })
}))

test('a final refusal is not sent again, anything else goes to the callable in the same attempt', async () => withFetch(async calls => {
  await assert.rejects(setMessageReaction(credentials(async () => ({ ok: false, error: 'NOT_MEMBER', reason: 'NOT_MEMBER' })), 'me1', action, new AbortController().signal),
    (error: unknown) => error instanceof MessageMutationFailure && error.definitive)
  assert.equal(calls.length, 0)
  for (const reason of ['UNAUTHORIZED', 'SUSPENDED', 'PERSIST_FAILED', 'INVALID_PAYLOAD']) {
    await setMessageReaction(credentials(async () => ({ ok: false, error: reason, reason })), 'me1', action, new AbortController().signal)
  }
  await setMessageReaction(credentials(async () => { throw new Error('timeout') }), 'me1', action, new AbortController().signal)
  await setMessageReaction(credentials(null), 'me1', action, new AbortController().signal)
  assert.equal(calls.length, 6, 'four refusals, a timeout and a server without message-reactions each went to the callable')
  assert.equal((calls[0] as { clientRevision: string }).clientRevision, 'rev1', 'the same revision, so the server applies it once')
}))

test('an inquiry reaction names the inquiry, and its answer names the inquiry as the room', async () => withFetch(async () => {
  const sent: Record<string, unknown>[] = []
  await setMessageReaction(credentials(async payload => { sent.push(payload); return { ...answer, chatId: 'sub_inq_ch1_s1', roomId: 'ch1_s1' } }), 'me1',
    { ...action, chatId: 'sub_inq_ch1_s1' }, new AbortController().signal, 'ch1_s1')
  assert.equal(sent[0]!.inquiryId, 'ch1_s1')
}))

test('the event state is shown until the document reaches its version', () => {
  const doc = (version: number): FirestoreDocument => ({ name: 'd', fields: { reactionVersion: { integerValue: String(version) } } } as unknown as FirestoreDocument)
  const updates = new ReactionUpdates()
  assert.equal(updates.remember('m1', { '❤️': ['p1'] }, 3, doc(3)), false, 'nothing newer than the document')
  assert.equal(updates.remember('m1', { '❤️': ['p1'], '👍': ['me1'] }, 4, doc(3)), true)
  assert.deepEqual(updates.reactions('m1', doc(3), 'me1')?.map(reaction => [reaction.emoji, reaction.selected]), [['❤️', false], ['👍', true]].sort((a, b) => String(a[0]) < String(b[0]) ? -1 : 1))
  assert.equal(updates.remember('m1', { '❤️': ['p1'] }, 4, doc(3)), false, 'the same version twice is one update')
  assert.equal(updates.reactions('m1', doc(4), 'me1'), null, 'the document caught up, so it speaks again')
  assert.equal(updates.reactions('m1', doc(4), 'me1'), null)
})
