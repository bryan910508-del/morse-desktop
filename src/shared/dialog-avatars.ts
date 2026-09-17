import { identifier } from './validation'
import { tr } from './i18n'

export const maxDialogAvatars = 24
export function visibleDialogPhotos(raw: unknown): string[] {
  if (!Array.isArray(raw) || raw.length > maxDialogAvatars) throw new Error(tr('표시할 대화 목록을 확인해 주세요.'))
  return [...new Set(raw.map(identifier))]
}
