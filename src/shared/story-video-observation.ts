import { object } from './validation'
import { backgroundPhotoId } from './chat-background'
import type { StoryPublicationObservation } from './story-publication'
import { tr } from './i18n'
export interface StoryVideoObservationRequest { id: string; state: 'submitted' | 'confirmed' | 'rejected' }
export interface StoryVideoObservation extends StoryPublicationObservation, StoryVideoObservationRequest {}
export function storyVideoObservationRequest(raw: unknown): StoryVideoObservationRequest { const v = object(raw); if (Object.keys(v).some(k => !['id','state'].includes(k)) || (v.state !== 'submitted' && v.state !== 'confirmed' && v.state !== 'rejected')) throw new Error(tr('현재 영상 게시 요청 기록을 선택해 주세요.')); return { id:backgroundPhotoId(v.id),state:v.state } }
