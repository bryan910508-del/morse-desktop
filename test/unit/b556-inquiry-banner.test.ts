import assert from 'node:assert/strict'
import { test } from 'node:test'
import { InquiryNotifications, type InquiryNotice } from '../../src/main/accounts/inquiry-notifications'
import { defaultPreferences, type Preferences } from '../../src/shared/model'
import type { NotificationContent } from '../../src/main/messaging/notifications'

// B556 (reports/desktop/2026-11-06-b556-inquiry-delete-read.md §3–§4, review 20:2x): an inquiry banner goes when the
// message it told of is deleted (the room's newest message goes back) or the room is read elsewhere (unread 0), as
// tdesktop clears a notification on clearFromItem · clearIncomingFromHistory; a newer message still shows a new one.
const room = (value: Partial<InquiryNotice> = {}): InquiryNotice =>
  ({ inquiryId: 'ch1_sub1', channelId: 'ch1', title: '민지', preview: '안녕하세요', at: 1_000, unread: 1, fromMe: false, ...value })
const clock = (): number => 1_000
function host() {
  const shown: NotificationContent[] = [], closed: string[] = []
  return { shown, closed, host: {
    preferences: (): Preferences => ({ ...defaultPreferences, showNotificationPreview: true }),
    locked: () => false, appActive: () => false, foreground: () => false,
    show: (content: NotificationContent) => { shown.push(content); return () => closed.push(content.chatId) },
    open: () => {}
  } }
}
function announced() {
  const h = host(), n = new InquiryNotifications(h.host, clock)
  n.observe([room({ at: 1_000 })])
  n.observe([room({ at: 2_000, preview: '지워질 글', unread: 2 })])
  assert.deepEqual([h.shown.length, h.closed.length], [1, 0])
  return { ...h, n }
}

test('B556: the newest message deleted (by either side or the sweep) — the server sets the line back, and the banner goes', () => {
  const { n, closed, shown } = announced()
  n.observe([room({ at: 1_500, preview: '앞 글', unread: 1 })])
  assert.deepEqual(closed, ['ch1_sub1'], 'the banner telling the deleted words is withdrawn')
  assert.equal(shown.length, 1, 'and no banner for the older message the line now shows')
  const empty = announced()
  empty.n.observe([room({ at: 0, preview: '', unread: 0 })])
  assert.deepEqual(empty.closed, ['ch1_sub1'], 'the room left with no message at all')
})

test('B556: read on another device (unread 0, the same newest message) — the banner goes', () => {
  const { n, closed } = announced()
  n.observe([room({ at: 2_000, preview: '지워질 글', unread: 0 })])
  assert.deepEqual(closed, ['ch1_sub1'])
})

test('B556: a newer message still shows a new banner (the old one gives way); an older message deleted leaves it', () => {
  const { n, closed, shown } = announced()
  n.observe([room({ at: 2_000, preview: '지워질 글', unread: 1 })])
  assert.deepEqual(closed, [], 'an older message deleted: the newest is the same, the banner stays')
  n.observe([room({ at: 3_000, preview: '새 글', unread: 2 })])
  assert.deepEqual([shown.length, shown.at(-1)!.body, closed], [2, '새 글', ['ch1_sub1']])
})
