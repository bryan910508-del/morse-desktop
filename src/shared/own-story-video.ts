import { backgroundPhotoId } from './chat-background'
import { identifier, object } from './validation'
import { tr } from './i18n'
export interface OwnStoryVideoRequest { mode: 'original' | 'with-audio'; selectionId: string; requestId: string; storyId: string; version: string }
export interface OwnStoryVideoSnapshot extends OwnStoryVideoRequest { audioUrl: string | null; status: 'loading' | 'ready' | 'error'; url: string | null; loaded: number; total: number | null; message: string }
export function ownStoryVideoRequest(raw: unknown): OwnStoryVideoRequest {
  const v = object(raw)
  if (Object.keys(v).some(k => !['selectionId', 'requestId', 'storyId', 'version', 'mode'].includes(k)) || (v.mode !== 'original' && v.mode !== 'with-audio') || typeof v.version !== 'string' || !/^\d{1,12}:\d{1,9}$/.test(v.version)) throw new Error(tr('현재 내 영상 스토리에서 다시 선택해 주세요.'))
  return { mode: v.mode, selectionId: backgroundPhotoId(v.selectionId), requestId: identifier(v.requestId), storyId: identifier(v.storyId), version: v.version }
}
