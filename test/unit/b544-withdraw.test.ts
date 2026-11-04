import assert from 'node:assert/strict'
import { test } from 'node:test'
import { AccountNotifications } from '../../src/main/messaging/notifications'
import { defaultPreferences, type MessagePosition } from '../../src/shared/model'
import type { FirestoreReader } from '../../src/main/network/firestore-rpc'
import { documents, type FirestoreDocument, type ReadDialog } from '../../src/main/network/firestore-values'

// B544 (reports/desktop/2026-11-03-b544-desktop.md §4): a shown notification is taken back when its message goes, as
// tdesktop clears it with the message (history.cpp:741-742 clearFromItem: delete for everyone, the TTL, a cleared history)
// and with the chat (data_session.cpp:5799-5801 clearFromHistory).
const name = `${documents}/chats/c1/messages/m1`
const dialog = (cutoff: MessagePosition | null = null) => ({ summary: { id: 'c1', version: '1:0', kind: 'direct', title: '친구', participantUids: ['me', 'peer'],
  preview: '', unreadCount: 1, markedUnread: false, readPositions: { me: { at: 1750000100_000, id: 'zz' } }, readSync: { status: 'ready' },
  pinned: false, pinVersion: '', muted: false, archived: false, top: null }, cutoff, participantNames: { me: '나', peer: '친구' }, accountUid: 'me' }) as unknown as ReadDialog
const message = (extra: Record<string, unknown> = {}): FirestoreDocument => ({ name, updateTime: { seconds: '2', nanos: 0 },
  fields: { createdAt: { timestampValue: { seconds: '1750000200', nanos: 0 } }, senderId: { stringValue: 'peer' }, type: { stringValue: 'text' }, text: { stringValue: '안녕' },
    status: { stringValue: 'sent' }, ...extra } } as unknown as FirestoreDocument)
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

// Shows m1 in c1, then lets `after` change what the account sees; gives what was taken back and how many closed.
async function withdrawnAfter(doc: FirestoreDocument, after: (world: { snapshot(rows: Map<string, FirestoreDocument>): void; dialogs: Map<string, ReadDialog>; notifications: AccountNotifications }) => Promise<void> | void) {
  const withdrawn: string[] = []
  let shown = 0, closed = 0
  let snapshot: ((rows: Map<string, FirestoreDocument>) => void) | undefined
  const dialogs = new Map([['c1', dialog()]])
  const reader = { query: async () => [doc], watch: (_target: unknown, _signal: unknown, events: { snapshot(rows: Map<string, FirestoreDocument>): void }) => { snapshot = events.snapshot; return () => {} } } as unknown as FirestoreReader
  const notifications = new AccountNotifications('me', new AbortController().signal, () => ({ ready: true, reader, dialogs }), {
    preferences: () => defaultPreferences, locked: () => false, foreground: () => false, appActive: () => false,
    show: () => { shown++; return () => { closed++ } }, open: () => {}, report: () => {}, withdrawn: reason => { withdrawn.push(reason) }
  }, async () => true)
  notifications.receive({ chatId: 'c1', id: 'm1' } as never)
  await sleep(600)
  assert.equal(shown, 1, 'shown first')
  await after({ snapshot: rows => snapshot!(rows), dialogs, notifications })
  const result = { withdrawn: [...withdrawn], closed }
  await notifications.close()
  return result
}

test('deleted for everyone: the message document is gone and its notification closes', async () => {
  assert.deepEqual(await withdrawnAfter(message(), ({ snapshot }) => snapshot(new Map())), { withdrawn: ['watch:gone'], closed: 1 })
  assert.deepEqual(await withdrawnAfter(message(), ({ snapshot }) => snapshot(new Map([[name, message({ isDeleted: { booleanValue: true } })]]))),
    { withdrawn: ['watch:not-notifiable'], closed: 1 }, 'an older deletion mark on the document')
})

test('auto-delete: the notification closes when the message\'s time is up', async () => {
  const deleteAt = Date.now() + 900
  const doc = message({ deleteAt: { timestampValue: { seconds: String(Math.floor(deleteAt / 1000)), nanos: (deleteAt % 1000) * 1_000_000 } } })
  assert.deepEqual(await withdrawnAfter(doc, () => sleep(Math.max(0, deleteAt - Date.now()) + 200)), { withdrawn: ['expired'], closed: 1 })
})

test('a deleted room: the next chat list no longer has it and its notification closes', async () => {
  assert.deepEqual(await withdrawnAfter(message(), ({ dialogs, notifications }) => { dialogs.delete('c1'); notifications.resume('list') }),
    { withdrawn: ['resume:list:no-dialog'], closed: 1 })
})

test('a history cleared for everyone: a message inside the boundary closes, one after it stays', async () => {
  assert.deepEqual(await withdrawnAfter(message(), ({ dialogs, notifications }) => { dialogs.set('c1', dialog({ seconds: 1750000200, nanoseconds: 0, id: 'm1' })); notifications.resume('list') }),
    { withdrawn: ['resume:list:not-notifiable'], closed: 1 })
  assert.deepEqual(await withdrawnAfter(message(), ({ dialogs, notifications }) => { dialogs.set('c1', dialog({ seconds: 1750000150, nanoseconds: 0, id: 'm0' })); notifications.resume('list') }),
    { withdrawn: [], closed: 0 })
})
