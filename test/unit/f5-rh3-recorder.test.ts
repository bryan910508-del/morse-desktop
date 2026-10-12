import assert from 'node:assert/strict'
import { test } from 'node:test'
import { AccountNotifications } from '../../src/main/messaging/notifications'
import { defaultPreferences } from '../../src/shared/model'
import { readCursor } from '../../src/shared/read-receipts'
import type { FirestoreReader } from '../../src/main/network/firestore-rpc'
import { decodeMessage, documents, type FirestoreDocument, type ReadDialog } from '../../src/main/network/firestore-values'
import { elementKind, lostDetail } from '../../src/renderer/src/app/tap-recorder'
import { noteWindowInput, tapDetail, windowInputsAround } from '../../src/main/platform/tap-diagnostics'

// rh-3: a shown notification taken back says which check took it — a read on another device arriving with the chat
// list, the window coming into use, its message's watch starting again, a read here — as a code only.
const doc = { name: `${documents}/chats/c1/messages/m1`, updateTime: { seconds: '2', nanos: 0 },
  fields: { createdAt: { timestampValue: { seconds: '1750000000', nanos: 0 } }, senderId: { stringValue: 'peer' }, type: { stringValue: 'text' },
    text: { stringValue: 'hello' }, status: { stringValue: 'sent' } } } as unknown as FirestoreDocument
const dialog = () => ({ summary: { id: 'c1', version: '1:0', kind: 'direct', title: 'peer', participantUids: ['me', 'peer'], preview: '', unreadCount: 1,
  markedUnread: false, readPositions: {} as Record<string, unknown>, readSync: { status: 'ready' }, pinned: false, pinVersion: '', muted: false, archived: false, top: null },
  cutoff: null, participantNames: { me: '나', peer: 'peer' }, accountUid: 'me' }) as unknown as ReadDialog

async function shown() {
  const room = dialog(), reasons: string[] = []
  let state: ((value: string) => void) | null = null
  const reader = { query: async () => [doc], watch: (_target: unknown, _signal: unknown, handlers: { state(value: string): void }) => { state = handlers.state; handlers.state('loading'); return () => {} } } as unknown as FirestoreReader
  let ready = true
  const notifications = new AccountNotifications('me', new AbortController().signal, () => ({ ready, reader, dialogs: new Map([['c1', room]]) }), {
    preferences: () => ({ ...defaultPreferences }), locked: () => false, foreground: () => false, appActive: () => false,
    show: () => () => {}, open: () => {}, report: () => {}, withdrawn: reason => { reasons.push(reason) }
  }, async () => true)
  notifications.receive({ chatId: 'c1', id: 'm1' } as never)
  await new Promise(resolve => setTimeout(resolve, 600))
  return { notifications, room, reasons, state: () => state!, setReady: (value: boolean) => { ready = value } }
}

test('a read arriving with the chat list takes the notification back as resume:list:read-position', async () => {
  const h = await shown()
  try {
    h.notifications.resume('list')
    assert.deepEqual(h.reasons, [], 'still unread: it stays')
    const message = decodeMessage(doc, h.room)!
    ;(h.room.summary.readPositions as Record<string, unknown>).me = readCursor(message.position)
    h.notifications.resume('list')
    assert.deepEqual(h.reasons, ['resume:list:read-position'])
  } finally { await h.notifications.close() }
})

test('the window coming into use while the account is not ready, a watch starting again, and a read here each say so', async () => {
  const a = await shown()
  try { a.setReady(false); a.notifications.resume('focus'); assert.deepEqual(a.reasons, ['resume:focus:inactive']) } finally { await a.notifications.close() }
  const b = await shown()
  try { b.state()('loading'); assert.deepEqual(b.reasons, ['watch:reset']) } finally { await b.notifications.close() }
  const c = await shown()
  try {
    c.notifications.observed('c1', decodeMessage(doc, c.room)!.position)
    assert.deepEqual(c.reasons, ['read-here'])
  } finally { await c.notifications.close() }
  const d = await shown()
  await d.notifications.close()
  assert.deepEqual(d.reasons, ['paused'])
})

// F5: the step a lost press stopped at, from element kinds and flags only.
test('a lost press is told by its step and element kind, with no words', () => {
  const element = { tagName: 'BUTTON', classList: ['file-message', 'remote', 'x'], getAttribute: (name: string) => name === 'role' ? null : 'secret words' } as unknown as Element
  assert.equal(elementKind(element), 'button.file-message.remote')
  assert.equal(elementKind({ tagName: 'SPAN', classList: [], getAttribute: () => 'button' } as unknown as Element), 'span[button]')
  const base = { at: 0, node: null, kind: 'button.file-message', screen: '', down: true, up: true, click: true, sameTarget: true, downGone: false, bubbled: true, prevented: false, focused: true, hidden: false, changed: false }
  assert.match(lostDetail({ ...base, up: false, click: false }), /^step=no-up /)
  assert.match(lostDetail({ ...base, click: false, downGone: true }), /^step=no-click:redrawn /)
  assert.match(lostDetail({ ...base, click: false, sameTarget: false }), /^step=no-click:moved /)
  assert.match(lostDetail({ ...base, prevented: true }), /^step=prevented /)
  assert.match(lostDetail({ ...base, bubbled: false }), /^step=stopped /)
  assert.match(lostDetail(base), /^step=no-effect kind=button.file-message /)
  assert.equal(tapDetail('step=no-effect kind=a.b «이름» @id/x'), 'step=no-effect kind=a.b  id/x')
})

test('main tells whether the lost press reached the window, and whether it was focused', () => {
  const at = 1_000_000
  noteWindowInput('down', false, at + 10); noteWindowInput('up', false, at + 60)
  assert.equal(windowInputsAround(at), 'win-down=1 win-up=1 win-focused=0')
  assert.equal(windowInputsAround(at + 60_000), 'win-down=0 win-up=0 win-focused=-')
})
