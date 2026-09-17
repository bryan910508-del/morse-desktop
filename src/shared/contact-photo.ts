import { backgroundPhotoId } from './chat-background'
import { profilePhotoClear } from './profile-photo-clear'
import { identifier, object } from './validation'
import { tr } from './i18n'

export const maxContactPhotoStorage = 64 * 1024 * 1024
export interface ContactPhotoBinding { requestId: string; contactVersion: string; expectedVersion: string }
export interface ContactPhotoEdit extends ContactPhotoBinding { operationId: string; photoId: string | null }
export interface ContactPhotoSnapshot { status: 'loading' | 'ready' | 'error'; version: string; photoId: string | null }
export interface ContactPhotoStorageItem { uid: string; name: string; member: boolean; version: string; photoId: string; bytes: number }
export interface ContactPhotoStorage { token: string; items: ContactPhotoStorageItem[]; bytes: number; limit: number }
export interface ContactPhotoRemoval { token: string; uid: string; version: string; photoId: string; operationId: string }
export function contactPhotoRemoval(raw: unknown): ContactPhotoRemoval {
  const value = object(raw)
  if (Object.keys(value).some(key => !['token', 'uid', 'version', 'photoId', 'operationId'].includes(key))) throw new Error(tr('정리할 사진을 다시 확인해 주세요.'))
  const result = { token: backgroundPhotoId(value.token), uid: identifier(value.uid), version: backgroundPhotoId(value.version),
    photoId: backgroundPhotoId(value.photoId), operationId: backgroundPhotoId(value.operationId) }
  if (result.operationId === result.version) throw new Error(tr('새 정리 요청을 확인해 주세요.'))
  return result
}
export function contactPhotoBinding(raw: unknown): ContactPhotoBinding {
  const value = object(raw)
  if (Object.keys(value).some(key => !['requestId', 'contactVersion', 'expectedVersion'].includes(key))) throw new Error(tr('연락처 사진 선택을 다시 확인해 주세요.'))
  return { requestId: identifier(value.requestId), contactVersion: profilePhotoClear({ version: value.contactVersion }).version,
    expectedVersion: value.expectedVersion === '' ? '' : backgroundPhotoId(value.expectedVersion) }
}
export function contactPhotoEdit(raw: unknown): ContactPhotoEdit {
  const value = object(raw)
  if (Object.keys(value).some(key => !['requestId', 'contactVersion', 'expectedVersion', 'operationId', 'photoId'].includes(key))) throw new Error(tr('연락처 사진 저장을 다시 확인해 주세요.'))
  const binding = contactPhotoBinding({ requestId: value.requestId, contactVersion: value.contactVersion, expectedVersion: value.expectedVersion })
  return { ...binding, operationId: backgroundPhotoId(value.operationId), photoId: value.photoId === null ? null : backgroundPhotoId(value.photoId) }
}
