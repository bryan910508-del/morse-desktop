import assert from 'node:assert/strict'
import { test } from 'node:test'
import { autoDownloadChoices, autoDownloadDefaultBytes, autoDownloadLimit, autoDownloadLimits, autoDownloadSource } from '../../src/shared/auto-download'
import { defaultPreferences } from '../../src/shared/model'
import { preferencePatch } from '../../src/shared/validation'
import type { DialogSummary } from '../../src/shared/model'

// Data::AutoDownload: automatic media download is a limit in bytes kept for each kind of peer a message
// can come from, not a switch. kDefaultMaxSize (8 MiB) is what SetDefaultsForSource gives a photo, and
// zero is off (SetDisabledForSource).
const room = (kind: DialogSummary['kind']): DialogSummary => ({ kind }) as DialogSummary

test('a photo comes from a person, a group or a channel, as SourceFromPeer decides', () => {
  assert.equal(autoDownloadSource(room('direct')), 'user')
  assert.equal(autoDownloadSource(room('secret')), 'user')
  // A channel's discussion room is a megagroup, so it is a group like any other.
  assert.equal(autoDownloadSource(room('group')), 'group')
  // A room this account has no dialog for is a channel's own 1:1 inquiry.
  assert.equal(autoDownloadSource(null, true), 'channel')
})

test('Telegram’s default is 8 MiB for every source, and zero is off', () => {
  assert.equal(autoDownloadDefaultBytes, 8 * 1024 * 1024)
  assert.deepEqual(defaultPreferences.autoDownloadPhotos, { user: autoDownloadDefaultBytes, group: autoDownloadDefaultBytes, channel: autoDownloadDefaultBytes })
  assert.equal(autoDownloadLimit(defaultPreferences, 'group'), autoDownloadDefaultBytes)
  assert.equal(autoDownloadLimit({ autoDownloadPhotos: { user: 0, group: 0, channel: 0 } }, 'user'), 0)
  assert.ok(autoDownloadChoices.includes(0) && autoDownloadChoices.includes(autoDownloadDefaultBytes))
})

// The switch this replaced is still in the settings people already have on disk.
test('the setting people already had becomes the limits it meant', () => {
  assert.deepEqual(autoDownloadLimits(true), { user: autoDownloadDefaultBytes, group: autoDownloadDefaultBytes, channel: autoDownloadDefaultBytes })
  assert.deepEqual(autoDownloadLimits(false), { user: 0, group: 0, channel: 0 })
  assert.deepEqual(autoDownloadLimits(undefined), { user: autoDownloadDefaultBytes, group: autoDownloadDefaultBytes, channel: autoDownloadDefaultBytes })
  assert.deepEqual(preferencePatch({ autoDownloadPhotos: false }).autoDownloadPhotos, { user: 0, group: 0, channel: 0 })
  const chosen = { user: 0, group: 1024 * 1024, channel: autoDownloadDefaultBytes }
  assert.deepEqual(preferencePatch({ autoDownloadPhotos: chosen }).autoDownloadPhotos, chosen)
})

test('a size this window does not offer is refused instead of stored', () => {
  for (const value of [{ user: 5, group: 0, channel: 0 }, { user: 0, group: 0 }, { user: -1, group: 0, channel: 0 }, 'off', 12, null])
    assert.throws(() => autoDownloadLimits(value), /사진 자동 내려받기/)
})
