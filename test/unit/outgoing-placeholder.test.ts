import assert from 'node:assert/strict'
import { test } from 'node:test'
import { outgoingPhotoPlaceholder, placeholderBudgetBytes, placeholderQualities, placeholderSides } from '../../src/main/media/outgoing-placeholder'

// iOS MorseOutgoingPhotoPlaceholder walks the long side down 64 → 40 → 32 and, at each step, the
// quality 0.5 → 0.3, taking the first result that fits 1024 bytes; Android was measured against the
// same values. Desktop used to make one fixed 32px picture at quality 50, so the same photo sent from
// here reached the other side blurrier than one sent from a phone.
const steps = (encode: (side: number, quality: number) => Uint8Array | null) => {
  const tried: [number, number][] = []
  const text = outgoingPhotoPlaceholder((side, quality) => { tried.push([side, quality]); return encode(side, quality) })
  return { tried, text }
}
const bytes = (length: number): Uint8Array => new Uint8Array(length).fill(1)

test('the largest picture that fits the budget is the one that travels', () => {
  const { tried, text } = steps(side => bytes(side === 64 ? 900 : 100))
  assert.deepEqual(tried, [[64, 50]], 'the first step fits, so no smaller one is tried')
  assert.equal(Buffer.from(text, 'base64').length, 900)
})

test('a picture too heavy at one step is tried again quieter, then smaller', () => {
  const { tried, text } = steps((side, quality) => bytes(side === 64 ? 4000 : side === 40 ? (quality === 50 ? 1200 : 1000) : 200))
  assert.deepEqual(tried, [[64, 50], [64, 30], [40, 50], [40, 30]])
  assert.equal(Buffer.from(text, 'base64').length, 1000)
})

test('a picture that fits none of the steps travels without a placeholder, as iOS returns nil', () => {
  const { tried, text } = steps(() => bytes(placeholderBudgetBytes + 1))
  assert.equal(text, '')
  assert.deepEqual(tried, placeholderSides.flatMap(side => placeholderQualities.map(quality => [side, quality])))
})

test('a picture that cannot be read at all stops the ladder', () => {
  assert.equal(steps(() => null).tried.length, 1)
  assert.equal(outgoingPhotoPlaceholder(() => { throw new Error('unreadable') }), '')
})

test('the ladder is the one the phones walk', () => {
  assert.deepEqual([...placeholderSides], [64, 40, 32])
  assert.deepEqual([...placeholderQualities], [50, 30])
  assert.equal(placeholderBudgetBytes, 1024)
})
