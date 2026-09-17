import { backgroundImageInfo } from '../../../shared/background-photo-bytes'
import { maxProfilePhotoBytes, maxProfilePhotoEdge, profilePhotoBytes } from '../../../shared/profile-photo-upload'
import { channelPhotoBytes, maxChannelCoverWidth } from '../../../shared/channel-photo-bytes'
import { withoutMetadata } from './jpeg-metadata'

const worker = self as unknown as { onmessage: ((event: MessageEvent<{ bytes: Uint8Array; x: number; y: number; zoom: number; shape?: 'square' | 'cover' }>) => void) | null; postMessage(value: unknown, transfer?: Transferable[]): void }
worker.onmessage = event => {
  void (async () => {
    const { bytes, x, y, zoom, shape = 'square' } = event.data
    let bitmap: ImageBitmap | null = null, encoded: Uint8Array | null = null
    try {
      backgroundImageInfo(bytes, true)
      if (shape !== 'square' && shape !== 'cover') throw new Error('사진 비율을 다시 확인해 주세요.')
      if (![x, y, zoom].every(Number.isFinite) || x < 0 || x > 100 || y < 0 || y > 100 || zoom < 1 || zoom > 3) throw new Error('사진 위치를 다시 확인해 주세요.')
      try { bitmap = await createImageBitmap(new Blob([new Uint8Array(bytes)], { type: 'image/jpeg' })) }
      catch { throw new Error('이 사진 파일을 열지 못했습니다. 다른 JPEG 또는 PNG 사진을 선택해 주세요.') }
      const ratio = shape === 'cover' ? 8 / 3 : 1
      const cropWidth = Math.min(bitmap.width, bitmap.height * ratio) / zoom, cropHeight = cropWidth / ratio
      const unit = Math.floor(Math.min(maxChannelCoverWidth, cropWidth) / 8)
      if (shape === 'cover' && unit < 1) throw new Error('가로 커버로 준비하기에는 사진이 너무 작습니다.')
      const width = shape === 'cover' ? unit * 8 : Math.max(1, Math.min(maxProfilePhotoEdge, Math.floor(cropWidth)))
      const height = shape === 'cover' ? unit * 3 : width
      const canvas = new OffscreenCanvas(width, height), context = canvas.getContext('2d', { alpha: false })
      if (!context) throw new Error('사진을 준비하지 못했습니다.')
      context.drawImage(bitmap, (bitmap.width - cropWidth) * x / 100, (bitmap.height - cropHeight) * y / 100, cropWidth, cropHeight, 0, 0, width, height)
      bitmap.close(); bitmap = null
      const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: .85 })
      canvas.width = 1; canvas.height = 1
      if (blob.type !== 'image/jpeg' || blob.size > maxProfilePhotoBytes) throw new Error('사진 사본이 1 MB를 넘습니다. 다른 사진을 선택해 주세요.')
      encoded = new Uint8Array(await blob.arrayBuffer())
      const output = withoutMetadata(encoded)
      if (shape === 'cover') channelPhotoBytes(output, 'cover'); else profilePhotoBytes(output)
      worker.postMessage({ bytes: output }, [output.buffer])
    } catch (error) { worker.postMessage({ error: error instanceof Error ? error.message : '사진을 준비하지 못했습니다.' }) }
    finally { bytes.fill(0); encoded?.fill(0); bitmap?.close() }
  })()
}
