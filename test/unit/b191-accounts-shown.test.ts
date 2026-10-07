import assert from 'node:assert/strict'
import { test } from 'node:test'
import { defaultPreferences } from '../../src/shared/model'
import { preferencePatch } from '../../src/shared/validation'

// B191: the main menu's account list started closed every time it opened. Telegram keeps it open until the person
// closes it, and remembers that (Core::Settings::_mainMenuAccountsShown = true, core_settings.h:1146).
test('the account list is open by default, and a settings file without the key opens it too', () => {
  assert.equal(defaultPreferences.mainMenuAccountsShown, true)
  const older = { theme: 'dark' }
  assert.equal({ ...defaultPreferences, ...preferencePatch(older) }.mainMenuAccountsShown, true)
})

test('closing or opening it is saved as the person left it, and only as a yes or no', () => {
  assert.deepEqual(preferencePatch({ mainMenuAccountsShown: false }), { mainMenuAccountsShown: false })
  assert.deepEqual(preferencePatch({ mainMenuAccountsShown: true }), { mainMenuAccountsShown: true })
  assert.throws(() => preferencePatch({ mainMenuAccountsShown: 'no' }))
})
