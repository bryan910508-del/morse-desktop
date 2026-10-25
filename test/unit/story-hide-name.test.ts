import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { storyHiddenText } from '../../src/renderer/src/stories/stories-row'
import en from '../../src/shared/i18n/en.json'
import ru from '../../src/shared/i18n/ru.json'

// The line after hiding or showing someone's stories (tdesktop Stories::toggleHidden, data_stories.cpp:1334-1346, names
// the person): with a name it says it; with none it says the same without one — never «님의 …» on nothing.
test('the line names the person, or says the same without a name when there is none', () => {
  assert.equal(storyHiddenText('민지', true), '민지님의 스토리를 보관함으로 옮겼어요.')
  assert.equal(storyHiddenText('민지', false), '민지님의 스토리를 다시 대화 목록에 보여요.')
  for (const empty of ['', '  ']) {
    assert.equal(storyHiddenText(empty, true), '스토리를 보관함으로 옮겼어요.')
    assert.equal(storyHiddenText(empty, false), '스토리를 다시 대화 목록에 보여요.')
    assert.doesNotMatch(storyHiddenText(empty, true), /^\s*님/)
  }
  for (const key of ['스토리를 보관함으로 옮겼어요.', '스토리를 다시 대화 목록에 보여요.']) assert.ok(key in en && key in ru, key)
  const row = readFileSync(join(__dirname, '../../src/renderer/src/stories/stories-row.tsx'), 'utf8')
  assert.match(row, /controller\.toast\(storyHiddenText\(name, to\), 'default',/)
})
