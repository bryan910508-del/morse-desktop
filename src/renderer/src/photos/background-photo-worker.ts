import { withoutMetadata } from './jpeg-metadata'
import { backgroundImageInfo, maxBackgroundEdge, maxBackgroundPhotoBytes } from '../../../shared/background-photo-bytes'

const worker = self as unknown as { onmessage: ((event: MessageEvent<Uint8Array>) => void) | null; postMessage(value: unknown, transfer?: Transferable[]): void }

worker.onmessage = event => {
  void (async () => {
    const input = event.data
    let bitmap: ImageBitmap | null = null, encoded: Uint8Array | null = null
    try {
      const info = backgroundImageInfo(input)
      // A file the browser cannot decode answers with its own English message; say it in our words.
      try { bitmap = await createImageBitmap(new Blob([new Uint8Array(input)], { type: info.type }), { imageOrientation: 'from-image' }) }
      catch { throw new Error('이 사진 파일을 열지 못했습니다. 다른 JPEG 또는 PNG 사진을 선택해 주세요.') }
      const ratio = Math.min(1, maxBackgroundEdge / Math.max(bitmap.width, bitmap.height))
      const width = Math.max(1, Math.round(bitmap.width * ratio)), height = Math.max(1, Math.round(bitmap.height * ratio))
      const canvas = new OffscreenCanvas(width, height), context = canvas.getContext('2d', { alpha: false })
      if (!context) throw new Error('사진을 변환할 수 없습니다.')
      context.fillStyle = '#000000'; context.fillRect(0, 0, width, height)
      context.drawImage(bitmap, 0, 0, width, height)
      bitmap.close(); bitmap = null
      const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: .85 })
      canvas.width = 1; canvas.height = 1
      if (blob.type !== 'image/jpeg' || blob.size > maxBackgroundPhotoBytes) throw new Error('변환한 사진이 2 MB를 넘습니다. 더 작은 사진을 선택해 주세요.')
      encoded = new Uint8Array(await blob.arrayBuffer())
      const output = withoutMetadata(encoded)
      backgroundImageInfo(output, true)
      worker.postMessage({ bytes: output }, [output.buffer])
    } catch (error) { worker.postMessage({ error: error instanceof Error ? error.message : '사진을 변환하지 못했습니다.' }) }
    finally { input.fill(0); encoded?.fill(0); bitmap?.close() }
  })()
}
