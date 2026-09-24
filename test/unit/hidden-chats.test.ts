import assert from 'node:assert/strict'
import { test } from 'node:test'
import { HiddenChats, emptyRevokedDirect, withLocalDeletion } from '../../src/main/accounts/hidden-chats'
import type { HiddenChatCommand } from '../../src/main/storage/hidden-chat-table'
import { decodeMessage, documents, type FirestoreDocument, type ReadDialog } from '../../src/main/network/firestore-values'
import type { DialogSummary, MessagePosition } from '../../src/shared/model'

// "나에게만 삭제", as iOS does it: the moment of deleting stays on this device. Messages up to it stay
// deleted; the room is out of the list until a newer message arrives, and then it comes back with
// only what came after. The session rebuilds its list when the moments arrive, and every rebuild
// asks for them - so the read must happen once, or the list is rebuilt forever.
interface Pending { command: HiddenChatCommand; resolve: (value: unknown) => void; reject: (error: unknown) => void }
function device(rows: { chatId: string; hiddenAt: number }[] = [], clearedRows: { chatId: string; cutoff: number }[] = []) {
  const table = new Map(rows.map(row => [row.chatId, row.hiddenAt])), cleared = new Map(clearedRows.map(row => [row.chatId, row.cutoff]))
  const pending: Pending[] = [], commands: HiddenChatCommand[] = []
  const store = <T,>(command: HiddenChatCommand): Promise<T> => {
    commands.push(command)
    return new Promise<T>((resolve, reject) => pending.push({ command, resolve: resolve as (value: unknown) => void, reject }))
  }
  // Answers every waiting command the way the delivery table does.
  const settle = async (fail = false): Promise<void> => {
    while (pending.length) {
      const next = pending.shift()!
      if (fail) { next.reject(new Error('disk')); continue }
      const command = next.command
      if (command.kind === 'hidden-chats-read') next.resolve([...table].map(([chatId, hiddenAt]) => ({ chatId, hiddenAt })))
      else if (command.kind === 'cleared-chats-read') next.resolve([...cleared].map(([chatId, cutoff]) => ({ chatId, cutoff })))
      else if (command.kind === 'cleared-chat-set') { cleared.set(command.chatId, command.cutoff); next.resolve(null) }
      else { if (command.on) table.set(command.chatId, command.at); else table.delete(command.chatId); next.resolve(null) }
    }
    await new Promise(resolve => setImmediate(resolve))
  }
  return { store, settle, table, cleared, commands, reads: () => commands.filter(command => command.kind === 'hidden-chats-read').length }
}
const at = (milliseconds: number, id = 'm'): MessagePosition => ({ seconds: Math.floor(milliseconds / 1000), nanoseconds: (milliseconds % 1000) * 1_000_000, id })
const room = (id: string, top: MessagePosition | null): DialogSummary => ({ id, top, preview: '마지막 메시지' }) as unknown as DialogSummary

test('the moments are read once, even though their arrival rebuilds the list that asks for them', async () => {
  const disk = device([{ chatId: 'a', hiddenAt: 5_000_000 }])
  let rebuilds = 0
  const hidden: HiddenChats = new HiddenChats(disk.store, () => { rebuilds++; hidden.load() })
  hidden.load(); hidden.load()
  await disk.settle(); await disk.settle()
  assert.equal(disk.reads(), 1)
  assert.equal(rebuilds, 1)
  assert.equal(hidden.hides(room('a', at(4_000_000))), true)
  assert.equal(hidden.hides(room('b', at(4_000_000))), false)
})

test('nothing deleted on this device: no rebuild at all', async () => {
  const disk = device()
  let rebuilds = 0
  const hidden = new HiddenChats(disk.store, () => { rebuilds++ })
  hidden.load(); await disk.settle()
  assert.equal(rebuilds, 0)
})

test('a newer message brings the room back, and the deleted history stays deleted', async () => {
  const disk = device([{ chatId: 'a', hiddenAt: 5_000_000 }])
  const hidden = new HiddenChats(disk.store, () => {})
  hidden.load(); await disk.settle()
  const writes = disk.commands.length
  assert.equal(hidden.hides(room('a', at(5_000_000))), true, 'the last message deleted with the room keeps it out')
  assert.equal(hidden.hides(room('a', at(5_000_500))), false, 'a message after the deleting brings it back')
  assert.equal(disk.commands.length, writes, 'reading the list writes nothing')
  assert.ok(disk.table.has('a'), 'the moment is kept')
  assert.deepEqual(hidden.cutoff('a'), at(5_000_001, ''))
})

test('the boundary drops every message up to the moment of deleting and keeps the ones after', () => {
  const chat = 'c1', deleted = at(5_000_001, '')
  const dialog = { summary: { id: chat, kind: 'direct', top: at(5_000_500), preview: '새 메시지' }, cutoff: null, participantNames: {}, accountUid: 'me' } as unknown as ReadDialog
  withLocalDeletion(dialog, deleted)
  assert.deepEqual(dialog.cutoff, deleted)
  assert.equal(dialog.summary.preview, '새 메시지', 'a room brought back by a newer message shows that message')
  const message = (id: string, milliseconds: number): FirestoreDocument => ({ name: `${documents}/chats/${chat}/messages/${id}`, fields: {
    createdAt: { timestampValue: { seconds: String(Math.floor(milliseconds / 1000)), nanos: (milliseconds % 1000) * 1_000_000 } },
    senderId: { stringValue: 'peer' }, type: { stringValue: 'text' }, text: { stringValue: id } } } as unknown as FirestoreDocument)
  assert.equal(decodeMessage(message('older', 4_000_000), dialog), null)
  assert.equal(decodeMessage(message('same-moment', 5_000_000), dialog), null)
  assert.equal(decodeMessage(message('after', 5_000_500), dialog)?.text, 'after')
})

test('a later server boundary wins, an earlier one gives way, and a deleted last message leaves no preview', () => {
  const dialog = (cutoff: MessagePosition | null, top: MessagePosition): ReadDialog =>
    ({ summary: { id: 'c1', top, preview: '옛 메시지' }, cutoff, participantNames: {}, accountUid: 'me' }) as unknown as ReadDialog
  const later = dialog(at(9_000_000, ''), at(9_500_000))
  withLocalDeletion(later, at(5_000_001, ''))
  assert.deepEqual(later.cutoff, at(9_000_000, ''))
  const earlier = dialog(at(1_000_000, ''), at(4_000_000))
  withLocalDeletion(earlier, at(5_000_001, ''))
  assert.deepEqual(earlier.cutoff, at(5_000_001, ''))
  assert.equal(earlier.summary.preview, '')
  const untouched = dialog(null, at(4_000_000))
  withLocalDeletion(untouched, null)
  assert.equal(untouched.cutoff, null)
})

test('a room deleted while the read is on its way stays deleted', async () => {
  const disk = device()
  const hidden = new HiddenChats(disk.store, () => {}, () => 9_000_000)
  hidden.load()
  const hiding = hidden.hide('a')
  await disk.settle(); await hiding
  assert.equal(hidden.hides(room('a', at(8_000_000))), true)
  assert.equal(disk.table.get('a'), 9_000_000, 'the stored moment is the one the list uses')
})

test('a room restored while the read is on its way stays restored', async () => {
  const disk = device([{ chatId: 'a', hiddenAt: 9_000_000 }])
  const hidden = new HiddenChats(disk.store, () => {})
  hidden.load()
  const restoring = hidden.restore('a')
  await disk.settle(); await restoring
  assert.equal(hidden.hides(room('a', at(1_000_000))), false)
  assert.equal(hidden.cutoff('a'), null)
  assert.equal(disk.table.has('a'), false)
})

test('a room deleted right after its last message stays deleted when this clock runs behind', async () => {
  const disk = device()
  // This computer says 10:00:00.000; the server stamped the last message 10:00:00.800.
  const hidden = new HiddenChats(disk.store, () => {}, () => 36_000_000)
  hidden.load(); await disk.settle()
  const last = at(36_000_800)
  const hiding = hidden.hide('a', last)
  await disk.settle(); await hiding
  assert.equal(hidden.hides(room('a', last)), true)
  assert.equal(hidden.hides(room('a', at(36_001_000))), false, 'a message after it still brings the room back')
})

test('a deletion that cannot be stored is undone and reported', async () => {
  const disk = device()
  const hidden = new HiddenChats(disk.store, () => {})
  hidden.load(); await disk.settle()
  const outcome = assert.rejects(hidden.hide('a'), /목록에서 지우지 못했습니다/)
  await disk.settle(true)
  await outcome
  assert.equal(hidden.cutoff('a'), null)
})

test('a failed read is asked again by the next rebuild, not in a loop', async () => {
  const disk = device([{ chatId: 'a', hiddenAt: 5_000_000 }])
  const hidden = new HiddenChats(disk.store, () => {})
  hidden.load(); await disk.settle(true)
  assert.equal(disk.reads(), 1)
  hidden.load(); await disk.settle()
  assert.equal(disk.reads(), 2)
  assert.equal(hidden.hides(room('a', at(1_000_000))), true)
})

test('a closed account reads and deletes nothing', async () => {
  const disk = device([{ chatId: 'a', hiddenAt: 5_000_000 }])
  const hidden = new HiddenChats(disk.store, () => { throw new Error('closed accounts do not rebuild') })
  hidden.load(); hidden.close(); await disk.settle()
  assert.equal(hidden.hides(room('a', at(1_000_000))), false)
  await assert.rejects(hidden.hide('b'))
})

// Telegram Desktop lists a private chat while it has a last message (History::shouldBeInChatList). "Delete chat" and
// the other side's delete for everyone leave none; "Clear history" leaves the "history cleared" service message, so
// that chat stays. Morse keeps the boundary this device cleared a room at instead of such a message.
const direct = (id: string, top: MessagePosition | null): DialogSummary => ({ id, top, kind: 'direct', preview: '' }) as unknown as DialogSummary
test('a private room with nothing after the delete-for-everyone boundary is not a row; a newer message brings it back', () => {
  assert.equal(emptyRevokedDirect(direct('a', at(1_000)), at(2_000, '')), true)
  assert.equal(emptyRevokedDirect(direct('a', null), at(2_000, '')), true)
  assert.equal(emptyRevokedDirect(direct('a', at(3_000)), at(2_000, '')), false)
  assert.equal(emptyRevokedDirect(direct('a', at(1_000)), null), false)
  assert.equal(emptyRevokedDirect({ ...direct('g', at(1_000)), kind: 'group' } as DialogSummary, at(2_000, '')), false)
})
test('the room this device cleared stays listed for exactly that boundary, across restarts, and while the clear is on its way', async () => {
  const disk = device()
  const hidden = new HiddenChats(disk.store, () => {})
  hidden.load(); await disk.settle()
  assert.equal(hidden.keepsCleared('a', at(2_000, '')), false)
  hidden.beginClear('a')
  assert.equal(hidden.keepsCleared('a', at(2_000, '')), true)   // the listener is ahead of the callable's answer
  const noted = hidden.noteCleared('a', 2_000); await disk.settle(); await noted
  hidden.endClear('a')
  assert.equal(hidden.keepsCleared('a', at(2_000, '')), true)
  assert.equal(hidden.keepsCleared('a', at(9_000, '')), false)  // a later delete for everyone moved the boundary
  assert.equal(hidden.keepsCleared('b', at(2_000, '')), false)
  const again = new HiddenChats(device([], [...disk.cleared].map(([chatId, cutoff]) => ({ chatId, cutoff }))).store, () => {})
  assert.equal(again.keepsCleared('a', at(2_000, '')), false)    // not read yet
})
test('the cleared boundaries arrive with the hidden moments and rebuild the list once', async () => {
  const disk = device([], [{ chatId: 'a', cutoff: 2_000 }])
  let rebuilds = 0
  const hidden = new HiddenChats(disk.store, () => { rebuilds++ })
  hidden.load(); await disk.settle()
  assert.equal(rebuilds, 1)
  assert.equal(hidden.keepsCleared('a', at(2_000, '')), true)
})


// Saved Messages is the account's own room and Telegram's list always holds it. Here the notes screen
// finds the room through the dialog list, so an emptied one must not drop out of it: iOS's «메시지
// 비우기» clears it on the server, which writes the very boundary this rule reads.
test('an emptied Saved Messages stays in the list, where an emptied 1:1 does not', () => {
  const saved = 'memo_uid-1'
  const revoked = { seconds: 2000, nanoseconds: 0, id: 'r' }
  const room = (id: string) => ({ id, kind: 'direct', top: null } as unknown as DialogSummary)
  assert.equal(emptyRevokedDirect(room('chat-a'), revoked, saved), true)
  assert.equal(emptyRevokedDirect(room(saved), revoked, saved), false)
  // Said of no account in particular, the rule is what it always was.
  assert.equal(emptyRevokedDirect(room(saved), revoked), true)
  // Another account's memo room is not this one's Saved Messages.
  assert.equal(emptyRevokedDirect(room('memo_uid-2'), revoked, saved), true)
})
