import { postPhotoBytes } from '../../../shared/channel-post-photo'
import { tr } from '../../../shared/i18n'
export function prepareChannelPostPhoto(input: Uint8Array, signal: AbortSignal): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./channel-post-photo-worker.ts', import.meta.url), { type: 'module' })
    let finished = false
    const done = (bytes: Uint8Array | null = null, message = tr('사진 준비가 취소되었습니다.')): void => {
      if (finished) { bytes?.fill(0); return }
      finished = true; clearTimeout(timer); signal.removeEventListener('abort', cancel); worker.terminate()
      if (bytes) resolve(bytes); else reject(new Error(message))
    }
    const cancel = (): void => done()
    const timer = setTimeout(() => done(null, tr('사진 준비 시간이 초과되었습니다.')), 30000)
    worker.onmessage = (event: MessageEvent<Uint8Array | { error?: string }>) => {
      const data = event.data
      if (!(data instanceof Uint8Array)) { done(null, data.error ? tr(data.error) : tr('사진을 준비하지 못했습니다.')); return }
      try { done(postPhotoBytes(data)) } catch { data.fill(0); done(null, tr('준비한 사진을 확인하지 못했습니다.')) }
    }
    worker.onerror = event => { event.preventDefault(); done(null, tr('사진을 준비하지 못했습니다.')) }
    worker.onmessageerror = () => done(null, tr('사진 준비 응답을 읽지 못했습니다.'))
    signal.addEventListener('abort', cancel, { once: true })
    if (signal.aborted) { input.fill(0); cancel(); return }
    const bytes = new Uint8Array(input); input.fill(0); worker.postMessage(bytes, [bytes.buffer])
  })
}
