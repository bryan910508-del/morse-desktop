import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AttachmentStaging, setVideoCompressor, type VideoEdit } from '../../src/main/media/attachment-staging'

// Editor::VideoEditor cuts the picked file again for every edit: the staged copy is replaced, the first
// prepared copy stays playable for the editor, and a file changed since it was picked is refused.
const mp4 = (fill: number, length = 200): Buffer => Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from('ftypisom'), Buffer.alloc(length, fill)])

async function picked(compressed: Buffer) {
  const dir = await mkdtemp(join(tmpdir(), 'morse-video-edit-')), path = join(dir, 'clip.mp4')
  await writeFile(path, mp4(1, 4000))
  const edits: (VideoEdit | undefined)[] = []
  setVideoCompressor(async (_path, edit) => { edits.push(edit); return { status: 'ok', bytes: Buffer.from(edit ? mp4(7, 64) : compressed) } })
  const staging = new AttachmentStaging()
  const draft = await staging.pick('chat1', 'media', () => true, async () => [path])
  assert.ok(draft)
  return { staging, draft, path, edits, done: async () => { setVideoCompressor(null); await rm(dir, { recursive: true, force: true }) } }
}
const body = async (response: Response): Promise<Buffer> => Buffer.from(await response.arrayBuffer())
const get = (url: string) => new Request(url)

test('an edited video replaces the staged copy and keeps the first one for the editor', async () => {
  const { staging, draft, edits, done } = await picked(mp4(3, 120))
  try {
    const item = draft.items[0]!
    assert.equal(item.originalUrl, `morse://app/__draft-media/${draft.id}/${item.id}/original`)
    // iOS VideoMarkupEditorView: the drawing travels with the part and quality to the helper.
    const overlay = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3])
    const edit: VideoEdit = { start: 1.5, end: 4, preset: 'medium', overlay }
    const next = await staging.editVideo('chat1', draft.id, item.id, edit, () => true)
    assert.deepEqual(edits, [undefined, edit])
    assert.equal(edits[1]?.overlay, overlay)
    assert.equal(next.items[0]!.size, mp4(7, 64).length)
    assert.deepEqual(await body(staging.response('chat1', `${draft.id}/${item.id}`, get(item.previewUrl!))), mp4(7, 64))
    assert.deepEqual(await body(staging.response('chat1', `${draft.id}/${item.id}/original`, get(item.originalUrl!))), mp4(3, 120))
    const { wire } = staging.prepare('me', 'chat1', draft.id, '', [item.id], null)
    assert.ok(wire)
  } finally { await done() }
})

test('a file changed after it was picked, or a result over 50 MB, is not sent', async () => {
  const { staging, draft, path, done } = await picked(mp4(3, 120))
  try {
    const item = draft.items[0]!
    await utimes(path, new Date(), new Date(Date.now() + 60000))
    await assert.rejects(staging.editVideo('chat1', draft.id, item.id, { start: 0, end: 2, preset: 'medium' }, () => true), /원본 동영상/)
  } finally { await done() }
  const large = await picked(mp4(3, 120))
  try {
    setVideoCompressor(async () => ({ status: 'ok', bytes: Buffer.alloc(50 * 1024 * 1024) }))
    const item = large.draft.items[0]!
    await assert.rejects(large.staging.editVideo('chat1', large.draft.id, item.id, { start: 0, end: 2, preset: '1280x720' }, () => true), /50 MB/)
    assert.deepEqual(await body(large.staging.response('chat1', `${large.draft.id}/${item.id}`, get(item.previewUrl!))), mp4(3, 120), 'the staged copy stays')
  } finally { await large.done() }
})

test('without the Mac helper a picked video has nothing to edit', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'morse-video-plain-')), path = join(dir, 'clip.mp4')
  try {
    setVideoCompressor(null)
    await writeFile(path, mp4(1))
    const staging = new AttachmentStaging()
    const draft = (await staging.pick('chat1', 'media', () => true, async () => [path]))!
    assert.equal(draft.items[0]!.originalUrl, undefined)
    await assert.rejects(staging.editVideo('chat1', draft.id, draft.items[0]!.id, { start: 0, end: 1, preset: 'medium' }, () => true))
  } finally { await rm(dir, { recursive: true, force: true }) }
})
