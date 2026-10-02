import assert from 'node:assert/strict'
import { test } from 'node:test'
import { messageReportAllowed, reportAlsoBlocksByDefault, reportRequest } from '../../src/shared/reports'
import { reportFields } from '../../src/main/api/account-tools'

// iOS report documents: a user takes UserReportCategory, content takes ReportCategory, a post names its channel.
test('a report names its target and a category from the right list', () => {
  assert.deepEqual(reportRequest({ target: { type: 'user', targetId: 'u1' }, category: 'minor_safety', extra: ' 설명 ' }),
    { target: { type: 'user', targetId: 'u1' }, category: 'minor_safety', extra: '설명' })
  assert.throws(() => reportRequest({ target: { type: 'channel', targetId: 'c1' }, category: 'minor_safety', extra: '' }), 'a user category is not a channel one')
  assert.deepEqual(reportRequest({ target: { type: 'post', targetId: 'p1', channelId: 'c1' }, category: 'copyright', extra: '' }).target, { type: 'post', targetId: 'p1', channelId: 'c1' })
  assert.throws(() => reportRequest({ target: { type: 'post', targetId: 'p1' }, category: 'spam', extra: '' }), 'a post needs its channel')
  assert.throws(() => reportRequest({ target: { type: 'user', targetId: 'u1' }, category: 'spam', extra: 'x'.repeat(1001) }))
})

// B50: a report alone no longer blocks the person (the review's test report blocked a test account on iOS).
test('reporting a person does not block them unless the reporter turns it on', () => {
  assert.equal(reportAlsoBlocksByDefault, false)
})

// A10 §3-1 (Telegram R-55): a message, a channel comment and a story are reported as themselves, with exactly the
// fields firestore.rules isValidReport allows for each kind.
const allowed: Record<string, string[]> = {
  message: ['type', 'targetId', 'chatId', 'reporterId', 'category', 'extra', 'createdAt'],
  comment: ['type', 'targetId', 'channelId', 'postId', 'reporterId', 'category', 'extra', 'createdAt'],
  story: ['type', 'targetId', 'ownerType', 'ownerId', 'reporterId', 'category', 'extra', 'createdAt']
}
test('message, comment and story reports carry their own coordinates and nothing else', () => {
  const cases = [
    { target: { type: 'message', targetId: 'm1', chatId: 'c1' }, own: { chatId: 'c1' } },
    { target: { type: 'comment', targetId: 'k1', channelId: 'ch1', postId: 'p1' }, own: { channelId: 'ch1', postId: 'p1' } },
    { target: { type: 'story', targetId: 's1', ownerType: 'channel', ownerId: 'ch1' }, own: { ownerType: 'channel', ownerId: 'ch1' } }
  ]
  for (const { target, own } of cases) {
    const request = reportRequest({ target, category: 'spam', extra: ' 설명 ' })
    const fields = reportFields('me', request, 1_700_000_000_123)
    assert.ok(Object.keys(fields).every(key => allowed[target.type]!.includes(key)), `${target.type}: only the rule's fields`)
    for (const [key, value] of Object.entries(own)) assert.equal((fields[key] as { stringValue: string }).stringValue, value)
    assert.equal((fields.targetId as { stringValue: string }).stringValue, target.targetId)
    assert.equal((fields.extra as { stringValue: string }).stringValue, '설명')
  }
})
test('the new kinds take the content categories and need their coordinates', () => {
  assert.throws(() => reportRequest({ target: { type: 'message', targetId: 'm1', chatId: 'c1' }, category: 'minor_safety', extra: '' }), 'a person category is not a message one')
  assert.throws(() => reportRequest({ target: { type: 'message', targetId: 'm1' }, category: 'spam', extra: '' }), 'a message needs its chat')
  assert.throws(() => reportRequest({ target: { type: 'comment', targetId: 'k1', channelId: 'ch1' }, category: 'spam', extra: '' }), 'a comment needs its post')
  assert.throws(() => reportRequest({ target: { type: 'story', targetId: 's1', ownerType: 'group', ownerId: 'g1' }, category: 'spam', extra: '' }), 'a story is a person\'s or a channel\'s')
})

// 6A-5 decision (Telegram suggestReport, history_item.cpp:3405-3414): messages are reported in groups only.
test('a message can be reported in a group, not in a 1:1 or a secret chat, where the person is reported', () => {
  assert.deepEqual(['group', 'direct', 'secret', undefined].map(kind => messageReportAllowed(kind as never)), [true, false, false, false])
})
