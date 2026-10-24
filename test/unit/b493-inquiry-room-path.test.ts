import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { ChannelInquiries } from '../../src/main/accounts/channel-inquiries'
import type { ReadCredentials, WatchEvents } from '../../src/main/network/firestore-rpc'
import { documents, type FirestoreDocument } from '../../src/main/network/firestore-values'
import { controller, ui } from '../../src/renderer/src/app/ui'

// B493 (iOS found two gaps on the inquiry room's path). Telegram Desktop shows a chat already on screen without opening
// it again (MainWidget::showHistory, mainwidget.cpp:1508-1538, :1578-1631), and closes a chat that is gone from the
// windows showing it — that chat alone, with the third column that goes with it (Application::closeChatFromWindows,
// core/application.cpp:1740-1761; mainwidget.cpp:3037-3039).
const fresh = () => controller.resetAccount()

test('a chat already shown is not opened again: what is beside it stays and the composer takes the focus', () => {
  fresh()
  controller.openChat('c1'); controller.setRight('search')
  const focus = ui().composerFocus
  controller.openChat('c1')
  assert.deepEqual([ui().chatId, ui().right, ui().composerFocus], ['c1', 'search', focus + 1])
  controller.openPersonInfo('u2')
  controller.openChat('c1')
  assert.equal(ui().right, 'person', 'a person opened beside it stays')
  controller.openChat('c2')
  assert.deepEqual([ui().chatId, ui().right], ['c2', null], 'another chat opens as before')
})

test('a room already on screen stays as it is, in the main column or beside its channel', () => {
  fresh()
  controller.openInquiryRoom('ch1', 'ch1_sub1'); controller.openPersonInfo('sub1')
  const before = ui()
  controller.openInquiryRoom('ch1', 'ch1_sub1')
  assert.equal(ui().right, 'person', 'the panel beside the room stays')
  assert.equal(ui().inquiry, before.inquiry, 'the room is not opened again')
  // Beside its channel, as the channel's third column (and under a person opened from it).
  fresh()
  controller.openChannel('ch1'); controller.openChannelInquiry('ch1', 'ch1_sub1')
  controller.openInquiryRoom('ch1', 'ch1_sub1')
  assert.deepEqual([ui().channelId, ui().right, ui().inquiry?.thread], ['ch1', 'inquiry', 'ch1_sub1'], 'not moved to the main column')
  controller.openPersonInfo('sub1')
  controller.openInquiryRoom('ch1', 'ch1_sub1')
  assert.deepEqual([ui().channelId, ui().right], ['ch1', 'person'])
  // Another room opens as before.
  controller.openInquiryRoom('ch1', 'ch1_sub2')
  assert.deepEqual([ui().channelId, ui().right, ui().inquiry?.thread], [null, null, 'ch1_sub2'])
})

test('a deleted room closes, and only it', () => {
  // In the main column: the room and the panel beside it.
  fresh()
  controller.openInquiryRoom('ch1', 'ch1_sub1'); controller.openPersonInfo('sub1')
  controller.closeInquiryRoom('ch1_sub2')
  assert.equal(ui().inquiry?.thread, 'ch1_sub1', 'another room\'s deletion changes nothing')
  controller.closeInquiryRoom('ch1_sub1')
  assert.deepEqual([ui().inquiry, ui().right, ui().person], [null, null, null])
  // The owner's list in the main column: back to the list.
  fresh()
  controller.openInquiryRoom('ch1', null); controller.setInquiryThread('ch1_sub1')
  controller.closeInquiryRoom('ch1_sub1')
  assert.deepEqual([ui().inquiry?.thread, ui().inquiry?.fromList, ui().right], [null, true, null])
  // A channel's third column: that column alone, the channel stays.
  fresh()
  controller.openChannel('ch1'); controller.openChannelInquiry('ch1', 'ch1_sub1'); controller.openPersonInfo('sub1')
  controller.closeInquiryRoom('ch1_sub1')
  assert.deepEqual([ui().channelId, ui().inquiry, ui().right, ui().person], ['ch1', null, null, null])
  // The owner's list beside the channel: back to that list.
  fresh()
  controller.openChannel('ch1'); controller.openChannelInquiry('ch1', null); controller.setInquiryThread('ch1_sub1')
  controller.closeInquiryRoom('ch1_sub1')
  assert.deepEqual([ui().channelId, ui().right, ui().inquiry?.thread], ['ch1', 'inquiry', null])
  // The channel's information shown over a room not on screen: it stays.
  fresh()
  controller.openChannel('ch1'); controller.openChannelInquiry('ch1', 'ch1_sub1'); controller.setRight('info')
  controller.closeInquiryRoom('ch1_sub1')
  assert.deepEqual([ui().channelId, ui().right, ui().inquiry], ['ch1', 'info', null])
})

const at = { seconds: '1790121600', nanos: 0 }
test('the open room\'s document going away marks it gone, once; until then it is not', async () => {
  const room = `${documents}/channelInquiries/ch-a_me`
  const roomDoc = { name: room, updateTime: at, createTime: at, fields: { channelOwnerId: { stringValue: 'owner1' }, subscriberId: { stringValue: 'me' },
    channelId: { stringValue: 'ch-a' }, channelName: { stringValue: '채널' } } } as unknown as FirestoreDocument
  const watches: { target: { documents?: { documents: string[] } }; events: WatchEvents }[] = []
  const reader = { getDocument: async () => roomDoc, watch: (target: { documents?: { documents: string[] } }, _signal: AbortSignal, events: WatchEvents) => { watches.push({ target, events }); return () => {} } }
  const credentials: ReadCredentials = { signal: new AbortController().signal, authorize: async () => { throw new Error('offline') } }
  let changes = 0
  const inquiries = new ChannelInquiries('me', credentials, () => {}, () => ({ authorName: '나', authorPhotoURL: null }), () => true, () => { changes++ }, async () => {}, async () => {})
  ;(inquiries as unknown as { reader: unknown }).reader = reader
  inquiries.openThread({ requestId: '3f2504e0-4f89-41d3-9a0c-0305e82c3301', inquiryId: 'ch-a_me' })
  await new Promise(resolve => setImmediate(resolve))
  const roomWatch = watches.find(watch => watch.target.documents?.documents[0] === room)
  assert.ok(roomWatch, 'the room document is followed')
  roomWatch.events.snapshot(new Map([[room, roomDoc]]))
  assert.equal(inquiries.snapshot?.thread?.gone, undefined)
  const before = changes
  roomWatch.events.snapshot(new Map())
  roomWatch.events.snapshot(new Map())
  assert.equal(inquiries.snapshot?.thread?.gone, true)
  assert.equal(changes, before + 1, 'told once')
})

test('the room closes itself when gone, the list\'s delete closes it first, and B484 still takes its queue', () => {
  const read = (path: string) => readFileSync(join(__dirname, '../../src', path), 'utf8')
  const panel = read('renderer/src/channels/channel-inquiry-panel.tsx'), list = read('renderer/src/dialogs/dialogs-widget.tsx'), sends = read('main/accounts/inquiry-sends.ts')
  assert.match(panel, /const gone = thread\?\.gone === true\n  useEffect\(\(\) => \{ if \(gone\) controller\.closeInquiryRoom\(inquiryId\) \}, \[gone, inquiryId\]\)/)
  // B495 moved the delete into one shared function (inquiry-delete.ts); the list's row uses it.
  const shared = readFileSync(join(__dirname, '../../src/renderer/src/channels/inquiry-delete.ts'), 'utf8')
  assert.match(shared, /confirm: tr\('모두에게 삭제'\), danger: true \}\)\) return\n  controller\.closeInquiryRoom\(inquiryId\)\n  try \{/)
  assert.match(list, /await deleteInquiryRoom\(accountUid, inquiry\.inquiryId, inquiry\.title\)/)
  assert.match(sends, /NOT_FOUND/, 'a send answered «not found» still lets its room go (B484)')
  assert.match(sends, /forgetGoneRooms/)
})
