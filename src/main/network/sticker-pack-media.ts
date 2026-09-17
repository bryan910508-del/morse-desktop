import { createHash } from 'node:crypto'
import type { StickerPackItem } from '../../shared/sticker-packs'
import { maxStickerBytes, stickerKind } from '../../shared/stickers'
import type { ReadCredentials } from './firestore-rpc'
import { storageBucket } from '../media/media-document'

async function readBody(response: Response, max: number, signal: AbortSignal, validate: () => void): Promise<Buffer> {
  const header = response.headers.get('content-length'), length = header === null ? null : Number(header)
  if (response.status !== 200 || !response.body || (length !== null && (!Number.isSafeInteger(length) || length <= 0 || length > max))) {
    await response.body?.cancel(); throw new Error('Invalid sticker pack response')
  }
  const reader = response.body.getReader(), chunks: Buffer[] = []
  let total = 0
  try {
    while (true) {
      const part = await reader.read(); signal.throwIfAborted(); validate()
      if (part.done) break
      total += part.value.byteLength
      if (total > max) throw new Error('Sticker pack response too large')
      chunks.push(Buffer.from(part.value))
    }
    if (!total || (length !== null && total !== length)) throw new Error('Incomplete sticker pack response')
    return Buffer.concat(chunks, total)
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); chunks.forEach(chunk => chunk.fill(0)) }
}

// sticker_sets/{setId}/{sha256}.{ext} is readable by every signed-in account (storage.rules), like a public
// Telegram sticker set, so the bytes come straight from Storage with the Firebase ID token; they are only kept
// when they hash to the id the set names them by (iOS MorseStickerSetFileCache.data(for:)).
export async function downloadStickerPackItem(auth: ReadCredentials, item: StickerPackItem, signal: AbortSignal, validate: () => void): Promise<Buffer> {
  if (!item.path.startsWith('sticker_sets/') || item.path.includes('..')) throw new Error('Sticker pack path scope mismatch')
  signal.throwIfAborted(); validate()
  const authorization = await auth.authorize(signal, false)
  signal.throwIfAborted(); validate()
  const url = `https://firebasestorage.googleapis.com/v0/b/${storageBucket}/o/${encodeURIComponent(item.path)}?alt=media`
  const response = await fetch(url, { signal, redirect: 'error', credentials: 'omit', cache: 'no-store',
    headers: { Authorization: `Firebase ${authorization.idToken}`, 'X-Firebase-AppCheck': authorization.appCheckToken } })
  const bytes = await readBody(response, maxStickerBytes, signal, validate)
  const hash = createHash('sha256').update(bytes).digest('hex')
  if (hash !== item.id || stickerKind(bytes) !== item.kind) { bytes.fill(0); throw new Error('Sticker pack bytes mismatch') }
  return bytes
}
