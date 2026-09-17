import assert from 'node:assert/strict'
import { test } from 'node:test'
import { reportRequest } from '../../src/shared/reports'

// iOS report documents: a user takes UserReportCategory, content takes ReportCategory, a post names its channel.
test('a report names its target and a category from the right list', () => {
  assert.deepEqual(reportRequest({ target: { type: 'user', targetId: 'u1' }, category: 'minor_safety', extra: ' 설명 ' }),
    { target: { type: 'user', targetId: 'u1' }, category: 'minor_safety', extra: '설명' })
  assert.throws(() => reportRequest({ target: { type: 'channel', targetId: 'c1' }, category: 'minor_safety', extra: '' }), 'a user category is not a channel one')
  assert.deepEqual(reportRequest({ target: { type: 'post', targetId: 'p1', channelId: 'c1' }, category: 'copyright', extra: '' }).target, { type: 'post', targetId: 'p1', channelId: 'c1' })
  assert.throws(() => reportRequest({ target: { type: 'post', targetId: 'p1' }, category: 'spam', extra: '' }), 'a post needs its channel')
  assert.throws(() => reportRequest({ target: { type: 'user', targetId: 'u1' }, category: 'spam', extra: 'x'.repeat(1001) }))
})
