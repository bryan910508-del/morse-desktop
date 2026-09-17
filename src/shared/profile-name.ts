import { object } from './validation'
import { tr } from './i18n'

export const maxProfileNameLength = 50
export interface ProfileNameEdit { version: string; displayName: string }
export interface ProfileNameSaveResult { status: 'saved' | 'rejected' | 'uncertain'; message: string }
export function profileNameEdit(raw: unknown): ProfileNameEdit {
  const value = object(raw)
  if (Object.keys(value).some(key => !['version', 'displayName'].includes(key)) ||
    typeof value.version !== 'string' || !/^\d{1,12}:\d{1,9}$/.test(value.version) ||
    typeof value.displayName !== 'string' || value.displayName.length > maxProfileNameLength ||
    !value.displayName.trim() || /[\u0000-\u001f\u007f]/.test(value.displayName)) throw new Error(tr('이름은 줄바꿈 없이 1~50자로 입력해 주세요. 최신 프로필도 확인해 주세요.'))
  return { version: value.version, displayName: value.displayName.trim() }
}
