import type { StickerItem } from '../../../shared/stickers'

// B-menu-now: whether a sticker message is a favourite, known when its menu is made (tdesktop decides «Add to Favorites» /
// «Remove from Favorites» from the document at once, history_view_context_menu.cpp:480-489). Its id is learned once per
// message as the pointer comes over it (its bytes are hashed in main); the favourites themselves are the snapshot's list.
// Not learned yet, the menu offers the add, which for a favourite only moves it to the front.
const ids = new Map<string, string>(), asking = new Set<string>()
const maxIds = 500
const keyOf = (accountUid: string, chatId: string, messageId: string, version: string): string => `${accountUid}\n${chatId}\n${messageId}\n${version}`
export function learnStickerId(accountUid: string, chatId: string, messageId: string, version: string | undefined): void {
  if (!version) return
  const key = keyOf(accountUid, chatId, messageId, version)
  if (ids.has(key) || asking.has(key)) return
  asking.add(key)
  void window.morse.stickerMessageFavourite(accountUid, chatId, messageId, version)
    .then(answer => { if (ids.size >= maxIds) ids.delete(ids.keys().next().value!); ids.set(key, answer.id) }, () => {})
    .finally(() => asking.delete(key))
}
export function stickerFavouriteNow(accountUid: string, chatId: string, messageId: string, version: string | undefined, faved: StickerItem[] | null | undefined): { id: string; favourite: boolean } | null {
  const id = version ? ids.get(keyOf(accountUid, chatId, messageId, version)) : undefined
  if (!id) { learnStickerId(accountUid, chatId, messageId, version); return null }
  return { id, favourite: (faved ?? []).some(item => item.id === id) }
}
