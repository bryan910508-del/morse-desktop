import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import './b384-dom-stub'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { desktop } from '../../src/renderer/src/app/store'
import { UpdateBar } from '../../src/renderer/src/window/update-bar'
import { IntroUpdate } from '../../src/renderer/src/auth/intro'
import { updateReady, type AppUpdateSnapshot } from '../../src/shared/app-updates'
import { setLanguage } from '../../src/shared/i18n'
import type { DesktopSnapshot } from '../../src/shared/model'

// B456 (user 10-16 19:2x «업데이트 표시가 채팅 목록에서만 보인다»): the bar sat inside the chat list, so the channels and notes
// columns had none. tdesktop's left column is always the chat list, its bar under it (dialogs_widget.cpp:2624-2659, :4645),
// so it is in view beside whatever else is open; here the bar belongs to the left column itself.
const update = (patch: Partial<AppUpdateSnapshot>): AppUpdateSnapshot => ({ available: true, status: 'idle', version: null, progress: 0, ...patch })
let revision = 0
const show = (appUpdate: AppUpdateSnapshot): void => desktop.replace({ revision: ++revision, appUpdate } as unknown as DesktopSnapshot)

test('only a downloaded version is offered — not while checking or downloading, and not in a build with no updater', () => {
  assert.equal(updateReady(update({ status: 'ready', version: '0.241.39', progress: 1 })), true)
  for (const status of ['idle', 'checking', 'latest', 'downloading', 'error'] as const) assert.equal(updateReady(update({ status })), false, status)
  assert.equal(updateReady(update({ available: false, status: 'ready' })), false)
  assert.equal(updateReady(null), false)
})

test('the bar and the sign-in screen\'s button come and go with that one reading', () => {
  setLanguage('ko')
  show(update({ status: 'downloading', progress: 0.5 }))
  assert.equal(renderToStaticMarkup(createElement(UpdateBar)), '')
  assert.equal(renderToStaticMarkup(createElement(IntroUpdate)), '')
  show(update({ status: 'ready', version: '0.241.39', progress: 1 }))
  assert.match(renderToStaticMarkup(createElement(UpdateBar)), /class="dialogs-update"[^>]*>Morse 업데이트</)
  assert.match(renderToStaticMarkup(createElement(IntroUpdate)), /intro-update[^>]*>업데이트</)
})

test('the bar is the left column\'s, under the chats, the channels and the notes alike; the chat list has none of its own', () => {
  const source = (path: string): string => readFileSync(`src/renderer/src/${path}`, 'utf8')
  const window = source('window/main-window.tsx')
  const column = window.slice(window.indexOf('<aside className="column-left"'), window.indexOf('</aside>', window.indexOf('<aside className="column-left"')))
  assert.match(column, /<NotesWidget[^]*<ChannelsWidget[^]*<DialogsWidget[^]*\}\s*<UpdateBar \/>\s*$/, 'one bar after whichever section the column shows')
  assert.doesNotMatch(source('dialogs/dialogs-widget.tsx'), /dialogs-update|installAppUpdate/)
  assert.match(window, /<Intro \/><IntroUpdate \/>/)
  assert.match(source('settings/settings-box.tsx'), /page === 'main' && <>\s*<ReadyUpdateEntry \/>/, 'Settings\' first page, which covers the window, offers it too')
})
