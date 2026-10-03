import assert from 'node:assert/strict'
import { test } from 'node:test'
import { supportConfigPath, supportUidOf } from '../../src/main/accounts/support-account'
import { documents, type FirestoreDocument } from '../../src/main/network/firestore-values'

// B86 · §25 (Telegram help.getSupport): who answers support is the server's word, app_config/support.uid.
const config = (uid: unknown): FirestoreDocument => ({ name: supportConfigPath, fields: uid === undefined ? {} : { uid: { stringValue: uid } } }) as unknown as FirestoreDocument

test('the support account is the one the server names, and only a user id', () => {
  assert.equal(supportConfigPath, `${documents}/app_config/support`)
  assert.equal(supportUidOf(config('SupportUid123')), 'SupportUid123')
  assert.equal(supportUidOf(config(' SupportUid123 ')), 'SupportUid123')
  assert.equal(supportUidOf(config(undefined)), null, 'no value: chat support is not offered now')
  assert.equal(supportUidOf(config('')), null)
  assert.equal(supportUidOf(config('not/a/uid')), null)
  assert.equal(supportUidOf(null), null, 'no document')
})

test('no constant support account is left in the app', async () => {
  const { readFileSync } = await import('node:fs'), { join } = await import('node:path')
  const session = readFileSync(join(process.cwd(), 'src/main/accounts/session.ts'), 'utf8')
  assert.ok(!session.includes('RAk6jfkPEXhydeuUxG9U36UQP9m1') && !session.includes('morseSupportUid'))
  assert.ok(session.includes("tr('지금은 채팅 문의를 쓸 수 없어요.')"))
})

// A13 §9-2: the «공식 고객센터» mark comes only from the server's field on the public profile, never from a name.
test('only the server\'s official field marks the support account', async () => {
  const { decodePeerProfile } = await import('../../src/main/accounts/peer-profiles')
  const profile = (fields: Record<string, unknown>) => decodePeerProfile({ name: `${documents}/publicProfiles/u`, fields } as unknown as FirestoreDocument, false)
  assert.equal(profile({ displayName: { stringValue: 'Morse 고객센터' }, official: { stringValue: 'support' } })?.official, 'support')
  assert.equal(profile({ displayName: { stringValue: 'Morse 고객센터' } })?.official, null, 'a name that says Morse is not enough')
  assert.equal(profile({ displayName: { stringValue: 'x' }, official: { stringValue: 'admin' } })?.official, null, 'only «support» is known')
})
