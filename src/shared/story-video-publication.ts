import { storyPublicationAudioRevision,storyPublicationAudioFields,type StoryPublicationAudioFields } from './story-publication-audio'
import { object, identifier } from './validation'
import { backgroundPhotoId } from './chat-background'
import { storyComposerDraftContent, type StoryComposerDraftContent } from './story-composer-drafts'
import type { StoryComposerVideoRecord } from './story-composer-video-storage'
import { tr } from './i18n'
export interface StoryVideoPublicationPrepare { audioRevision?:string;id: string; draftId: string; draftRevision: string; videoRevision: string }
export interface StoryVideoPublicationIntent extends StoryVideoPublicationPrepare, StoryComposerDraftContent, StoryPublicationAudioFields { ownerId: string; video: NonNullable<StoryComposerVideoRecord['video']> }
export type StoryVideoPart = 'video' | 'poster' | 'audio'
export type StoryVideoTransferState = 'pending' | 'acknowledged' | 'unknown' | 'expired'
export interface PendingStoryVideoPublication extends StoryVideoPublicationIntent { state: 'prepared' | 'uploading' | 'uploaded' | 'submitted' | 'confirmed' | 'rejected'; time: import('./story-publication-commit').StoryPublicationTime | null; uploads: (Record<Exclude<StoryVideoPart,'audio'>, StoryVideoTransferState> & {audio?:StoryVideoTransferState}) | null }
export interface StoryVideoUploadRequest { id: string; state: 'prepared' | 'uploading' }
export function storyVideoUploadRequest(raw: unknown): StoryVideoUploadRequest { const v = object(raw); if (Object.keys(v).some(k => !['id','state'].includes(k)) || (v.state !== 'prepared' && v.state !== 'uploading')) throw new Error(tr('현재 영상 업로드 준비 기록을 확인해 주세요.')); return { id: backgroundPhotoId(v.id), state: v.state } }
const keys = ['id', 'draftId', 'draftRevision', 'videoRevision', 'audioRevision']
export function storyVideoPublicationPrepare(raw: unknown): StoryVideoPublicationPrepare {
  const v = object(raw)
  if (Object.keys(v).some(k => !keys.includes(k))) throw new Error(tr('현재 초안과 저장한 영상 버전을 확인해 주세요.'))
  return { ...storyPublicationAudioRevision(v.audioRevision),id: backgroundPhotoId(v.id), draftId: backgroundPhotoId(v.draftId), draftRevision: backgroundPhotoId(v.draftRevision), videoRevision: backgroundPhotoId(v.videoRevision) }
}
export function storyVideoPublicationIntent(raw: unknown): StoryVideoPublicationIntent {
  const v = object(raw), video = object(v.video)
  if (Object.keys(v).some(k => ![...keys, 'audio','ownerId', 'caption', 'privacy', 'hiddenFrom', 'video'].includes(k)) || Object.keys(video).some(k => !['sourceId', 'posterId', 'declaredDuration', 'trackWidth', 'trackHeight', 'hasAudioTrack', 'bytes', 'posterBytes', 'sha256', 'posterSha256', 'md5', 'posterMD5', 'frameTime', 'posterWidth', 'posterHeight'].includes(k))) throw new Error(tr('영상 게시 준비 기록 형식이 다릅니다.'))
  const draft = storyComposerDraftContent({ caption: v.caption, privacy: v.privacy, hiddenFrom: v.hiddenFrom }), ownerId = identifier(v.ownerId), points = [...draft.caption]
  if (draft.hiddenFrom.includes(ownerId) || points.length > 2000 || points.some(c => { const n = c.codePointAt(0)!; return n >= 0xD800 && n <= 0xDFFF })) throw new Error(tr('게시할 설명은 올바른 문자 2,000자 이내여야 합니다. 원문은 유지합니다.'))
  const size = (key: string, max: number): number => { const n = video[key]; if (typeof n !== 'number' || !Number.isSafeInteger(n) || n < 1 || n > max) throw new Error(tr('게시 영상 크기를 확인해 주세요.')); return n }
  const hash = (key: string, pattern: RegExp): string => { const s = video[key]; if (typeof s !== 'string' || !pattern.test(s)) throw new Error(tr('게시 영상 식별값을 확인해 주세요.')); return s }
  const declaredDuration = video.declaredDuration, frameTime = video.frameTime
  if (typeof declaredDuration !== 'number' || !Number.isFinite(declaredDuration) || declaredDuration < .5 || declaredDuration > 60 || typeof frameTime !== 'number' || !Number.isFinite(frameTime) || frameTime < 0 || frameTime > declaredDuration || typeof video.hasAudioTrack !== 'boolean') throw new Error(tr('게시 영상의 길이와 선택 시점을 확인해 주세요.'))
  const trackWidth = size('trackWidth',4096), trackHeight = size('trackHeight',4096), posterWidth = size('posterWidth',360), posterHeight = size('posterHeight',360), ratio = Math.min(1,360/Math.max(trackWidth,trackHeight))
  if (trackWidth * trackHeight > 8*1024*1024 || posterWidth !== Math.max(1,Math.round(trackWidth*ratio)) || posterHeight !== Math.max(1,Math.round(trackHeight*ratio))) throw new Error(tr('게시 영상과 포스터 비율을 확인해 주세요.'))
  return { ...storyVideoPublicationPrepare(Object.fromEntries(keys.map(k => [k,v[k]]))), ...draft, ...storyPublicationAudioFields(v.audioRevision,v.audio),ownerId, video: { sourceId: backgroundPhotoId(video.sourceId), posterId: backgroundPhotoId(video.posterId), declaredDuration, frameTime, trackWidth, trackHeight, posterWidth, posterHeight, hasAudioTrack: video.hasAudioTrack, bytes: size('bytes',50*1024*1024-1), posterBytes: size('posterBytes',2*1024*1024), sha256: hash('sha256',/^[a-f0-9]{64}$/), posterSha256: hash('posterSha256',/^[a-f0-9]{64}$/), md5: hash('md5',/^[A-Za-z0-9+/]{22}==$/), posterMD5: hash('posterMD5',/^[A-Za-z0-9+/]{22}==$/) } }
}
