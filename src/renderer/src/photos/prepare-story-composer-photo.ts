import { storyComposerPhotoPair, type StoryComposerPhotoPair } from '../../../shared/story-composer-photo'
import { tr } from '../../../shared/i18n'
export function prepareStoryComposerPhoto(input: Uint8Array, signal: AbortSignal): Promise<StoryComposerPhotoPair> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./story-composer-photo-worker.ts', import.meta.url), { type: 'module' })
    let finished = false
    const done = (pair: StoryComposerPhotoPair | null = null, message = tr('사진 준비가 취소되었습니다.')): void => {
      if (finished) { pair?.full.fill(0); pair?.thumbnail.fill(0); return }
      finished = true; clearTimeout(timer); signal.removeEventListener('abort', cancel); worker.terminate()
      if (pair) resolve(pair); else reject(new Error(message))
    }
    const cancel = (): void => done()
    const timer = setTimeout(() => done(null, tr('스토리 사진 준비 시간이 초과되었습니다.')), 30000)
    worker.onmessage = (event: MessageEvent<Partial<StoryComposerPhotoPair> & { error?: string }>) => {
      try { done(storyComposerPhotoPair(event.data.full, event.data.thumbnail)) }
      catch { event.data.full?.fill(0); event.data.thumbnail?.fill(0); done(null, event.data.error ? tr(event.data.error) : tr('준비한 사진을 확인하지 못했습니다.')) }
    }
    worker.onerror = event => { event.preventDefault(); done(null, tr('스토리 사진을 준비하지 못했습니다.')) }
    worker.onmessageerror = () => done(null, tr('사진 준비 응답을 읽지 못했습니다.'))
    signal.addEventListener('abort', cancel, { once: true })
    if (signal.aborted) { input.fill(0); cancel(); return }
    const bytes = new Uint8Array(input); input.fill(0); worker.postMessage(bytes, [bytes.buffer])
  })
}
