import assert from 'node:assert/strict'
import { test } from 'node:test'
import { fieldHeight } from '../../src/renderer/src/history/field-height'

// B286: the composer's height is measured on a copy, never by collapsing the field itself — that pushed the history
// down for a frame each time a line was added (Phase1: 38 px).
const copy = { value: '', className: '', style: { width: '' }, get scrollHeight() { return 18 + 20 * Math.max(1, this.value.split('\n').length) } }
const field = (value: string) => {
  let height = '78px'
  return { value, className: 'compose-field', offsetWidth: 500, offsetHeight: 78, clientHeight: 76, style: { get height() { return height }, set height(next: string) { height = next } } }
}

test('measured on the copy, with the field\'s class, width and text; the borders are added so the field never scrolls', () => {
  const element = field('one\ntwo\nthree')
  const touched: string[] = []
  const watched = { ...element, style: { get height() { return '78px' }, set height(next: string) { touched.push(next) } } }
  assert.equal(fieldHeight(watched, 224, () => copy), 18 + 60 + 2)
  assert.deepEqual(touched, [], 'the field itself is never set to auto')
  assert.deepEqual([copy.className, copy.style.width, copy.value], ['compose-field', '500px', 'one\ntwo\nthree'])
})

test('one line is the field\'s smallest height; many lines stop at the most it may grow', () => {
  assert.equal(fieldHeight(field(''), 224, () => copy), 18 + 20 + 2)
  assert.equal(fieldHeight(field('a\n'.repeat(30)), 224, () => copy), 224)
})
