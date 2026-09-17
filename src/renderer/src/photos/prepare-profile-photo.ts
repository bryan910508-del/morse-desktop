import { tr } from '../../../shared/i18n'
export function cropProfilePhoto(input: Uint8Array, crop: { x: number; y: number; zoom: number }, signal: AbortSignal, shape: 'square' | 'cover' = 'square'): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./profile-photo-worker.ts', import.meta.url), { type: 'module' })
    let finished = false
    const done = (bytes?: Uint8Array, message = tr('사진 준비가 취소되었습니다.')): void => {
      if (finished) return
      finished = true; clearTimeout(timer); signal.removeEventListener('abort', cancel); worker.terminate()
      if (bytes) resolve(bytes); else reject(new Error(message))
    }
    const cancel = (): void => done()
    const timer = setTimeout(() => done(undefined, tr('사진 준비 시간이 초과되었습니다.')), 30000)
    worker.onmessage = event => done(event.data.bytes, event.data.error ? tr(event.data.error) : event.data.error)
    worker.onerror = event => { event.preventDefault(); done(undefined, tr('사진을 준비하지 못했습니다.')) }
    worker.onmessageerror = () => done(undefined, tr('사진을 준비하지 못했습니다.'))
    signal.addEventListener('abort', cancel, { once: true })
    if (signal.aborted) { cancel(); return }
    const bytes = new Uint8Array(input)
    worker.postMessage({ bytes, ...crop, shape }, [bytes.buffer])
  })
}
