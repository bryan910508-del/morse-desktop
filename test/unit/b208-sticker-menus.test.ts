import assert from 'node:assert/strict'
import { test } from 'node:test'
import { favouriteStickerMenu, packStickerMenu, stickerSetMenu } from '../../src/renderer/src/history/sticker-actions'
import type { MenuAction, MenuEntry } from '../../src/renderer/src/ui/popup-menu'
import type { StickerPack } from '../../src/shared/sticker-packs'

// B208: every sticker of the panel has a menu (tdesktop StickersListWidget::fillContextMenu), and a set this account
// made offers what only its owner may do.
const labels = (entries: MenuEntry[]) => entries.filter((entry): entry is MenuAction => Boolean(entry) && entry !== 'separator').map(entry => entry.label)
const item = { id: 'a'.repeat(64), kind: 'png' as const, path: 'sticker_sets/s/x.png', emoji: '', bytes: 1 }
const pack = (ownerUid: string): StickerPack => ({ id: 'set1', ownerUid, ownerName: '', title: 'P', items: [item] })

test('a favourite: send or take it out of the favourites', () => {
  assert.deepEqual(labels(favouriteStickerMenu('me', { id: 'b'.repeat(64), kind: 'png', size: 1, url: '' }, () => {})), ['보내기', '즐겨찾기에서 삭제'])
})

test('a set\'s sticker: send, keep, open its set — and take it out only from a set this account made', () => {
  assert.deepEqual(labels(packStickerMenu('me', pack('me'), item, () => {}, true)), ['보내기', '즐겨찾기에 추가', '스티커팩 보기', '스티커팩에서 빼기'])
  assert.deepEqual(labels(packStickerMenu('me', pack('other'), item, () => {}, true)), ['보내기', '즐겨찾기에 추가', '스티커팩 보기'])
  assert.deepEqual(labels(packStickerMenu('me', pack('me'), item, null, false)), ['즐겨찾기에 추가', '스티커팩에서 빼기'], 'in the sheet with no chat: nothing to send to, the set already open')
})

test('a set on the strip: delete it when this account made it, else remove it', () => {
  assert.deepEqual(labels(stickerSetMenu('me', pack('me'))), ['스티커팩 보기', '스티커팩 삭제'])
  assert.deepEqual(labels(stickerSetMenu('me', pack('other'))), ['스티커팩 보기', '스티커팩 제거'])
})
