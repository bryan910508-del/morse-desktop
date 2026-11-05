import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { defaultReactionSettings, reactionKinds, reactionSettingsPatch } from '../../src/shared/reaction-settings'
import { reactionSettingsWrite } from '../../src/main/network/reaction-settings-write'
import { reactionSettingsOf } from '../../src/main/messaging/reaction-notifications'
import { documents } from '../../src/main/network/firestore-values'

// B545 §5 (contracts/B545-reaction-push.md): the «반응» settings page writes users/{uid}/settings/notify.reactions as the
// phones do — only the changed fields, under an update mask, so the other apps' fields and the rest of the document stay.
test('B545 §5: a change writes only its own reactions field, and the document is made when there is none', () => {
  const write = reactionSettingsWrite('me', { messages: 'everyone' })
  assert.deepEqual(write, { update: { name: `${documents}/users/me/settings/notify`, fields: { reactions: { mapValue: { fields: { messages: { stringValue: 'everyone' } } } } } },
    updateMask: { fieldPaths: ['reactions.messages'] } })
  assert.equal('currentDocument' in write, false, 'no precondition: the first change makes the document')
  const two = reactionSettingsWrite('me', { showSender: false, sound: 'none' })
  assert.deepEqual((two.updateMask as { fieldPaths: string[] }).fieldPaths, ['reactions.showSender', 'reactions.sound'])
})

test('B545 §5: the window may send only the four fields, each with a value the phones write', () => {
  assert.deepEqual(reactionSettingsPatch({ stories: 'nobody', sound: 'default' }), { stories: 'nobody', sound: 'default' })
  for (const bad of [null, [], {}, { messages: 'all' }, { sound: null }, { showSender: 'no' }, { version: 2 }, { messages: 'contacts', extra: 1 }])
    assert.throws(() => reactionSettingsPatch(bad), /Invalid reaction settings/, JSON.stringify(bad))
})

test('B545 §5: the row names the kinds that notify, and nothing written reads as both from my contacts', () => {
  assert.deepEqual(reactionKinds(defaultReactionSettings), ['messages', 'stories'])
  assert.deepEqual(reactionKinds({ ...defaultReactionSettings, messages: 'nobody' }), ['stories'])
  assert.deepEqual(reactionKinds({ ...defaultReactionSettings, messages: 'nobody', stories: 'nobody' }), [])
  const stories = { name: 'x', fields: { reactions: { mapValue: { fields: { stories: { stringValue: 'everyone' } } } } } } as never
  assert.equal(reactionSettingsOf(stories).stories, 'everyone')
})

test('B545 §5: the page sits last in «알림 받기» and opens from it, back to the notifications page', () => {
  const box = readFileSync('src/renderer/src/settings/settings-box.tsx', 'utf8')
  const group = box.slice(box.indexOf("<div className=\"section-label\">{tr('알림 받기')}</div>"), box.indexOf("<div className=\"section-label\">{tr('알림 방식')}</div>"))
  assert.match(group, /<ReactionsEntry accountUid=\{accountUid\} open=\{\(\) => setPage\('reactions'\)\} \/>\n\s*$/)
  assert.match(box, /reactions: 'notifications'/)
})
