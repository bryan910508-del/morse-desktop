import assert from 'node:assert/strict'
import { test } from 'node:test'
import Database from 'better-sqlite3-multiple-ciphers'
import { executePeerPhoto, maxPeerPhotos, type PeerPhotoCommand } from '../../src/main/storage/peer-photo-table'
import { PeerPhotoAlbum } from '../../src/main/accounts/peer-photo-album'
import type { ReadCredentials } from '../../src/main/network/firestore-rpc'

// ProfilePhotoHistory (iOS): the address of a picture moves to the front when it is seen again, and twenty of one
// person are kept. Telegram walks a peer's album with the arrows; this is the album a device can know of.
function store(): { db: Database.Database; run<T>(command: PeerPhotoCommand): T } {
  const db = new Database(':memory:')
  db.exec('CREATE TABLE peer_photos (uid TEXT NOT NULL, raw TEXT NOT NULL, seen_at INTEGER NOT NULL, PRIMARY KEY(uid, raw));')
  return { db, run: <T,>(command: PeerPhotoCommand) => executePeerPhoto(db, command) as T }
}
const address = (index: number): string => `gs://bucket/profile_photos/peer1/${index}.jpg`

test('a person keeps the pictures this device saw, newest first', () => {
  const { db, run } = store()
  for (const [at, index] of [[1_000, 1], [2_000, 2], [3_000, 3]] as const) run({ kind: 'peer-photo-seen', uid: 'peer1', raw: address(index), at })
  assert.deepEqual(run<string[]>({ kind: 'peer-photos-read', uid: 'peer1' }), [address(3), address(2), address(1)])
  // Seen again: the same address moves to the front and is not written twice.
  run({ kind: 'peer-photo-seen', uid: 'peer1', raw: address(1), at: 4_000 })
  assert.deepEqual(run<string[]>({ kind: 'peer-photos-read', uid: 'peer1' }), [address(1), address(3), address(2)])
  run({ kind: 'peer-photo-forget', uid: 'peer1', raw: address(3) })
  assert.deepEqual(run<string[]>({ kind: 'peer-photos-read', uid: 'peer1' }), [address(1), address(2)])
  assert.deepEqual(run<string[]>({ kind: 'peer-photos-read', uid: 'peer2' }), [], 'one person\'s pictures are only that person\'s')
  assert.throws(() => run({ kind: 'peer-photo-seen', uid: 'peer1', raw: '', at: 5_000 }))
  assert.throws(() => run({ kind: 'peer-photo-seen', uid: 'bad/uid', raw: address(9), at: 5_000 }))
  db.close()
})

test('twenty of one person are kept, and the oldest gives way', () => {
  const { db, run } = store()
  for (let index = 0; index < maxPeerPhotos + 5; index++) run({ kind: 'peer-photo-seen', uid: 'peer1', raw: address(index), at: 1_000 + index })
  const kept = run<string[]>({ kind: 'peer-photos-read', uid: 'peer1' })
  assert.equal(kept.length, maxPeerPhotos)
  assert.equal(kept[0], address(maxPeerPhotos + 4), 'the newest is first')
  assert.ok(!kept.includes(address(0)), 'the oldest is gone')
  db.close()
})

test('the album opens with the picture on screen first, then the ones remembered', async () => {
  const kept = [address(3), address(2), address(1)]
  const credentials = { signal: new AbortController().signal, authorize: async () => { throw new Error('no network in this test') } } as unknown as ReadCredentials
  const written: PeerPhotoCommand[] = []
  const album = new PeerPhotoAlbum(credentials, async command => {
    written.push(command)
    return (command.kind === 'peer-photos-read' ? kept : null) as never
  }, () => {})
  assert.deepEqual(await album.open('peer1', address(3)), { count: 3 }, 'the picture on screen is not counted twice')
  assert.deepEqual(await album.open('peer1', address(9)), { count: 4 }, 'a picture not remembered yet still opens')
  assert.deepEqual(await album.open('peer1', ''), { count: 3 }, 'a person with no picture now still has the earlier ones')
  // Remembering: the same address twice in a row is written once.
  album.remember('peer1', address(1)); album.remember('peer1', address(1)); album.remember('peer1', address(2))
  const seen = written.filter(command => command.kind === 'peer-photo-seen')
  assert.deepEqual(seen.map(command => (command as { raw: string }).raw), [address(1), address(2)])
  album.remember('peer1', ''); album.remember('', address(1))
  assert.equal(written.filter(command => command.kind === 'peer-photo-seen').length, 2, 'nothing without a person or a picture')
  assert.equal((await album.show('peer2', 0)), null, 'only the person whose album is open')
  album.dispose()
  assert.deepEqual(await album.open('peer1', address(1)), { count: 0 }, 'a closed album opens nothing')
})
