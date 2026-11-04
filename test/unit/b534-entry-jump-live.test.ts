import assert from 'node:assert/strict'
import { test } from 'node:test'
import { HistoryReader } from '../../src/main/accounts/history-reader'
import type { FirestoreReader, WatchEvents } from '../../src/main/network/firestore-rpc'
import { documents, ReadFailure, type FirestoreDocument, type ReadDialog } from '../../src/main/network/firestore-values'
import { AccountNotifications } from '../../src/main/messaging/notifications'
import { defaultPreferences } from '../../src/shared/model'

// B534: a chat opened from a notice jumped to its message on the page kept from the last visit, and the live listen,
// as it started, cancelled the jump (cancelPage), which came back without the message. Entry jumps now wait until the
// listen has said «current» once (whenLive); a failed or closed history lets them go too.
const dialog = {
  summary: { id: 'chat1', version: '1:0', kind: 'direct', title: 'peer', participantUids: ['me', 'peer'], preview: '', unreadCount: 0, markedUnread: false,
    readPositions: {}, readSync: { status: 'ready' }, pinned: false, pinVersion: '', muted: false, archived: false, top: null },
  cutoff: null, participantNames: { me: 'me', peer: 'peer' }, accountUid: 'me'
} as unknown as ReadDialog
const tick = () => new Promise(resolve => setTimeout(resolve, 0))
function opened() {
  const watches: WatchEvents[] = []
  const reader = { watch: (_t: unknown, _s: AbortSignal, events: WatchEvents) => { watches.push(events); return () => {} }, query: async () => [] } as unknown as FirestoreReader
  let revision = 0
  const history = new HistoryReader(dialog, reader, () => {}, () => ++revision)
  history.start()
  let live = false
  void history.whenLive().then(() => { live = true })
  return { history, events: () => watches[0]!, live: () => live }
}

test('an entry jump waits until the live listen has answered', async () => {
  const room = opened()
  room.events().snapshot(new Map()); await tick()
  assert.equal(room.live(), false, 'a snapshot alone is not yet current')
  room.events().state('loading'); await tick()
  assert.equal(room.live(), false)
  room.events().state('ready'); await tick()
  assert.equal(room.live(), true)
  let later = false
  await room.history.whenLive().then(() => { later = true })
  assert.equal(later, true, 'once live, it does not wait again')
})

test('a history that fails or closes lets the jump go', async () => {
  const failed = opened()
  failed.events().state('error', new ReadFailure('network')); await tick()
  assert.equal(failed.live(), true)
  const closed = opened()
  closed.history.close(); await tick()
  assert.equal(closed.live(), true)
})

// B534 / F-MB-003: pressing the notice of this account's own (scheduled) message opens that message; another person's
// message opens the chat at its first unread (tdesktop openNotificationMessage, openExactlyMessage = item->out()).
const room = { summary: { id: 'c1', version: '1:0', kind: 'direct', title: '친구', participantUids: ['me', 'peer'], preview: '', unreadCount: 1,
  markedUnread: false, readPositions: { me: { at: 1750000100_000, id: 'zz' } }, readSync: { status: 'ready' }, pinned: false, pinVersion: '',
  muted: false, archived: false, top: null }, cutoff: null, participantNames: { me: '나', peer: '친구' }, accountUid: 'me' } as unknown as ReadDialog
const doc = (sender: string, extra: Record<string, unknown> = {}): FirestoreDocument => ({ name: `${documents}/chats/c1/messages/m1`, updateTime: { seconds: '2', nanos: 0 },
  fields: { createdAt: { timestampValue: { seconds: '1750000200', nanos: 0 } }, senderId: { stringValue: sender }, type: { stringValue: 'text' }, text: { stringValue: 'hi' },
    status: { stringValue: 'sent' }, ...extra } } as unknown as FirestoreDocument)
async function pressed(message: FirestoreDocument): Promise<unknown[][]> {
  const opened: unknown[][] = []
  let click: (() => void) | null = null
  const reader = { query: async () => [message], watch: () => () => {} } as unknown as FirestoreReader
  const notifications = new AccountNotifications('me', new AbortController().signal, () => ({ ready: true, reader, dialogs: new Map([['c1', room]]) }), {
    preferences: () => defaultPreferences, locked: () => false, foreground: () => false, appActive: () => false,
    show: (_content, onClick) => { click = onClick; return () => {} }, open: (...args: unknown[]) => { opened.push(args) }, report: () => {}
  }, async () => true)
  notifications.receive({ chatId: 'c1', id: 'm1' } as never)
  await new Promise(resolve => setTimeout(resolve, 600))
  ;(click as (() => void) | null)?.()
  await notifications.close()
  return opened
}

test('my own message\'s notice opens that message; another person\'s opens the chat', async () => {
  assert.deepEqual(await pressed(doc('me', { wasScheduled: { booleanValue: true } })), [['c1', 'm1']])
  assert.deepEqual(await pressed(doc('peer')), [['c1', undefined]])
})
