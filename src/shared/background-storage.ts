import { backgroundPhotoId } from './chat-background'
import { identifier, object } from './validation'
import { tr } from './i18n'

export interface BackgroundStorageRecord { chatId: string; version: string; photoId: string; bytes: number }
export interface BackgroundStorageItem extends BackgroundStorageRecord { title: string; listed: boolean }
export interface BackgroundStorageSnapshot { token: string; items: BackgroundStorageItem[]; bytes: number; limit: number }
export interface BackgroundStorageRemoval { token: string; chatId: string; version: string; photoId: string; operationId: string }
export function backgroundStorageRemoval(raw: unknown): BackgroundStorageRemoval {
  const value = object(raw)
  if (Object.keys(value).some(key => !['token', 'chatId', 'version', 'photoId', 'operationId'].includes(key))) throw new Error(tr('정리할 대화 배경을 다시 확인해 주세요.'))
  const result = { token: backgroundPhotoId(value.token), chatId: identifier(value.chatId), version: identifier(value.version),
    photoId: backgroundPhotoId(value.photoId), operationId: backgroundPhotoId(value.operationId) }
  if (result.version === result.operationId) throw new Error(tr('새 배경 정리 요청을 확인해 주세요.'))
  return result
}
