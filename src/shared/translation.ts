import { language, tr, type Language } from './i18n'
// Chat translation (MorseMessenger iOS: message menu "번역" and "전체번역"), on this Mac only.
export type TranslationResult =
  | { status: 'translated'; text: string }
  | { status: 'same-language' | 'unsupported' | 'not-installed' | 'unavailable' | 'failed' }

// The interface language of Morse Desktop; translations are made into it, as iOS translates into currentLanguage.
export function translationTarget(): Language { return language() }
export const maxTranslationText = 10000

export function translationMessage(result: TranslationResult): string {
  switch (result.status) {
    case 'translated': return ''
    case 'same-language': return tr('이미 한국어로 된 메시지예요.')
    case 'unsupported': return tr('이 언어는 이 Mac에서 번역할 수 없어요.')
    case 'not-installed': return tr('번역 언어를 내려받아야 해요. 시스템 설정의 번역 언어에서 내려받아 주세요.')
    case 'unavailable': return tr('이 Mac에서는 번역을 사용할 수 없어요. macOS 26 이상이 필요해요.')
    default: return tr('번역할 수 없습니다. 잠시 후 다시 시도해 주세요.')
  }
}
