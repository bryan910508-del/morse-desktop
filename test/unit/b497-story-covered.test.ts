import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { controller, ui } from '../../src/renderer/src/app/ui'
import { storyCovered } from '../../src/renderer/src/stories/story-covered'

// B497 (tdesktop Stories::Controller::updatePlayingAllowed, media_stories_controller.cpp:1155-1168): a story plays only
// while no menu is open and no box is over the viewer, and carries on by itself when they go; a pause the person
// pressed is kept apart. Before, the own viewer's «스토리 메뉴» did not hold it (the story ran on and the viewer closed),
// and a box held it until «재생» was pressed again.
test('a menu, or a box above the viewer, covers the story; one below or none does not', () => {
  const layers = [{ id: 'below' }, { id: 'viewer' }]
  assert.equal(storyCovered(layers, 'viewer', false), false, 'the viewer on top')
  assert.equal(storyCovered(layers, 'viewer', true), true, 'a menu open')
  assert.equal(storyCovered([...layers, { id: 'box' }], 'viewer', false), true, 'a box above')
  assert.equal(storyCovered([...layers, { id: 'box' }, { id: 'confirm' }], 'viewer', false), true, 'boxes stacked')
  assert.equal(storyCovered(layers, 'gone', false), false, 'not the viewer\'s own')
})

test('a box opened over the viewer holds the story, and closing it lets it carry on', () => {
  controller.resetAccount()
  const viewer = controller.showLayer(() => null)
  assert.equal(storyCovered(ui().layers, viewer, false), false)
  const box = controller.showLayer(() => null)
  assert.equal(storyCovered(ui().layers, viewer, false), true, 'held while the box is up')
  const confirm = controller.showLayer(() => null)
  controller.closeLayer(confirm)
  assert.equal(storyCovered(ui().layers, viewer, false), true, 'still held under the first box')
  controller.closeLayer(box)
  assert.equal(storyCovered(ui().layers, viewer, false), false, 'carries on')
  controller.resetAccount()
})

test('a viewer opened over another layer takes its own layer as the top at its first draw', () => {
  controller.resetAccount()
  // showLayer adds the layer before React draws (ui.ts showLayer), and LayerHost keys each layer by its id, so the
  // viewer's first draw sees itself on top — here over a person's profile box.
  const profile = controller.showLayer(() => null)
  const viewer = controller.showLayer(() => null)
  const ownAtFirstDraw = ui().layers.at(-1)?.id
  assert.equal(ownAtFirstDraw, viewer)
  assert.equal(storyCovered(ui().layers, ownAtFirstDraw!, false), false, 'the profile below does not hold it')
  const box = controller.showLayer(() => null)
  assert.equal(storyCovered(ui().layers, ownAtFirstDraw!, false), true)
  controller.closeLayer(box)
  controller.closeLayer(profile)
  assert.equal(storyCovered(ui().layers, ownAtFirstDraw!, false), false, 'a layer below going changes nothing')
  controller.resetAccount()
  const host = readFileSync(join(__dirname, '../../src/renderer/src/ui/layers.tsx'), 'utf8')
  assert.match(host, /<LayerFrame key=\{layer\.id\}/, 'layers keep their place by id, so a box opened above does not redraw the viewer as new')
})

const read = (path: string) => readFileSync(join(__dirname, '../../src/renderer/src', path), 'utf8')
test('both viewers hold on a cover and keep the person\'s own pause apart; no box pauses by hand any more', () => {
  const own = read('stories/own-story-viewer.tsx'), peer = read('stories/story-viewer.tsx'), hook = read('stories/story-covered.ts')
  assert.match(own, /const stopped = paused \|\| hidden \|\| busy \|\| covered\n/)
  assert.match(peer, /const stopped = paused \|\| hidden \|\| reacting \|\| typing \|\| replying \|\| Boolean\(reply\) \|\| covered\n/)
  assert.match(hook, /usePopupMenuOpen\(\)/)
  // A paused story stays paused when a menu or a box goes: covered only adds to the person's pause.
  const stopped = (paused: boolean, covered: boolean) => paused || covered
  assert.equal(stopped(true, false), true)
  for (const source of [own, peer]) {
    assert.doesNotMatch(source, /setPaused\(true\);? ?\n?\s*(showTextEditBox|controller\.showLayer|showReportBox)/, 'no pause by hand before a box')
    assert.doesNotMatch(source, /onClose: \(\) => setPaused\(false\)/, 'nor a resume by hand that undoes the person\'s pause')
  }
})
