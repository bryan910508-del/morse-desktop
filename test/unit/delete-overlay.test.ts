import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { ChatMessage } from '../../src/shared/model'

// B101 (§34, user rule «텔레그램 구조»): «delete for everyone» hides the bubble at once, before the server answers
// (message-overlay.ts mutate), and keeps it hidden whatever else moves on the server copy meanwhile (a reaction, an
// edit, a read mark) until the delete lands, as tdesktop destroys the item in the same pass as the request
// (data_histories.cpp:1019-1030) and puts nothing back when the request fails (:797-801 — B165).
const pending: (() => void)[] = []
;(globalThis as unknown as { window: unknown }).window = { morse: { mutateMessage: () => new Promise<void>(resolve => { pending.push(resolve) }) } }

const message = (version: string): ChatMessage => ({ id: 'm1', chatId: 'chat1', senderId: 'me', text: 's43e2', version } as unknown as ChatMessage)

test('B101: a deleted bubble is hidden at once, before the server answers', async () => {
  const { deleteMessage, overlayMessage } = await import('../../src/renderer/src/history/message-overlay')
  void deleteMessage('me', message('v1'))
  assert.equal(overlayMessage(message('v1')), null, 'hidden while the delete is on its way')
  pending.splice(0).forEach(resolve => resolve())
})

test('B101: a version that moves before the delete lands keeps the bubble gone; the copy going ends the hiding', async () => {
  const { deleteMessage, overlayMessage, reconcileMessages } = await import('../../src/renderer/src/history/message-overlay')
  void deleteMessage('me', message('v1'))
  assert.equal(overlayMessage(message('v1')), null)
  // Someone reacts (or the message is read) before the server has the delete: the room's copy moves to v2.
  reconcileMessages('chat1', [message('v2')])
  assert.equal(overlayMessage(message('v2')), null, 'still gone, as in Telegram')
  // The delete lands: the copy leaves the history, and the hiding with it.
  reconcileMessages('chat1', [])
  assert.notEqual(overlayMessage(message('v3')), null, 'nothing hidden any more for this id')
  pending.splice(0).forEach(resolve => resolve())
})

test('B101: a delete the device could not hand over puts the bubble back', async () => {
  ;(globalThis as unknown as { window: { morse: object } }).window.morse = { mutateMessage: async () => { throw new Error('refused') } }
  const { deleteMessage, overlayMessage } = await import('../../src/renderer/src/history/message-overlay')
  const ui = await import('../../src/renderer/src/app/ui')
  const toast = ui.controller.toast; ui.controller.toast = () => {}
  await deleteMessage('me', { ...message('v1'), id: 'm2' } as ChatMessage)
  assert.notEqual(overlayMessage({ ...message('v1'), id: 'm2' } as ChatMessage), null)
  ui.controller.toast = toast
})

test('B165: a delete the queue reports as failed stays gone, as in tdesktop; a failed reaction comes back', async () => {
  const dismissed: string[] = [], sent: { id: string; messageId: string; kind: string }[] = []
  ;(globalThis as unknown as { window: { morse: object } }).window.morse = {
    mutateMessage: async (_uid: string, _chat: string, request: { id: string; messageId: string; kind: string }) => { sent.push(request) },
    dismissMessageAction: async (_uid: string, _chat: string, id: string) => { dismissed.push(id) } }
  const { deleteMessage, toggleReaction, overlayMessage, reconcileActions } = await import('../../src/renderer/src/history/message-overlay')
  const ui = await import('../../src/renderer/src/app/ui')
  const toast = ui.controller.toast, toasts: string[] = []
  ui.controller.toast = (text: string) => { toasts.push(text) }
  const gone = { ...message('v1'), id: 'm3' } as ChatMessage, liked = { ...message('v1'), id: 'm4', reactions: [] } as ChatMessage
  await deleteMessage('me', gone)
  await toggleReaction('me', liked, '👍')
  assert.equal(overlayMessage(gone), null)
  assert.equal(overlayMessage(liked)?.reactions.length, 1, 'the reaction shows at once')
  const items = sent.map(request => ({ id: request.id, messageId: request.messageId, kind: request.kind as 'delete', preview: '', state: 'failed' as const, reason: 'refused', busy: false }))
  reconcileActions('me', 'chat1', { revision: 1, ready: true, message: '', items })
  assert.equal(overlayMessage(gone), null, 'the deleted bubble does not come back')
  assert.deepEqual(overlayMessage(liked)?.reactions, [], 'the reaction gives way to the server copy')
  assert.equal(toasts.length, 2, 'both failures are said')
  assert.equal(dismissed.length, 2)
  ui.controller.toast = toast
})
