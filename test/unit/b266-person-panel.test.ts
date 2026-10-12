import assert from 'node:assert/strict'
import { test } from 'node:test'
import { controller, ui } from '../../src/renderer/src/app/ui'

// B266: a person opens in the third column over whatever is there (tdesktop showPeerInfo); back returns to the panel it
// opened over, close shuts the column, and a person opened from a person's panel goes back to the same first panel.
test('the person panel opens over the open panel and goes back to it', () => {
  controller.openChannel('ch1', 'p1'); controller.setRight('comments')
  controller.openPersonInfo('u2', '댓글 작성자')
  assert.deepEqual([ui().right, ui().person], ['person', { uid: 'u2', hint: '댓글 작성자', back: 'comments' }])
  controller.openPersonInfo('u3')
  assert.deepEqual(ui().person, { uid: 'u3', hint: '', back: 'comments' }, 'one step back, to the comments')
  controller.closePerson(true)
  assert.deepEqual([ui().right, ui().person], ['comments', null])
  controller.openPersonInfo('u2')
  controller.closePerson(false)
  assert.deepEqual([ui().right, ui().person], [null, null])
  controller.openChat('c1')
  controller.openPersonInfo('u2')
  assert.equal(ui().person?.back, null)
  controller.openChat('c2')
  assert.equal(ui().right, null, 'another chat does not keep a person open')
})
