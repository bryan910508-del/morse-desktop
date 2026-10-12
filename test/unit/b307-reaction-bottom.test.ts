import assert from 'node:assert/strict'
import { test } from 'node:test'
import { keepsBottomOnChange } from '../../src/renderer/src/history/keep-bottom'

// B307 (user: «말풍선에 반응 이모지하면 말풍선이 늘어날 때 메시지입력창 아래에서 위로 올라오는게 느리다»; tdesktop
// updateListSize, history_widget.cpp:8661-8713): a bubble grown by a reaction at the bottom is shown at once — the bottom
// followed in the same pass, not when the server's copy came (measured 653 ms before).
test('a history at its bottom follows a message that changes height', () => {
  assert.equal(keepsBottomOnChange(false, true, true), true)
})
test('one read away from the bottom keeps its place; a scroll already asked for, or a history still settling, decides itself', () => {
  assert.equal(keepsBottomOnChange(false, false, true), false)
  assert.equal(keepsBottomOnChange(true, true, true), false)
  assert.equal(keepsBottomOnChange(false, true, false), false)
})
