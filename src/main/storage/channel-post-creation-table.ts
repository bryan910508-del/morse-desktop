import type Database from 'better-sqlite3-multiple-ciphers'
import { createHash, randomUUID } from 'node:crypto'
import { postCreationRequest, type PostCreationRequest, type PostCreationState, type PendingPostCreation } from '../../shared/channel-post-creation'
import { backgroundPhotoId } from '../../shared/chat-background'
import { channelPostPhotoPath, postPhotoBytes } from '../../shared/channel-post-photo'
import { storageBucket } from '../media/media-document'
export type PostCreationCommand = { kind: 'post-creation-read' } | { kind: 'post-creation-prepare'; request: PostCreationRequest; photos?: Uint8Array[] } |
  { kind: 'post-photo-read'; id: string } | { kind: 'post-photo-state'; id: string; photoId: string; session?: string; uploaded?: true } | { kind: 'post-creation-state'; id: string; expected: PostCreationState; state: PostCreationState | 'dismissed' } |
  { kind: 'post-creation-rebase'; id: string; expected: 'prepared' | 'submitted'; request: PostCreationRequest }
const conflict = (): never => { throw Object.assign(new Error('Post creation or saved draft changed'), { deliveryCode: 'conflict' }) }
export function pendingPostCreation(db: Database.Database): PendingPostCreation | null {
  const rows = db.prepare('SELECT id,payload,state FROM channel_post_creations WHERE payload IS NOT NULL LIMIT 2').all() as { id: string; payload: string; state: PostCreationState }[]
  if (rows.length > 1) return conflict()
  const row = rows[0]
  if (!row) return null
  if (!['prepared', 'submitted', 'confirmed', 'rejected'].includes(row.state) || row.payload.length > 40000) return conflict()
  const request = postCreationRequest(JSON.parse(row.payload))
  if (request.id !== row.id) return conflict()
  return { ...request, state: row.state }
}
function requireDraft(db: Database.Database, request: PostCreationRequest): void {
  const row = db.prepare('SELECT text,visibility,revision FROM channel_post_drafts WHERE channel_id=?').get(request.channelId) as { text: string; visibility: string; revision: string } | undefined
  if (!row || row.revision !== request.draftRevision || row.text !== request.text || row.visibility !== request.visibility) return conflict()
}
// A post that is not going to be published after all gives its words back to the channel's draft, unless something
// new has been written there since.
function restoreDraft(db: Database.Database, request: PostCreationRequest): void {
  const row = db.prepare('SELECT text,visibility FROM channel_post_drafts WHERE channel_id=?').get(request.channelId) as { text: string; visibility: string } | undefined
  if (row && (row.text || row.visibility !== 'public')) return
  db.prepare('INSERT INTO channel_post_drafts(channel_id,text,visibility,revision) VALUES(?,?,?,?) ON CONFLICT(channel_id) DO UPDATE SET text=excluded.text,visibility=excluded.visibility,revision=excluded.revision')
    .run(request.channelId, request.text, request.visibility, randomUUID())
}
// What a post says and shows is fixed when it is handed over; only the channel conditions it was checked against may
// be brought up to date before it goes again.
const content = (request: PostCreationRequest): string => JSON.stringify([request.id, request.channelId, request.authorId, request.text, request.visibility, request.draftRevision, request.photos])
export function executePostCreation(db: Database.Database, command: Exclude<PostCreationCommand, { kind: 'post-photo-read' | 'post-photo-state' }>, uid: string): PendingPostCreation | null {
  if (command.kind === 'post-creation-read') return pendingPostCreation(db)
  return db.transaction(() => {
    const current = pendingPostCreation(db)
    if (command.kind === 'post-creation-prepare') {
      const request = postCreationRequest(command.request)
      if (request.authorId !== uid) return conflict()
      if (current) { const { state, ...previous } = current; if (state === 'prepared' && JSON.stringify(previous) === JSON.stringify(request)) return current; return conflict() }
      if (db.prepare('SELECT 1 FROM channel_post_creations WHERE id=?').get(request.id)) return conflict()
      if ((db.prepare('SELECT COUNT(*) AS n FROM channel_post_creations').get() as { n: number }).n >= 10000) throw Object.assign(new Error('Post creation capacity'), { deliveryCode: 'capacity' })
      requireDraft(db, request)
      db.prepare("INSERT INTO channel_post_creations(id,payload,state) VALUES(?,?,'prepared')").run(request.id, JSON.stringify(request))
      // The post now holds its words, as Telegram's composer empties into the history the moment a message leaves:
      // the draft is free for the next post at once, and the words come back only if this one is not published.
      db.prepare("UPDATE channel_post_drafts SET text='',visibility='public',revision=? WHERE channel_id=?").run(randomUUID(), request.channelId)
      // The prepared photos are kept with the record until it is confirmed or closed.
      const photos = command.photos ?? []
      if (photos.length !== request.photos.length) return conflict()
      request.photos.forEach((info, position) => {
        const bytes = postPhotoBytes(photos[position])
        if (bytes.byteLength !== info.size || createHash('sha256').update(bytes).digest('hex') !== info.sha256 || createHash('md5').update(bytes).digest('base64') !== info.md5) return conflict()
        db.prepare('INSERT INTO channel_post_photos(photo_id,post_id,position,source,session,uploaded) VALUES(?,?,?,?,NULL,0)').run(info.id, request.id, position, Buffer.from(bytes))
      })
    } else if (command.kind === 'post-creation-rebase') {
      // Before it goes again: the same post under the same id, checked against the channel as it is now.
      const request = postCreationRequest(command.request)
      if (!current || current.id !== command.id || request.id !== command.id || current.state !== command.expected || current.authorId !== uid || content(request) !== content(current)) return conflict()
      db.prepare("UPDATE channel_post_creations SET state='prepared',payload=? WHERE id=?").run(JSON.stringify(request), command.id)
    } else {
      backgroundPhotoId(command.id)
      if (!current || current.id !== command.id || current.state !== command.expected || current.authorId !== uid) return conflict()
      // submitted → prepared: the attempt never left, or the server has been seen not to have the post.
      // prepared → rejected: the channel or the upload refused it before it was sent.
      if (!(command.state === 'dismissed' || (current.state === 'prepared' && ['submitted', 'rejected'].includes(command.state)) ||
        (current.state === 'submitted' && ['confirmed', 'rejected', 'prepared'].includes(command.state)))) return conflict()
      if (command.state === 'rejected' || (command.state === 'dismissed' && ['prepared', 'submitted'].includes(current.state))) restoreDraft(db, current)
      db.prepare('UPDATE channel_post_creations SET state=?,payload=CASE WHEN ? THEN NULL ELSE payload END WHERE id=?').run(command.state, command.state === 'dismissed' ? 1 : 0, command.id)
      if (command.state === 'dismissed' || command.state === 'confirmed') db.prepare('DELETE FROM channel_post_photos WHERE post_id=?').run(command.id)
    }
    return pendingPostCreation(db)
  })()
}

export function channelPostPhotoSession(raw: string, channelId: string, photoId: string): string {
  const url = new URL(raw)
  if (raw.length > 8192 || url.protocol !== 'https:' || url.host !== 'firebasestorage.googleapis.com' || url.username || url.password || url.hash ||
    url.pathname !== `/v0/b/${storageBucket}/o` || !url.searchParams.get('upload_id') || (url.searchParams.has('name') && url.searchParams.get('name') !== channelPostPhotoPath(channelId, photoId))) return conflict()
  return url.href
}
export interface PostPhotoRecord { id: string; position: number; bytes: Uint8Array; session: string | null; uploaded: boolean }
// Photos of the one pending post. Upload progress can change only while the post is still prepared.
export function executePostPhotos(db: Database.Database, command: Extract<PostCreationCommand, { kind: 'post-photo-read' | 'post-photo-state' }>): PostPhotoRecord[] {
  return db.transaction(() => {
    const current = pendingPostCreation(db)
    if (!current || current.id !== backgroundPhotoId(command.id)) return conflict()
    if (command.kind === 'post-photo-state') {
      const info = current.photos.find(photo => photo.id === command.photoId)
      const row = info && db.prepare('SELECT session,uploaded FROM channel_post_photos WHERE photo_id=? AND post_id=?').get(info.id, current.id) as { session: string | null; uploaded: number } | undefined
      if (!info || !row || current.state !== 'prepared') return conflict()
      const session = command.session === undefined ? row.session : channelPostPhotoSession(command.session, current.channelId, info.id)
      if (row.session && session !== row.session) return conflict()
      db.prepare('UPDATE channel_post_photos SET session=?,uploaded=? WHERE photo_id=?').run(session, command.uploaded || row.uploaded ? 1 : 0, info.id)
    }
    const rows = db.prepare('SELECT photo_id AS id,position,source,session,uploaded FROM channel_post_photos WHERE post_id=? ORDER BY position').all(current.id) as
      { id: string; position: number; source: Buffer; session: string | null; uploaded: number }[]
    if (rows.length !== current.photos.length) return conflict()
    return rows.map((row, index) => {
      const info = current.photos[index]!
      if (row.id !== info.id || row.position !== index || createHash('sha256').update(row.source).digest('hex') !== info.sha256) return conflict()
      return { id: row.id, position: index, bytes: postPhotoBytes(new Uint8Array(row.source)), session: row.session, uploaded: row.uploaded === 1 }
    })
  })()
}
