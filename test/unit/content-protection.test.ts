import assert from 'node:assert/strict'
import { test } from 'node:test'
import { channelDocumentType } from '../../src/main/accounts/channels'
import type { FirestoreDocument } from '../../src/main/network/firestore-values'

// iOS Channel.requiresContentProtection is `type != .publicChannel`, with the type read from the stored
// field or, for older channels, from isPublic. Anything not proven public is protected.
const fields = (value: Record<string, unknown>): FirestoreDocument['fields'] => value as FirestoreDocument['fields']

test('a channel is public only when its type or its older isPublic flag says so', () => {
  assert.equal(channelDocumentType(fields({ type: { stringValue: 'public' } })), 'public')
  assert.equal(channelDocumentType(fields({ type: { stringValue: 'private' }, isPublic: { booleanValue: true } })), 'private')
  assert.equal(channelDocumentType(fields({ type: { stringValue: 'invite' } })), 'invite')
  assert.equal(channelDocumentType(fields({ isPublic: { booleanValue: true } })), 'public')
  assert.equal(channelDocumentType(fields({ isPublic: { booleanValue: false } })), 'private')
  assert.equal(channelDocumentType(fields({})), 'unknown')
  assert.equal(channelDocumentType(fields({ type: { stringValue: 'secret-club' } })), 'unknown')
})
