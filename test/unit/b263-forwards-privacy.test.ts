import assert from 'node:assert/strict'
import { test } from 'node:test'
import { AccountToolsApi } from '../../src/main/api/account-tools'
import { privacyKey, privacyRule } from '../../src/shared/account-tools'
import type { AccountAuthorization } from '../../src/main/messaging/outbox'

// B263 §4: «전달된 메시지» is lastSeen's twin — users/{uid}.privacy.forwards, saved as syncPrivacySettings' forwardsPrivacy.
function tools(stored: Record<string, unknown> | null) {
  const api = new AccountToolsApi('me', {} as AccountAuthorization, () => true) as unknown as Record<string, unknown>
  const calls: { name: string; data: Record<string, unknown> }[] = []
  api.call = async (name: string, data: Record<string, unknown>) => { calls.push({ name, data }); return {} }
  api.read = async (work: (reader: unknown, signal: AbortSignal) => Promise<unknown>) => work({ getDocument: async (path: string) => {
    assert.equal(path.endsWith('/users/me'), true)
    return stored ? { name: path, fields: { privacy: { mapValue: { fields: stored } } } } : null
  } }, new AbortController().signal)
  return { api: api as unknown as AccountToolsApi, calls }
}
const rule = (mode: string, always: string[] = [], never: string[] = []) => ({ mapValue: { fields: { mode: { stringValue: mode },
  alwaysShareWith: { arrayValue: { values: always.map(stringValue => ({ stringValue })) } }, neverShareWith: { arrayValue: { values: never.map(stringValue => ({ stringValue })) } } } } })

test('each key reads its own rule, everybody when nothing is stored', async () => {
  const { api } = tools({ lastSeen: rule('nobody'), forwards: rule('contacts', ['a1'], ['b1', 'b2']) })
  assert.deepEqual(await api.privacyRule('forwards'), { mode: 'contacts', alwaysShareWith: ['a1'], neverShareWith: ['b1', 'b2'] })
  assert.deepEqual(await api.privacyRule('lastSeen'), { mode: 'nobody', alwaysShareWith: [], neverShareWith: [] })
  assert.deepEqual(await tools(null).api.privacyRule('forwards'), { mode: 'everybody', alwaysShareWith: [], neverShareWith: [] })
  assert.deepEqual(await tools({ forwards: rule('odd') }).api.privacyRule('forwards'), { mode: 'everybody', alwaysShareWith: [], neverShareWith: [] })
})

test('each key saves under its own name, exceptions kept', async () => {
  const { api, calls } = tools(null)
  await api.setPrivacyRule('forwards', { mode: 'nobody', alwaysShareWith: ['a1'], neverShareWith: [] })
  await api.setPrivacyRule('lastSeen', { mode: 'contacts', alwaysShareWith: [], neverShareWith: ['b1'] })
  assert.deepEqual(calls, [
    { name: 'syncPrivacySettings', data: { forwardsPrivacy: { mode: 'nobody', alwaysShareWith: ['a1'], neverShareWith: [] } } },
    { name: 'syncPrivacySettings', data: { lastSeenPrivacy: { mode: 'contacts', alwaysShareWith: [], neverShareWith: ['b1'] } } }])
})

test('the window may name only a known key and a whole rule', () => {
  assert.equal(privacyKey('forwards'), 'forwards')
  assert.equal(privacyKey('lastSeen'), 'lastSeen')
  assert.throws(() => privacyKey('profilePhoto'))
  assert.throws(() => privacyKey('__proto__'))
  assert.deepEqual(privacyRule({ mode: 'contacts', alwaysShareWith: ['a1'], neverShareWith: [] }), { mode: 'contacts', alwaysShareWith: ['a1'], neverShareWith: [] })
  assert.throws(() => privacyRule({ mode: 'all', alwaysShareWith: [], neverShareWith: [] }))
  assert.throws(() => privacyRule({ mode: 'nobody', alwaysShareWith: [], neverShareWith: [], extra: 1 }))
})
