import { backgroundPhotoId } from './chat-background'
import { identifier, object } from './validation'
import { tr } from './i18n'
export interface GroupPhotoBinding { chatId: string; version: string; title: string }
export interface GroupPhotoUploadRequest extends GroupPhotoBinding { id: string }
export type GroupPhotoUploadStage = 'upload' | 'ready' | 'committing' | 'confirmed' | 'rejected'
export interface GroupPhotoUploadAction { id: string; stage: GroupPhotoUploadStage; action: 'upload' | 'apply' | 'check' | 'discard'; version?: string }
export interface GroupPhotoUploadSnapshot {
  status: 'loading' | 'ready' | 'error'; busy: boolean; progress: number; message: string
  pending: (GroupPhotoUploadRequest & { stage: GroupPhotoUploadStage; preview: string | null }) | null
  current: { version: string; title: string; hasPhoto: boolean } | null
}
export function groupPhotoVersion(raw: unknown): string {
  if (typeof raw !== 'string' || !/^\d{1,12}:\d{1,9}$/.test(raw)) throw new Error(tr('최신 그룹 정보를 다시 확인해 주세요.'))
  return raw
}
export function groupPhotoBinding(raw: unknown): GroupPhotoBinding {
  const value = object(raw)
  if (Object.keys(value).some(key => !['chatId', 'version', 'title'].includes(key)) || typeof value.title !== 'string' || !value.title || value.title.length > 512) throw new Error(tr('사진을 변경할 그룹을 다시 확인해 주세요.'))
  return { chatId: identifier(value.chatId), version: groupPhotoVersion(value.version), title: value.title }
}
export function groupPhotoUploadRequest(raw: unknown): GroupPhotoUploadRequest {
  const value = object(raw)
  if (Object.keys(value).some(key => !['id', 'chatId', 'version', 'title'].includes(key))) throw new Error(tr('그룹 사진 준비를 다시 확인해 주세요.'))
  return { id: backgroundPhotoId(value.id), ...groupPhotoBinding({ chatId: value.chatId, version: value.version, title: value.title }) }
}
export function groupPhotoUploadAction(raw: unknown): GroupPhotoUploadAction {
  const value = object(raw)
  if (Object.keys(value).some(key => !['id', 'stage', 'action', 'version'].includes(key)) || !['upload', 'ready', 'committing', 'confirmed', 'rejected'].includes(String(value.stage)) ||
    !['upload', 'apply', 'check', 'discard'].includes(String(value.action)) || (value.action !== 'apply' && value.version !== undefined)) throw new Error(tr('그룹 사진 작업을 다시 확인해 주세요.'))
  return { id: backgroundPhotoId(value.id), stage: value.stage as GroupPhotoUploadStage, action: value.action as GroupPhotoUploadAction['action'],
    ...(value.action === 'apply' ? { version: groupPhotoVersion(value.version) } : {}) }
}
