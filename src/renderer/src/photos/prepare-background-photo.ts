import { tr } from '../../../shared/i18n'
export function prepareBackgroundPhoto(input: Uint8Array, signal: AbortSignal): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./background-photo-worker.ts', import.meta.url), { type: 'module' })
    let finished = false
    const done = (bytes?: Uint8Array, error?: Error): void => {
      if (finished) return
      finished = true; clearTimeout(timer); signal.removeEventListener('abort', cancel); worker.terminate()
      if (bytes) resolve(bytes); else reject(error ?? new Error(tr('사진 준비가 취소되었습니다.')))
    }
    const cancel = (): void => done()
    const timer = setTimeout(() => done(undefined, new Error(tr('사진 준비 시간이 초과되었습니다. 다른 사진을 선택해 주세요.'))), 30000)
    worker.onmessage = (event: MessageEvent<{ bytes?: Uint8Array; error?: string }>) => done(event.data.bytes, new Error(event.data.error ? tr(event.data.error) : tr('사진을 준비하지 못했습니다.')))
    worker.onerror = event => { event.preventDefault(); done(undefined, new Error(tr('사진을 준비하지 못했습니다. 다른 사진을 선택해 주세요.'))) }
    worker.onmessageerror = () => done(undefined, new Error(tr('사진을 준비하지 못했습니다.')))
    signal.addEventListener('abort', cancel, { once: true })
    if (signal.aborted) { input.fill(0); cancel(); return }
    const transferable = new Uint8Array(input)
    input.fill(0)
    worker.postMessage(transferable, [transferable.buffer])
  })
}
