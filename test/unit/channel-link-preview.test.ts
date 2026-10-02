import assert from 'node:assert/strict'
import { test } from 'node:test'
import { discoveryRow, linkedChannelMetadata, publicChannelMetadata } from '../../src/main/accounts/channel-discovery-values'
import { documents, type FirestoreDocument } from '../../src/main/network/firestore-values'

// A channel's plain share link (https://talky-a38c3.web.app/channel/<id>) opens any channel, as iOS opens it: a private
// one used to fail here with the English «Invalid public channel», even for its owner, and could not be asked to join.
const channel = (fields: Record<string, unknown>, id = 'c1'): FirestoreDocument => ({
  name: `${documents}/channels/${id}`, updateTime: { seconds: '1788220900', nanos: 0 },
  fields: { name: { stringValue: '채널' }, ownerId: { stringValue: 'owner' }, createdAt: { timestampValue: { seconds: '1788220800', nanos: 0 } },
    description: { stringValue: '소개' }, subscriberCount: { integerValue: '12' }, ...fields } as FirestoreDocument['fields']
})
const isPublic = (value: boolean) => ({ isPublic: { booleanValue: value } })
const type = (value: string) => ({ type: { stringValue: value } })

test('a link shows any channel, and says whether anyone may read its posts', () => {
  assert.equal(linkedChannelMetadata(channel({ ...isPublic(true), ...type('public') })).access, 'public')
  assert.equal(linkedChannelMetadata(channel(isPublic(true))).access, 'public', 'a channel made before `type` existed')
  assert.equal(linkedChannelMetadata(channel({ ...isPublic(false), ...type('private') })).access, 'private')
  assert.equal(linkedChannelMetadata(channel({ ...isPublic(false), ...type('invite') })).access, 'invite')
  assert.equal(linkedChannelMetadata(channel({})).access, 'private', 'no public flag is not public')
  // The rules read isPublic alone, and the app has always also required the stored type to agree.
  assert.equal(linkedChannelMetadata(channel({ ...isPublic(true), ...type('private') })).access, 'private')
  const closed = linkedChannelMetadata(channel({ ...isPublic(false), ...type('private') }))
  assert.deepEqual({ id: closed.id, name: closed.name, description: closed.description, subscriberCount: closed.subscriberCount }, { id: 'c1', name: '채널', description: '소개', subscriberCount: 12 })
})

test('search, sharing and public posts keep to public channels, in words a person can read', () => {
  assert.equal(publicChannelMetadata(channel({ ...isPublic(true), ...type('public') })).access, 'public')
  for (const fields of [{ ...isPublic(false), ...type('private') }, { ...isPublic(false), ...type('invite') }, {}]) {
    assert.throws(() => publicChannelMetadata(channel(fields)), (error: Error) => error.message === '현재 공개 채널을 확인할 수 없습니다.')
    assert.throws(() => discoveryRow(channel(fields), '채', null, 'name'))
  }
})

test('a document that cannot be shown is a channel that was not found, never the raw decoder text', () => {
  const missing = [{ name: { stringValue: ' ' } }, { createdAt: { nullValue: null } }]
  for (const fields of missing) {
    assert.throws(() => linkedChannelMetadata(channel({ ...isPublic(false), ...fields })), (error: Error) => error.message === '채널을 찾지 못했습니다.')
  }
  assert.throws(() => linkedChannelMetadata({ ...channel(isPublic(true)), updateTime: undefined }), (error: Error) => error.message === '채널을 찾지 못했습니다.')
  for (const fields of [{ ...isPublic(false), ...type('private') }, { name: { stringValue: '' } }]) {
    try { publicChannelMetadata(channel(fields)) } catch (error) { assert.doesNotMatch((error as Error).message, /Invalid public channel/) }
  }
})
