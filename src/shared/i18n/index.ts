import english from './en.json'
import russian from './ru.json'
import { isLanguage, type Language } from './resolve'

// The app's words are written in Korean and looked up here, as iOS LocalizationService keeps one dictionary per
// language: the Korean text is the key, a missing translation falls back to Korean, and `{0}` marks a value.
export { isLanguage, resolveLanguage, type Language } from './resolve'
export const languages: readonly Language[] = ['ko', 'ru', 'en']
export const languageNames: Readonly<Record<Language, string>> = { ko: '한국어', ru: 'Русский', en: 'English' }
const locales: Readonly<Record<Language, string>> = { ko: 'ko-KR', en: 'en-US', ru: 'ru-RU' }

// A translation that depends on a count names its plural forms (Intl.PluralRules categories).
type Plural = Partial<Record<Intl.LDMLPluralRule, string>> & { other: string }
type Entry = string | Plural
const tables: Readonly<Record<Exclude<Language, 'ko'>, Readonly<Record<string, Entry>>>> = {
  en: english as unknown as Record<string, Entry>,
  ru: russian as unknown as Record<string, Entry>
}

let current: Language | null = null
export function setLanguage(next: Language): void { current = next }
// The window learns the language from its preload bridge; main's start-up entry (src/main/boot.ts) puts it in the
// environment, which main's worker threads share. A page worker or a test without either stays in Korean.
export function language(): Language {
  if (current) return current
  const scope = globalThis as { morse?: { language?: unknown }; process?: { env?: Record<string, string | undefined> } }
  const given = scope.morse?.language ?? scope.process?.env?.MORSE_LANGUAGE
  // Korean is not remembered as the answer, so a bridge that arrives later is still read.
  if (!isLanguage(given)) return 'ko'
  current = given
  return current
}
export function locale(): string { return locales[language()] }

const pluralRules = new Map<Language, Intl.PluralRules>()
function pluralForm(entry: Plural, args: readonly unknown[]): string {
  const count = args.map(arg => typeof arg === 'number' ? arg : typeof arg === 'string' ? Number(arg.replace(/[^\d.-]/g, '')) : NaN).find(Number.isFinite)
  if (count === undefined) return entry.other
  const lang = language()
  let rules = pluralRules.get(lang)
  if (!rules) { rules = new Intl.PluralRules(locales[lang]); pluralRules.set(lang, rules) }
  return entry[rules.select(count)] ?? entry.other
}

// `context` tells apart one Korean word used in two senses (Telegram's lang keys do the same with separate names):
// the dictionary keeps it as «word\u0004context», and the word alone is the fallback.
export function tr(key: string, args: readonly unknown[] = [], context?: string): string {
  const lang = language()
  const entry = lang === 'ko' ? undefined : (context === undefined ? undefined : tables[lang][`${key}\u0004${context}`]) ?? tables[lang][key]
  const text = entry === undefined ? key : typeof entry === 'string' ? entry : pluralForm(entry, args)
  return args.length ? text.replace(/\{(\d+)\}/g, (whole, index: string) => { const value = args[Number(index)]; return value === undefined ? whole : String(value) }) : text
}

// The Korean text a translated message came from, for the few places that classify a message by its words.
let reverse: { lang: Language; exact: Map<string, string>; patterns: [RegExp, string][] } | null = null
export function sourceText(message: string): string {
  const lang = language()
  if (lang === 'ko') return message
  if (reverse?.lang !== lang) {
    const exact = new Map<string, string>(), patterns: [RegExp, string][] = []
    const escape = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    for (const [key, entry] of Object.entries(tables[lang])) {
      for (const text of typeof entry === 'string' ? [entry] : Object.values(entry)) {
        if (!/\{\d+\}/.test(text)) { if (!exact.has(text)) exact.set(text, key); continue }
        // A text made only of values («{0}») would match any message, so it is left out.
        if (text.replace(/\{\d+\}/g, '').trim().length < 3) continue
        patterns.push([new RegExp(`^${text.split(/\{\d+\}/).map(escape).join('[\\s\\S]*?')}$`), key])
      }
    }
    // The most specific wording is tried first.
    const literal = (pattern: RegExp): number => pattern.source.replace(/\[\\s\\S\]\*\?/g, '').length
    patterns.sort((a, b) => literal(b[0]) - literal(a[0]))
    reverse = { lang, exact, patterns }
  }
  return reverse.exact.get(message) ?? reverse.patterns.find(([pattern]) => pattern.test(message))?.[1] ?? message
}
