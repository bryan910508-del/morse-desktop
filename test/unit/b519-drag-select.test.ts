import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import { applyDragSelection, dragChooses, dragSelectionRange, maxSelectedMessages, type DragRowBox } from '../../src/renderer/src/history/drag-select'

// B519: dragging over the messages chooses them, as tdesktop's HistoryInner does (history_inner_widget.cpp @42f8a36d4):
// text is selected only while the pointer stays in the pressed message (:5474-5477), the range runs from the pressed row
// to the row under the pointer with Telegram's margin rules (:5677-5711), it chooses or lets go by the first row it
// reaches (:5712-5722), and adds at most MaxSelectedItems (config.h:13) in list order (:6315-6333).
const box: DragRowBox = { height: 60, marginTop: 6, marginBottom: 2 }
const at = (index: number, y: number) => ({ index, y, box })

test('the range runs from the pressed row to the row under the pointer, either way', () => {
  assert.deepEqual(dragSelectionRange({ ...at(2, 30), inside: true }, at(5, 30), 10), { from: 2, to: 5, down: true })
  assert.deepEqual(dragSelectionRange({ ...at(5, 30), inside: true }, at(2, 30), 10), { from: 2, to: 5, down: false })
  assert.deepEqual(dragSelectionRange({ ...at(2, 30), inside: false }, at(5, 30), 10), { from: 2, to: 5, down: true }, 'beside the bubble, not in its margin')
})

test('a press in the pressed row\'s margin on the far side leaves that row out', () => {
  assert.deepEqual(dragSelectionRange({ ...at(2, 59), inside: false }, at(5, 30), 10), { from: 3, to: 5, down: true }, 'below its bubble, going down')
  assert.deepEqual(dragSelectionRange({ ...at(5, 3), inside: false }, at(2, 30), 10), { from: 2, to: 4, down: false }, 'above its bubble, going up')
  assert.deepEqual(dragSelectionRange({ ...at(2, 59), inside: true }, at(5, 30), 10), { from: 2, to: 5, down: true }, 'a press on the bubble keeps it')
})

test('the row under the pointer counts once the pointer is past its near margin', () => {
  assert.deepEqual(dragSelectionRange({ ...at(2, 30), inside: true }, at(5, 3), 10), { from: 2, to: 4, down: true }, 'only in its top margin, going down')
  assert.deepEqual(dragSelectionRange({ ...at(5, 30), inside: true }, at(2, 59), 10), { from: 3, to: 5, down: false }, 'only in its bottom margin, going up')
  assert.deepEqual(dragSelectionRange({ ...at(2, 30), inside: true }, at(5, 6), 10), { from: 2, to: 5, down: true })
})

test('in the pressed row, a press beside the bubble chooses it only after the drag distance', () => {
  assert.equal(dragSelectionRange({ ...at(2, 20), inside: false }, at(2, 25), 10), null)
  assert.deepEqual(dragSelectionRange({ ...at(2, 20), inside: false }, at(2, 35), 10), { from: 2, to: 2, down: true })
  assert.equal(dragSelectionRange({ ...at(2, 40), inside: false }, at(2, 35), 10), null, 'going up, inside the distance')
  assert.deepEqual(dragSelectionRange({ ...at(2, 20), inside: true }, at(2, 25), 10), { from: 2, to: 2, down: true }, 'on the bubble it is chosen')
  assert.equal(dragSelectionRange({ ...at(2, 59), inside: false }, at(3, 3), 10), null, 'from below one bubble to above the next: nothing between')
})

test('the drag chooses the range unless the first row it reaches that can be chosen is chosen already', () => {
  const ids = ['a', 'b', null, 'c']
  assert.equal(dragChooses({ from: 0, to: 3, down: true }, ids, new Set()), true)
  assert.equal(dragChooses({ from: 0, to: 3, down: true }, ids, new Set(['a'])), false)
  assert.equal(dragChooses({ from: 0, to: 3, down: true }, ids, new Set(['c'])), true, 'the far end does not decide')
  assert.equal(dragChooses({ from: 0, to: 3, down: false }, ids, new Set(['c'])), false, 'going up the pressed side is the bottom')
  assert.equal(dragChooses({ from: 2, to: 3, down: false }, ids, new Set(['c'])), false, 'a row that cannot be chosen is passed over')
  assert.equal(dragChooses({ from: 2, to: 2, down: true }, ids, new Set()), false, 'nothing to choose')
})

test('choosing adds in list order up to the limit; letting go removes the range', () => {
  assert.deepEqual(applyDragSelection([], ['a', null, 'b', 'c'], true), ['a', 'b', 'c'])
  assert.deepEqual(applyDragSelection(['x', 'b'], ['a', 'b', 'c'], true), ['x', 'b', 'a', 'c'], 'kept ones stay, once')
  assert.deepEqual(applyDragSelection(['x'], ['a', 'b', 'c'], true, 3), ['x', 'a', 'b'], 'the limit stops it, top first')
  assert.deepEqual(applyDragSelection(['x', 'a', 'b'], ['a', null, 'b', 'c'], false), ['x'])
  assert.equal(maxSelectedMessages, 100)
  const many = Array.from({ length: 150 }, (_, index) => `m${index}`)
  assert.equal(applyDragSelection([], many, true).length, 100)
})

test('the history wires the drag where «메시지 선택» is offered, draws it before it ends, and Delete asks to delete', () => {
  const widget = readFileSync('src/renderer/src/history/history-widget.tsx', 'utf8')
  assert.match(widget, /useDragSelect\(scroll, \{/)
  assert.match(widget, /owner!\.kind !== 'secret' && !owner!\.service && !owner!\.restricted && current\.current\.status === 'ready'/)
  assert.match(widget, /entry\.message\.version && !entry\.message\.system && !entry\.message\.channelPost \? entry\.message\.id : null/, 'what the «선택» menu can choose')
  assert.match(widget, /selected=\{dragPreview\?\.ids\.has\(entry\.message\.id\) \? dragPreview\.choose : selection\?\.includes\(entry\.message\.id\) \?\? false\}/)
  assert.match(widget, /event\.key !== 'Delete' && event\.key !== 'Backspace'[\s\S]{0,300}void removeMessages\(selected\)/)
  const hook = readFileSync('src/renderer/src/history/use-drag-select.ts', 'utf8')
  assert.match(hook, /if \(!key \|\| key === mode\.start\.key\) return\n\s*toRange\(mode\.start\)/, 'text gives way only in another row')
  assert.match(hook, /window\.getSelection\(\)\?\.removeAllRanges\(\)/)
  assert.match(hook, /optionsRef\.current\.chosen\(\) === null && target\.closest\('\.selectable'\) \? \{ kind: 'text', start \} : \{ kind: 'prepare', start \}/, 'while chosen, no text')
  assert.match(hook, /swallowClick = true/, 'the click ending a drag toggles nothing')
  const css = readFileSync('src/renderer/src/styles/history.css', 'utf8')
  assert.match(css, /\.history-scroll\.drag-choosing \.selectable \{ user-select: none/)
})

test('a row\'s bubble is its message\'s, not the date pill above it', () => {
  const hook = readFileSync('src/renderer/src/history/use-drag-select.ts', 'utf8')
  assert.match(hook, /row\.querySelector<HTMLElement>\('\.history-message \.bubble'\) \?\? row\.querySelector<HTMLElement>\('\.history-service > \*'\)/)
  assert.doesNotMatch(hook, /'\.bubble, \.service-pill/)
})

test('a click beside the text lets the list\'s text selection go, as tdesktop\'s does', () => {
  const hook = readFileSync('src/renderer/src/history/use-drag-select.ts', 'utf8')
  assert.match(hook, /if \(was\.kind === 'prepare'\) \{\n\s*const selection = window\.getSelection\(\)\n\s*if \(selection && !selection\.isCollapsed && selection\.anchorNode && element\.contains\(selection\.anchorNode\)\) selection\.removeAllRanges\(\)/)
})
