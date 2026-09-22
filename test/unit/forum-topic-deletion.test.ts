import assert from 'node:assert/strict'
import { test } from 'node:test'
import { deleteTopicMessages, topicDeletionPage, TopicDeletions, TopicDeletionStop, type TopicMessages } from '../../src/main/accounts/forum-topic-deletion'
import { MessageMutationFailure } from '../../src/main/network/contracts'
import type { FirestoreDocument } from '../../src/main/network/firestore-values'

// Telegram's deleteTopicHistory takes every message of a topic: here the owner's device does it a page at a time.
const doc = (id: string): FirestoreDocument => ({ name: `projects/p/databases/(default)/documents/chats/g1/messages/${id}`, fields: {}, updateTime: '2026-09-21T00:00:00Z' } as unknown as FirestoreDocument)

function server(count: number, refuse: (docs: FirestoreDocument[], tombstone: boolean) => boolean = () => false): TopicMessages & { left: Set<string>; commits: { ids: string[]; tombstone: boolean }[] } {
  const left = new Set(Array.from({ length: count }, (_, index) => `m${String(index).padStart(3, '0')}`))
  const commits: { ids: string[]; tombstone: boolean }[] = []
  return {
    left, commits,
    page: async limit => [...left].slice(0, limit).map(doc),
    remove: async (docs, tombstone) => {
      commits.push({ ids: docs.map(value => value.name.split('/').pop()!), tombstone })
      if (refuse(docs, tombstone)) throw new MessageMutationFailure('refused', true)
      for (const value of docs) left.delete(value.name.split('/').pop()!)
    },
  }
}

test('every message of the topic goes, a page at a time', async () => {
  const messages = server(topicDeletionPage * 2 + 3)
  assert.equal(await deleteTopicMessages(messages, () => {}), topicDeletionPage * 2 + 3)
  assert.equal(messages.left.size, 0)
  assert.ok(messages.commits.every(commit => commit.tombstone && commit.ids.length <= topicDeletionPage), 'each with its revokedForAll record')
  assert.equal(await deleteTopicMessages(server(0), () => {}), 0, 'an empty topic has nothing to take')
})

test('a message already revoked goes without a second record, and the rest of its page still goes', async () => {
  const messages = server(5, (docs, tombstone) => tombstone && docs.some(value => value.name.endsWith('m002')))
  assert.equal(await deleteTopicMessages(messages, () => {}), 5)
  assert.equal(messages.left.size, 0)
  assert.deepEqual(messages.commits.filter(commit => !commit.tombstone).map(commit => commit.ids), [['m002']])
})

test('a message that cannot go stops the deletion instead of reading it forever', async () => {
  const messages = server(3, docs => docs.some(value => value.name.endsWith('m001')))
  await assert.rejects(deleteTopicMessages(messages, () => {}))
  assert.deepEqual([...messages.left], ['m001'])
  assert.ok(messages.commits.length < 12)
})

test('an uncertain answer and an account that moved on both stop it', async () => {
  const uncertain = server(3)
  uncertain.remove = async () => { throw new MessageMutationFailure('unknown', false) }
  await assert.rejects(deleteTopicMessages(uncertain, () => {}), /unknown/)
  const messages = server(20)
  let calls = 0
  await assert.rejects(deleteTopicMessages(messages, () => { if (++calls > 3) throw new Error('moved on') }), /moved on/)
  assert.ok(messages.left.size > 0)
})

// PeerMenuDeleteTopic outlives the box and a lost connection; applyTopicDeleted takes the topic away at once.
const tick = (): Promise<void> => new Promise(resolve => setImmediate(resolve))
const room = () => ({ id: 'g1', forum: { categories: [{ id: 'general' }, { id: 'notice' }] } } as { id: string; forum: { categories: { id: string }[] }; forumDeleting?: { id: string; failed: boolean }[] })

test('a deletion waits for the connection, goes on after a failure, and the topic leaves the list when it is done', async () => {
  let ready = false, attempts = 0, changes = 0
  const deletions = new TopicDeletions(async () => { if (++attempts === 1) throw new Error('network') }, () => ready, () => { changes++ }, async () => {})
  deletions.start('g1', 'notice')
  await tick()
  assert.equal(attempts, 0, 'nothing is tried while the account is not connected')
  let summary = room(); deletions.apply(summary)
  assert.deepEqual(summary.forumDeleting, [{ id: 'notice', failed: false }])
  ready = true; deletions.connectionChanged()
  for (let i = 0; i < 5; i++) await tick()
  assert.equal(attempts, 2, 'a failed attempt is tried again')
  summary = room(); deletions.apply(summary)
  assert.deepEqual(summary.forum.categories.map(value => value.id), ['general'], 'gone before the room document says so')
  assert.equal(summary.forumDeleting, undefined)
  summary = { id: 'g1', forum: { categories: [{ id: 'general' }] } }; deletions.apply(summary)
  summary = room(); deletions.apply(summary)
  assert.equal(summary.forum.categories.length, 2, 'once the room document agrees, what it says is shown again')
  assert.ok(changes >= 2)
  deletions.close()
})

test('a deletion that cannot go on is left failed, and is started again when asked', async () => {
  let stop = true, attempts = 0
  const deletions = new TopicDeletions(async () => { attempts++; if (stop) throw new TopicDeletionStop('kept') }, () => true, () => {}, async () => {})
  deletions.start('g1', 'notice'); deletions.start('g1', 'notice')
  for (let i = 0; i < 5; i++) await tick()
  assert.equal(attempts, 1, 'one deletion of a topic at a time, and a stop is not retried')
  let summary = room(); deletions.apply(summary)
  assert.deepEqual(summary.forumDeleting, [{ id: 'notice', failed: true }])
  stop = false; deletions.start('g1', 'notice')
  for (let i = 0; i < 5; i++) await tick()
  summary = room(); deletions.apply(summary)
  assert.deepEqual(summary.forum.categories.map(value => value.id), ['general'])
  deletions.close()
  deletions.start('g1', 'other')
  summary = room(); deletions.apply(summary)
  assert.equal(summary.forumDeleting, undefined, 'a closed account starts nothing')
})
