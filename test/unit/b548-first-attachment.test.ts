import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { prepareChatMediaRequest } from '../../src/main/network/media-upload-api'

// B548 (reports/desktop/2026-11-05-new-direct-first-attachment-plan.md): a new 1:1 not made yet takes a picture or a file
// as its first message. tdesktop asks only what the person may receive, never whether the history is empty
// (history_widget.cpp:697-704, data_chat_participant_status.cpp:249-253); the phones make the room first through
// prepareMorseChatMedia with the peer, which the server already does (morse-release-authority.js:597-613).
test('B548: the upload asks the server to make the room only for a new 1:1, naming its peer, type and auto-delete', () => {
  assert.deepEqual(prepareChatMediaRequest('dm_a_b', 'a'), { chatId: 'dm_a_b', expectedUid: 'a' }, 'a room that exists: as before')
  assert.deepEqual(prepareChatMediaRequest('dm_a_b', 'a', { peerUid: 'b' }), { chatId: 'dm_a_b', expectedUid: 'a', peerUid: 'b', chatType: 'direct' })
  assert.deepEqual(prepareChatMediaRequest('dm_a_b', 'a', { peerUid: 'b', autoDeleteSeconds: 86400 }),
    { chatId: 'dm_a_b', expectedUid: 'a', peerUid: 'b', chatType: 'direct', autoDeleteSeconds: 86400, autoDeleteMyOnly: false })
  const api = readFileSync('src/main/network/media-upload-api.ts', 'utf8')
  assert.match(api, /callMorseFunction\(auth, 'prepareMorseChatMedia', prepareChatMediaRequest\(upload\.chatId, uid, create\)/)
})

const outbox = readFileSync('src/main/messaging/outbox.ts', 'utf8')
const body = (start: string, end: string): string => outbox.slice(outbox.indexOf(start), outbox.indexOf(end, outbox.indexOf(start)))
test('B548: a pending direct (never secret) is a target for pick, drop, paste, preview, edits and the send; the old «text first» refusal is gone', () => {
  assert.match(outbox, /private attachable\(chatId: string\): boolean \{\n    return \(this\.context\(\)\.dialogs\.has\(chatId\) \|\| this\.pending\.has\(chatId\)\) && this\.eligible\(chatId\)/)
  for (const call of ['this.staging.pick(chatId, mode, () => this.attachable(chatId), choose)', 'this.staging.drop(chatId, paths, mode, () => this.attachable(chatId))',
    'this.staging.receive(chatId, items, () => this.attachable(chatId))', 'return this.attachable(chatId) ? this.staging.response(chatId, path, request)'])
    assert.ok(outbox.includes(call), call)
  assert.doesNotMatch(outbox, /첫 텍스트 메시지를 보낸 뒤 첨부할 수 있습니다/)
  const pressed = body('  private async enqueuePressed(', '  pause(): void {')
  assert.equal((pressed.match(/!this\.attachable\(chatId\)/g) ?? []).length, 2, 'both checks of the send')
})
test('B548: into a pending direct the message names its peer, as a first text does, and the first upload makes the room', () => {
  const pressed = body('  private async enqueuePressed(', '  pause(): void {')
  assert.match(pressed, /const pendingDirect = this\.context\(\)\.dialogs\.has\(chatId\) \? undefined : this\.pending\.get\(chatId\)/)
  assert.match(pressed, /wire\.peerUid = pendingDirect\.peerUid; wire\.chatType = 'direct'/)
  assert.match(pressed, /const policy = this\.newChatAutoDelete\(\)/)
  assert.match(outbox, /signal, Boolean\(part\.url\), this\.directCreation\(intent\.chatId, intent\.wire\)\)/)
  const creation = body('  private directCreation(', '  private active(')
  assert.match(creation, /if \(!pending \|\| this\.context\(\)\.dialogs\.has\(chatId\)\) return undefined/, 'once the room is there, nothing to make')
  assert.match(outbox, /\/\/ A first message naming its peer \(text, or B548 a picture or a file\) goes only into that peer's 1:1\.\n      if \(intent\.wire\.peerUid && this\.context\(\)\.dialogs\.has\(intent\.chatId\) &&/)
})
test('B548: stickers, voice and round videos still wait for the chat (out of this change, as Android keeps them)', () => {
  assert.match(outbox, /첫 텍스트 메시지를 보낸 뒤 스티커를 보낼 수 있습니다/)
  assert.match(outbox, /첫 텍스트 메시지를 보낸 뒤 영상 메시지를 보낼 수 있습니다/)
  assert.match(outbox, /voiceCaptureAccess\(chatId:string\):void\{if\(!this\.context\(\)\.dialogs\.has\(chatId\)/)
})
test('B548: the session takes the open chat or a pending direct for attachments; the window opens attach, drop and paste only', () => {
  const session = readFileSync('src/main/accounts/session.ts', 'utf8')
  assert.match(session, /private attachTarget\(chatId: string\): boolean \{\n    if \(this\.selected\?\.dialog\.summary\.id === chatId\) return true\n    if \(!this\.delivery\.isPendingDirect\(chatId\)\) return false/)
  for (const name of ['pickAttachment', 'dropAttachments', 'pasteAttachments', 'restoreAttachmentImage', 'editAttachmentVideo', 'pressAttachment'])
    assert.match(session.slice(session.indexOf(`  ${name}(`), session.indexOf(`  ${name}(`) + 400), /!this\.attachTarget\(chatId\)/, name)
  const compose = readFileSync('src/renderer/src/history/compose.tsx', 'utf8')
  assert.match(compose, /const canAttachFiles = loaded && outgoing\.canCompose && !editing && Boolean\(dialog \|\| pending\) && !secret/)
  assert.match(compose, /aria-label=\{tr\('첨부'\)\} disabled=\{!canAttachFiles\}/)
  assert.match(compose, /if \(!files\.length \|\| !canAttachFiles \|\| editing\) return/)
  assert.match(compose, /onSticker=\{item => \{ if \(!editing && canAttach\)/, 'stickers keep the old rule')
  assert.match(compose, /<RecordButton choice=\{record\} disabled=\{!canAttach\}/, 'voice keeps the old rule')
  assert.match(compose, /!pending && \{ label: tr\('일정 만들기'\)/)
  const widget = readFileSync('src/renderer/src/history/history-widget.tsx', 'utf8')
  assert.match(widget, /const canAttach = Boolean\(dialog \|\| pending\) && !secret && outgoing\.canCompose && !editing/)
})
