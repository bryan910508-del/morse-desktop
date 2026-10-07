import { Layers, Send, Star, StarOff, Trash2 } from 'lucide-react'
import type { StickerItem } from '../../../shared/stickers'
import type { StickerPack, StickerPackItem } from '../../../shared/sticker-packs'
import type { MenuEntry } from '../ui/popup-menu'
import { confirmBox } from '../ui/layers'
import { controller } from '../app/ui'
import { errorText } from '../app/format'
import { tr } from '../../../shared/i18n'
import { showStickerPackSheetById as openStickerPackSheet } from './sticker-pack-sheet'

// B208: the sticker menus of tdesktop's panel and set box, shared by the entity panel and the set sheet.
const failed = (reason: unknown): void => controller.toast(errorText(reason, tr('처리하지 못했습니다. 다시 시도해 주세요.')), 'error')

// A favourite (this device's library): send it, or take it out (StickersListWidget::fillContextMenu,
// stickers_list_widget.cpp:2618-2705 — «Send», «Remove from Favorites»).
export function favouriteStickerMenu(accountUid: string, item: StickerItem, send: () => void): MenuEntry[] {
  return [
    { label: tr('보내기'), icon: <Send size={18} />, onSelect: send },
    { label: tr('즐겨찾기에서 삭제'), icon: <StarOff size={18} />, danger: true, onSelect: () => { void window.morse.removeSticker(accountUid, item.id).catch(failed) } }
  ]
}

// A set's sticker: send it, keep it in the favourites, open its set, and — in a set this account made — take it out
// (the same menu, :2675-2688; the own set's «Delete», sticker_set_box.cpp:1903-1929).
export function packStickerMenu(accountUid: string, pack: StickerPack, item: StickerPackItem, send: (() => void) | null, openSet: boolean): MenuEntry[] {
  return [
    send && { label: tr('보내기'), icon: <Send size={18} />, onSelect: send },
    { label: tr('즐겨찾기에 추가'), icon: <Star size={18} />, onSelect: () => { void window.morse.savePackSticker(accountUid, pack.id, item.id).then(() => controller.toast(tr('즐겨찾기에 저장했어요'))).catch(failed) } },
    openSet && { label: tr('스티커팩 보기'), icon: <Layers size={18} />, onSelect: () => openStickerPackSheet(accountUid, pack.id) },
    pack.ownerUid === accountUid && { label: tr('스티커팩에서 빼기'), icon: <Trash2 size={18} />, danger: true, onSelect: () => { void removeFromPack(accountUid, pack, item) } }
  ]
}

// A set on the panel's strip: open it, and delete it when this account made it or remove it otherwise
// (FillStickerSetContextMenu, stickers_list_widget.cpp:2723; «Delete pack», sticker_set_box.cpp:936-980).
export function stickerSetMenu(accountUid: string, pack: StickerPack): MenuEntry[] {
  return [
    { label: tr('스티커팩 보기'), icon: <Layers size={18} />, onSelect: () => openStickerPackSheet(accountUid, pack.id) },
    pack.ownerUid === accountUid
      ? { label: tr('스티커팩 삭제'), icon: <Trash2 size={18} />, danger: true, onSelect: () => { void deletePack(accountUid, pack) } }
      : { label: tr('스티커팩 제거'), icon: <Trash2 size={18} />, danger: true, onSelect: () => { void window.morse.uninstallStickerPack(accountUid, pack.id).then(() => controller.toast(tr('스티커팩을 제거했습니다.'))).catch(failed) } }
  ]
}

export async function removeFromPack(accountUid: string, pack: StickerPack, item: StickerPackItem): Promise<boolean> {
  if (!await confirmBox({ title: tr('스티커팩에서 빼기'), text: tr('«{0}»에서 이 스티커를 뺄까요? 이 스티커팩을 추가한 모든 사람에게서 빠져요.', [pack.title]), confirm: tr('빼기'), danger: true })) return false
  try { await window.morse.removeFromStickerPack(accountUid, pack.id, item.id); controller.toast(tr('스티커팩에서 뺐어요')); return true }
  catch (reason) { failed(reason); return false }
}

export async function deletePack(accountUid: string, pack: StickerPack): Promise<boolean> {
  if (!await confirmBox({ title: tr('스티커팩 삭제'), text: tr('«{0}»을(를) 삭제할까요? 이 스티커팩을 추가한 모든 사람에게서도 사라지고, 되돌릴 수 없어요.', [pack.title]), confirm: tr('삭제'), danger: true })) return false
  try { await window.morse.deleteStickerPack(accountUid, pack.id); controller.toast(tr('스티커팩을 삭제했어요')); return true }
  catch (reason) { failed(reason); return false }
}
