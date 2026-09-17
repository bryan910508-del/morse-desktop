// Kept apart from the dictionaries so main's start-up entry can read it without loading them.
export type Language = 'ko' | 'en' | 'ru'
export function isLanguage(value: unknown): value is Language { return value === 'ko' || value === 'en' || value === 'ru' }
// MorseLanguage: the saved choice, otherwise the system's language when Morse has it, otherwise Korean.
export function resolveLanguage(saved: unknown, system: readonly string[]): Language {
  if (isLanguage(saved)) return saved
  const code = system[0]?.split(/[-_]/)[0]?.toLowerCase()
  return isLanguage(code) ? code : 'ko'
}
