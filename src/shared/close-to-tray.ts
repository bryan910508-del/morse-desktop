import type { Preferences } from './model'

// B374: tdesktop on Windows keeps running in the notification area when its window is closed — WorkMode::WindowAndTray
// is the default (core/core_settings.h:1170) and hideNoQuit then minimizes to the tray (window/main_window.cpp:491-504).
// Morse's setting is a choice the person makes: null until then, which on Windows means the tray.
export function closeToTrayEffective(preferences: Pick<Preferences, 'closeToTrayChoice'>, platform: string): boolean {
  return platform === 'win32' && (preferences.closeToTrayChoice ?? true)
}
// The settings file before 0.241.30 kept `closeToTray`, written as false with every other change, so a false there cannot
// tell a choice from the old default. Read once on the way in: one turned on stays on; anything else becomes «not chosen».
export function migrateCloseToTray(stored: Record<string, unknown>): Record<string, unknown> {
  if ('closeToTrayChoice' in stored) return stored
  const { closeToTray, ...rest } = stored
  return closeToTray === true ? { ...rest, closeToTrayChoice: true } : rest
}
