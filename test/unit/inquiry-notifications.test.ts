import assert from 'node:assert/strict'
import { test } from 'node:test'
import { InquiryNotifications, type InquiryNotice } from '../../src/main/accounts/inquiry-notifications'
import { defaultPreferences, type Preferences } from '../../src/shared/model'
import type { NotificationContent } from '../../src/main/messaging/notifications'

// What a push tells the other side on iOS, this window tells itself from the room document: a room whose newest
// message is not mine and not read yet shows the banner a chat's message shows. What was already waiting when the
// account opened belongs to the unread badge, never to a banner.
const room = (value: Partial<InquiryNotice> = {}): InquiryNotice =>
  ({ inquiryId: 'ch1_sub1', channelId: 'ch1', title: '민지', preview: '안녕하세요', at: 1_000, unread: 1, fromMe: false, ...value })
// The window started at 1,000: everything up to it is history, everything after it arrived while it watched.
const clock = (): number => 1_000

function host(preferences: Partial<Preferences> = {}, state: { locked?: boolean; active?: boolean; open?: string } = {}) {
  const shown: NotificationContent[] = [], closed: string[] = [], opened: string[] = []
  const clicks = new Map<string, () => void>()
  return {
    shown, closed, opened, clicks,
    host: {
      preferences: (): Preferences => ({ ...defaultPreferences, ...preferences }),
      locked: () => state.locked === true,
      appActive: () => state.active === true,
      foreground: (inquiryId: string) => state.open === inquiryId,
      show: (content: NotificationContent, click: () => void) => { shown.push(content); clicks.set(content.chatId, click); return () => closed.push(content.chatId) },
      open: (_channelId: string, inquiryId: string) => { opened.push(inquiryId) }
    }
  }
}

test('the first list only records where the rooms stand; a newer message then shows a banner', () => {
  const { shown, host: target, clicks, opened } = host({ showNotificationPreview: true })
  const notifications = new InquiryNotifications(target, clock)
  notifications.observe([room({ at: 1_000 })])
  assert.deepEqual(shown, [], 'nothing waiting at the start is announced')
  notifications.observe([room({ at: 1_000 })])
  assert.deepEqual(shown, [], 'the same message is not a new one')
  notifications.observe([room({ at: 2_000, preview: '사진' })])
  assert.equal(shown.length, 1)
  assert.equal(shown[0]!.title, '민지')
  assert.equal(shown[0]!.body, '사진')
  assert.equal(shown[0]!.silent, false)
  clicks.get('ch1_sub1')!()
  assert.deepEqual(opened, ['ch1_sub1'], 'pressing it opens that room')
})

test('my own message, a read room, the room on screen and a locked screen announce nothing', () => {
  const mine = host()
  const first = new InquiryNotifications(mine.host, clock)
  first.observe([room({ at: 1_000 })])
  first.observe([room({ at: 2_000, fromMe: true })])
  first.observe([room({ at: 3_000, unread: 0 })])
  assert.deepEqual(mine.shown, [])

  const open = host({}, { open: 'ch1_sub1' })
  const second = new InquiryNotifications(open.host, clock)
  second.observe([room({ at: 1_000 })]); second.observe([room({ at: 2_000 })])
  assert.deepEqual(open.shown, [], 'the room being read shows nothing')

  const locked = host({}, { locked: true })
  const third = new InquiryNotifications(locked.host, clock)
  third.observe([room({ at: 1_000 })]); third.observe([room({ at: 2_000 })])
  assert.deepEqual(locked.shown, [])
})

test('the preferences a chat obeys are obeyed here too', () => {
  const off = host({ notifications: false })
  const a = new InquiryNotifications(off.host, clock)
  a.observe([room({ at: 1_000 })]); a.observe([room({ at: 2_000 })])
  assert.deepEqual(off.shown, [])

  const personal = host({ notifyPersonal: false })
  const b = new InquiryNotifications(personal.host, clock)
  b.observe([room({ at: 1_000 })]); b.observe([room({ at: 2_000 })])
  assert.deepEqual(personal.shown, [], 'a 1:1 inquiry follows «개인» notifications')

  const inApp = host({ inAppNotifications: false }, { active: true })
  const c = new InquiryNotifications(inApp.host, clock)
  c.observe([room({ at: 1_000 })]); c.observe([room({ at: 2_000 })])
  assert.deepEqual(inApp.shown, [], 'nothing while the window is in use, when that is off')

  const quiet = host({ showNotificationPreview: false, notificationSound: false })
  const d = new InquiryNotifications(quiet.host, clock)
  d.observe([room({ at: 1_000 })]); d.observe([room({ at: 2_000 })])
  assert.equal(quiet.shown[0]!.title, 'Morse')
  assert.equal(quiet.shown[0]!.body, '새 메시지가 도착했습니다.')
  assert.equal(quiet.shown[0]!.silent, true)
})

test('a banner goes when the room is read, when the room leaves the list, and when the list stops', () => {
  const { shown, closed, host: target } = host()
  const notifications = new InquiryNotifications(target, clock)
  notifications.observe([room({ at: 1_000 })])
  notifications.observe([room({ at: 2_000 })])
  assert.equal(shown.length, 1)
  notifications.observe([room({ at: 3_000, unread: 0 })])
  assert.deepEqual(closed, ['ch1_sub1'], 'reading the room takes the banner away')
  notifications.observe([room({ at: 4_000 })])
  assert.equal(shown.length, 2)
  notifications.observe([])
  assert.deepEqual(closed, ['ch1_sub1', 'ch1_sub1'], 'a room that left the list leaves no banner')
  notifications.observe([room({ at: 5_000 })])
  assert.equal(shown.length, 3, 'a room that comes back with a message from this run still announces it')
  notifications.observe([room({ at: 500 })])
  assert.equal(shown.length, 3, 'and never for a message older than this run')
  notifications.pause()
  assert.equal(closed.length, 3)
  notifications.close()
  notifications.observe([room({ at: 7_000 })]); notifications.observe([room({ at: 8_000 })])
  assert.equal(shown.length, 3, 'a closed account announces nothing')
})
