import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SettingsStore } from '../../src/main/platform/settings'
import { defaultPreferences } from '../../src/shared/model'

// A settings file written by another version of the app: what it no longer knows is left behind, so the app still
// opens. A value that is known but wrong is still refused, and the file is kept either way.
async function store(contents: string): Promise<{ store: SettingsStore; path: string }> {
  const directory = await mkdtemp(join(tmpdir(), 'morse-settings-'))
  const path = join(directory, 'preferences.json')
  await writeFile(path, contents)
  return { store: new SettingsStore(directory), path }
}

test('a setting this version does not know is left behind', async () => {
  const { store: settings, path } = await store(JSON.stringify({ version: 1, preferences: { theme: 'dark', autoDeleteOnlyMyMessages: false, messageFontSize: 17 } }))
  await settings.load()
  assert.equal(settings.preferences.theme, 'dark')
  assert.equal(settings.preferences.messageFontSize, 17, 'the settings beside it are kept')
  assert.equal('autoDeleteOnlyMyMessages' in settings.preferences, false)
  assert.ok((await readFile(path, 'utf8')).includes('autoDeleteOnlyMyMessages'), 'the file is not rewritten by reading it')
})

test('a setting that is known but wrong still refuses the file, and an empty one falls back', async () => {
  const bad = await store(JSON.stringify({ version: 1, preferences: { theme: 'aquamarine' } }))
  await assert.rejects(bad.store.load())
  const missing = await store(JSON.stringify({ version: 1 }))
  await missing.store.load()
  assert.deepEqual(missing.store.preferences, defaultPreferences)
  const old = await store(JSON.stringify({ version: 2, preferences: {} }))
  await assert.rejects(old.store.load(), /설정 파일을 읽을 수 없습니다/)
})
