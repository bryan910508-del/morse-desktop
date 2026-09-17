import { object } from './validation'
import type { ProfilePhotoUploadSnapshot } from './profile-photo-upload'
import { tr } from './i18n'

export interface SelfProfile {
  uid: string
  userId: string
  displayName: string
  bio: string
  premium: boolean
  hasPhoto: boolean
  version: string
}
export interface ProfileSnapshot {
  status: 'loading' | 'ready' | 'error'
  profile: SelfProfile | null
  message: string
  photo: { url: string | null; status: 'none' | 'loading' | 'ready' | 'error'; message: string }
  photoUpload: ProfilePhotoUploadSnapshot
  saving: boolean
  result: 'none' | 'saved' | 'rejected' | 'uncertain'
  resultMessage: string
}
export interface BioEdit { version: string; bio: string }
export interface BioSaveResult { status: 'saved' | 'rejected' | 'uncertain'; message: string }
export function bioEdit(raw: unknown): BioEdit {
  const value = object(raw)
  if (typeof value.version !== 'string' || !/^\d{1,12}:\d{1,9}$/.test(value.version) ||
      typeof value.bio !== 'string' || value.bio.length > 500) throw new Error(tr('소개는 500자까지 입력할 수 있습니다. 최신 프로필을 확인해 주세요.'))
  return { version: value.version, bio: value.bio.trim() }
}
