import { storyPublicationAudioRevision,storyPublicationAudioFields,type StoryPublicationAudioFields } from './story-publication-audio'
import { object, identifier } from './validation'
import { backgroundPhotoId } from './chat-background'
import { storyComposerDraftContent, type StoryComposerDraftContent } from './story-composer-drafts'
import { tr } from './i18n'
export interface StoryPublicationPrepare { audioRevision?:string;id: string; draftId: string; draftRevision: string; photoRevision: string }
export interface StoryPublicationIntent extends StoryPublicationPrepare, StoryComposerDraftContent, StoryPublicationAudioFields { ownerId: string; photoId: string; width: number; height: number; thumbnailWidth: number; thumbnailHeight: number; fullBytes: number; thumbnailBytes: number; fullSHA256: string; thumbnailSHA256: string; fullMD5: string; thumbnailMD5: string }
export type StoryPhotoPart = 'full' | 'thumbnail' | 'audio'
export type StoryPhotoTransferState = 'pending' | 'acknowledged' | 'unknown' | 'expired'
export interface PendingStoryPublication extends StoryPublicationIntent { state: 'prepared' | 'uploading' | 'uploaded' | 'submitted' | 'confirmed' | 'rejected'; time: import('./story-publication-commit').StoryPublicationTime | null; uploads: (Record<Exclude<StoryPhotoPart,'audio'>, StoryPhotoTransferState> & {audio?:StoryPhotoTransferState}) | null }
export interface StoryPublicationObservation { outcome: 'matching' | 'different' | 'expired' | 'absent' | 'unavailable'; observedAt: number; expiresAt: number | null; message: string }
export interface StoryPublicationSnapshot { observation: StoryPublicationObservation | null; canCheck: boolean; status: 'loading' | 'ready' | 'error'; busy: boolean; pending: PendingStoryPublication | null; message: string; progress: number }
export interface StoryPublicationAction { id: string; state: PendingStoryPublication['state']; action: 'dismiss' | 'upload' | 'publish' | 'check' }
const prepareKeys = ['id', 'draftId', 'draftRevision', 'photoRevision', 'audioRevision']
export function storyPublicationPrepare(raw: unknown): StoryPublicationPrepare {
  const v = object(raw)
  if (Object.keys(v).some(key => !prepareKeys.includes(key))) throw new Error(tr('현재 기기 초안과 사진을 확인해 주세요.'))
  return { ...storyPublicationAudioRevision(v.audioRevision),id: backgroundPhotoId(v.id), draftId: backgroundPhotoId(v.draftId), draftRevision: backgroundPhotoId(v.draftRevision), photoRevision: backgroundPhotoId(v.photoRevision) }
}
export function storyPublicationIntent(raw: unknown): StoryPublicationIntent {
  const v = object(raw), keys = [...prepareKeys, 'audio','ownerId', 'photoId', 'caption', 'privacy', 'hiddenFrom', 'width', 'height', 'thumbnailWidth', 'thumbnailHeight', 'fullBytes', 'thumbnailBytes', 'fullSHA256', 'thumbnailSHA256', 'fullMD5', 'thumbnailMD5']
  if (Object.keys(v).some(key => !keys.includes(key))) throw new Error(tr('스토리 게시 검토 내용을 확인해 주세요.'))
  const ownerId = identifier(v.ownerId), draft = storyComposerDraftContent({ caption: v.caption, privacy: v.privacy, hiddenFrom: v.hiddenFrom }), points = Array.from(draft.caption)
  if (draft.hiddenFrom.includes(ownerId) || points.length > 2000 || points.some(char => { const point = char.codePointAt(0)!; return point >= 0xD800 && point <= 0xDFFF })) throw new Error(tr('게시할 설명은2,000자까지이며 본인은 숨김 대상으로 지정할 수 없습니다. 원문을 자동으로 자르지 않습니다.'))
  const size = (key: string, limit: number): number => { const value = v[key]; if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1 || value > limit) throw new Error(tr('검토할 사진 크기를 확인해 주세요.')); return value }
  const hash = (key: string, pattern: RegExp): string => { const value = v[key]; if (typeof value !== 'string' || !pattern.test(value)) throw new Error(tr('검토할 사진 식별값을 확인해 주세요.')); return value }
  const width = size('width', 1080), height = size('height', 1080), thumbnailWidth = size('thumbnailWidth', 360), thumbnailHeight = size('thumbnailHeight', 360), ratio = Math.min(1, 360 / Math.max(width, height))
  if (thumbnailWidth !== Math.max(1, Math.round(width * ratio)) || thumbnailHeight !== Math.max(1, Math.round(height * ratio))) throw new Error(tr('사진 비율이 변경되었습니다.'))
  return { ...storyPublicationPrepare(Object.fromEntries(prepareKeys.map(key => [key, v[key]]))), ...draft, ...storyPublicationAudioFields(v.audioRevision,v.audio),ownerId, photoId: backgroundPhotoId(v.photoId), width, height, thumbnailWidth, thumbnailHeight, fullBytes: size('fullBytes', 2 * 1024 * 1024), thumbnailBytes: size('thumbnailBytes', 2 * 1024 * 1024), fullSHA256: hash('fullSHA256', /^[a-f0-9]{64}$/), thumbnailSHA256: hash('thumbnailSHA256', /^[a-f0-9]{64}$/), fullMD5: hash('fullMD5', /^[A-Za-z0-9+/]{22}==$/), thumbnailMD5: hash('thumbnailMD5', /^[A-Za-z0-9+/]{22}==$/) }
}
export function storyPublicationAction(raw: unknown): StoryPublicationAction {
  const v = object(raw)
  if (Object.keys(v).some(key => !['id', 'state', 'action'].includes(key)) || typeof v.state !== 'string' || !['prepared', 'uploading', 'uploaded', 'submitted', 'confirmed', 'rejected'].includes(v.state) || typeof v.action !== 'string' || !['dismiss', 'upload', 'publish', 'check'].includes(v.action) || (v.action === 'upload' && !['prepared', 'uploading'].includes(v.state)) || (v.action === 'publish' && v.state !== 'uploaded') || (v.action === 'check' && !['submitted', 'confirmed', 'rejected'].includes(v.state))) throw new Error(tr('현재 게시 준비 기록을 확인해 주세요.'))
  return { id: backgroundPhotoId(v.id), state: v.state as PendingStoryPublication['state'], action: v.action as StoryPublicationAction['action'] }
}
