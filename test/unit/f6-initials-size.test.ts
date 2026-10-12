import assert from 'node:assert/strict'
import { test } from 'node:test'
import { initialsSize } from '../../src/renderer/src/ui/avatar'

// F6 — Ui::EmptyUserpic::paint (ui/empty_userpic.cpp:300): the letters are 13/33 of the photo's size wherever it is drawn.
test('the letters of a picture-less photo follow its size', () => {
  assert.equal(initialsSize(33), 13)
  assert.equal(initialsSize(46), 18)
  assert.equal(initialsSize(88), 35)
  assert.equal(initialsSize(20), 8)
})
