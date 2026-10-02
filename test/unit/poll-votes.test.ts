import assert from 'node:assert/strict'
import { test } from 'node:test'
import { PollVotes } from '../../src/main/accounts/poll-votes'
import type { ChatMessage } from '../../src/shared/model'

// A person's own answer is not on the message — the server keeps it at messages/{id}/pollVotes/{uid} —
// so the card had nothing but the optimistic overlay to show it with, and the answer vanished the moment
// anybody else voted and the overlay gave way to the server's copy.
const poll = (id: string, version: string): ChatMessage =>
  ({ id, version, kind: 'poll', encrypted: false, poll: { question: 'q', options: ['a', 'b'] } }) as unknown as ChatMessage
const settle = (): Promise<void> => new Promise(resolve => setImmediate(resolve))

test('the answer is read once and shown, and the card is told when it lands', async () => {
  const asked: string[] = []
  let changed = 0
  const votes = new PollVotes(async id => { asked.push(id); return [1] }, () => { changed++ })
  assert.equal(votes.mine('m1'), null, 'not read yet reads as no answer, like not voted')
  votes.follow([poll('m1', '100:0')])
  await settle()
  assert.deepEqual(votes.mine('m1'), [1])
  assert.equal(changed, 1)
  // The same message again asks nothing more.
  votes.follow([poll('m1', '100:0')])
  await settle()
  assert.deepEqual(asked, ['m1'])
  assert.equal(changed, 1)
})

test('the answer is read again when the message moves on, since anyone voting moves it', async () => {
  const asked: string[] = []
  const votes = new PollVotes(async id => { asked.push(id); return asked.length > 1 ? [0, 1] : [0] }, () => {})
  votes.follow([poll('m1', '100:0')]); await settle()
  votes.follow([poll('m1', '101:0')]); await settle()
  assert.deepEqual(asked, ['m1', 'm1'])
  assert.deepEqual(votes.mine('m1'), [0, 1], 'this account may have voted on another device')
})

test('no answer at all is remembered as none, and is not asked for again', async () => {
  const asked: string[] = []
  const votes = new PollVotes(async id => { asked.push(id); return null }, () => {})
  votes.follow([poll('m1', '100:0')]); await settle()
  assert.deepEqual(votes.mine('m1'), [], 'the poll is answered by nobody here, which is not «unknown»')
  votes.follow([poll('m1', '100:0')]); await settle()
  assert.deepEqual(asked, ['m1'])
})

test('a read that fails leaves no answer and may be asked again', async () => {
  let fail = true
  const votes = new PollVotes(async () => { if (fail) throw new Error('refused'); return [1] }, () => {})
  votes.follow([poll('m1', '100:0')]); await settle()
  assert.equal(votes.mine('m1'), null)
  fail = false
  votes.follow([poll('m1', '100:0')]); await settle()
  assert.deepEqual(votes.mine('m1'), [1])
})

test('only polls are asked about, and one that left the window is forgotten', async () => {
  const asked: string[] = []
  const votes = new PollVotes(async id => { asked.push(id); return [0] }, () => {})
  const text = ({ id: 'm2', version: '1:0', kind: 'text', encrypted: false }) as unknown as ChatMessage
  votes.follow([poll('m1', '100:0'), text]); await settle()
  assert.deepEqual(asked, ['m1'])
  votes.follow([text]); await settle()
  assert.equal(votes.mine('m1'), null, 'the window no longer holds it')
})

test('a closed reader tells nobody and asks nothing', async () => {
  let changed = 0
  const votes = new PollVotes(async () => [0], () => { changed++ })
  votes.follow([poll('m1', '100:0')])
  votes.close()
  await settle()
  assert.equal(changed, 0)
  assert.equal(votes.mine('m1'), null)
})
