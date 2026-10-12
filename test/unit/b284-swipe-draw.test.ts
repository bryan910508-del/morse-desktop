import assert from 'node:assert/strict'
import { test } from 'node:test'
import { SwipeBack, SwipeReply } from '../../src/renderer/src/history/use-swipe'

// B284: the swipe is drawn by components that read its frames themselves (the chat no longer reads them in its body,
// which drew the whole history again on every wheel event); with no swipe they read nothing of the page.
test('the plate and the icon read the frames themselves, and the page only while there is a swipe', () => {
  let rows = 0, hosts = 0, reads = 0
  const none = () => { reads++; return null }
  const back = SwipeBack({ frames: none }) as { props: { frame: unknown } }
  assert.equal(back.props.frame, null)
  const reply = SwipeReply({ frames: none, row: () => { rows++; return null }, host: () => { hosts++; return null } }) as { props: { frame: unknown } }
  assert.equal(reply.props.frame, null)
  assert.deepEqual([reads, rows, hosts], [2, 0, 0])
  const frame = { kind: 'reply' as const, ratio: 0.5, translation: -20, reached: false }
  SwipeReply({ frames: () => frame as never, row: () => { rows++; return null }, host: () => { hosts++; return null } })
  assert.deepEqual([rows, hosts], [1, 1])
})
