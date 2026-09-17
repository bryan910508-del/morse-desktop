import type { PhotoSendSpec } from '../../../shared/photo-quality'
import { tr } from '../../../shared/i18n'
export function prepareChatPhoto(input: Uint8Array, spec: PhotoSendSpec): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./chat-photo-worker.ts', import.meta.url), { type: 'module' })
    let finished = false
    const done = (bytes: Uint8Array | null = null, message = tr('사진 준비가 취소되었습니다.')): void => {
      if (finished) { bytes?.fill(0); return }
      finished = true; clearTimeout(timer); worker.terminate()
      if (bytes) resolve(bytes); else reject(new Error(message))
    }
    const timer = setTimeout(() => done(null, tr('사진 준비 시간이 초과되었습니다.')), 30000)
    worker.onmessage = (event: MessageEvent<Uint8Array | { error?: string }>) => {
      const data = event.data
      if (data instanceof Uint8Array) done(data); else done(null, data.error ? tr(data.error) : tr('사진을 준비하지 못했습니다.'))
    }
    worker.onerror = event => { event.preventDefault(); done(null, tr('사진을 준비하지 못했습니다.')) }
    worker.onmessageerror = () => done(null, tr('사진 준비 응답을 읽지 못했습니다.'))
    const bytes = new Uint8Array(input); input.fill(0)
    worker.postMessage({ bytes, maxEdge: spec.maxEdge, quality: spec.quality }, [bytes.buffer])
  })
}
