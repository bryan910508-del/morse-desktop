// Electron stand-in for main-process unit tests run in plain Node.
import { tmpdir } from 'node:os'
export const app = { getVersion: () => 'test', getPath: () => tmpdir(), isPackaged: false, getAppPath: () => process.cwd() }
// nativeImage stands in for the shrinking only: the "JPEG" it returns is a marker of the bytes it
// was given, so tests can follow a placeholder through the cache. Real encoding is Electron's.
export const nativeImage = {
  createFromBuffer: (bytes: Buffer) => {
    const image = { resize: () => image, toJPEG: () => Buffer.from(`thumb:${bytes.length}`) }
    return image
  }
}
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
export default { app, nativeImage, safeStorage, BrowserWindow, session, shell, net, ipcMain }
