// Electron stand-in for main-process unit tests run in plain Node.
import { tmpdir } from 'node:os'
export const app = { getVersion: () => 'test', getPath: () => tmpdir(), isPackaged: false, getAppPath: () => process.cwd(),
  // crash-diagnostics.ts listens for processes that end; the stand-in keeps the listeners so a test can call them.
  listeners: new Map<string, ((...args: unknown[]) => void)[]>(),
  on(event: string, listener: (...args: unknown[]) => void) { app.listeners.set(event, [...(app.listeners.get(event) ?? []), listener]); return app } }
// Native crash dumps: the stand-in only records that recording was started and how.
export const crashReporter = { started: [] as unknown[], start(options: unknown) { crashReporter.started.push(options) } }
// nativeImage stands in for the shrinking only: the "JPEG" it returns is a marker of the bytes it
// was given, so tests can follow a placeholder through the cache. Real encoding is Electron's.
export const nativeImage = {
  createFromBuffer: (bytes: Buffer) => {
    const image = { resize: () => image, toJPEG: () => Buffer.from(`thumb:${bytes.length}`) }
    return image
  },
  // The taskbar overlay (desktop-shell.ts) is built from the window's PNG; the stand-in keeps the URL to compare.
  createFromDataURL: (url: string) => ({ isEmpty: () => !url.includes(','), url }),
  // The Windows tray's logo (desktop-shell.ts): a marker image that resizes to itself.
  createFromPath: (path: string) => { const image = { isEmpty: () => false, url: `file:${path}`, resize: () => image }; return image }
}
// The desktop shell builds the Dock menu; the Windows tray icon is never made in tests.
export const Menu = { buildFromTemplate: (template: unknown[]) => template }
export class Tray { constructor() { throw new Error('Tray is not available in unit tests') } }
// safeStorage stands in for the OS keychain with a marked, reversible wrapper; tests never read it as secret.
export const safeStorage = {
  isAsyncEncryptionAvailable: async () => true,
  encryptStringAsync: async (text: string) => Buffer.from(`stub:${text}`, 'utf8'),
  decryptStringAsync: async (bytes: Buffer) => ({ result: bytes.toString('utf8').replace(/^stub:/, '') })
}
// The sign-in controller imports Apple's sign-in window (apple-authorization.ts); the tests never open it.
export class BrowserWindow { constructor() { throw new Error('BrowserWindow is not available in unit tests') } }
export const session = { fromPartition: () => { throw new Error('session is not available in unit tests') } }
export const shell = { openExternal: async () => { throw new Error('shell is not available in unit tests') } }
// The App Check provider (web-app-proof.ts) asks whether the machine is online and listens for its page's answer.
export const net = { isOnline: () => true }
export const ipcMain = { on: () => {}, removeListener: () => {} }
export default { app, nativeImage, Menu, Tray, safeStorage, BrowserWindow, session, shell, net, ipcMain }
