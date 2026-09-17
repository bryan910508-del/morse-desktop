import { withoutMetadata } from './jpeg-metadata'
import { backgroundImageInfo, maxBackgroundPixels } from '../../../shared/background-photo-bytes'
import { maxPostPhotoEdge, postPhotoBytes } from '../../../shared/channel-post-photo'
const worker = self as unknown as { onmessage: ((event: MessageEvent<Uint8Array>) => void) | null; postMessage(value: unknown, transfer?: Transferable[]): void }
// ChannelService.resizedForChannel + jpegData(compressionQuality: 0.7), without photo metadata.
worker.onmessage = event => {
  void (async () => {
    const input = event.data
    let bitmap: ImageBitmap | null = null, output: Uint8Array | null = null, canvas: OffscreenCanvas | null = null
    try {
      const info = backgroundImageInfo(input)
      // A file the browser cannot decode answers with its own English message; say it in our words.
      try { bitmap = await createImageBitmap(new Blob([new Uint8Array(input)], { type: info.type }), { imageOrientation: 'from-image' }) }
      catch { throw new Error('이 사진 파일을 열지 못했습니다. 다른 JPEG 또는 PNG 사진을 선택해 주세요.') }
      if (!bitmap.width || !bitmap.height || bitmap.width > 16384 || bitmap.height > 16384 || bitmap.width * bitmap.height > maxBackgroundPixels) throw new Error('지원하는 사진 크기를 확인해 주세요.')
      const ratio = Math.min(1, maxPostPhotoEdge / Math.max(bitmap.width, bitmap.height)), width = Math.max(1, Math.round(bitmap.width * ratio)), height = Math.max(1, Math.round(bitmap.height * ratio))
      canvas = new OffscreenCanvas(width, height)
      const context = canvas.getContext('2d', { alpha: false })
      if (!context) throw new Error('사진을 준비할 수 없습니다.')
      context.fillStyle = '#000000'; context.fillRect(0, 0, width, height); context.drawImage(bitmap, 0, 0, width, height); bitmap.close(); bitmap = null
      const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.7 })
      const bytes = new Uint8Array(await blob.arrayBuffer())
      try { output = withoutMetadata(bytes) } finally { bytes.fill(0) }
      postPhotoBytes(output)
      worker.postMessage(output, [output.buffer]); output = null
    } catch (error) { worker.postMessage({ error: error instanceof Error ? error.message : '사진을 준비하지 못했습니다.' }) }
    finally { input.fill(0); bitmap?.close(); output?.fill(0); if (canvas) { canvas.width = 1; canvas.height = 1 } }
  })()
}
