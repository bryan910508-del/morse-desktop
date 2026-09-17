import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { inquiryAttachmentFields } from '../../src/main/accounts/channel-inquiries'
import { AttachmentStaging } from '../../src/main/media/attachment-staging'
import { inquiryAttachmentPath, inquiryPhotoPath } from '../../src/main/network/inquiry-photo-upload-api'
import { inquiryAttachmentRequest } from '../../src/shared/channel-inquiries'

// ChannelInquiryChatView sends videos and files in an inquiry as well. Desktop stores them where iOS
// does and sends the fields iOS sends, so either side reads the other's.
const inquiryId = 'channel1_subscriber1', messageId = '3E838DC4-FD8D-4765-8DCC-3E49E64F3AA5'

test('an inquiry attachment is stored under inquiry_files with the extension its kind uses', () => {
  assert.equal(inquiryPhotoPath(inquiryId, messageId), `inquiry_files/${inquiryId}/${messageId}.jpg`)
  for (const extension of ['mp4', 'mov', 'bin']) assert.equal(inquiryAttachmentPath(inquiryId, messageId, extension), `inquiry_files/${inquiryId}/${messageId}.${extension}`)
  for (const [room, id, extension] of [[inquiryId, messageId, 'exe'], [inquiryId, messageId.toLowerCase(), 'mp4'], ['nounderscore', messageId, 'mp4'], ['a/b_c', messageId, 'bin']])
    assert.throws(() => inquiryAttachmentPath(room!, id!, extension!), `refused: ${room} ${id} ${extension}`)
})

test('a video says its caption, whole seconds, size and thumbnail; a file its name and size', () => {
  assert.deepEqual(inquiryAttachmentFields('video', 'clip.mp4', 812345, '영상 설명', { duration: 16.6, width: 1280, height: 720, thumb: 'QUJD' }),
    { type: 'video', text: '영상 설명', videoCaption: '영상 설명', videoDuration: 17, videoWidthPx: 1280, videoHeightPx: 720, thumbData: 'QUJD' })
  assert.deepEqual(inquiryAttachmentFields('video', 'clip.mp4', 812345, '', null), { type: 'video', text: '' }, 'a video that could not be read goes as iOS sends one without a length')
  assert.deepEqual(inquiryAttachmentFields('video', 'clip.mp4', 1, '', { duration: 3, width: 10, height: 10, thumb: '' }), { type: 'video', text: '', videoDuration: 3, videoWidthPx: 10, videoHeightPx: 10 })
  assert.deepEqual(inquiryAttachmentFields('file', '견적서.pdf', 48213, 'ignored', null), { type: 'file', text: '견적서.pdf', fileName: '견적서.pdf', fileSize: 48213 })
})

test('the send request names one staged item of one room, with a client id the server accepts', () => {
  const valid = { requestId: '111e8959-8b64-4c54-a040-4af49cda22c3', inquiryId, messageId, draftId: 'd1', itemId: 'i1', caption: ' 설명 ' }
  assert.deepEqual(inquiryAttachmentRequest(valid), { ...valid, caption: '설명' })
  for (const bad of [{ ...valid, messageId: messageId.toLowerCase() }, { ...valid, caption: 'x'.repeat(3001) }, { ...valid, draftId: '../x' }, { ...valid, extra: true }, { ...valid, inquiryId: 'nope' }])
    assert.throws(() => inquiryAttachmentRequest(bad))
})

test("an inquiry's staging answers on its own route and hands over a copy of the file", async () => {
  const dir = await mkdtemp(join(tmpdir(), 'morse-inquiry-')), path = join(dir, 'clip.mp4')
  await writeFile(path, Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from('ftypisom'), Buffer.alloc(100, 2)]))
  const staging = new AttachmentStaging('__inquiry-draft')
  try {
    const draft = await staging.pick(inquiryId, 'media', () => true, async () => [path])
    assert.ok(draft)
    const item = draft.items[0]!
    assert.equal(item.previewUrl, `morse://app/__inquiry-draft/${draft.id}/${item.id}`)
    const taken = staging.take(inquiryId, draft.id, item.id)
    assert.equal(taken?.kind, 'video')
    assert.equal(taken?.extension, 'mp4')
    assert.equal(taken?.size, 112)
    taken!.bytes.fill(0)
    assert.equal(staging.take(inquiryId, draft.id, item.id)?.bytes[4], 'f'.charCodeAt(0), 'zeroing the copy leaves the staged file')
    assert.equal(staging.take('channel2_subscriber2', draft.id, item.id), null, 'another room')
    staging.clear(draft.id)
    assert.equal(staging.take(inquiryId, draft.id, item.id), null, 'a put-down selection')
  } finally { staging.clear(); await rm(dir, { recursive: true, force: true }) }
})
