import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { mock, test } from 'node:test'
import type { ReadCredentials, WatchEvents } from '../../src/main/network/firestore-rpc'
import { StoryBarApi } from '../../src/main/api/story-bar'
import { storageBucket } from '../../src/main/media/media-document'
import { documents, type FirestoreDocument, type WireObject } from '../../src/main/network/firestore-values'
import { maxStoryPeers, storyPeerFromDocument, storyPeerHideWrite, storyPeerUnhideWrite } from '../../src/main/network/story-peers-document'

// B482 (server contract §2·§3, rules v4.8.42; tdesktop FillSourceMenu → Stories::toggleHidden): a person's stories can be
// kept in the archive's row instead of the chat list's. The list is this account's users/{me}/storyPeers; the feed stays
// whole (hidden stories can still be watched), the row is what splits. Desktop shows no story notifications, so it
// never writes storiesMuted, and never wipes one the phones set.
const auth = { signal: new AbortController().signal, authorize: async () => ({ idToken: 'id', appCheckToken: 'check', expiresAt: Date.now() + 60000 }) } as unknown as ReadCredentials
const me = 'me'
const iso = (ms: number) => ({ seconds: String(Math.floor(ms / 1000)), nanos: (ms % 1000) * 1e6 })
const copy = (owner: string, id: string, created: number, expires: number): FirestoreDocument => ({
  name: `${documents}/users/${me}/storyFeed/${owner}_${id}`, updateTime: { seconds: '1', nanos: 0 },
  fields: { ownerType: { stringValue: 'user' }, ownerId: { stringValue: owner }, storyId: { stringValue: id }, collection: { stringValue: 'publicStories' },
    storyPath: { stringValue: `users/${owner}/publicStories/${id}` }, source: { stringValue: 'audience' }, authorId: { stringValue: owner },
    mediaURL: { stringValue: `gs://${storageBucket}/stories/user/${owner}/${id}.jpg` }, mediaType: { stringValue: 'image' },
    createdAt: { timestampValue: iso(created) }, expiresAt: { timestampValue: iso(expires) } }
} as unknown as FirestoreDocument)
const peerDoc = (owner: string, fields: Record<string, WireObject> = {}): FirestoreDocument => ({
  name: `${documents}/users/${me}/storyPeers/user_${owner}`, updateTime: { seconds: '1', nanos: 0 },
  fields: { ownerType: { stringValue: 'user' }, ownerId: { stringValue: owner }, ...fields }
} as unknown as FirestoreDocument)
const docs = (...items: FirestoreDocument[]) => new Map(items.map(item => [item.name, item]))
function bar(write: (write: WireObject) => Promise<void> = async () => {}) {
  const clock = 1_800_000_000_000
  const live = new Map<string, WatchEvents>(), writes: WireObject[] = []
  const listen = {
    add: (wire: WireObject, events: WatchEvents) => {
      const key = (wire.query as { structuredQuery: { from: { collectionId: string }[] } }).structuredQuery.from[0]!.collectionId
      live.set(key, events); return () => { if (live.get(key) === events) live.delete(key) }
    },
    close: () => live.clear(), tally: { fresh: 0, resumed: 0, documents: 0, refused: 0 }, get size() { return live.size }
  }
  const api = new StoryBarApi(me, auth, () => {}, () => {}, () => ({ listenTargets: () => listen, close: () => {} }) as never, () => clock,
    async item => { writes.push(item); await write(item) })
  return { api, live, writes, now: () => clock }
}
const hidden = (api: StoryBarApi, owner: string) => api.peerEntry(owner)?.hidden === true

test('the row listens to this account\'s storyPeers on the same stream, and a hidden person\'s entry says so', async () => {
  mock.timers.enable({ apis: ['setTimeout'] })
  try {
    const { api, live, now } = bar()
    await api.list(['ann', 'bob'], false)
    assert.ok(live.has('storyPeers'), 'one more target on the row\'s stream')
    const t = now(), later = t + 3600000
    live.get('storyFeed')!.snapshot(docs(copy('ann', 'a1', t - 1000, later), copy('bob', 'b1', t - 2000, later)))
    live.get('storyPeers')!.snapshot(docs(peerDoc('ann', { hidden: { booleanValue: true } }), peerDoc('bob', { storiesMuted: { booleanValue: true } })))
    mock.timers.tick(100)
    assert.equal(hidden(api, 'ann'), true)
    assert.equal(hidden(api, 'bob'), false, 'a person only muted stays in the row')
    assert.equal(api.peerEntry('ann')?.count, 1, 'hidden stories are still there to watch')
    assert.deepEqual(api.preloadCandidates().map(candidate => candidate.ownerId), ['bob'], 'the archive\'s row is not fetched ahead')
  } finally { mock.timers.reset() }
})

test('hiding moves the row at once, the server\'s answer takes over, and a refused write moves it back', async () => {
  mock.timers.enable({ apis: ['setTimeout'] })
  try {
    const t = 1_800_000_000_000
    let refuse = false
    const { api, live, writes } = bar(async () => { if (refuse) throw new Error('denied') })
    await api.list(['ann'], false)
    live.get('storyFeed')!.snapshot(docs(copy('ann', 'a1', t - 1000, t + 3600000)))
    live.get('storyPeers')!.snapshot(docs())
    await api.setHidden('ann', true)
    assert.equal(hidden(api, 'ann'), true, 'moved before the server answers')
    assert.equal((writes[0] as { update: { name: string } }).update.name, `${documents}/users/${me}/storyPeers/user_ann`)
    live.get('storyPeers')!.snapshot(docs(peerDoc('ann', { hidden: { booleanValue: true } })))
    assert.equal(hidden(api, 'ann'), true)
    refuse = true
    await assert.rejects(api.setHidden('ann', false))
    assert.equal(hidden(api, 'ann'), true, 'a refused «unhide» leaves it hidden')
    await assert.rejects(api.setHidden(me, true), 'not one\'s own stories')
  } finally { mock.timers.reset() }
})

test('the documents: hide keeps storiesMuted, unhide drops only hidden — or the document when nothing else is left', () => {
  const hide = storyPeerHideWrite(me, 'user', 'ann') as { update: { fields: Record<string, unknown> }; updateMask: { fieldPaths: string[] }; updateTransforms: unknown[] }
  assert.deepEqual(hide.updateMask.fieldPaths, ['ownerType', 'ownerId', 'hidden'], 'storiesMuted is not in the mask, so it stays')
  assert.deepEqual(hide.updateTransforms, [{ fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' }])
  assert.deepEqual(storyPeerUnhideWrite(me, 'user', 'ann', { ownerType: 'user', ownerId: 'ann', hidden: true, storiesMuted: null }), { delete: `${documents}/users/${me}/storyPeers/user_ann` })
  const keep = storyPeerUnhideWrite(me, 'user', 'ann', { ownerType: 'user', ownerId: 'ann', hidden: true, storiesMuted: false }) as { updateMask: { fieldPaths: string[] }; currentDocument: unknown }
  assert.deepEqual(keep.updateMask.fieldPaths, ['hidden'])
  assert.deepEqual(keep.currentDocument, { exists: true })
  assert.throws(() => storyPeerFromDocument(peerDoc(me), me), 'never oneself')
  assert.throws(() => storyPeerFromDocument({ ...peerDoc('ann'), name: `${documents}/users/${me}/storyPeers/user_bob` } as FirestoreDocument, me), 'the id names its owner')
  assert.equal(maxStoryPeers, 1000)
})

test('the chat list\'s row, the archive\'s row and the archive line read one answer', () => {
  const read = (path: string) => readFileSync(join(__dirname, '../../src/renderer/src', path), 'utf8')
  const widget = read('dialogs/dialogs-widget.tsx'), row = read('stories/stories-row.tsx')
  assert.match(widget, /const storyBar = useStoryBar\(accountUid\)/)
  assert.match(widget, /<StoriesRow bar=\{storyBar\} \/>/)
  assert.match(widget, /archived && <StoriesRow bar=\{storyBar\} kind="archive" \/>/)
  assert.match(widget, /stored\.length \|\| storedInquiries\.length \|\| hiddenStories/)
  assert.match(row, /shown: people\.filter\(entry => !entry\.hidden\)/)
  assert.match(row, /hidden: people\.filter\(entry => entry\.hidden\)/)
  assert.match(row, /window\.morse\.setStoryPeerHidden\(bar\.accountUid, uid, to\)/)
})
