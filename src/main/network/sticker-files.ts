import { createHash, randomUUID } from 'node:crypto'
import { maxStickerBytes, stickerContentType, stickerKind, type StickerKind } from '../../shared/stickers'
import type { FirestoreDocument, WireObject } from './firestore-values'
import { documents, stringField } from './firestore-values'
import type { FirestoreReader, ReadCredentials } from './firestore-rpc'
import { storageBucket } from '../media/media-document'
import { uploadStorageObject } from './storage-object'
import { MorseCallableFailure } from './morse-callable'

// B195·B210 (contracts/B195-B210-stickers.md): the server's own copy of a sticker's bytes, `sticker_files/{sha256}.{kind}`,
// registered in `stickerFiles/{sha256}` (Telegram's document), and an account's favourites and recents in
// `users/{uid}/stickerPrefs/main` (messages.getFavedStickers / getRecentStickers). Only the server writes either.
export interface StickerRef { id: string; kind: StickerKind }
export interface StickerPrefs { faved: StickerRef[]; recent: StickerRef[] }
export interface StickerFile extends StickerRef { mediaUrl: string; bytes: number }

const kinds: readonly StickerKind[] = ['png', 'gif', 'mp4']
export const stickerFilePath = (ref: StickerRef): string => `sticker_files/${ref.id}.${ref.kind}`

// "{sha256}.{kind}", as morse-sticker-prefs.js writes each entry.
export function stickerEntry(raw: unknown): StickerRef | null {
  const match = typeof raw === 'string' ? /^([a-f0-9]{64})\.(png|gif|mp4)$/.exec(raw) : null
  return match ? { id: match[1]!, kind: match[2] as StickerKind } : null
}
function entries(value: WireObject | undefined): StickerRef[] {
  const list = (value as { arrayValue?: { values?: WireObject[] } } | undefined)?.arrayValue?.values ?? [], seen = new Set<string>(), out: StickerRef[] = []
  for (const item of list.slice(0, 100)) {
    const ref = stickerEntry((item as { stringValue?: unknown }).stringValue)
    if (ref && !seen.has(ref.id)) { seen.add(ref.id); out.push(ref) }
  }
  return out
}
// The server's order is kept: newest first (tdesktop pushFavedToFront, data_stickers.cpp:549-559; incrementSticker :207).
export function stickerPrefsOf(doc: FirestoreDocument | null | undefined): StickerPrefs {
  return { faved: entries(doc?.fields.faved), recent: entries(doc?.fields.recent) }
}
export const stickerPrefsName = (uid: string): string => `${documents}/users/${uid}/stickerPrefs/main`

// stickerFiles/{sha}: ready, of a known kind, with the server's https address of the copy.
export function stickerFileOf(doc: FirestoreDocument | null, id: string): StickerFile | null {
  if (!doc || stringField(doc.fields, 'state', 32) !== 'ready') return null
  const kind = stringField(doc.fields, 'kind', 8) as StickerKind, mediaUrl = stringField(doc.fields, 'mediaUrl', 4096)
  const raw = doc.fields.bytes as { integerValue?: string; doubleValue?: number } | undefined, bytes = Number(raw?.integerValue ?? raw?.doubleValue ?? 0)
  return kinds.includes(kind) && mediaUrl.startsWith('https://') ? { id, kind, mediaUrl, bytes: Number.isFinite(bytes) ? bytes : 0 } : null
}
export async function readStickerFile(reader: FirestoreReader, id: string, signal: AbortSignal, validate: () => void): Promise<StickerFile | null> {
  if (!/^[a-f0-9]{64}$/.test(id)) return null
  return stickerFileOf(await reader.getDocument(`${documents}/stickerFiles/${id}`, signal, validate), id)
}

// The copy's bytes, read with the account's credentials (storage.rules sticker_files: any signed-in account reads) and
// checked against the name: the same SHA-256 and kind, or nothing.
export async function downloadStickerFile(auth: ReadCredentials, ref: StickerRef, signal: AbortSignal, validate: () => void): Promise<Buffer> {
  signal.throwIfAborted(); validate()
  const authorization = await auth.authorize(signal, false)
  signal.throwIfAborted(); validate()
  const response = await fetch(`https://firebasestorage.googleapis.com/v0/b/${storageBucket}/o/${encodeURIComponent(stickerFilePath(ref))}?alt=media`, {
    signal, redirect: 'error', credentials: 'omit', cache: 'no-store',
    headers: { Authorization: `Firebase ${authorization.idToken}`, 'X-Firebase-AppCheck': authorization.appCheckToken } })
  const header = response.headers.get('content-length'), length = header === null ? null : Number(header)
  if (response.status !== 200 || !response.body || (length !== null && (!Number.isSafeInteger(length) || length <= 0 || length > maxStickerBytes))) {
    await response.body?.cancel(); throw new Error('Sticker file unavailable')
  }
  const reader = response.body.getReader(), chunks: Buffer[] = []
  let size = 0
  for (;;) {
    const part = await reader.read()
    if (part.done) break
    size += part.value.byteLength
    if (size > maxStickerBytes) { await reader.cancel(); throw new Error('Sticker file too large') }
    chunks.push(Buffer.from(part.value)); validate()
  }
  const bytes = Buffer.concat(chunks)
  if (createHash('sha256').update(bytes).digest('hex') !== ref.id || stickerKind(bytes) !== ref.kind) { bytes.fill(0); throw new Error('Sticker file mismatch') }
  return bytes
}

// registerStickerFile (morse-sticker-files.js): bytes in no set go up to this account's upload area, the server checks
// them (SHA-256, kind, 512, < 10 MB), copies them as the sticker document and answers with its name — Telegram's
// «upload a document, get its id». A refusal says why (not-512, unknown-format, too-large…).
export class StickerRegistrationRefused extends Error { constructor(readonly reason: string) { super(reason) } }
export async function registerStickerBytes(auth: ReadCredentials, uid: string, bytes: Uint8Array,
  call: (name: string, data: Record<string, unknown>) => Promise<Record<string, unknown>>, signal: AbortSignal): Promise<StickerRef> {
  const kind = stickerKind(bytes)
  if (!kind) throw new StickerRegistrationRefused('unknown-format')
  if (!bytes.byteLength || bytes.byteLength >= maxStickerBytes) throw new StickerRegistrationRefused('too-large')
  const path = `sticker_uploads/${uid}/${randomUUID()}`
  await uploadStorageObject(auth, path, bytes, stickerContentType[kind], {}, AbortSignal.any([signal, AbortSignal.timeout(300000)]))
  let answer: Record<string, unknown>
  try { answer = await call('registerStickerFile', { path }) }
  catch (error) {
    if (error instanceof MorseCallableFailure && error.delivery === 'answered' && error.status === 'INVALID_ARGUMENT') throw new StickerRegistrationRefused(error.reason || 'refused')
    throw error
  }
  const ref = stickerEntry(`${answer.stickerId}.${answer.stickerKind}`)
  if (!ref || ref.id !== createHash('sha256').update(bytes).digest('hex')) throw new Error('Sticker registration mismatch')
  return ref
}
