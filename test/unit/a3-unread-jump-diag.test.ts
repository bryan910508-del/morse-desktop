import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { unreadJumpTime } from '../../src/main/accounts/session'

// A3 (0.241.51 Phase1: the «unread» bar 2.1 s late, not reproduced 11-05 at 108 / 149 ms): the unread jump records how it
// ended and how long it took, as a band, so a slow one is seen in history-check.log next time — codes only.
test('A3: the jump time is told in a few bands', () => {
  assert.deepEqual([0, 499, 500, 999, 1000, 2100, 4999, 5000, 60000].map(unreadJumpTime), ['<0.5s', '<0.5s', '0.5-1s', '0.5-1s', '1-2s', '2-5s', '2-5s', '>5s', '>5s'])
})
test('A3: every way the jump ends is recorded, with no ids or text', () => {
  const session = readFileSync('src/main/accounts/session.ts', 'utf8')
  const body = session.slice(session.indexOf('  async jumpUnread(chatId: string)'), session.indexOf('  async jumpMessage('))
  for (const how of ["done('left')", "done(result ? 'found' : 'none')", "done('failed')"]) assert.ok(body.includes(how), how)
  assert.match(body, /recordHistoryStep\('unread-jump', `\$\{how\} \$\{unreadJumpTime\(Date\.now\(\) - started\)\}`\)/)
})
