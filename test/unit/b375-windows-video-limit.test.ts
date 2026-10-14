import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, rm, truncate, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AttachmentStaging } from '../../src/main/media/attachment-staging'

// B375 (reports/desktop/2026-10-14-0.241.30-plan.md): Windows has no helper to make a video smaller (index.ts sets the
// compressor on macOS only), and a picked video over 50 MB was refused as «50 MB 미만의 일반 파일». It is read as a video
// either way and told as one. No compressor is set here, as on Windows.
const isoHeader = Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from('ftypisom')])
async function picked(name: string, head: Buffer, size: number) {
  const dir = await mkdtemp(join(tmpdir(), 'morse-b375-')), path = join(dir, name)
  await writeFile(path, Buffer.concat([head, Buffer.alloc(64, 1)]))
  await truncate(path, size) // sparse: the size the limit reads, without writing it
  return { path, done: () => rm(dir, { recursive: true, force: true }) }
}

test('a video over 50 MB on a platform that cannot make it smaller is refused as a video', async () => {
  const file = await picked('clip.mp4', isoHeader, 60 * 1024 * 1024), staging = new AttachmentStaging()
  try {
    await assert.rejects(staging.pick('chat1', 'media', () => true, async () => [file.path]), { message: '50 MB 미만의 동영상을 선택해 주세요.' })
  } finally { staging.clear(); await file.done() }
})

test('any other file over 50 MB keeps its words, and a smaller video is staged as it is', async () => {
  const big = await picked('notes.bin', Buffer.from('plain text file '), 60 * 1024 * 1024), staging = new AttachmentStaging()
  try {
    await assert.rejects(staging.pick('chat1', 'media', () => true, async () => [big.path]), { message: '50 MB 미만의 일반 파일을 선택해 주세요.' })
  } finally { staging.clear(); await big.done() }
  const small = await picked('clip.mp4', isoHeader, 2 * 1024 * 1024), other = new AttachmentStaging()
  try {
    const draft = await other.pick('chat1', 'media', () => true, async () => [small.path])
    assert.equal(draft?.kind, 'video')
    assert.equal(draft?.items[0]?.size, 2 * 1024 * 1024, 'sent as it is: Windows does not re-encode, as tdesktop does not')
  } finally { other.clear(); await small.done() }
})
