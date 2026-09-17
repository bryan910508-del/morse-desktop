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
export default { app, nativeImage, safeStorage }
