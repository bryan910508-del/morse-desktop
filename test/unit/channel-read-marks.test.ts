import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ChannelReadMarks } from '../../src/main/accounts/channel-read-marks'
import type { MessagePosition } from '../../src/shared/model'

// MorseChannelPostReadMarks: the furthest post seen in a joined channel, someone else's, forward only.
const at = (seconds: number, id: string, nanoseconds = 0): MessagePosition => ({ seconds, nanoseconds, id })
const post = (id: string, seconds: number, own = false, nanoseconds = 0) => ({ id, position: at(seconds, id, nanoseconds), own })
const flush = (): Promise<void> => new Promise(resolve => setImmediate(resolve))

test('the furthest post of someone else moves the mark, and only forward', async () => {
  const writes: [string, MessagePosition, string][] = []
  const marks = new ChannelReadMarks(async (channelId, position, postId) => { writes.push([channelId, position, postId]) })
  assert.equal(marks.seen('ch1', [post('p1', 100), post('p3', 300), post('p2', 200)], true), true)
  assert.deepEqual(writes.map(([, , id]) => id), ['p3'], 'one write, for the furthest')
  assert.equal(marks.seen('ch1', [post('p2', 200)], true), false, 'an older post does not move it back')
  assert.equal(marks.seen('ch1', [post('p3', 300)], true), false, 'the same post twice is one write')
  assert.equal(marks.seen('ch1', [post('p4', 300, false, 5)], true), true, 'nanoseconds count, as the stored timestamp does')
  assert.equal(marks.seen('ch1', [post('p9', 900, true)], true), false, 'my own post is always read and never written')
  assert.equal(marks.seen('ch2', [post('q1', 50)], false), false, 'a channel I have not joined writes nothing')
  assert.equal(marks.seen('ch2', [post('q1', 50)], true), true, 'marks are per channel')
  assert.deepEqual(writes.map(([channel, , id]) => `${channel}/${id}`), ['ch1/p3', 'ch1/p4', 'ch2/q1'])
  assert.deepEqual(writes[0]![1], at(300, 'p3'), 'the post’s own moment is written')
  marks.close()
  assert.equal(marks.seen('ch1', [post('p5', 999)], true), false)
})

test('a refused write gives the channel back its earlier mark, so a later post is tried again', async () => {
  let refuse = true
  const writes: string[] = []
  const marks = new ChannelReadMarks(async (_channel, _position, postId) => { writes.push(postId); if (refuse) throw new Error('rules') })
  marks.seen('ch1', [post('p2', 200)], true)
  await flush()
  refuse = false
  assert.equal(marks.seen('ch1', [post('p2', 200)], true), true, 'the refused one may go again')
  await flush()
  assert.equal(marks.seen('ch1', [post('p2', 200)], true), false)
  assert.deepEqual(writes, ['p2', 'p2'])
})
