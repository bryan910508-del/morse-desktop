import assert from 'node:assert/strict'
import { test } from 'node:test'
import { featureAccessPath, featureOn, featureSwitches, type FeatureSwitchName } from '../../src/main/api/feature-switch'
import { decodeTwoStepSettings } from '../../src/main/api/two-step-settings'
import { qrSwitchOn } from '../../src/main/auth/qr-login'

// Server r35 §1 (morse-feature-switch.js decide(), MorseIOS fca81df6) and Android FeatureSwitchTest (e8ed5297): the
// same table, so the app offers what the server allows.
const doc = (fields: Record<string, unknown>) => ({ name: 'x', fields }) as never
const flag = (value: unknown) => typeof value === 'boolean' ? { booleanValue: value } : { stringValue: String(value) }
const names = Object.keys(featureSwitches) as FeatureSwitchName[]

test('a switch is on for everyone or for the account', () => {
  for (const name of names) {
    const field = featureSwitches[name]
    assert.equal(featureOn(name, doc({ enabled: flag(true) }), null), true, name)
    assert.equal(featureOn(name, doc({ enabled: flag(true) }), doc({ [field]: flag(false) })), true, name)
    assert.equal(featureOn(name, null, doc({ [field]: flag(true) })), true, name)
    assert.equal(featureOn(name, doc({ enabled: flag(false) }), doc({ [field]: flag(true) })), true, name)
  }
})

test('off unless one says true', () => {
  for (const name of names) {
    assert.equal(featureOn(name, null, null), false, 'no documents')
    assert.equal(featureOn(name, doc({ enabled: flag(false) }), null), false, 'an unread account document is none')
    assert.equal(featureOn(name, doc({ enabled: flag('true') }), doc({ [featureSwitches[name]]: flag('true') })), false, '=== true only')
    const others = Object.fromEntries(names.filter(other => other !== name).map(other => [featureSwitches[other], flag(true)]))
    assert.equal(featureOn(name, null, doc(others)), false, 'another switch\'s field')
  }
})

test('the server\'s names', () => {
  assert.deepEqual(featureSwitches, { qr_login: 'qrLogin', two_step: 'twoStep', system_notices: 'systemNotices', sticker_reference_send: 'stickerReferenceSend' })
  assert.equal(featureAccessPath('u1'), 'users/u1/featureAccess/state')
})

test('two-step: a password may be set while the switch is on for this account alone', () => {
  assert.equal(decodeTwoStepSettings(null, doc({ enabled: flag(false) }), doc({ twoStep: flag(true) })).available, true)
  assert.equal(decodeTwoStepSettings(null, doc({ enabled: flag(false) }), doc({ qrLogin: flag(true) })).available, false)
  assert.equal(decodeTwoStepSettings(null, doc({ enabled: flag(false) }), null).available, false)
})

test('QR before sign-in (가): a release shows it only when on for everyone; a test build also while testing', () => {
  const testing = { fields: { enabled: { booleanValue: false }, testing: { booleanValue: true } } }
  assert.equal(qrSwitchOn(testing), false, 'release')
  assert.equal(qrSwitchOn(testing, true), true, 'Phase1 or a development run')
  assert.equal(qrSwitchOn({ fields: { enabled: { booleanValue: true } } }), true)
  assert.equal(qrSwitchOn({ fields: { testing: { stringValue: 'true' } } }, true), false)
  assert.equal(qrSwitchOn(null, true), false)
})
