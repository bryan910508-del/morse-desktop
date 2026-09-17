import { app } from 'electron'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { resolveLanguage } from '../shared/i18n/resolve'

// Morse's start-up entry. The language is settled before the app's modules load, because some of them word their
// labels as they load: the choice saved in preferences.json, or the system's (iOS LocalizationService.initialLanguage).
// A change made in settings is saved and used from the next start.
function savedLanguage(): unknown {
  try { return (JSON.parse(readFileSync(join(app.getPath('userData'), 'preferences.json'), 'utf8')) as { preferences?: { language?: unknown } }).preferences?.language }
  catch { return null }
}
function systemLanguages(): string[] {
  try { return app.getPreferredSystemLanguages() } catch { return [] }
}
process.env.MORSE_LANGUAGE = resolveLanguage(savedLanguage(), systemLanguages())
createRequire(__filename)(join(__dirname, 'index.cjs'))
