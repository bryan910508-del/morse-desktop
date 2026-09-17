import type { StickerKind } from './stickers'

// iOS MorseStickerSet (MorseStickerSets.swift): a sticker set is a Firestore document stickerSets/{setId}
// with the creator, a title and up to 120 stickers, each named by the SHA-256 of its bytes and stored at
// Storage sticker_sets/{setId}/{sha256}.{png|gif|mp4}. A received sticker finds its set through
// stickerIndex/{sha256}; the account's installed sets are users/{uid}/stickerSets/{setId}.
// Telegram: StickerPackCollectionInfo + StickerPackItem, opened by StickerPackScreen.
export interface StickerPackItem { id: string; kind: StickerKind; path: string; emoji: string; bytes: number }
export interface StickerPack { id: string; ownerUid: string; ownerName: string; title: string; items: StickerPackItem[] }
export interface StickerPackSnapshot {
  status: 'loading' | 'ready' | 'none' | 'error'
  // The chat the sticker was tapped in; a sticker chosen in the sheet is sent there.
  chatId: string | null
  pack: StickerPack | null
  // The sticker that opened the sheet.
  highlighted: string | null
  installed: boolean
  busy: boolean
  message: string
}
export const maxStickerPackItems = 120
export const maxStickerPackTitle = 64
export const stickerPackItemURL = (setId: string, itemId: string): string => `morse://app/__sticker-pack/${setId}/${itemId}`
export const validStickerId = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)
