import type { Language } from './resolve'

// The same words for the page's workers and the preload, without the dictionaries (electron.vite.config.ts points
// their imports here): they word a message in Korean, and the window shows it in its language (errorText, tr).
export { isLanguage, resolveLanguage, type Language } from './resolve'
export const languages: readonly Language[] = ['ko', 'ru', 'en']
export const languageNames: Readonly<Record<Language, string>> = { ko: '한국어', ru: 'Русский', en: 'English' }
export function setLanguage(_next: Language): void {}
export function language(): Language { return 'ko' }
export function locale(): string { return 'ko-KR' }
export function tr(key: string, args: readonly unknown[] = [], _context?: string): string {
  return args.length ? key.replace(/\{(\d+)\}/g, (whole, index: string) => { const value = args[Number(index)]; return value === undefined ? whole : String(value) }) : key
}
export function sourceText(message: string): string { return message }
