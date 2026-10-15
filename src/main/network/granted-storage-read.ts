import { createHash } from 'node:crypto'
import { object } from '../../shared/validation'
import type { ReadCredentials } from './firestore-rpc'
import { callMorseFunction } from './morse-callable'
import { storageBucket } from '../media/media-document'
import { sendAgain } from './resend'
import { morseFetch } from './client-agent'

// What a read of one granted Storage object must find: the custom metadata the uploader wrote, the content types it
// may have, its largest size, and the words its errors use ('Story photo', 'Channel media', …).
export interface GrantedObjectCheck {
  label: string
  custom: Record<string, string>
  contentTypes: readonly string[] | null
  maxBytes: number
  // Whether a request whose connection never came up is sent again (resend.ts).
  resend: boolean
  // B360: maxBytes is the person's automatic download limit, so the object's size is weighed before any of its bytes
  // are asked for (tdesktop knows a document's size before it downloads, data_auto_download.cpp:50-58).
  weighFirst?: boolean
}
export interface GrantedObject { bytes: Buffer; contentType: string }

async function body(response: Response, max: number, label: string, signal: AbortSignal, validate: () => void, progress?: (loaded: number, length: number | null) => void): Promise<Buffer> {
  const header = response.headers.get('content-length'), length = header === null ? null : Number(header)
  if (response.status !== 200 || !response.body || (length !== null && (!Number.isSafeInteger(length) || length <= 0 || length > max))) {
    await response.body?.cancel(); throw new Error(`Invalid ${label} response`)
  }
  const reader = response.body.getReader(), chunks: Buffer[] = []
  let total = 0, lastProgress = 0
  try {
    while (true) {
      const part = await reader.read(); signal.throwIfAborted(); validate()
      if (part.done) break
      total += part.value.byteLength
      if (total > max) throw new Error(`${label} response too large`)
      chunks.push(Buffer.from(part.value))
      if (Date.now() - lastProgress >= 500) { progress?.(total, length); lastProgress = Date.now() }
    }
    if (!total || (length !== null && total !== length)) throw new Error(`Incomplete ${label} response`)
    return Buffer.concat(chunks, total)
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); chunks.forEach(chunk => chunk.fill(0)) }
}

// B416: one granted Storage object — authorizeMorseMediaRead, then its bytes, kept only when they are what the object's
// own description says (the uploader's custom metadata, an allowed type, a size within bounds, and the md5 of the bytes).
// Every Storage request pays the server's access check (0.45–3.7 s measured 10-15 against a 0.11 s bare round trip), so
// the description is taken from the bytes' answer itself when it carries it (x-goog-hash md5, x-goog-generation,
// x-goog-meta-*, Content-Type: it did on every read measured), as tdesktop reads a file in one request (FileLoader). Only
// an answer that lacks part of it asks for the metadata too, while the bytes keep coming. An object replaced while it
// was read fails the md5 and is read again by the caller.
interface Described { contentType: string; size: number | null; hash: string }
export async function readGrantedStorageObject(auth: ReadCredentials, path: string, check: GrantedObjectCheck, signal: AbortSignal, validate: () => void,
  progress: (loaded: number, total: number) => void, timing?: (marks: string) => void): Promise<GrantedObject> {
  const resourceURL = `gs://${storageBucket}/${path}`, started = performance.now(), marks: string[] = []
  const mark = (name: string): void => { marks.push(`${name}=${Math.round(performance.now() - started)}`) }
  // The grant is the one callable of a read; morse-callable.ts sends it again while the connection was never made.
  const grant = await callMorseFunction(auth, 'authorizeMorseMediaRead', { resourceURL }, signal, { validate, limit: 64 * 1024 })
  if (grant.ok !== true || grant.resourceURL !== resourceURL) throw new Error(`${check.label} authorization denied`)
  mark('grant')
  signal.throwIfAborted(); validate()
  const authorization = await auth.authorize(signal, false)
  mark('token')
  signal.throwIfAborted(); validate()
  // Either request failing stops the other.
  const both = new AbortController(), bounded = AbortSignal.any([signal, both.signal])
  const endpoint = `https://firebasestorage.googleapis.com/v0/b/${storageBucket}/o/${encodeURIComponent(path)}`
  const fetchOnce = (url: string) => morseFetch(url, { signal: bounded, redirect: 'error', credentials: 'omit', cache: 'no-store',
    headers: { Authorization: `Firebase ${authorization.idToken}`, 'X-Firebase-AppCheck': authorization.appCheckToken } })
  const get = (url: string) => check.resend ? sendAgain(bounded, () => fetchOnce(url)) : fetchOnce(url)
  const allowedType = (type: unknown): type is string => check.contentTypes === null || (typeof type === 'string' && check.contentTypes.includes(type))
  const metadata = async (): Promise<Described> => {
    const payload = await body(await get(endpoint), 64 * 1024, check.label, bounded, validate)
    try {
      const value = object(JSON.parse(payload.toString('utf8'))), custom = object(value.metadata)
      if (value.bucket !== storageBucket || value.name !== path || Object.entries(check.custom).some(([key, expected]) => custom[key] !== expected) ||
          !allowedType(value.contentType) ||
          typeof value.size !== 'string' || !/^\d{1,10}$/.test(value.size) || Number(value.size) <= 0 || Number(value.size) > check.maxBytes ||
          typeof value.generation !== 'string' || !/^\d{1,30}$/.test(value.generation) ||
          typeof value.metageneration !== 'string' || !/^\d{1,30}$/.test(value.metageneration) ||
          typeof value.md5Hash !== 'string' || !/^[A-Za-z0-9+/]{22}==$/.test(value.md5Hash)) throw new Error(`${check.label} metadata mismatch`)
      mark('meta')
      return { contentType: typeof value.contentType === 'string' ? value.contentType : '', size: Number(value.size), hash: value.md5Hash }
    } finally { payload.fill(0) }
  }
  // The same description from the bytes' answer, or null when it does not carry all of it. A part it carries that
  // disagrees is a mismatch, as in the metadata.
  const fromHeaders = (headers: Headers): Described | null => {
    const md5 = /(?:^|,)\s*md5=([A-Za-z0-9+/]{22}==)\s*(?:,|$)/.exec(headers.get('x-goog-hash') ?? '')?.[1]
    const generation = headers.get('x-goog-generation'), type = headers.get('content-type')?.split(';')[0]?.trim()
    const customs = Object.entries(check.custom).map(([key, expected]) => [headers.get(`x-goog-meta-${key}`), expected] as const)
    if (customs.some(([seen, expected]) => seen !== null && seen !== expected) || (type && !allowedType(type))) throw new Error(`${check.label} metadata mismatch`)
    if (!md5 || !generation || !/^\d{1,30}$/.test(generation) || customs.some(([seen]) => seen === null) || (check.contentTypes !== null && !type)) return null
    const length = headers.get('content-length')
    return { contentType: type ?? '', size: length !== null && /^\d{1,10}$/.test(length) ? Number(length) : null, hash: md5 }
  }
  let described: Promise<Described> | null = null, known: number | null = null, asked = 'one'
  if (check.weighFirst) {
    // Over the limit, nothing more is asked: the metadata's own check refuses a size above maxBytes.
    const weighed = await metadata()
    described = Promise.resolve(weighed); known = weighed.size; asked = 'weighed'
  }
  const media = (async () => {
    const response = await get(`${endpoint}?alt=media`)
    mark('headers')
    const carried = described ? null : fromHeaders(response.headers)
    if (described) { /* Weighed already. */ }
    else if (carried) { described = Promise.resolve(carried); known = carried.size }
    else {
      // The answer does not say enough: the metadata is asked for while the bytes keep coming.
      asked = 'two'
      described = metadata().then(value => { known = value.size; return value })
      described.catch(() => both.abort())
    }
    const bytes = await body(response, check.maxBytes, check.label, bounded, validate,
      (loaded, length) => { validate(); progress(loaded, known ?? length ?? loaded) })
    mark('media')
    return bytes
  })()
  let bytes: Buffer
  try { bytes = await media }
  catch (error) {
    // The metadata's own failure is the one that says why (it stopped the bytes).
    both.abort(); const reason = await (described as Promise<Described> | null)?.then(() => null, failure => failure as unknown)
    throw reason ?? error
  }
  try {
    const about = await (described as unknown as Promise<Described>)
    if ((about.size !== null && about.size !== bytes.length) || bytes.length > check.maxBytes || createHash('md5').update(bytes).digest('base64') !== about.hash) throw new Error(`${check.label} changed during download`)
    signal.throwIfAborted(); validate(); progress(bytes.length, bytes.length)
    timing?.(`${marks.join(' ')} bytes=${bytes.length} requests=${asked}`)
    return { bytes, contentType: about.contentType }
  } catch (error) { both.abort(); bytes.fill(0); throw error }
}
