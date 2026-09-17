import { object } from './validation'
import { tr } from './i18n'

export interface ProfilePhotoClear { version: string }
export interface ProfilePhotoClearResult { status: 'saved' | 'rejected' | 'uncertain'; message: string }
export function profilePhotoClear(raw: unknown): ProfilePhotoClear {
  const value = object(raw)
  if (Object.keys(value).some(key => key !== 'version') || typeof value.version !== 'string' || !/^\d{1,12}:\d{1,9}$/.test(value.version)) {
    throw new Error(tr('최신 프로필 사진을 확인한 뒤 제거해 주세요.'))
  }
  return { version: value.version }
}
