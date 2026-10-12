import assert from 'node:assert/strict'
import { test } from 'node:test'
import { fullscreenAllowed } from '../../src/main/platform/fullscreen-permission'
import { escapeAfterFullScreenMs, leaveFullScreenOnEscape, noteFullScreenLeft, toggleVideoFullScreen, videoFullScreenKey } from '../../src/renderer/src/media/viewer-keys'

// B301: a video goes full screen — the «fullscreen» permission for this app's own page only, and tdesktop's keys.
const trusted = (url: string) => url === 'morse://app/index.html'
test('full screen is allowed for the main window\'s main frame at the app\'s own address only', () => {
  assert.equal(fullscreenAllowed(true, true, 'morse://app/index.html', trusted), true)
  assert.equal(fullscreenAllowed(false, true, 'morse://app/index.html', trusted), false, 'another window')
  assert.equal(fullscreenAllowed(true, false, 'morse://app/index.html', trusted), false, 'a subframe')
  assert.equal(fullscreenAllowed(true, true, 'https://example.com/', trusted), false, 'another origin')
})

const key = (k: string, extra: Partial<{ code: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean }> = {}) =>
  ({ key: k, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...extra })
test('Ctrl/⌘+F and Ctrl/⌘/Alt+Enter toggle the video full screen; plain keys do not', () => {
  for (const event of [key('f', { ctrlKey: true, code: 'KeyF' }), key('f', { metaKey: true, code: 'KeyF' }), key('ㄹ', { metaKey: true, code: 'KeyF' }),
    key('Enter', { ctrlKey: true }), key('Enter', { altKey: true }), key('Enter', { metaKey: true })]) assert.equal(videoFullScreenKey(event), true, JSON.stringify(event))
  for (const event of [key('f'), key('Enter'), key('f', { ctrlKey: true, shiftKey: true }), key('f', { ctrlKey: true, altKey: true })]) assert.equal(videoFullScreenKey(event), false, JSON.stringify(event))
})

test('the toggle enters with the video and leaves when something is full screen; Esc leaves it and keeps the viewer', async () => {
  const calls: string[] = []
  const video = { requestFullscreen: async () => { calls.push('enter') } } as unknown as HTMLElement
  toggleVideoFullScreen(video, { fullscreenElement: null, exitFullscreen: async () => { calls.push('exit') } })
  toggleVideoFullScreen(video, { fullscreenElement: video as unknown as Element, exitFullscreen: async () => { calls.push('exit') } })
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(calls, ['enter', 'exit'])
  assert.equal(leaveFullScreenOnEscape('Escape', { fullscreenElement: null, exitFullscreen: async () => {} }), false, 'not full screen: Esc closes the viewer')
  assert.equal(leaveFullScreenOnEscape('Escape', { fullscreenElement: video as unknown as Element, exitFullscreen: async () => {} }), true)
})

test('the Esc Chromium hands over just after it ended the full screen itself is taken too; a later one closes the viewer', () => {
  const none = { fullscreenElement: null, exitFullscreen: async () => {} }
  noteFullScreenLeft(1000)
  assert.equal(leaveFullScreenOnEscape('Escape', none, 1000 + 50), true)
  assert.equal(leaveFullScreenOnEscape('Escape', none, 1000 + escapeAfterFullScreenMs + 1), false)
  assert.equal(leaveFullScreenOnEscape('ArrowLeft', none, 1000 + 50), false)
})
