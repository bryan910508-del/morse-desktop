import assert from 'node:assert/strict'
import { test } from 'node:test'
import { StoryBarApi } from '../../src/main/api/story-bar'
import { mergeStoryBar, type StoryBarEntry } from '../../src/shared/story-bar'
import { documents, type FirestoreDocument } from '../../src/main/network/firestore-values'

// B47 (Telegram R-59): the stories row keeps what it has when a read fails; a dropped connection no longer empties it.
const me = 'me', peer = 'peer'
const iso = (ms: number) => ({ seconds: String(Math.floor(ms / 1000)), nanos: 0 })
const story = (owner: string, id: string, expires: number): FirestoreDocument => ({
  name: `${documents}/users/${owner}/publicStories/${id}`, updateTime: { seconds: '1', nanos: 0 },
  fields: { authorId: { stringValue: owner }, createdAt: { timestampValue: iso(expires - 86400000) }, expiresAt: { timestampValue: iso(expires) } }
} as unknown as FirestoreDocument)

function bar() {
  const failing = new Set<string>()
  const expires = Date.now() + 3600000
  const owner = (path: string) => path.split('/users/')[1]!.split('/')[0]!
  const reader = {
    query: async (parent: string) => {
      if (failing.has(owner(parent))) throw new Error('offline')
      return parent.endsWith(`/users/${peer}`) ? [story(peer, 's1', expires)] : []
    },
    getDocument: async (path: string) => { if (failing.has(owner(path))) throw new Error('offline'); return null },
    close: () => {}
  }
  const auth = { signal: new AbortController().signal, authorize: async () => ({ idToken: 'id', appCheckToken: 'check', expiresAt: Date.now() + 60000 }) }
  const api = new StoryBarApi(me, auth, () => {}, uid => uid === peer, () => reader as never)
  return { api, fail: (...owners: string[]) => { failing.clear(); for (const id of owners) failing.add(id) }, expires }
}

test('a read that fails keeps the person last read, and a load nobody answered is a failure, not an empty row', async () => {
  const { api, fail } = bar()
  const first = await api.list([peer], true)
  assert.deepEqual(first.entries.map(entry => entry.uid), [peer])
  assert.equal(first.partial, false)
  fail(peer)
  const partial = await api.list([peer], true)
  assert.deepEqual([partial.entries.map(entry => entry.uid), partial.partial], [[peer], true], 'the person not read now keeps their stories')
  fail(me, peer)
  await assert.rejects(api.list([peer], true), 'no connection: the row keeps what it shows')
  fail()
  const again = await api.list([peer], true)
  assert.deepEqual(again.entries.map(entry => entry.uid), [peer])
  api.close()
})

test('the row merges a partial result and drops only what has expired', () => {
  const now = 1_000_000
  const a: StoryBarEntry = { uid: 'a', count: 1, unseen: 1, latestAt: 1, expiresAt: now + 10 }
  const b: StoryBarEntry = { uid: 'b', count: 2, unseen: 0, latestAt: 2, expiresAt: now + 10 }
  const gone: StoryBarEntry = { uid: 'c', count: 1, unseen: 0, latestAt: 3, expiresAt: now - 1 }
  assert.deepEqual(mergeStoryBar([a, b], { entries: [], observedAt: now, partial: true }, now).map(entry => entry.uid), ['a', 'b'], 'a partial empty answer keeps the row')
  assert.deepEqual(mergeStoryBar([a, b], { entries: [{ ...a, unseen: 0 }], observedAt: now, partial: true }, now).map(entry => [entry.uid, entry.unseen]), [['a', 0], ['b', 0]])
  assert.deepEqual(mergeStoryBar([a, b], { entries: [a], observedAt: now, partial: false }, now).map(entry => entry.uid), ['a'], 'a full answer replaces it')
  assert.deepEqual(mergeStoryBar([a, gone], { entries: [], observedAt: now, partial: true }, now).map(entry => entry.uid), ['a'], 'expired stories leave')
})
