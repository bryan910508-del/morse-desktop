import { channelPhotoKind, type ChannelPhotoKind } from './channel-photo-bytes'
import { backgroundPhotoId } from './chat-background'
import { identifier, object } from './validation'
import { tr } from './i18n'
export interface ChannelPhotoBinding { kind: ChannelPhotoKind; channelId: string; version: string; title: string }
export interface ChannelPhotoUploadRequest extends ChannelPhotoBinding { id: string }
export type ChannelPhotoUploadStage = 'upload' | 'ready' | 'committing' | 'confirmed' | 'rejected'
export interface ChannelPhotoUploadAction { id: string; stage: ChannelPhotoUploadStage; action: 'upload' | 'apply' | 'check' | 'discard'; version?: string }
export interface ChannelPhotoUploadSnapshot {
  status: 'loading' | 'ready' | 'error'; busy: boolean; progress: number; message: string
  pending: (ChannelPhotoUploadRequest & { stage: ChannelPhotoUploadStage; preview: string | null }) | null
  current: { version: string; title: string; hasPhoto: boolean } | null
}
export function channelPhotoVersion(raw: unknown): string {
  if (typeof raw !== 'string' || !/^\d{1,12}:\d{1,9}$/.test(raw)) throw new Error(tr('최신 채널 정보를 다시 확인해 주세요.'))
  return raw
}
export function channelPhotoBinding(raw: unknown): ChannelPhotoBinding {
  const value = object(raw)
  if (Object.keys(value).some(key => !['channelId', 'version', 'title', 'kind'].includes(key)) || typeof value.title !== 'string' || !value.title || value.title.length > 512) throw new Error(tr('사진을 변경할 채널을 다시 확인해 주세요.'))
  return { kind: channelPhotoKind(value.kind), channelId: identifier(value.channelId), version: channelPhotoVersion(value.version), title: value.title }
}
export function channelPhotoUploadRequest(raw: unknown): ChannelPhotoUploadRequest {
  const value = object(raw)
  if (Object.keys(value).some(key => !['id', 'channelId', 'version', 'title', 'kind'].includes(key))) throw new Error(tr('채널 사진 준비를 다시 확인해 주세요.'))
  return { id: backgroundPhotoId(value.id), ...channelPhotoBinding({ kind: value.kind, channelId: value.channelId, version: value.version, title: value.title }) }
}
export function channelPhotoUploadAction(raw: unknown): ChannelPhotoUploadAction {
  const value = object(raw)
  if (Object.keys(value).some(key => !['id', 'stage', 'action', 'version'].includes(key)) || (typeof value.stage !== 'string' || !['upload', 'ready', 'committing', 'confirmed', 'rejected'].includes(value.stage)) ||
    (typeof value.action !== 'string' || !['upload', 'apply', 'check', 'discard'].includes(value.action)) || (value.action !== 'apply' && value.version !== undefined)) throw new Error(tr('채널 사진 작업을 다시 확인해 주세요.'))
  return { id: backgroundPhotoId(value.id), stage: value.stage as ChannelPhotoUploadStage, action: value.action as ChannelPhotoUploadAction['action'],
    ...(value.action === 'apply' ? { version: channelPhotoVersion(value.version) } : {}) }
}
