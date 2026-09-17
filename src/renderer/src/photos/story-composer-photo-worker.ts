import { withoutMetadata } from './jpeg-metadata'
import { backgroundImageInfo, maxBackgroundPhotoBytes, maxBackgroundPixels } from '../../../shared/background-photo-bytes'
import { storyComposerPhotoPair } from '../../../shared/story-composer-photo'
const worker = self as unknown as { onmessage: ((event: MessageEvent<Uint8Array>) => void) | null; postMessage(value: unknown, transfer?: Transferable[]): void }
worker.onmessage = event => {
  void (async () => {
    const input = event.data
    let bitmap: ImageBitmap | null = null, full: Uint8Array | null = null, thumbnail: Uint8Array | null = null
    const canvases: OffscreenCanvas[] = []
    async function encode(canvas: OffscreenCanvas, quality: number): Promise<Uint8Array> {
      const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality })
      if (blob.type !== 'image/jpeg' || blob.size > maxBackgroundPhotoBytes) throw new Error('준비한 사진이2MB를 넘습니다. 다른 사진을 선택해 주세요.')
      const bytes = new Uint8Array(await blob.arrayBuffer())
      try { return withoutMetadata(bytes) } finally { bytes.fill(0) }
    }
    try {
      const info = backgroundImageInfo(input)
      try { bitmap = await createImageBitmap(new Blob([new Uint8Array(input)], { type: info.type }), { imageOrientation: 'from-image' }) }
      catch { throw new Error('이 사진 파일을 열지 못했습니다. 다른 JPEG 또는 PNG 사진을 선택해 주세요.') }
      if (!bitmap.width || !bitmap.height || bitmap.width > 16384 || bitmap.height > 16384 || bitmap.width * bitmap.height > maxBackgroundPixels) throw new Error('지원하는 사진 크기를 확인해 주세요.')
      const ratio = Math.min(1, 1080 / Math.max(bitmap.width, bitmap.height)), width = Math.max(1, Math.round(bitmap.width * ratio)), height = Math.max(1, Math.round(bitmap.height * ratio))
      const canvas = new OffscreenCanvas(width, height); canvases.push(canvas)
      const context = canvas.getContext('2d', { alpha: false })
      if (!context) throw new Error('사진을 준비할 수 없습니다.')
      context.fillStyle = '#000000'; context.fillRect(0, 0, width, height); context.drawImage(bitmap, 0, 0, width, height); bitmap.close(); bitmap = null
      const thumbRatio = Math.min(1, 360 / Math.max(width, height)), thumb = new OffscreenCanvas(Math.max(1, Math.round(width * thumbRatio)), Math.max(1, Math.round(height * thumbRatio))); canvases.push(thumb)
      const thumbContext = thumb.getContext('2d', { alpha: false })
      if (!thumbContext) throw new Error('미리보기 사진을 준비할 수 없습니다.')
      thumbContext.drawImage(canvas, 0, 0, thumb.width, thumb.height)
      full = await encode(canvas, .82); thumbnail = await encode(thumb, .75)
      const pair = storyComposerPhotoPair(full, thumbnail)
      worker.postMessage(pair, [pair.full.buffer, pair.thumbnail.buffer]); full = null; thumbnail = null
    } catch (error) { worker.postMessage({ error: error instanceof Error ? error.message : '스토리 사진을 준비하지 못했습니다.' }) }
    finally { input.fill(0); bitmap?.close(); full?.fill(0); thumbnail?.fill(0); for (const canvas of canvases) { canvas.width = 1; canvas.height = 1 } }
  })()
}
