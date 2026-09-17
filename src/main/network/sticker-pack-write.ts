import { documents, type WireObject } from './firestore-values'
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
