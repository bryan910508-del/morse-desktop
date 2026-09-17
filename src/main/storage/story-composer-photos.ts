import { pendingStoryVideoPublication } from './story-video-publication-table'
import { pendingStoryPublication } from './story-publication-table'
import type Database from 'better-sqlite3-multiple-ciphers'
import { createHash } from 'node:crypto'
import { backgroundPhotoId } from '../../shared/chat-background'
import { backgroundImageInfo } from '../../shared/background-photo-bytes'
import { storyComposerDraftTarget, type StoryComposerDraftTarget } from '../../shared/story-composer-drafts'
import { storyComposerPhotoPair, storyComposerPhotoWrite, storyComposerPhotoReference, type StoryComposerPhotoWrite, type StoryComposerPhotoReference, type StoryComposerPhotoRecord } from '../../shared/story-composer-photo'
import { storedStoryComposerDraft } from './story-composer-drafts'
export type StoryComposerPhotoCommand = { kind: 'story-composer-photo-read'; target: StoryComposerDraftTarget } | { kind: 'story-composer-photo-source'; reference: StoryComposerPhotoReference } | { kind: 'story-composer-photo-write'; request: StoryComposerPhotoWrite; full?: Uint8Array; thumbnail?: Uint8Array }
interface StoredPhoto { revision: string; photoId: string | null; full: Uint8Array | null; thumbnail: Uint8Array | null }
const fail = (code: 'conflict' | 'capacity'): never => { throw Object.assign(new Error('Story composer photo ' + code), { deliveryCode: code }) }
const sha = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex')
function stored(db: Database.Database, id: string): StoredPhoto | undefined {
  return db.prepare('SELECT revision,photo_id AS photoId,CASE WHEN length(full)<=2097152 THEN full END AS full,CASE WHEN length(thumbnail)<=2097152 THEN thumbnail END AS thumbnail FROM story_composer_photos WHERE draft_id=?').get(id) as StoredPhoto | undefined
}
function record(id: string, row: StoredPhoto | undefined): StoryComposerPhotoRecord {
  if (!row) return { id, revision: null, photo: null }
  const revision = backgroundPhotoId(row.revision)
  if (row.photoId === null) { if (row.full !== null || row.thumbnail !== null) return fail('conflict'); return { id, revision, photo: null } }
  const photoId = backgroundPhotoId(row.photoId), pair = storyComposerPhotoPair(row.full, row.thumbnail), full = backgroundImageInfo(pair.full, true), thumb = backgroundImageInfo(pair.thumbnail, true)
  return { id, revision, photo: { id: photoId, width: full.width, height: full.height, thumbnailWidth: thumb.width, thumbnailHeight: thumb.height, bytes: pair.full.byteLength, thumbnailBytes: pair.thumbnail.byteLength, sha256: sha(pair.full), thumbnailSha256: sha(pair.thumbnail) } }
}
export function executeStoryComposerPhoto(db: Database.Database, command: StoryComposerPhotoCommand): StoryComposerPhotoRecord | { bytes: Uint8Array; sha256: string } {
  if (command.kind === 'story-composer-photo-read') {
    const target = storyComposerDraftTarget(command.target), draft = storedStoryComposerDraft(db, target), result = record(target.id, stored(db, target.id))
    if (result.photo && !draft.draft) return fail('conflict')
    return result
  }
  if (command.kind === 'story-composer-photo-source') {
    const reference = storyComposerPhotoReference(command.reference), draft = storedStoryComposerDraft(db, { id: reference.id }), row = stored(db, reference.id), current = record(reference.id, row)
    if (!draft.draft || !current.photo || current.revision !== reference.revision || current.photo.id !== reference.photoId || !row?.full) return fail('conflict')
    return { bytes: new Uint8Array(row.full), sha256: current.photo.sha256 }
  }
  return db.transaction(() => {
    const request = storyComposerPhotoWrite(command.request), draft = storedStoryComposerDraft(db, { id: request.id })
    if (pendingStoryPublication(db)?.draftId === request.id || pendingStoryVideoPublication(db)?.draftId === request.id) return fail('conflict')
    if (!draft.draft || draft.revision !== request.draftRevision) return fail('conflict')
    if (request.sourceId !== null && db.prepare('SELECT 1 FROM story_composer_videos WHERE draft_id=? AND source_id IS NOT NULL').get(request.id)) return fail('conflict')
    const pair = request.sourceId === null ? null : storyComposerPhotoPair(command.full, command.thumbnail)
    if (!pair && (command.full !== undefined || command.thumbnail !== undefined)) return fail('conflict')
    const previous = stored(db, request.id), current = record(request.id, previous)
    const next = record(request.id, { revision: request.revision, photoId: request.sourceId, full: pair?.full ?? null, thumbnail: pair?.thumbnail ?? null })
    if (current.revision === request.revision) { if (JSON.stringify(current) === JSON.stringify(next)) return current; return fail('conflict') }
    if (current.revision !== request.expected || db.prepare('SELECT 1 FROM story_composer_photos WHERE revision=?').get(request.revision)) return fail('conflict')
    const totals = db.prepare('SELECT COUNT(*) AS count,COALESCE(SUM(COALESCE(length(full),0)+COALESCE(length(thumbnail),0)),0) AS bytes FROM story_composer_photos').get() as { count: number; bytes: number }
    const oldBytes = (previous?.full?.byteLength ?? 0) + (previous?.thumbnail?.byteLength ?? 0), nextBytes = (pair?.full.byteLength ?? 0) + (pair?.thumbnail.byteLength ?? 0)
    if ((!previous && totals.count >= 10000) || totals.bytes - oldBytes + nextBytes > 64 * 1024 * 1024) return fail('capacity')
    db.prepare('INSERT INTO story_composer_photos(draft_id,revision,photo_id,full,thumbnail) VALUES(?,?,?,?,?) ON CONFLICT(draft_id) DO UPDATE SET revision=excluded.revision,photo_id=excluded.photo_id,full=excluded.full,thumbnail=excluded.thumbnail').run(request.id, request.revision, request.sourceId, pair ? Buffer.from(pair.full) : null, pair ? Buffer.from(pair.thumbnail) : null)
    return next
  })()
}
