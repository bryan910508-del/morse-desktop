import type { StickerPack, StickerPackItem } from '../../shared/sticker-packs'
import { maxStickerPackItems, maxStickerPackTitle, validStickerId } from '../../shared/sticker-packs'
import { identifier } from '../../shared/validation'
import { childId, documents, stringField, type FirestoreDocument, type WireObject } from './firestore-values'
import type { FirestoreReader } from './firestore-rpc'

const kinds = new Set(['png', 'gif', 'mp4'])

// stickerSets/{setId} as iOS MorseStickerSet.init(id:data:) reads it; a sticker whose path is not under this
// set's Storage folder is dropped, as iOS does.
export function stickerPackFromDocument(doc: FirestoreDocument): StickerPack | null {
  const id = childId(doc.name, `${documents}/stickerSets`)
  const ownerUid = stringField(doc.fields, 'ownerUid', 160), title = stringField(doc.fields, 'title', maxStickerPackTitle)
  if (!ownerUid || !title) return null
  const raw = (doc.fields.stickers as { arrayValue?: { values?: unknown } } | undefined)?.arrayValue?.values
  const items: StickerPackItem[] = []
  for (const value of Array.isArray(raw) ? raw.slice(0, maxStickerPackItems) : []) {
    const fields = (value as { mapValue?: { fields?: Record<string, WireObject> } })?.mapValue?.fields
    if (!fields) continue
    const itemId = stringField(fields, 'id', 64), kind = stringField(fields, 'kind', 3), path = stringField(fields, 'path', 400)
    if (!validStickerId(itemId) || !kinds.has(kind) || path !== `sticker_sets/${id}/${itemId}.${kind}`) continue
    const bytes = Number(fields.bytes?.integerValue ?? 0)
    items.push({ id: itemId, kind: kind as StickerPackItem['kind'], path, emoji: stringField(fields, 'emoji', 32), bytes: Number.isSafeInteger(bytes) && bytes > 0 ? bytes : 0 })
  }
  return { id, ownerUid, ownerName: stringField(doc.fields, 'ownerName', 50), title, items }
}

export async function readStickerPack(reader: FirestoreReader, setId: string, signal: AbortSignal, validate: () => void): Promise<StickerPack | null> {
  const doc = await reader.getDocument(`${documents}/stickerSets/${identifier(setId)}`, signal, validate)
  return doc ? stickerPackFromDocument(doc) : null
}

// iOS MorseStickerSetStore.resolveSet(forStickerData:): the bytes' SHA-256 → stickerIndex → the set.
export async function resolveStickerPack(reader: FirestoreReader, hash: string, signal: AbortSignal, validate: () => void): Promise<{ pack: StickerPack; item: StickerPackItem } | null> {
  if (!validStickerId(hash)) return null
  const entry = await reader.getDocument(`${documents}/stickerIndex/${hash}`, signal, validate)
  if (!entry) return null
  const setId = stringField(entry.fields, 'setId', 160)
  if (!setId) return null
  const pack = await readStickerPack(reader, setId, signal, validate)
  const item = pack?.items.find(candidate => candidate.id === hash)
  return pack && item ? { pack, item } : null
}

// users/{uid}/stickerSets, newest install first (iOS MorseStickerSetStore.refresh).
export async function installedStickerPackIds(reader: FirestoreReader, uid: string, signal: AbortSignal): Promise<string[]> {
  const rows = await reader.query(`${documents}/users/${identifier(uid)}`, {
    from: [{ collectionId: 'stickerSets' }],
    orderBy: [{ field: { fieldPath: 'installedAt' }, direction: 'DESCENDING' }, { field: { fieldPath: '__name__' }, direction: 'DESCENDING' }],
    limit: { value: 80 }
  }, signal)
  const ids: string[] = []
  for (const row of rows) {
    try { ids.push(identifier(childId(row.name, `${documents}/users/${uid}/stickerSets`))) } catch { /* not an id */ }
  }
  return ids
}
