import assert from 'node:assert/strict'
import { test } from 'node:test'
import { textDigest } from '../../src/main/messaging/text-identity'
import { albumThumbs } from '../../src/shared/media-metadata'
import type { SendWire } from '../../src/shared/model'

// F3 (server broad check reports/server/2026-10-11-broad-check.md; review 22:1x): the digest Desktop computes is the one
// the server stores — sha256(JSON.stringify(canonical(payload))), talky f734810d morse-message-authority.js:82-150, :207.
// The rows are the server's own parity table (MorseIOS firebase/functions/morse-album-thumbs.test.js, 12 rows) and the
// fields F3 named (contactShareId, a sticker reference, a stray sticker field), with the digests that server code itself
// gave for each payload; a payload it refuses is one Desktop never builds (albumThumbs refuses the same).
const base = { id: 'm1', chatId: 'c1', senderId: 'me', isSilent: false, isEncrypted: false, protocolVersion: 3 }
const album = (extra: Record<string, unknown> = {}) => ({ ...base, type: 'image', text: '', mediaUrl: '', mediaKeys: ['k1', 'k2', 'k3'], thumbData: 't1', ...extra })
const encrypted = (extra: Record<string, unknown> = {}) => { const value: Record<string, unknown> = album({ isEncrypted: true, ...extra }); delete value.thumbData; return value }
const REFUSED = null
const ROWS: [string, Record<string, unknown>, string | null][] = [
  ['one per photo', album({ thumbDatas: ['t1', '', 't3'] }), '260930d214a2de49bff79d954557eb34ae92a8d467bda8cfad36a3b8a2097e1a'],
  ['fewer than the photos', album({ thumbDatas: ['t1'] }), '36fbeff38503af85db69a94649a4f85980ed100c36c63e66f92c58efd08aec18'],
  ['none', album(), '0dd3aa732c95cdfcc9e1fa748960ff9e7df079b2a9ffbe2bb7a378fdb2610643'],
  ['more than the photos', album({ thumbDatas: ['a', 'b', 'c', 'd'] }), REFUSED],
  ['not a string', album({ thumbDatas: ['t1', 7] }), REFUSED],
  ['one too long', album({ thumbDatas: ['x'.repeat(16385)] }), REFUSED],
  ['the longest', album({ thumbDatas: ['x'.repeat(16384)] }), '0d9baecac4be43395df658a7967d8a8a18993802a04cd09f6d212d8474646fa1'],
  ['an album of eleven', album({ mediaKeys: Array.from({ length: 11 }, (_, i) => `k${i}`), thumbDatas: ['t1'] }), REFUSED],
  ['encrypted, empty entries', encrypted({ thumbDatas: ['', ''] }), '80b6641a4a5e768b18be7581534583d1a6ffd0adc79e53b35e2d35071ea308dd'],
  ['a contact share', { ...base, type: 'contact', text: '', contactShareId: 'share1' }, 'b5bc3b53efe40487f50cbe922cf8dd87f42185494091a3033e28b4ff0016119f'],
  ['contactShareId on a text', { ...base, type: 'text', text: 'hi', contactShareId: 'share1' }, 'a625376cbd09aeddc1ae9249ddffa8e19d6388c3a30afafac0bead2a8d2fe4e9'],
  ['a sticker reference', { ...base, type: 'sticker', text: 'x', mediaUrl: '', stickerId: 'a'.repeat(64), stickerKind: 'png', stickerSetId: 'set1', mediaKeys: ['k'] }, '44fbbbb5bfafb8c4605341e5930f66c8719d494801caa76b2803a881926a753f'],
  ['sticker fields on an image', album({ stickerId: 'a'.repeat(64), stickerKind: 'png' }), '0dd3aa732c95cdfcc9e1fa748960ff9e7df079b2a9ffbe2bb7a378fdb2610643'],
  ['a forwarded album with previews', album({ thumbDatas: ['t1', '', 't3'], isForwarded: true }), 'e4fa9a204ca145dd79f8fd9a78c61dd705b98812b91e499b2dc439d10b38ae30'],
  ['a text', { ...base, type: 'text', text: 'hello', replyToId: 'r1' }, 'f6d76e65063ea2c422f66f45f88f9af7408217c57ab471db109011820c7ef52b'],
]

test('the digest of every payload the server keeps is the server\'s own', () => {
  for (const [name, payload, want] of ROWS) if (want) assert.equal(textDigest(payload as unknown as SendWire), want, name)
})
test('the album previews the server refuses, Desktop never sends', () => {
  for (const [name, payload, want] of ROWS) {
    if (want !== REFUSED) continue
    const keys = payload.mediaKeys as unknown[]
    assert.equal(albumThumbs(payload.thumbDatas, keys.length), null, name)
  }
})
