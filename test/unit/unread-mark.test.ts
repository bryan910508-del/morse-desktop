import assert from 'node:assert/strict'
import { test } from 'node:test'
import { clearsUnreadMark } from '../../src/shared/manual-unread'

// B104 (tdesktop history_widget.cpp:3442-3447, history.cpp:2078-2080 → data_histories.cpp:516-527): opening or reading a
// chat clears its unread mark, and only the mark (setMorseChatUnread readToEnd:false, server round 2/2).
const chat = (fields: Partial<{ id: string; kind: string; unreadCount: number; markedUnread: boolean }>) =>
  ({ id: 'c1', kind: 'direct', unreadCount: 1, markedUnread: true, ...fields })

test('a chat marked unread loses the mark when opened, whatever else is unread', () => {
  assert.equal(clearsUnreadMark(chat({ unreadCount: 1 }), 'me'), true, 'the mark raised the count to 1 (setMorseChatUnread)')
  assert.equal(clearsUnreadMark(chat({ unreadCount: 0 }), 'me'), true, 'the count went down by reading, the mark stayed')
  assert.equal(clearsUnreadMark(chat({ unreadCount: 3 }), 'me'), true, 'more unread: only the mark goes, the messages are read as they are seen')
  assert.equal(clearsUnreadMark(chat({ markedUnread: false }), 'me'), false, 'no mark, nothing to clear')
  assert.equal(clearsUnreadMark(chat({ kind: 'secret' }), 'me'), false)
  assert.equal(clearsUnreadMark(chat({ id: 'memo_me' }), 'me'), false)
})

test('opening a chat sends only the mark (readToEnd false); the list\'s «읽음으로 표시» still reads to the end', async () => {
  const { setManualUnread } = await import('../../src/main/network/manual-unread-api')
  const sent: unknown[] = []
  globalThis.fetch = (async (_url: string, init: RequestInit) => { sent.push(JSON.parse(String(init.body)).data); return new Response(JSON.stringify({ result: { ok: true } }), { status: 200 }) }) as typeof fetch
  const auth = { signal: new AbortController().signal, authorize: async () => ({ idToken: 'id', appCheckToken: 'proof', expiresAt: Date.now() + 3600000 }) }
  await setManualUnread(auth, 'c1', false, new AbortController().signal, () => {}, false)
  await setManualUnread(auth, 'c1', false, new AbortController().signal, () => {})
  await setManualUnread(auth, 'c1', true, new AbortController().signal, () => {})
  assert.deepEqual(sent, [{ chatId: 'c1', markedUnread: false, readToEnd: false }, { chatId: 'c1', markedUnread: false }, { chatId: 'c1', markedUnread: true }])
})
