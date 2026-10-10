import type { StickerDraw } from '../../shared/stickers'

// B264 (tdesktop api_sending.cpp:182 SendExistingMedia → :284 addNewLocalMessage({…}, media, caption)): a sticker this
// device sends is drawn as that sticker from the moment it is sent — the local message holds the document — and the
// server's copy keeps the same picture instead of loading it again. Here: the address each sent message was drawn from,
// by message id, so the sending row and the bubble the server's copy becomes use the bytes already on this device.
// Memory only, for this run (a restart draws a waiting sticker by its label until the server's copy comes); the newest
// few hundred are kept, as a session sends no more than that before they are answered.
const keep = 300
export class StickerDraws {
  private readonly draws = new Map<string, StickerDraw>()
  note(messageId: string, draw: StickerDraw): void {
    this.draws.delete(messageId)
    this.draws.set(messageId, draw)
    while (this.draws.size > keep) this.draws.delete(this.draws.keys().next().value!)
  }
  forget(messageId: string): void { this.draws.delete(messageId) }
  get(messageId: string): StickerDraw | null { return this.draws.get(messageId) ?? null }
  // The rows of a sending list, each sticker of this device with its picture.
  decorate<T extends { id: string }>(items: T[]): (T & { sticker?: StickerDraw })[] {
    if (!this.draws.size) return items
    return items.map(item => { const draw = this.draws.get(item.id); return draw ? { ...item, sticker: draw } : item })
  }
  clear(): void { this.draws.clear() }
}
