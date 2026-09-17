import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { UserpicStore, type UserpicCommand } from '../../src/main/storage/userpic-cache-table'
import { isPlainDatabase } from '../../src/main/storage/encrypted-database'
import { photoToken, registerUserpicCache, UserpicCache, userpicURL } from '../../src/main/accounts/userpic-cache'
import { avatarDisplayLimits, clearProfilePhotoCache, ProfilePhoto } from '../../src/main/accounts/profile-photo'
import { forgetImages } from '../../src/main/accounts/userpic-images'
import { DirectAvatar } from '../../src/main/accounts/direct-avatar'
import { PeerProfiles, registerPeerProfiles } from '../../src/main/accounts/peer-profiles'
import type { FirestoreReader, ReadCredentials, WatchEvents } from '../../src/main/network/firestore-rpc'
import { documents, type FirestoreDocument } from '../../src/main/network/firestore-values'

// Telegram draws a picture it fetched before from its encrypted cache, names one picture the same way on every surface,
// and paints the cached userpic of a person before the peer data is refreshed.
const picture = (fill: number, length = 64): Buffer => {
  const bytes = Buffer.alloc(length, fill)
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 40, 0, 0, 0, 40]).copy(bytes)
  return bytes
}
const key = (value: string): string => UserpicCache.key(value)

async function directory(): Promise<{ path: string; done(): Promise<void> }> {
  const path = await mkdtemp(join(tmpdir(), 'morse-userpics-'))
  return { path, done: () => rm(path, { recursive: true, force: true }) }
}

test('pictures are kept sealed in the cache file and the least recently shown ones give way first', async () => {
  const dir = await directory()
  try {
    const file = join(dir.path, 'userpics.sqlite'), secret = randomBytes(32).toString('hex')
    let now = 1
    const store = new UserpicStore(file, secret, () => now, { bytes: 200, entries: 3 })
    for (const name of ['a', 'b', 'c']) { now++; store.execute({ kind: 'userpic-write', key: key(name), mime: 'image/png', data: picture(name.charCodeAt(0)) }) }
    now++
    const read = store.execute({ kind: 'userpic-read', key: key('a') }) as { mime: string; data: Uint8Array }
    assert.deepEqual(Buffer.from(read.data), picture('a'.charCodeAt(0)))
    assert.equal(read.mime, 'image/png')
    now++; store.execute({ kind: 'userpic-write', key: key('d'), mime: 'image/png', data: picture(100) })
    assert.equal(store.execute({ kind: 'userpic-read', key: key('b') }), null, 'the picture shown longest ago left')
    assert.ok(store.execute({ kind: 'userpic-read', key: key('a') }), 'a picture read again stays')
    assert.equal(store.execute({ kind: 'userpic-usage' }), 64 * 3)
    store.execute({ kind: 'userpic-owner', owner: 'user:peer1', raw: 'gs://bucket/profile_photos/peer1/p.jpg' })
    assert.deepEqual(store.execute({ kind: 'userpic-owners' }), [{ owner: 'user:peer1', raw: 'gs://bucket/profile_photos/peer1/p.jpg' }])
    store.execute({ kind: 'userpic-owner', owner: 'user:peer1', raw: null })
    assert.deepEqual(store.execute({ kind: 'userpic-owners' }), [])
    assert.throws(() => store.execute({ kind: 'userpic-write', key: 'not-a-key', mime: 'image/png', data: picture(1) }))
    assert.throws(() => store.execute({ kind: 'userpic-write', key: key('e'), mime: 'text/html', data: picture(1) }))
    store.close()
    assert.equal(isPlainDatabase(file), false)
    assert.ok(!(await readFile(file)).includes(picture('a'.charCodeAt(0)).subarray(24)), 'no picture bytes in the file')
    const reopened = new UserpicStore(file, secret)
    assert.ok(reopened.execute({ kind: 'userpic-read', key: key('d') }))
    reopened.execute({ kind: 'userpic-clear' })
    assert.equal(reopened.execute({ kind: 'userpic-read', key: key('d') }), null)
    reopened.close()
  } finally { await dir.done() }
})

test('a cache file that cannot be opened is started again', async () => {
  const dir = await directory()
  try {
    const file = join(dir.path, 'userpics.sqlite')
    await writeFile(file, randomBytes(4096))
    const store = new UserpicStore(file, randomBytes(32).toString('hex'))
    store.execute({ kind: 'userpic-write', key: key('a'), mime: 'image/png', data: picture(1) })
    assert.ok(store.execute({ kind: 'userpic-read', key: key('a') }))
    store.close()
  } finally { await dir.done() }
})

test('one picture has one address in this run, whichever surface shows it', () => {
  const raw = 'gs://talky-a38c3.firebasestorage.app/profile_photos/peer1/p.jpg'
  assert.equal(photoToken('picture', raw), photoToken('picture', raw))
  assert.notEqual(photoToken('picture', raw), photoToken('picture', `${raw}x`))
  assert.notEqual(photoToken('picture', raw), photoToken('personal', raw))
  assert.match(userpicURL(photoToken('picture', raw)), /^morse:\/\/app\/__userpic\/[0-9a-f]{48}$/)
})

function fakeCache(owners: { owner: string; raw: string }[] = []) {
  const files = new Map<string, { mime: string; data: Uint8Array }>(), commands: UserpicCommand[] = []
  const store = async <T>(command: UserpicCommand): Promise<T> => {
    commands.push(command)
    if (command.kind === 'userpic-owners') return owners as T
    if (command.kind === 'userpic-read') return (files.get(command.key) ?? null) as T
    if (command.kind === 'userpic-write') files.set(command.key, { mime: command.mime, data: new Uint8Array(command.data) })
    return null as T
  }
  return { cache: new UserpicCache(store), files, commands }
}
const offline = (): ReadCredentials => ({ signal: new AbortController().signal, authorize: async () => { throw new Error('offline') } })

test('a picture fetched before this start is drawn from the cache file under the same address everywhere', async () => {
  clearProfilePhotoCache()
  const raw = 'gs://talky-a38c3.firebasestorage.app/profile_photos/peer1/p.png', auth = offline()
  const { cache, files } = fakeCache()
  files.set(key(raw), { mime: 'image/png', data: picture(7) })
  registerUserpicCache(auth, cache)
  const row = new ProfilePhoto('peer1', auth, () => {}, '__direct-avatar', { ...avatarDisplayLimits, validate: () => {} })
  await row.select(raw)
  assert.equal(row.snapshot.status, 'ready', 'no download was possible, so the picture came from the file')
  clearProfilePhotoCache()
  const profile = new ProfilePhoto('peer1', auth, () => {}, '__contact-photo')
  await profile.select(raw)
  assert.equal(profile.snapshot.url, row.snapshot.url)
  const token = row.snapshot.url!.split('/').pop()!
  const response = profile.response(token, new Request(row.snapshot.url!))
  assert.equal(response.status, 200)
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), picture(7))
  const empty = new ProfilePhoto('peer1', auth, () => {}, '__contact-photo')
  clearProfilePhotoCache()
  await empty.select('gs://talky-a38c3.firebasestorage.app/profile_photos/peer1/other.png')
  assert.equal(empty.snapshot.status, 'error', 'a picture that is not in the file is downloaded, which fails offline')
})

function watchedAvatar(owners: { owner: string; raw: string }[]) {
  const auth = offline(), { cache, files, commands } = fakeCache(owners)
  registerUserpicCache(auth, cache)
  let events: WatchEvents | null = null, changes = 0
  const reader = { watch: (_target: unknown, _signal: AbortSignal, value: WatchEvents) => { events = value; return () => {} } } as unknown as FirestoreReader
  const binding = { uid: 'peer1', reader, personalURL: null }
  const profiles = new PeerProfiles('me1', auth, auth.signal, () => { changes++ })
  registerPeerProfiles(auth, profiles)
  const bind = (): void => profiles.bind(reader, ['peer1'])
  return { cache, files, commands, auth, profiles, bind, events: () => events!, changes: () => changes,
    create: () => new DirectAvatar(binding, auth, () => binding, async () => new Response(null, { status: 403 }), () => { changes++ }, '__contact-avatar') }
}
const profileRows = (raw: string, mutual: boolean): Map<string, FirestoreDocument> => {
  const root = `${documents}/users/peer1`, rows = new Map<string, FirestoreDocument>()
  rows.set(root, { name: root, fields: { displayName: { stringValue: '민지' }, photoURL: { stringValue: raw } } } as unknown as FirestoreDocument)
  if (mutual) rows.set(`${root}/contacts/me1`, { name: `${root}/contacts/me1`, fields: {} } as unknown as FirestoreDocument)
  return rows
}

test('a contact row draws the last confirmed picture before the server answers, and the answer keeps, replaces or hides it', async () => {
  clearProfilePhotoCache()
  const raw = 'gs://talky-a38c3.firebasestorage.app/profile_photos/peer1/p.png'
  const setup = watchedAvatar([{ owner: 'user:peer1', raw }])
  setup.files.set(key(raw), { mime: 'image/png', data: picture(9) })
  await setup.cache.load()
  setup.bind()
  const avatar = setup.create()
  await avatar.takeLoad()!()
  const shown = avatar.snapshot
  assert.equal(shown.status, 'ready')
  setup.events().state('loading')
  assert.equal(avatar.snapshot.url, shown.url, 'a read still in progress keeps the picture')
  setup.events().snapshot(profileRows(raw, true)); avatar.refresh()
  assert.equal(avatar.snapshot.url, shown.url, 'the same picture confirmed is not drawn again')
  assert.equal(avatar.takeLoad(), null)
  setup.events().reconnecting!(); avatar.refresh()
  assert.equal(avatar.snapshot.url, shown.url)
  setup.events().snapshot(profileRows(raw, false)); avatar.refresh()
  assert.equal(avatar.snapshot.url, null, 'no longer a mutual contact hides the picture')
  assert.deepEqual(setup.commands.at(-1), { kind: 'userpic-owner', owner: 'user:peer1', raw: null })
  assert.equal(setup.cache.known('user:peer1'), '')
})

test('a changed picture replaces the confirmed one, and a refused read hides it', async () => {
  clearProfilePhotoCache()
  const old = 'gs://talky-a38c3.firebasestorage.app/profile_photos/peer1/old.png', next = 'gs://talky-a38c3.firebasestorage.app/profile_photos/peer1/new.png'
  const setup = watchedAvatar([{ owner: 'user:peer1', raw: old }])
  setup.files.set(key(old), { mime: 'image/png', data: picture(1) })
  setup.files.set(key(next), { mime: 'image/png', data: picture(2) })
  await setup.cache.load()
  setup.bind()
  const avatar = setup.create()
  await avatar.takeLoad()!()
  const first = avatar.snapshot.url
  setup.events().snapshot(profileRows(next, true)); avatar.refresh()
  assert.equal(setup.cache.known('user:peer1'), next)
  await avatar.takeLoad()!()
  assert.equal(avatar.snapshot.status, 'ready')
  assert.notEqual(avatar.snapshot.url, first)
  forgetImages()
  const refused = watchedAvatar([{ owner: 'user:peer1', raw: old }])
  refused.files.set(key(old), { mime: 'image/png', data: picture(1) })
  await refused.cache.load()
  refused.bind()
  const hidden = refused.create()
  await hidden.takeLoad()!()
  assert.equal(hidden.snapshot.status, 'ready', 'the confirmed picture is drawn while the account reads this person')
  refused.events().snapshot(profileRows(old, false))
  hidden.refresh()
  assert.equal(hidden.snapshot.url, null, 'no longer a mutual contact hides it')
})

test('nothing is shown or remembered before the confirmed pictures are read', async () => {
  const { cache, commands } = fakeCache([{ owner: 'user:peer1', raw: 'gs://x' }])
  assert.equal(cache.known('user:peer1'), '')
  cache.confirm('user:peer1', null)
  assert.equal(commands.length, 0)
  await cache.load()
  assert.equal(cache.known('user:peer1'), 'gs://x')
  cache.confirm('user:peer1', 'gs://x')
  assert.equal(commands.filter(command => command.kind === 'userpic-owner').length, 0, 'an unchanged picture is not written again')
  cache.close()
  assert.equal(cache.known('user:peer1'), '')
})
