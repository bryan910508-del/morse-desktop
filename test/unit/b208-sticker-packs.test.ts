import assert from 'node:assert/strict'
import { test } from 'node:test'
import { StickerPacks } from '../../src/main/accounts/sticker-packs'
import { stickerPackRemoveWrite } from '../../src/main/network/sticker-pack-write'
import { documents, type FirestoreDocument, type WireObject } from '../../src/main/network/firestore-values'
import type { FirestoreReader, ReadCredentials } from '../../src/main/network/firestore-rpc'

// B208 (10-07): Desktop could not take a sticker out of a set it made, nor delete the set; iOS writes both
// (MorseStickerSets.swift:345-371), tdesktop offers both in its own set's box (sticker_set_box.cpp:936-980, :1903-1929).
const me = 'RAk6me', setId = 'set0000000000000000A'
const hash = (n: number) => String(n).repeat(64).slice(0, 64)
const value = (id: string, bytes: WireObject) => ({ mapValue: { fields: { id: { stringValue: id }, kind: { stringValue: 'png' }, path: { stringValue: `sticker_sets/${setId}/${id}.png` }, emoji: { stringValue: '' }, bytes } } })
const setDoc = (owner = me): FirestoreDocument => ({
  name: `${documents}/stickerSets/${setId}`, updateTime: { seconds: '100', nanos: 5 },
  fields: { ownerUid: { stringValue: owner }, title: { stringValue: 'B208 시험 팩' }, count: { integerValue: '2' },
    // the first as iOS stored it (a double), the second as Desktop did
    stickers: { arrayValue: { values: [value(hash(1), { doubleValue: 10 }), value(hash(2), { integerValue: '20' })] } } }
} as unknown as FirestoreDocument)

test('taking a sticker out rewrites the set\'s own list without it, over the version read', () => {
  const write = stickerPackRemoveWrite(setDoc(), hash(2)) as { update: { fields: { stickers: { arrayValue: { values: unknown[] } }; count: { integerValue: string } } }; updateMask: { fieldPaths: string[] }; currentDocument: unknown }
  assert.deepEqual(write.update.fields.stickers.arrayValue.values, [value(hash(1), { doubleValue: 10 })], 'the other sticker stays exactly as stored')
  assert.equal(write.update.fields.count.integerValue, '1')
  assert.deepEqual(write.updateMask.fieldPaths, ['stickers', 'count'], 'the title and owner are not touched')
  assert.deepEqual(write.currentDocument, { updateTime: { seconds: '100', nanos: 5 } }, 'a change since the read is not lost')
  assert.equal(stickerPackRemoveWrite(setDoc(), hash(3)), null, 'a sticker the set no longer holds writes nothing')
})

function rig(owner = me, indexSet = setId, storageStatus = (_path: string) => 204) {
  const steps: string[] = []
  const reader = {
    async getDocument(name: string) {
      if (name.endsWith(`stickerSets/${setId}`)) return setDoc(owner)
      if (name.includes('/stickerIndex/')) return { name, updateTime: { seconds: '1', nanos: 0 }, fields: { setId: { stringValue: indexSet }, ownerUid: { stringValue: me } } }
      return null
    },
    async commitStickerPackWrites(writes: WireObject[]) {
      for (const write of writes as { delete?: string; update?: { name: string } }[]) steps.push(write.delete ? `delete ${write.delete.replace(`${documents}/`, '')}` : `update ${write.update!.name.replace(`${documents}/`, '')}`)
    },
    async uninstallStickerPack(uid: string, id: string) { steps.push(`uninstall ${uid}/${id}`) }
  } as unknown as FirestoreReader
  const auth = { signal: new AbortController().signal, authorize: async () => ({ idToken: 'id', appCheckToken: 'ac' }) } as unknown as ReadCredentials
  globalThis.fetch = (async (url: string, init?: { method?: string }) => {
    const path = decodeURIComponent(String(url).split('/o/')[1] ?? '')
    steps.push(`${init?.method ?? 'GET'} storage ${path}`)
    return new Response(null, { status: storageStatus(path) })
  }) as typeof fetch
  const packs = new StickerPacks(me, auth, () => reader, () => {}, async () => Buffer.alloc(0))
  return { packs, steps }
}

test('taking a sticker out: the list first, then its index while it names this set, then its file', async () => {
  const { packs, steps } = rig()
  const next = await packs.removeFromPack(setId, hash(2))
  assert.deepEqual(next.items.map(item => item.id), [hash(1)])
  assert.deepEqual(steps, [`update stickerSets/${setId}`, `delete stickerIndex/${hash(2)}`, `DELETE storage sticker_sets/${setId}/${hash(2)}.png`])
})

test('an index that names another set is left alone (another set holds the same bytes)', async () => {
  const { packs, steps } = rig(me, 'otherSet')
  await packs.removeFromPack(setId, hash(2))
  assert.ok(!steps.some(step => step.startsWith('delete stickerIndex')), steps.join(' | '))
})

test('deleting a set: every file and index while the set still names its owner, then the set, then the install', async () => {
  const { packs, steps } = rig()
  await packs.deletePack(setId)
  assert.deepEqual(steps, [
    `DELETE storage sticker_sets/${setId}/${hash(1)}.png`, `delete stickerIndex/${hash(1)}`,
    `DELETE storage sticker_sets/${setId}/${hash(2)}.png`, `delete stickerIndex/${hash(2)}`,
    `delete stickerSets/${setId}`, `uninstall ${me}/${setId}`
  ], 'Storage rules read the owner from the set, so its files go before it')
})

test('a file Storage will not let go stops the delete with the set still standing; one already gone does not', async () => {
  const refused = rig(me, setId, path => path.includes(hash(2)) ? 403 : 204)
  await assert.rejects(refused.packs.deletePack(setId))
  assert.deepEqual(refused.steps, [`DELETE storage sticker_sets/${setId}/${hash(1)}.png`, `delete stickerIndex/${hash(1)}`, `DELETE storage sticker_sets/${setId}/${hash(2)}.png`],
    'the second sticker\'s index and the set stay, so a retry can still delete them')
  const gone = rig(me, setId, path => path.includes(hash(1)) ? 404 : 204)
  await gone.packs.deletePack(setId)
  assert.ok(gone.steps.includes(`delete stickerSets/${setId}`), gone.steps.join(' | '))
})

test('another account\'s set can be neither changed nor deleted', async () => {
  const { packs, steps } = rig('someoneElse')
  await assert.rejects(packs.removeFromPack(setId, hash(1)))
  await assert.rejects(packs.deletePack(setId))
  assert.deepEqual(steps, [], 'nothing written')
})
