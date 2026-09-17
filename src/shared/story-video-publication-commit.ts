import { object } from './validation'
import { backgroundPhotoId } from './chat-background'
import { storyPublicationTime, type StoryPublicationTime } from './story-publication-commit'
import { storyVideoPublicationIntent, type StoryVideoPublicationIntent } from './story-video-publication'
import { tr } from './i18n'
export interface StoryVideoPublicationCommitRequest { intent: StoryVideoPublicationIntent; time: StoryPublicationTime }
export interface StoryVideoPublishRequest { id: string; state: 'uploaded' }
export function storyVideoPublishRequest(raw: unknown): StoryVideoPublishRequest { const v = object(raw); if (Object.keys(v).some(k => !['id','state'].includes(k)) || v.state !== 'uploaded') throw new Error(tr('모든 준비 파일의 완료 응답을 확인해 주세요.')); return { id:backgroundPhotoId(v.id),state:'uploaded' } }
export function storyVideoPublicationCommitRequest(raw: unknown): StoryVideoPublicationCommitRequest { const v = object(raw); if (Object.keys(v).some(k => !['intent','time'].includes(k))) throw new Error(tr('영상 게시 기록을 확인해 주세요.')); return { intent:storyVideoPublicationIntent(v.intent),time:storyPublicationTime(v.time) } }
