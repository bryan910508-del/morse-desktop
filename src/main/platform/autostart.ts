import { app } from 'electron'

// B378 ③, Windows only (tdesktop AutostartSupported: specific_win.cpp:441-443, false on a Mac specific_mac.h:15-17).
// tdesktop outside the Store puts a link with «-autostart» in the Startup folder (AutostartToggle :455-492); Electron's
// login item puts the same start, with its argument, in the user's Run key.
export const autostartArgument = '--autostart'
export type LoginItems = Pick<typeof app, 'setLoginItemSettings' | 'getLoginItemSettings'>
export function launchedAtLogin(argv: readonly string[]): boolean { return argv.includes(autostartArgument) }
// What the system now says, read back after the change (tdesktop done(enabled && success)).
export function toggleAutostart(enabled: boolean, items: LoginItems = app): boolean {
  try {
    items.setLoginItemSettings({ openAtLogin: enabled, args: [autostartArgument] })
    return items.getLoginItemSettings({ args: [autostartArgument] }).openAtLogin === true
  } catch { return false }
}
export interface LaunchState { platform: NodeJS.Platform; atLogin: boolean; autoStart: boolean; startMinimized: boolean; passcodeLocked: boolean; trayAvailable: boolean }
// A start by Windows that the setting no longer wants takes its entry away and ends (AutostartSkip :494-500,
// Application::run application.cpp:336-340).
export function autostartSkipped(state: LaunchState): boolean { return state.platform === 'win32' && state.atLogin && !state.autoStart }
// MainWindow::applyInitialWorkMode (mainwindow.cpp:124-136): a start by Windows with «start minimized» stays in the tray,
// unless the local passcode is locked and has to be shown. Without a tray to come back from it shows.
export function startHidden(state: LaunchState): boolean {
  return state.platform === 'win32' && state.atLogin && state.autoStart && state.startMinimized && !state.passcodeLocked && state.trayAvailable
}
