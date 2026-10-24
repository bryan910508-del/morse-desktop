import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { chatGone } from '../../src/renderer/src/window/chat-gone'

const read = (path: string) => readFileSync(join(__dirname, '../../src', path), 'utf8')

// B495: the owner deletes an inquiry room too — from its «1:1 문의» list and from the room's «더 보기» — the one way the
// asking side's chat-list row already does: the same question, «모두에게 삭제», and the same server path (main
// deleteRoom: the history through clearMorseInquiryHistory, then the room document both sides may remove).
test('every «문의 삭제» goes one way: asked first, the room closed here first, then deleted for both', () => {
  const shared = read('renderer/src/channels/inquiry-delete.ts')
  assert.match(shared, /confirmBox\(\{ title, text: tr\('이 문의를 삭제하면 상대방의 목록과 기록에서도 사라지고 되돌릴 수 없어요\.'\), confirm: tr\('모두에게 삭제'\), danger: true \}\)\) return\n  controller\.closeInquiryRoom\(inquiryId\)\n/)
  assert.match(shared, /window\.morse\.deleteInquiryRoom\(accountUid, inquiryId\)/)
  const list = read('renderer/src/dialogs/dialogs-widget.tsx'), panel = read('renderer/src/channels/channel-inquiry-panel.tsx')
  assert.match(list, /await deleteInquiryRoom\(accountUid, inquiry\.inquiryId, inquiry\.title\)/, 'the asking side\'s row')
  assert.doesNotMatch(list, /window\.morse\.deleteInquiryRoom/, 'no second way of its own')
  assert.match(panel, /className="inquiry-row" onClick=\{\(\) => showInquiryThread\(channelId, item\.id\)\}\n    onContextMenu=\{event => \{ event\.preventDefault\(\); popupMenu\.open\(pointFor\(event, event\.currentTarget\), \[\n      \{ label: tr\('문의 삭제'\), icon: <Trash2 size=\{18\} \/>, danger: true, onSelect: \(\) => \{ void deleteInquiryRoom\(accountUid, item\.id, item\.peerName\) \} \}\]\) \}\}>/, 'the owner\'s list row')
  assert.match(panel, /\{ label: tr\('문의 삭제'\), icon: <Trash2 size=\{18\} \/>, danger: true, onSelect: \(\) => \{ void deleteInquiryRoom\(accountUid, inquiryId, thread\?\.title \|\| tr\('1:1 문의'\)\) \} \}/, 'the room\'s menu, either side')
  const main = read('main/accounts/channel-inquiries.ts')
  assert.match(main, /async deleteRoom\(inquiryId: string\)[\s\S]*?decodeInquiry\(doc, this\.uid\)[\s\S]*?clearMorseInquiryHistory[\s\S]*?reader\.deleteInquiryRoom\(inquiryId, this\.signal\(\)\)/, 'one server path for both sides')
})

// B493c (three apps' rule; tdesktop calls closeChatFromWindows only when this account leaves the chat — data_chat.cpp:
// 136-146 — or deletes it in this window — delete_messages_box.cpp:567-572): a chat this account is no longer in closes;
// one deleted on this account's other device, or emptied by the other side, leaves the list and stays open, empty.
test('a chat on screen closes only when this account is no longer in it', () => {
  const session = read('main/accounts/session.ts'), store = read('renderer/src/app/store.ts')
  // Deleted on another device (this account's own historyClears, removeRow) or emptied for everyone: out of the list,
  // still in the account's dialogs, so the open one becomes the open unlisted dialog.
  assert.match(session, /filter\(summary => !this\.hiddenChats\.hides\(summary\) && !unlisted\.has\(summary\.id\)\)/)
  assert.match(session, /const openId = this\.selected\?\.dialog\.summary\.id\n    if \(openId && index\.has\(openId\) && !this\.list\.some\(dialog => dialog\.id === openId\)\) this\.unlistedOpen = openId/)
  assert.match(store, /snapshot\.dialogs\.find\(item => item\.id === chatId\) \?\? snapshot\.openDialogs\.find\(item => item\.id === chatId\)/)
  assert.equal(chatGone(true, { listReady: true, present: true, pending: false }), false, 'open unlisted: stays')
  // No longer in it (removed, the group deleted, a secret chat ended): not among the account's dialogs at all.
  assert.match(session, /if \(this\.unlistedOpen && \(!index\.has\(this\.unlistedOpen\)/)
  assert.equal(chatGone(true, { listReady: true, present: false, pending: false }), true, 'left: closes')
})
