import { backgroundImageInfo } from './background-photo-bytes'
import { backgroundPhotoId } from './chat-background'
import { object } from './validation'
import { profilePhotoClear } from './profile-photo-clear'
import { tr } from './i18n'

export const maxProfilePhotoEdge = 1024
export const maxProfilePhotoBytes = 1024 * 1024
export const maxProfilePhotoHistory = 20
export interface ProfilePhotoHistoryItem { id: string; preview: string; appliedAt: number }
export interface ProfilePhotoUploadSnapshot {
  status: 'loading' | 'none' | 'upload' | 'ready' | 'committing' | 'error'
  id: string | null
  preview: string | null
  busy: boolean
  progress: number
  message: string
  history: ProfilePhotoHistoryItem[]
}
export interface ProfilePhotoHistoryAction { id: string; action: 'restore' | 'forget'; version: string }
export function profilePhotoHistoryAction(raw: unknown): ProfilePhotoHistoryAction {
  const value = object(raw), id = backgroundPhotoId(value.id)
  if (Object.keys(value).some(key => !['id', 'action', 'version'].includes(key)) || !['restore', 'forget'].includes(String(value.action))) throw new Error(tr('사진 기록을 다시 확인해 주세요.'))
  return { id, action: value.action as ProfilePhotoHistoryAction['action'], version: profilePhotoClear({ version: value.version }).version }
}
export interface ProfilePhotoUploadAction { id: string; action: 'upload' | 'apply' | 'discard'; version: string }
export function profilePhotoUploadAction(raw: unknown): ProfilePhotoUploadAction {
  const value = object(raw), id = backgroundPhotoId(value.id)
  if (Object.keys(value).some(key => !['id', 'action', 'version'].includes(key)) || !['upload', 'apply', 'discard'].includes(String(value.action))) throw new Error(tr('사진 작업을 다시 확인해 주세요.'))
  return { id, action: value.action as ProfilePhotoUploadAction['action'], version: profilePhotoClear({ version: value.version }).version }
}
export function profilePhotoBytes(raw: unknown): Uint8Array {
  if (!(raw instanceof Uint8Array) || raw.byteLength > maxProfilePhotoBytes) throw new Error(tr('프로필 사진은 1 MB 이하로 준비해 주세요.'))
  const info = backgroundImageInfo(raw, true)
  if (info.width !== info.height || info.width > maxProfilePhotoEdge) throw new Error(tr('프로필 사진을 정사각형으로 다시 준비해 주세요.'))
  return raw
}
