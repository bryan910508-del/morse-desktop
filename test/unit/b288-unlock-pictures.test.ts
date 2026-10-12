import assert from 'node:assert/strict'
import { test } from 'node:test'
import { forgetImages, holdsImage, rememberedImage, restorePictures } from '../../src/main/accounts/userpic-images'

// B288: the lock still takes every picture out of memory; unlocking puts back the ones the list was drawing, from the
// account's cache file only, before the list is drawn again.
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')

test('locked: nothing in memory; unlocked: the drawn pictures are back, read from the cache file only', async () => {
  forgetImages()
  assert.equal(holdsImage('https://a'), false)
  const reads: string[] = [], given: Buffer[] = []
  const read = async (raw: string) => {
    reads.push(raw)
    if (raw === 'https://missing') return null
    const bytes = Buffer.from(png); given.push(bytes)
    return { bytes, mime: 'image/png' }
  }
  const restored = await restorePictures(['https://a', 'https://b', 'https://missing'], read, () => true)
  assert.equal(restored, 2)
  assert.deepEqual(reads.sort(), ['https://a', 'https://b', 'https://missing'])
  assert.ok(holdsImage('https://a') && holdsImage('https://b'))
  assert.equal(holdsImage('https://missing'), false, 'one the cache file does not have is not made')
  assert.ok(given.every(bytes => bytes.every(byte => byte === 0)), 'every read buffer is emptied once copied')
  assert.ok(rememberedImage('https://a')?.bytes.equals(png))
  forgetImages()
})

test('locked again meanwhile: nothing is put back', async () => {
  forgetImages()
  let alive = true
  const read = async () => { alive = false; return { bytes: Buffer.from(png), mime: 'image/png' } }
  assert.equal(await restorePictures(['https://a'], read, () => alive), 0)
  assert.equal(holdsImage('https://a'), false)
})
