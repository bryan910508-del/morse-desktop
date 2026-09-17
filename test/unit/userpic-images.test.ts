import assert from 'node:assert/strict'
import { test } from 'node:test'
import { forgetImages, holdsImage, imageStoreState, rememberedImage, rememberImage } from '../../src/main/accounts/userpic-images'
import { ChannelImages } from '../../src/main/accounts/channel-images'
import { DirectAvatar } from '../../src/main/accounts/direct-avatar'
import { registerUserpicCache, UserpicCache } from '../../src/main/accounts/userpic-cache'
import { PeerProfiles, registerPeerProfiles } from '../../src/main/accounts/peer-profiles'
import type { UserpicCommand } from '../../src/main/storage/userpic-cache-table'
import type { FirestoreReader, ReadCredentials, WatchEvents } from '../../src/main/network/firestore-rpc'
import { documents, type FirestoreDocument } from '../../src/main/network/firestore-values'

// Dialogs::Row keeps the picture it has drawn for as long as the row lives, and nothing clears it when the row scrolls
// out of sight; only memory bounds what is kept. A row that comes back draws in the same frame.
const picture = (fill: number, length = 64): Buffer => {
  const bytes = Buffer.alloc(length, fill)
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 40, 0, 0, 0, 40]).copy(bytes)
  return bytes
}
const offline = (): ReadCredentials => ({ signal: new AbortController().signal, authorize: async () => { throw new Error('offline') } })

test('the picture store keeps what was drawn and gives way by size, never by what is on screen', () => {
  forgetImages()
  rememberImage('a', picture(1), 'image/png')
  const held = rememberedImage('a')
  assert.deepEqual(held?.bytes, picture(1))
  assert.equal(held?.mime, 'image/png')
  held!.bytes.fill(0)
  assert.deepEqual(rememberedImage('a')?.bytes, picture(1), 'each reader gets its own copy')
  assert.equal(rememberedImage('a', { maxBytes: 10, maxPixels: Infinity }), null, 'a picture too large for a surface is not used')
  assert.equal(rememberedImage('b'), null)
  assert.equal(holdsImage('a'), true)
  assert.equal(imageStoreState().entries, 1)
  forgetImages()
  assert.equal(holdsImage('a'), false)
  assert.equal(imageStoreState().bytes, 0)
})

const channelDoc = (id: string, photo: string): FirestoreDocument => ({ name: `${documents}/channels/${id}`, fields: { photoURL: { stringValue: photo } } } as unknown as FirestoreDocument)

test('a channel row that scrolls away keeps its picture, and loses it only when memory is needed', () => {
  forgetImages()
  const raw = 'gs://talky-a38c3.firebasestorage.app/channel_photos/a/p.png'
  const docs = new Map([['a', channelDoc('a', raw)]])
  // More rows than the window of recently shown ones, so «a» is long out of it.
  const others = Array.from({ length: 60 }, (_, index) => `other${index}`)
  for (const id of others) docs.set(id, channelDoc(id, `gs://talky-a38c3.firebasestorage.app/channel_photos/${id}/p.png`))
  const images = new ChannelImages(offline(), id => { const found = docs.get(id); if (!found) throw new Error('unknown'); return found }, () => {})
  rememberImage(raw, picture(3), 'image/png')
  images.setVisible(['a'])
  const shown = images.snapshot('a')
  assert.equal(shown?.status, 'ready', 'drawn from memory without any read')
  for (let start = 0; start < others.length; start += 20) images.setVisible(others.slice(start, start + 20))
  assert.deepEqual(images.snapshot('a'), shown, 'scrolled far past the window, the row keeps the same picture')
  forgetImages()
  images.setVisible(others.slice(0, 20))
  assert.equal(images.snapshot('a')?.status, 'idle', 'memory needed elsewhere lets it go')
  images.close()
})

function peerAvatar(known: { owner: string; raw: string }[]) {
  const auth = offline(), commands: UserpicCommand[] = []
  const cache = new UserpicCache(async <T,>(command: UserpicCommand): Promise<T> => {
    commands.push(command)
    return (command.kind === 'userpic-owners' ? known : null) as T
  })
  registerUserpicCache(auth, cache)
  let events: WatchEvents | null = null
  const reader = { watch: (_t: unknown, _s: AbortSignal, value: WatchEvents) => { events = value; return () => {} } } as unknown as FirestoreReader
  const binding = { uid: 'peer1', reader, personalURL: null }
  registerPeerProfiles(auth, new PeerProfiles('me1', auth, auth.signal, () => {}))
  const create = (): DirectAvatar => new DirectAvatar(binding, auth, () => binding, async () => new Response(null, { status: 403 }), () => {}, '__direct-avatar')
  return { cache, create, commands, events: () => events! }
}

test('a person\'s row coming back into view draws the picture at once instead of reading it again', async () => {
  forgetImages()
  const raw = 'gs://talky-a38c3.firebasestorage.app/profile_photos/peer1/p.png'
  const setup = peerAvatar([{ owner: 'user:peer1', raw }])
  await setup.cache.load()
  rememberImage(raw, picture(5), 'image/png')
  // The row is created the way the list creates it when it comes into view again.
  const avatar = setup.create()
  const drawn = avatar.snapshot
  assert.equal(drawn.status, 'ready')
  assert.equal(avatar.takeLoad(), null, 'nothing is read again')
  const again = setup.create()
  assert.deepEqual(again.snapshot, drawn, 'every row of this person names the same picture')
  forgetImages()
  const empty = setup.create()
  assert.equal(empty.snapshot.status, 'idle')
  assert.ok(empty.takeLoad(), 'with the picture gone from memory it is read again')
})
