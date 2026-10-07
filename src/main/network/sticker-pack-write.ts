import { documents, type FirestoreDocument, type WireObject } from './firestore-values'
import type { StickerPackItem } from '../../shared/sticker-packs'

// The creator's writes of iOS MorseStickerSetStore (Telegram createStickerSet / addStickerToStickerSet), built apart
// so tests can send them through the real Firestore descriptor. firestore.rules validStickerSetDoc: ownerUid is
// the writer, a title of at most 64, stickers a list of at most 120 and count an int.
export function ownedStickerPacksQuery(uid: string, limit: number): WireObject {
  return { from: [{ collectionId: 'stickerSets' }], where: { fieldFilter: { field: { fieldPath: 'ownerUid' }, op: 'EQUAL', value: { stringValue: uid } } }, limit: { value: limit } }
}
export function stickerPackCreateWrite(setId: string, uid: string, ownerName: string, title: string): WireObject {
  return {
    update: { name: `${documents}/stickerSets/${setId}`, fields: {
      ownerUid: { stringValue: uid }, ownerName: { stringValue: ownerName }, title: { stringValue: title },
      stickers: { arrayValue: { values: [] } }, count: { integerValue: '0' }
    } },
    updateTransforms: [{ fieldPath: 'createdAt', setToServerValue: 'REQUEST_TIME' }, { fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' }],
    currentDocument: { exists: false }
  }
}
// MorseStickerSet.itemFields: id, kind, path, emoji, bytes.
export function stickerPackItemValue(item: StickerPackItem): WireObject {
  return { mapValue: { fields: { id: { stringValue: item.id }, kind: { stringValue: item.kind }, path: { stringValue: item.path }, emoji: { stringValue: item.emoji }, bytes: { integerValue: String(item.bytes) } } } }
}
// addSticker: stickers arrayUnion, count increment, updatedAt serverTimestamp.
export function stickerPackAddWrite(setId: string, item: StickerPackItem): WireObject {
  return { transform: { document: `${documents}/stickerSets/${setId}`, fieldTransforms: [
    { fieldPath: 'stickers', appendMissingElements: { values: [stickerPackItemValue(item)] } },
    { fieldPath: 'count', increment: { integerValue: '1' } },
    { fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' }
  ] }, currentDocument: { exists: true } }
}
// stickerIndex/{sha256}: created once; another set that already claims the bytes keeps them.
export function stickerIndexCreateWrite(hash: string, setId: string, uid: string): WireObject {
  return { update: { name: `${documents}/stickerIndex/${hash}`, fields: { setId: { stringValue: setId }, ownerUid: { stringValue: uid } } },
    updateTransforms: [{ fieldPath: 'createdAt', setToServerValue: 'REQUEST_TIME' }], currentDocument: { exists: false } }
}

const readVersion = (doc: FirestoreDocument): WireObject => doc.updateTime ? { updateTime: doc.updateTime } : { exists: true }
// removeSticker (iOS MorseStickerSets.removeSticker; tdesktop's «Delete» in its own set's box, sticker_set_box.cpp:1903-1929):
// the set's list without the sticker and its count, written over the version that was read. iOS removes the item with
// arrayRemove, which matches only when every stored value — each number's type included — equals the one sent; the
// list as stored, less the sticker, is the same result without that risk, and a change since the read is not lost.
export function stickerPackRemoveWrite(doc: FirestoreDocument, itemId: string): WireObject | null {
  const raw = (doc.fields.stickers as { arrayValue?: { values?: unknown[] } } | undefined)?.arrayValue?.values
  const values = Array.isArray(raw) ? raw : []
  const itemOf = (value: unknown): string | undefined => (value as { mapValue?: { fields?: { id?: { stringValue?: string } } } })?.mapValue?.fields?.id?.stringValue
  const kept = values.filter(value => itemOf(value) !== itemId)
  if (kept.length === values.length) return null
  return {
    update: { name: doc.name, fields: { stickers: { arrayValue: { values: kept } }, count: { integerValue: String(kept.length) } } },
    updateMask: { fieldPaths: ['stickers', 'count'] },
    updateTransforms: [{ fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' }],
    currentDocument: readVersion(doc)
  }
}
// stickerIndex/{sha256}: let go only while it still names this set (another set may hold the same bytes).
export function stickerIndexDeleteWrite(index: FirestoreDocument): WireObject {
  return { delete: index.name, currentDocument: readVersion(index) }
}
// deleteSet: the set itself, as it was read.
export function stickerPackDeleteWrite(doc: FirestoreDocument): WireObject {
  return { delete: doc.name, currentDocument: readVersion(doc) }
}
