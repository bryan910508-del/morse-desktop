import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

// B359 (review 10-14 02:0x, plan (a)): a different account in the same folder starts with no other account's media.
// The delivery worker's owner change cleared the avatars but not the disk cache of opened media and previews, which
// media-cache-table.ts's clear() names as one of its reasons; previews now keep more there, so it is cleared too.
test('the owner change clears the media disk cache beside the avatars', () => {
  const worker = readFileSync('src/main/storage/delivery-worker.ts', 'utf8')
  const start = worker.indexOf("if (owner?.scope !== scope) {"), block = worker.slice(start, worker.indexOf('\n  }\n', start))
  assert.ok(start > 0)
  assert.match(block, /userpics\.clear\(\)/)
  assert.match(block, /mediaFiles\.clear\(\)/, 'another account\'s pictures do not stay')
  assert.ok(worker.indexOf('const mediaFiles = new MediaCacheStore(') < start, 'the store exists before the owner is checked')
})
