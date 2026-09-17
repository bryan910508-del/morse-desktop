import { backgroundPhotoId } from './chat-background'
import { identifier, object } from './validation'
import { tr } from './i18n'
export interface OwnStoryAudioRequest { selectionId: string; requestId: string; storyId: string; version: string }
export interface OwnStoryAudioSnapshot extends OwnStoryAudioRequest { status: 'loading' | 'ready' | 'error'; url: string | null; loaded: number; total: number | null; message: string }
export function ownStoryAudioRequest(raw: unknown): OwnStoryAudioRequest {
  const v = object(raw)
  if (Object.keys(v).some(k => !['selectionId', 'requestId', 'storyId', 'version'].includes(k)) || typeof v.version !== 'string' || !/^\d{1,12}:\d{1,9}$/.test(v.version)) throw new Error(tr('현재 내 스토리 오디오에서 다시 선택해 주세요.'))
  return { selectionId: backgroundPhotoId(v.selectionId), requestId: identifier(v.requestId), storyId: identifier(v.storyId), version: v.version }
}
