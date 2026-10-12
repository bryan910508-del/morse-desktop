import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { AttachmentStaging } from '../../src/main/media/attachment-staging'

// B323 (tdesktop SendFilesBox: an edited photo takes its item's place and is drawn from it): a photo edited in the send
// box is read back from the selection at an address of its own — the tile shows it and the editor opens it again — and
// the page never needs a blob: copy, which its policy refuses to draw or read.
const png = (fill: number): Buffer => Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), Buffer.alloc(64, fill)])
const jpeg = (fill: number): Uint8Array => new Uint8Array(Buffer.concat([Buffer.from([255, 216, 255, 224]), Buffer.alloc(40, fill)]))
const read = async (staging: AttachmentStaging, url: string): Promise<number | Buffer> => {
  const path = url.slice('morse://app/__draft-media/'.length)
  const response = staging.response('c1', path, new Request(url.replace('morse://', 'http://')))
  return response.status === 200 ? Buffer.from(await response.arrayBuffer()) : response.status
}

test('an edited photo of an album is read at its new address, again after a second edit, and the others stay', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'morse-b323-'))
  const staging = new AttachmentStaging()
  try {
    const paths = await Promise.all([1, 2, 3, 4].map(async n => { const path = join(dir, `p${n}.png`); await writeFile(path, png(n)); return path }))
    const draft = (await staging.pick('c1', 'media', () => true, async () => paths))!
    assert.equal(draft.items.length, 4)
    const fourth = draft.items[3]!
    const first = staging.replaceImage('c1', draft.id, fourth.id, jpeg(7))
    const url1 = first.items[3]!.previewUrl!
    assert.notEqual(url1, fourth.previewUrl, 'the edited picture has an address of its own')
    assert.ok(url1.endsWith(`/${fourth.id}/e1`))
    assert.deepEqual(await read(staging, url1), Buffer.from(jpeg(7)))
    assert.deepEqual(await read(staging, fourth.previewUrl!), Buffer.from(jpeg(7)), 'the first address serves the edited bytes too (the send reads it)')
    assert.equal(first.items[0]!.previewUrl, draft.items[0]!.previewUrl, 'the other photos keep theirs')
    assert.deepEqual(await read(staging, draft.items[0]!.previewUrl!), png(1))
    const second = staging.replaceImage('c1', draft.id, fourth.id, jpeg(9))
    const url2 = second.items[3]!.previewUrl!
    assert.ok(url2.endsWith('/e2'))
    assert.deepEqual(await read(staging, url2), Buffer.from(jpeg(9)))
    assert.equal(await read(staging, url1), 403, 'an older edit\'s address is gone')
    assert.equal(await read(staging, draft.items[0]!.previewUrl!.replace(/$/, '/e1')), 403, 'an unedited photo has no edit address')
    const { parts } = staging.prepare('me', 'c1', draft.id, '', draft.items.map(item => item.id))
    assert.equal(parts[3]!.upload.contentType, 'image/jpeg')
    assert.equal(parts.length, 4)
  } finally { staging.clear(); await rm(dir, { recursive: true, force: true }) }
})
