import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ChannelImages } from '../../src/main/accounts/channel-images'
import type { ReadCredentials } from '../../src/main/network/firestore-rpc'
import { documents, type FirestoreDocument } from '../../src/main/network/firestore-values'

// Downloads never start in these checks: authorization is refused, so entries only show whether they are kept.
const credentials: ReadCredentials = { signal: new AbortController().signal, authorize: async () => { throw new Error('offline') } }
const doc = (id: string, photo: string): FirestoreDocument => ({ name: `${documents}/channels/${id}`, fields: { photoURL: { stringValue: photo } } })

function images() {
  const docs = new Map([['a', doc('a', 'gs://talky-a38c3.firebasestorage.app/channel_photos/a/p.jpg')], ['b', doc('b', 'gs://talky-a38c3.firebasestorage.app/channel_photos/b/p.jpg')]])
  let available = true
  const value = new ChannelImages(credentials, id => { const found = docs.get(id); if (!available || !found) throw new Error('unknown'); return found }, () => {})
  const entries = (): Map<string, unknown> => (value as unknown as { entries: Map<string, unknown> }).entries
  return { value, docs, entries, setAvailable: (next: boolean) => { available = next } }
}

// DialogAvatars' retained cache: a photo that left the screen is not loaded again when it comes back.
test('a channel photo that scrolls away keeps its entry for when it comes back', () => {
  const { value, entries } = images()
  value.setVisible(['a', 'b'])
  const first = entries().get('a')
  value.setVisible(['b'])
  assert.equal(entries().get('a'), first)
  value.setVisible(['a'])
  assert.equal(entries().get('a'), first)
})

test('photos stay while the channel list is read again, and a changed photo replaces its entry', () => {
  const { value, docs, entries, setAvailable } = images()
  value.setVisible(['a'])
  const first = entries().get('a')
  setAvailable(false); value.prune()
  assert.equal(entries().get('a'), first, 'an unknown document for a moment keeps the picture')
  setAvailable(true); value.prune()
  assert.equal(entries().get('a'), first)
  docs.set('a', doc('a', 'gs://talky-a38c3.firebasestorage.app/channel_photos/a/new.jpg')); value.prune()
  assert.notEqual(entries().get('a'), first)
  value.clear()
  assert.equal(entries().size, 0)
})
