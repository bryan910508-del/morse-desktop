import assert from 'node:assert/strict'
import { test } from 'node:test'
import { textDigest, textDigestMatches, forwardSourceValid } from '../../src/main/messaging/text-identity'
import { forwardWireSource } from '../../src/shared/channel-inquiries'
import type { SendWire } from '../../src/shared/model'

// B263 §2-1 (contracts/B263-forwarded-from.md): a forward names its original — forwardSource {kind, roomId, messageId},
// right after isForwarded in the server's canonical payload, in the digest, never stored.
test('§2-1a: the shared digest vectors (text, sticker) — and the B253 ones without forwardSource stay as they were', () => {
  const text = { id: 'msg_vector_b253', chatId: 'chat_vector_b253', senderId: 'uid_vector_b253', type: 'text', text: 'B253 forward vector', isSilent: false, isEncrypted: false,
    protocolVersion: 3, isForwarded: true, forwardSource: { kind: 'chat', roomId: 'room_vector_b263', messageId: 'msg_source_b263' } } as SendWire
  assert.equal(textDigest(text), '6e2a5178f0847a0fdc00bd74b5b326c511ec5505b0f07ade51bc8beb000f6306')
  const sticker = { id: 'm', chatId: 'c', senderId: 'u', type: 'sticker', text: '', isSilent: false, isEncrypted: false, protocolVersion: 3,
    stickerId: 'a'.repeat(64), stickerKind: 'png', stickerSetId: 'set_vector_b253', isForwarded: true,
    forwardSource: { kind: 'inquiry', roomId: 'room_vector_b263', messageId: 'msg_source_b263' } } as SendWire
  assert.equal(textDigest(sticker), '7546dd6b6c8920c5daf76a4d1f04d855f0cf8d5f679943d99e155597c238ffc0')
  const { forwardSource: _a, ...b253Text } = text as SendWire & { forwardSource?: unknown }
  assert.ok(textDigest(b253Text as SendWire).startsWith('7f8a65aa'), 'B253 text vector')
  const { forwardSource: _b, ...b253Sticker } = sticker as SendWire & { forwardSource?: unknown }
  assert.ok(textDigest(b253Sticker as SendWire).startsWith('c2fd69d8'), 'B253 sticker vector')
})

test('a malformed forwardSource, or one without isForwarded, is left out of the digest as the server leaves it out', () => {
  const base = { id: 'm', chatId: 'c', senderId: 'u', type: 'text', text: 'x', isSilent: false, isEncrypted: false, protocolVersion: 3, isForwarded: true } as SendWire
  for (const bad of [{ kind: 'secret', roomId: 'r', messageId: 'm' }, { kind: 'chat', roomId: 'r/x', messageId: 'm' }, { kind: 'chat', roomId: 'r' }])
    assert.equal(textDigest({ ...base, forwardSource: bad } as never), textDigest(base))
  const { isForwarded: _f, ...plain } = base as SendWire & { isForwarded?: true }
  assert.equal(textDigest({ ...plain, forwardSource: { kind: 'chat', roomId: 'r', messageId: 'm' } } as never), textDigest(plain as SendWire))
  // Key order is the server's, whatever order the object was built in.
  assert.equal(textDigest({ ...base, forwardSource: { messageId: 'm', roomId: 'r', kind: 'chat' } } as never), textDigest({ ...base, forwardSource: { kind: 'chat', roomId: 'r', messageId: 'm' } } as never))
})

test('a forward a server took matches whichever server: one that keeps forwardSource, an older that drops it, an older still without isForwarded', () => {
  const wire = { id: 'm', chatId: 'c', senderId: 'u', type: 'text', text: 'x', isSilent: false, isEncrypted: false, protocolVersion: 3, isForwarded: true,
    forwardSource: { kind: 'chat', roomId: 'r', messageId: 's' } } as SendWire
  const { forwardSource: _s, ...noSource } = wire as SendWire & { forwardSource?: unknown }
  const { isForwarded: _f, ...plain } = noSource as SendWire & { isForwarded?: true }
  assert.equal(textDigestMatches(wire, textDigest(wire)), true)
  assert.equal(textDigestMatches(wire, textDigest(noSource as SendWire)), true, 'a server before B263')
  assert.equal(textDigestMatches(wire, textDigest(plain as SendWire)), true, 'a server before B253')
  assert.equal(textDigestMatches(wire, 'f'.repeat(64)), false)
})

test('the original a forward names: a chat by its id, an inquiry room by its id (the queue\'s sub_inq_ name); the stored wire is checked', () => {
  assert.deepEqual(forwardWireSource({ chatId: 'chat_1', messageId: 'M1' }), { kind: 'chat', roomId: 'chat_1', messageId: 'M1' })
  assert.deepEqual(forwardWireSource({ chatId: 'sub_inq_room_9', messageId: 'M2' }), { kind: 'inquiry', roomId: 'room_9', messageId: 'M2' })
  assert.equal(forwardSourceValid({ isForwarded: true, forwardSource: { kind: 'chat', roomId: 'r', messageId: 'm' } }), true)
  assert.equal(forwardSourceValid({ forwardSource: { kind: 'chat', roomId: 'r', messageId: 'm' } }), false, 'only beside isForwarded')
  assert.equal(forwardSourceValid({ isForwarded: true, forwardSource: { kind: 'chat', roomId: 'r', messageId: 'm', extra: 1 } }), false)
  assert.equal(forwardSourceValid({ isForwarded: true }), true)
})
