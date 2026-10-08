import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ReadSync } from '../../src/main/messaging/read-sync'
import type { ReadDialog } from '../../src/main/network/firestore-values'
import type { ReadReceiptCommand } from '../../src/main/storage/read-receipt-protocol'

// B201 (10-08): opening a chat with nothing unread sent a read the server already held. tdesktop sends readHistory only
// while the server's inbox read position is behind the message (History::readInboxTillNeedsRequest, history.cpp:2074-2085).
const me = 'RAk6me', chatId = 'chat1'
const at = (seconds: number, id: string) => ({ seconds, nanoseconds: 0, id })
function rig(unreadCount: number, mine: { at: number; id: string } | null) {
  const stored: ReadReceiptCommand[] = []
  const dialog = { summary: { id: chatId, kind: 'direct', participantUids: [me, 'peer'], unreadCount, readPositions: mine ? { [me]: mine } : {} }, cutoff: null, participantNames: {}, accountUid: me } as unknown as ReadDialog
  const auth = { signal: new AbortController().signal, sender: { ready: true, markRead: async () => { throw new Error('not in this test') } } }
  const sync = new ReadSync(me, auth as never, (async (command: ReadReceiptCommand) => { stored.push(command); return command.kind === 'read-list' ? [] : null }) as never,
    () => ({ ready: true, foreground: true, dialogs: new Map([[chatId, dialog]]) }), () => {})
  return { sync, stored }
}

test('a read the server already holds is not queued, and counts as saved', async () => {
  const { sync, stored } = rig(0, { at: 20000, id: 'm2' })
  assert.equal(await sync.observe(chatId, at(10, 'm1')), true)
  assert.equal(await sync.observe(chatId, at(20, 'm2')), true, 'the same message the server read to')
  assert.ok(!stored.some(command => command.kind === 'read-enqueue'), JSON.stringify(stored))
  await sync.close()
})

test('a newer message, a chat never read, or one the server still counts unread is queued', async () => {
  for (const [unread, mine, target] of [[0, { at: 20000, id: 'm2' }, at(30, 'm3')], [0, null, at(10, 'm1')], [1, { at: 20000, id: 'm2' }, at(20, 'm2')]] as const) {
    const { sync, stored } = rig(unread, mine)
    assert.equal(await sync.observe(chatId, target), true)
    const enqueue = stored.find(command => command.kind === 'read-enqueue')
    assert.ok(enqueue, `${unread} ${JSON.stringify(mine)} ${target.id}`)
    assert.equal((enqueue as { recount?: boolean }).recount, unread > 0)
    await sync.close()
  }
})
