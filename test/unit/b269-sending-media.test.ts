import assert from 'node:assert/strict'
import { test } from 'node:test'
import { localMediaOf } from '../../src/main/messaging/outbox'
import { mediaOfFields, SendingMedia } from '../../src/main/messaging/sending-media'
import { localMediaMessage, sendingProgress } from '../../src/renderer/src/history/local-media'
import { mediaRequest } from '../../src/shared/media'

// B269 (user 0.241.20 «사진 보낼 때도 텍스트에서 사진으로 바뀐다»): a photo, a video, a file or an album on its way showed
// its upload's file name in a text bubble, then the server's copy loaded the same picture again. tdesktop draws the local
// message with its media from the start, by the same view as one received (api_sending.cpp:1227-1240 addNewLocalMessage,
// data_media_types.cpp:1076-1080), and the server's copy keeps the bytes (data_cloud_file.cpp:200-216).
const wire = (type: string, extra: object = {}) => ({ id: 'm1', chatId: 'c1', senderId: 'me', type, text: '', mediaUrl: '', isSilent: false, isEncrypted: false, protocolVersion: 3, ...extra })
const part = (index: number, name: string, size: number) => ({ index, upload: { name, size, contentType: 'image/jpeg' }, url: null })
const row = (type: string, extra: object, parts: ReturnType<typeof part>[] = []) => ({ wire: wire(type, extra), parts }) as never
const shrink = (bytes: Uint8Array, contentType: string) => ({ bytes: Buffer.from([...bytes].reverse()), mime: contentType === 'image/png' ? 'image/png' : 'image/jpeg' })

test('each kind on its way is the message the server\'s copy will be: its parts, size, placeholder and caption', () => {
  const photo = localMediaOf(row('image', { mediaWidthPx: 1200, mediaHeightPx: 800, thumbData: 'AAAA', imageCaption: '바다' }, [part(0, 'IMG_1.jpg', 1000)]))!
  assert.deepEqual(photo, { kind: 'image', parts: [{ index: 0, name: 'IMG_1.jpg', size: 1000 }], caption: '바다', metadata: { mediaWidthPx: 1200, mediaHeightPx: 800, thumbData: 'AAAA' } })
  const album = localMediaOf(row('image', { mediaWidthPx: 10, mediaHeightPx: 20, imageWidthsPx: [10, 30], imageHeightsPx: [20, 40] }, [part(0, 'a.jpg', 1), part(1, 'b.jpg', 2)]))!
  assert.deepEqual([album.parts.length, album.metadata.imageWidthsPx, album.caption], [2, [10, 30], ''])
  const video = localMediaOf(row('video', { videoWidthPx: 640, videoHeightPx: 360, videoDuration: 12, thumbData: 'BBBB', videoCaption: '영상' }, [part(0, 'v.mp4', 5)]))!
  assert.deepEqual([video.kind, video.caption, video.metadata.videoDuration, video.circular], ['video', '영상', 12, undefined])
  const round = localMediaOf(row('video', { videoWidthPx: 240, videoHeightPx: 240, isCircleVideo: true }, [part(0, 'video-message.mp4', 5)]))!
  assert.deepEqual([round.circular, round.metadata.isCircleVideo], [true, true])
  const file = localMediaOf(row('file', { fileName: '보고서.pdf', fileSize: 4096, text: '보고서.pdf' }, [part(0, '보고서.pdf', 4096)]))!
  assert.deepEqual([file.kind, file.parts, file.caption], ['file', [{ index: 0, name: '보고서.pdf', size: 4096 }], ''])
  assert.equal(localMediaOf(row('text', { text: '안녕' })), undefined, 'a text has none')
  assert.equal(localMediaOf(row('voice', { voiceDuration: 3 }, [part(0, '음성 메시지.m4a', 9)])), undefined, 'a voice message keeps its own player')
})

test('the renderer draws it with the same attachments as the server\'s copy; a picture opens from here, a video or file once sent', () => {
  const make = (media: ReturnType<typeof localMediaOf>) => localMediaMessage({ id: 'm1', chatId: 'c1', createdAt: 5, media })!
  const album = make(localMediaOf(row('image', { thumbData: 'AAAA' }, [part(0, 'a.jpg', 1), part(1, 'b.jpg', 2)])))
  assert.deepEqual([album.kind, album.caption, album.version, album.mediaMetadata?.thumbData], ['image', '', '0:0', 'AAAA'])
  // The preview call the tile makes must pass the window's media request check (it refused '' and the tile showed a
  // download button — Phase1 10-10 15:02).
  assert.deepEqual(mediaRequest({ requestId: 'r1', messageId: album.id, version: album.version, index: 1 }), { requestId: 'r1', messageId: 'm1', version: '0:0', index: 1 })
  assert.deepEqual(album.attachments!.map(item => [item.index, item.kind, item.available, item.blind]), [[0, 'image', true, false], [1, 'image', true, false]])
  const video = make(localMediaOf(row('video', { isCircleVideo: true }, [part(0, 'v.mp4', 5)])))
  assert.deepEqual([video.circular, video.attachments![0]!.available], [true, false])
  const file = make(localMediaOf(row('file', { fileName: 'f.zip', fileSize: 3 }, [part(0, 'f.zip', 3)])))
  assert.deepEqual([file.kind, file.attachments![0]!.name, file.attachments![0]!.available], ['file', 'f.zip', false])
  assert.equal(localMediaMessage({ id: 'm2', chatId: 'c1', createdAt: 5 }), null, 'a text keeps its bubble')
  assert.equal(sendingProgress({ loaded: 50, total: 200, current: 1, count: 2 }), .25, 'all parts together, as the upload counts them')
  assert.equal(sendingProgress(undefined), null)
})

test('the pictures it is drawn from are held, served, and given to the server\'s copy — no second download', async () => {
  const media = new SendingMedia(shrink)
  media.keepPictures('m1', [{ bytes: new Uint8Array([1, 2, 3]), contentType: 'image/jpeg' }, { bytes: new Uint8Array([4, 5]), contentType: 'image/png' }])
  const first = await media.picture('m1', 0), second = await media.picture('m1', 1)
  assert.match(first!, /^morse:\/\/app\/__sending-media\/[0-9a-f-]{36}$/)
  assert.notEqual(first, second)
  // The server's copy asks with the same id (session.photoPreview → SendingMedia.picture) and gets the same picture.
  assert.equal(await media.picture('m1', 0), first)
  const response = media.response(first!.slice(first!.lastIndexOf('/') + 1), new Request(first!))
  assert.deepEqual([response.status, response.headers.get('content-type'), [...new Uint8Array(await response.arrayBuffer())]], [200, 'image/jpeg', [3, 2, 1]])
  assert.equal(media.response(second!.slice(second!.lastIndexOf('/') + 1), new Request(second!)).headers.get('content-type'), 'image/png')
  assert.equal(media.picture('m1', 2), null, 'no such part')
  assert.equal(media.picture('other', 0), null, 'a picture another device sent loads as before')
  media.forget('m1')
  assert.equal(media.picture('m1', 0), null)
  assert.equal(media.response(first!.slice(first!.lastIndexOf('/') + 1), new Request(first!)).status, 404, 'let go with its message')
})

test('past the limit the oldest pictures go and load as any other; a picture that cannot be read is not drawn from here', async () => {
  const media = new SendingMedia(shrink)
  for (let i = 0; i < 49; i++) media.keepPictures(`m${i}`, [{ bytes: new Uint8Array([i]), contentType: 'image/jpeg' }])
  assert.equal(media.picture('m0', 0), null, 'the oldest of 49 is let go')
  assert.ok(await media.picture('m48', 0))
  const unreadable = new SendingMedia(() => null)
  unreadable.keepPictures('m1', [{ bytes: new Uint8Array([1]), contentType: 'image/heic' }])
  assert.equal(unreadable.picture('m1', 0), null)
})

test('after a restart a queued picture is read again from the queue when first drawn, once', async () => {
  const media = new SendingMedia(shrink)
  const reads: number[] = []
  media.want('m1', 2, async index => { reads.push(index); return index === 1 ? null : { bytes: new Uint8Array([7, 8]), contentType: 'image/jpeg' } })
  const [a, b] = await Promise.all([media.picture('m1', 0), media.picture('m1', 0)])
  assert.ok(a); assert.equal(a, b)
  assert.equal(await media.picture('m1', 0), a)
  assert.equal(await media.picture('m1', 1), null, 'a part the queue cannot give is loaded as any other')
  assert.deepEqual(reads, [0, 1], 'each part read once')
  // Kept pictures win over a later wish (the same message queued in this run).
  const kept = new SendingMedia(shrink)
  kept.keepPictures('m2', [{ bytes: new Uint8Array([1]), contentType: 'image/jpeg' }])
  kept.want('m2', 1, async () => { throw new Error('not read') })
  assert.ok(await kept.picture('m2', 0))
})

test('an inquiry room\'s message is read the same way, from its own fields', () => {
  assert.deepEqual(mediaOfFields({ type: 'image', imageCaption: '문의 사진' }, [{ index: 0, name: '', size: 300 }]),
    { kind: 'image', parts: [{ index: 0, name: '', size: 300 }], caption: '문의 사진', metadata: {} })
  assert.deepEqual(mediaOfFields({ type: 'file', text: 'a.pdf', fileName: 'a.pdf', fileSize: 9 }, [{ index: 0, name: 'a.pdf', size: 9 }])!.parts, [{ index: 0, name: 'a.pdf', size: 9 }])
  assert.equal(mediaOfFields({ type: 'voice', voiceDuration: 2 }, []), undefined)
  assert.equal(mediaOfFields({ type: 'text', text: 'hi' }, []), undefined)
})
