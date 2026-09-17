import type { ProfileSnapshot } from './profile'
import type { ContactDetailsSnapshot } from './contact-details'
import type { ContactPhotoSnapshot } from './contact-photo'
import { tr } from './i18n'

export interface ContactSummary { uid: string; displayName: string; originalName?: string; personalPhotoURL?: string | null; avatar?: import('./group-photo').GroupPhotoImage | null
  // This device's «즐겨찾기» / «보관».
  favorite?: boolean; archived?: boolean }
export interface ContactMutationSnapshot {
  requestId: string
  uid: string
  kind: 'save' | 'delete' | 'photo'
  busy: boolean
  outcome: 'none' | 'saved' | 'deleted' | 'cancelled' | 'rejected' | 'uncertain'
  message: string
  undo?: { operationId: string; remainingMs: number } | null
}
export const contactDeleteGraceMs = 5000
export interface ContactSearchSnapshot {
  requestId: string | null
  status: 'idle' | 'loading' | 'ready' | 'empty' | 'error'
  result: ContactSummary | null
  adding: boolean
  outcome: 'none' | 'added' | 'exists' | 'rejected' | 'uncertain'
  message: string
}
export function publicMorseId(raw: unknown): string {
  if (typeof raw !== 'string') throw new Error(tr('Morse ID를 입력해 주세요.'))
  const id = raw.trim().toLowerCase().replace(/^@/, '')
  if (!/^[abcdefghjkmnpqrstuvwxyz23456789]{8}$/.test(id)) throw new Error(tr('8자리 Morse ID를 확인해 주세요.'))
  return id
}
export interface ContactProfileSnapshot {
  requestId: string
  uid: string
  status: 'loading' | 'ready' | 'unavailable' | 'error'
  displayName: string
  originalName: string
  contactVersion: string
  local: ContactDetailsSnapshot
  personalPhoto: ContactPhotoSnapshot
  visibility: 'unknown' | 'hidden' | 'visible'
  userId: string
  bio: string
  message: string
  photo: ProfileSnapshot['photo']
}
export interface ContactsSnapshot {
  status: 'loading' | 'ready' | 'error'
  message: string
  items: ContactSummary[]
  personalPhotosStatus: ContactPhotoSnapshot['status']
  profile: ContactProfileSnapshot | null
  mutation: ContactMutationSnapshot | null
}
