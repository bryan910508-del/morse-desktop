import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import { advancedTops, ChatTopNotices, chatTopsOf, type ChatTop } from '../../src/main/accounts/chat-top-notices'
import { AccountNotifications, type NotificationContent, type NotificationHost } from '../../src/main/messaging/notifications'
import { defaultPreferences, type MessagePosition } from '../../src/shared/model'
import type { FirestoreReader } from '../../src/main/network/firestore-rpc'
import { documents, type FirestoreDocument, type ReadDialog } from '../../src/main/network/firestore-values'

// F-RT-004: a chat's notification also comes from the list's state (tdesktop announces a message whichever way it came,
// history.cpp:1681-1706, api_updates.cpp:612-621), and a locked app hides its words instead of dropping it
// (notifications_manager.cpp:1084-1088); the account's own scheduled message is announced to it (:348-350).
const at = (seconds: number, id = `m${seconds}`): MessagePosition => ({ seconds, nanoseconds: 0, id })
const top = (chatId: string, seconds: number | null, extra: Partial<ChatTop> = {}): ChatTop =>
  ({ chatId, top: seconds === null ? null : at(seconds), messageId: seconds === null ? null : `m${seconds}`, fromMe: false, ...extra })

test('a chat whose last message moved forward is announced once; the first look only remembers', () => {
  const hinted: string[] = []
  const notices = new ChatTopNotices(item => hinted.push(`${item.chatId}/${item.messageId}`), () => 5_000_000)
  notices.observe([top('a', 100), top('b', null)])
  assert.deepEqual(hinted, [], 'an account opening does not announce its history')
  notices.observe([top('a', 100), top('b', null)])
  assert.deepEqual(hinted, [], 'nothing moved')
  notices.observe([top('a', 120), top('b', 130)])
  assert.deepEqual(hinted, ['a/m120', 'b/m130'], 'moved forward, and a chat that had no message gets one')
  notices.observe([top('a', 110), top('b', 130)])
  assert.deepEqual(hinted, ['a/m120', 'b/m130'], 'a deleted newest message moves it back: nothing to announce')
})

test('a chat that first appears after the first look counts only for a message since then', () => {
  const known = new Map<string, MessagePosition | null>()
  assert.deepEqual(advancedTops(known, 5_000_000, [top('old', 4_000)]).map(item => item.chatId), [], 'its history came before')
  known.clear()
  assert.deepEqual(advancedTops(known, 5_000_000, [top('new', 5_001)]).map(item => item.chatId), ['new'], 'started meanwhile')
  assert.deepEqual(advancedTops(known, 5_000_000, []).length, 0)
  assert.equal(known.has('new'), false, 'a chat gone from the list is forgotten')
})

test('the list gives the chats it reads, not a secret chat or a channel post copy', () => {
  const doc = (id: string, fields: Record<string, unknown> = {}) => ({ name: `${documents}/chats/${id}`, fields }) as unknown as FirestoreDocument
  const dialog = (id: string, kind: string, summary: Record<string, unknown> = {}) =>
    [id, { summary: { id, kind, top: at(10), topMessageId: 'm10', ...summary } }] as unknown as [string, ReadDialog]
  const index = new Map([dialog('d', 'direct', { topFromMe: true }), dialog('s', 'secret'), dialog('c', 'group')])
  const tops = chatTopsOf([doc('d'), doc('s'), doc('c', { lastSenderType: { stringValue: 'channel_post' } }), doc('x')], index)
  assert.deepEqual(tops, [{ chatId: 'd', top: at(10), messageId: 'm10', fromMe: true }])
})

const summary = (muted = false) => ({ summary: { id: 'c1', version: '1:0', kind: 'direct', title: '친구', participantUids: ['me', 'peer'],
  preview: '', unreadCount: 1, markedUnread: false, readPositions: { me: { at: 1750000100_000, id: 'zz' } }, readSync: { status: 'ready' },
  pinned: false, pinVersion: '', muted, archived: false, top: null }, cutoff: null, participantNames: { me: '나', peer: '친구' }, accountUid: 'me' }) as unknown as ReadDialog
const message = (sender: string, seconds: number, extra: Record<string, unknown> = {}): FirestoreDocument => ({ name: `${documents}/chats/c1/messages/m1`, updateTime: { seconds: '2', nanos: 0 },
  fields: { createdAt: { timestampValue: { seconds: String(seconds), nanos: 0 } }, senderId: { stringValue: sender }, type: { stringValue: 'text' }, text: { stringValue: '안녕' },
    status: { stringValue: 'sent' }, ...extra } } as unknown as FirestoreDocument)

async function shown(doc: FirestoreDocument, host: Partial<NotificationHost>, muted = false): Promise<NotificationContent[]> {
  const result: NotificationContent[] = []
  const reader = { query: async () => [doc], watch: () => () => {} } as unknown as FirestoreReader
  const notifications = new AccountNotifications('me', new AbortController().signal, () => ({ ready: true, reader, dialogs: new Map([['c1', summary(muted)]]) }), {
    preferences: () => defaultPreferences, locked: () => false, foreground: () => false, appActive: () => false,
    show: content => { result.push(content); return () => {} }, open: () => {}, report: () => {}, ...host
  }, async () => true)
  notifications.receive({ chatId: 'c1', id: 'm1' } as never)
  await new Promise(resolve => setTimeout(resolve, 600))
  await notifications.close()
  return result
}

test('a locked screen or a person away no longer drops it; the app\'s lock hides its words; closing or sleep drops it', async () => {
  const peer = message('peer', 1750000200)
  assert.equal((await shown(peer, { locked: () => true, dropped: () => false })).length, 1, 'screen locked or away')
  const hidden = await shown(peer, { locked: () => true, dropped: () => false, hidden: () => true })
  assert.deepEqual([hidden[0]?.title, hidden[0]?.body], ['Morse', '새 메시지가 도착했습니다.'])
  assert.equal((await shown(peer, { locked: () => false, dropped: () => true })).length, 0, 'closing, asleep')
  assert.equal((await shown(peer, { locked: () => true })).length, 0, 'a host without the split drops as before')
})

test('this account\'s own message sent at its set time is announced, even muted and read; its other messages are not', async () => {
  const scheduled = message('me', 1750000050, { wasScheduled: { booleanValue: true } })
  assert.equal((await shown(scheduled, {})).length, 1)
  assert.equal((await shown(scheduled, {}, true)).length, 1, 'muted')
  assert.equal((await shown(message('me', 1750000200), {})).length, 0, 'one it sent itself')
  assert.equal((await shown(message('peer', 1750000050), {})).length, 0, 'someone else\'s, already read')
  assert.equal((await shown(message('peer', 1750000200), {}, true)).length, 0, 'someone else\'s, muted')
})

test('the session hands the list\'s tops to the same notifications, and the window\'s host splits dropping from hiding', () => {
  const session = readFileSync('src/main/accounts/session.ts', 'utf8')
  assert.match(session, /this\.chatTops\.observe\(chatTopsOf\(this\.chatRows\.values\(\), index\)\)/)
  assert.match(session, /if \(top\.fromMe && events\.canRead\(\) && this\.selected\?\.dialog\.summary\.id === top\.chatId\) return\n\s*this\.notifications\.receive\(\{ chatId: top\.chatId, id: top\.messageId! \}\)/)
  const main = readFileSync('src/main/index.ts', 'utf8')
  assert.match(main, /dropped: \(\) => shutdown !== 'running' \|\| systemSuspended,\n\s*hidden: \(\) => Boolean\(appLock\?\.locked\),/)
})

test('a shown notification stays when its message is only marked delivered; an edit takes it back only when its words showed', async () => {
  const run = async (preview: boolean, change: Record<string, unknown>) => {
    const withdrawn: string[] = []
    let snapshot: ((rows: Map<string, FirestoreDocument>) => void) | undefined
    const first = message('peer', 1750000200)
    const reader = { query: async () => [first], watch: (_target: unknown, _signal: unknown, events: { snapshot(rows: Map<string, FirestoreDocument>): void }) => { snapshot = events.snapshot; return () => {} } } as unknown as FirestoreReader
    const notifications = new AccountNotifications('me', new AbortController().signal, () => ({ ready: true, reader, dialogs: new Map([['c1', summary()]]) }), {
      preferences: () => ({ ...defaultPreferences, showNotificationPreview: preview }), locked: () => false, foreground: () => false, appActive: () => false,
      show: () => () => {}, open: () => {}, report: () => {}, withdrawn: reason => { withdrawn.push(reason) }
    }, async () => true)
    notifications.receive({ chatId: 'c1', id: 'm1' } as never)
    await new Promise(resolve => setTimeout(resolve, 600))
    snapshot!(new Map([[first.name, { ...first, updateTime: { seconds: '3', nanos: 0 }, fields: { ...first.fields, ...change } } as FirestoreDocument]]))
    const result = [...withdrawn]
    await notifications.close()
    return result
  }
  assert.deepEqual(await run(true, { status: { stringValue: 'delivered' } }), [], 'delivered: same words')
  assert.deepEqual(await run(false, { status: { stringValue: 'delivered' } }), [])
  assert.deepEqual(await run(true, { text: { stringValue: '안녕하세요' }, isEdited: { booleanValue: true } }), ['watch:edited'], 'the words it showed changed')
  assert.deepEqual(await run(false, { text: { stringValue: '안녕하세요' }, isEdited: { booleanValue: true } }), [], 'it only said a message came')
})
