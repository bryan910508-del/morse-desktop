import { backgroundPhotoId } from './chat-background'
import { identifier, object } from './validation'
import { tr } from './i18n'
export interface OwnStoryPhotoRequest { presentation: 'image' | 'video-poster'; selectionId: string; requestId: string; storyId: string; version: string }
export interface OwnStoryPhotoSnapshot extends OwnStoryPhotoRequest { status: 'loading' | 'ready' | 'error'; url: string | null; loaded: number; total: number | null; message: string }
export function ownStoryPhotoRequest(raw: unknown): OwnStoryPhotoRequest {
  const v = object(raw)
  if (Object.keys(v).some(k => !['selectionId', 'requestId', 'storyId', 'version', 'presentation'].includes(k)) || (v.presentation !== 'image' && v.presentation !== 'video-poster') || typeof v.version !== 'string' || !/^\d{1,12}:\d{1,9}$/.test(v.version)) throw new Error(tr('현재 내 사진 스토리에서 다시 선택해 주세요.'))
  return { presentation: v.presentation, selectionId: backgroundPhotoId(v.selectionId), requestId: identifier(v.requestId), storyId: identifier(v.storyId), version: v.version }
}
