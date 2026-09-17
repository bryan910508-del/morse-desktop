import type Database from 'better-sqlite3-multiple-ciphers'
import { createHash, randomUUID } from 'node:crypto'
import { backgroundPhotoId } from '../../shared/chat-background'
import { backgroundImageInfo } from '../../shared/background-photo-bytes'
import { storyComposerDraftTarget, type StoryComposerDraftTarget } from '../../shared/story-composer-drafts'
import { storyComposerVideoReference, type StoryComposerVideoReference, type StoryComposerVideoStoredSource, storyComposerVideoWrite, type StoryComposerVideoWrite, type StoryComposerVideoPair, type StoryComposerVideoRecord } from '../../shared/story-composer-video-storage'
import { storyVideoHeaders } from '../media/story-video-headers'
import { storedStoryComposerDraft } from './story-composer-drafts'
import { pendingStoryVideoPublication } from './story-video-publication-table'
import { pendingStoryPublication } from './story-publication-table'
export type StoryComposerVideoCommand = { kind: 'story-composer-video-source'; reference: StoryComposerVideoReference } | { kind: 'story-composer-video-read'; target: StoryComposerDraftTarget } | { kind: 'story-composer-video-write'; request: StoryComposerVideoWrite; pair?: StoryComposerVideoPair }
interface Row { revision: string; sourceId: string | null; posterId: string | null; video: Uint8Array | null; poster: Uint8Array | null; frameTime: number | null }
const fail = (code: 'conflict' | 'capacity' = 'conflict'): never => { throw Object.assign(new Error('Story composer video ' + code), { deliveryCode: code }) }
const hash = (bytes: Uint8Array, algorithm: 'sha256' | 'md5'): string => createHash(algorithm).update(bytes).digest(algorithm === 'md5' ? 'base64' : 'hex')
function stored(db: Database.Database, id: string): Row | undefined {
  return db.prepare('SELECT revision,source_id AS sourceId,poster_id AS posterId,CASE WHEN length(video)<52428800 THEN video END AS video,CASE WHEN length(poster)<=2097152 THEN poster END AS poster,frame_time AS frameTime FROM story_composer_videos WHERE draft_id=?').get(id) as Row | undefined
}
function record(id: string, row: Row | undefined): StoryComposerVideoRecord {
  if (!row) return { id, revision: null, video: null }
  const revision = backgroundPhotoId(row.revision)
  if (row.sourceId === null) { if (row.posterId !== null || row.video !== null || row.poster !== null || row.frameTime !== null) return fail(); return { id, revision, video: null } }
  if (!(row.video instanceof Uint8Array) || !(row.poster instanceof Uint8Array)) return fail()
  const info = storyVideoHeaders(Buffer.from(row.video.buffer, row.video.byteOffset, row.video.byteLength)), image = backgroundImageInfo(row.poster, true), ratio = Math.min(1, 360 / Math.max(info.trackWidth, info.trackHeight))
  if (typeof row.frameTime !== 'number' || !Number.isFinite(row.frameTime) || row.frameTime < 0 || row.frameTime > info.declaredDuration || info.trackWidth * info.trackHeight > 8 * 1024 * 1024 || image.width !== Math.max(1, Math.round(info.trackWidth * ratio)) || image.height !== Math.max(1, Math.round(info.trackHeight * ratio))) return fail()
  return { id, revision, video: { ...info, sourceId: backgroundPhotoId(row.sourceId), posterId: backgroundPhotoId(row.posterId), bytes: row.video.byteLength, posterBytes: row.poster.byteLength, sha256: hash(row.video, 'sha256'), posterSha256: hash(row.poster, 'sha256'), md5: hash(row.video, 'md5'), posterMD5: hash(row.poster, 'md5'), frameTime: row.frameTime, posterWidth: image.width, posterHeight: image.height } }
}
export function executeStoryComposerVideo(db: Database.Database, command: StoryComposerVideoCommand): StoryComposerVideoRecord | StoryComposerVideoStoredSource {
  if (command.kind === 'story-composer-video-source') {
    const reference = storyComposerVideoReference(command.reference), row = stored(db, reference.id)
    try {
      const current = record(reference.id, row)
      if (!storedStoryComposerDraft(db, { id: reference.id }).draft || current.revision !== reference.revision || current.video?.sourceId !== reference.sourceId || current.video.posterId !== reference.posterId || !row?.video || !row.poster || row.frameTime === null) return fail()
      return { record: current, pair: { video: new Uint8Array(row.video), poster: new Uint8Array(row.poster), frameTime: row.frameTime } }
    } finally { row?.video?.fill(0); row?.poster?.fill(0) }
  }
  if (command.kind === 'story-composer-video-read') {
    const target = storyComposerDraftTarget(command.target), result = record(target.id, stored(db, target.id))
    if (result.video && !storedStoryComposerDraft(db, target).draft) return fail()
    return result
  }
  try { return db.transaction(() => {
    const request = storyComposerVideoWrite(command.request), draft = storedStoryComposerDraft(db, { id: request.id })
    if (!draft.draft || draft.revision !== request.draftRevision || pendingStoryPublication(db)?.draftId === request.id || pendingStoryVideoPublication(db)?.draftId === request.id) return fail()
    const pair = command.pair
    if (request.media ? !pair : pair !== undefined) return fail()
    const next = record(request.id, { revision: request.revision, sourceId: request.media?.sourceId ?? null, posterId: request.media?.posterId ?? null, video: pair?.video ?? null, poster: pair?.poster ?? null, frameTime: pair?.frameTime ?? null })
    const previous = stored(db, request.id), current = record(request.id, previous)
    if (current.revision === request.revision) { if (JSON.stringify(current) === JSON.stringify(next)) return current; return fail() }
    if (current.revision !== request.expected || db.prepare('SELECT 1 FROM story_composer_videos WHERE revision=?').get(request.revision)) return fail()
    const photo = db.prepare('SELECT revision FROM story_composer_photos WHERE draft_id=?').get(request.id) as { revision: string } | undefined
    if ((photo?.revision ?? null) !== request.expectedPhoto) return fail()
    const totals = db.prepare('SELECT COUNT(*) AS count,COALESCE(SUM(COALESCE(length(video),0)+COALESCE(length(poster),0)),0) AS bytes FROM story_composer_videos').get() as { count: number; bytes: number }
    const oldBytes = (previous?.video?.byteLength ?? 0) + (previous?.poster?.byteLength ?? 0), nextBytes = (pair?.video.byteLength ?? 0) + (pair?.poster.byteLength ?? 0)
    if ((!previous && totals.count >= 10000) || totals.bytes - oldBytes + nextBytes > 512 * 1024 * 1024) return fail('capacity')
    db.prepare('INSERT INTO story_composer_videos(draft_id,revision,source_id,poster_id,video,poster,frame_time) VALUES(?,?,?,?,?,?,?) ON CONFLICT(draft_id) DO UPDATE SET revision=excluded.revision,source_id=excluded.source_id,poster_id=excluded.poster_id,video=excluded.video,poster=excluded.poster,frame_time=excluded.frame_time').run(request.id, request.revision, request.media?.sourceId ?? null, request.media?.posterId ?? null, pair ? Buffer.from(pair.video.buffer, pair.video.byteOffset, pair.video.byteLength) : null, pair ? Buffer.from(pair.poster.buffer, pair.poster.byteOffset, pair.poster.byteLength) : null, pair?.frameTime ?? null)
    // Replacing a photo must also invalidate its previous compare-and-swap revision.
    if (pair && photo) db.prepare('UPDATE story_composer_photos SET revision=?,photo_id=NULL,full=NULL,thumbnail=NULL WHERE draft_id=?').run(randomUUID(), request.id)
    return next
  })() } finally { command.pair?.video.fill(0); command.pair?.poster.fill(0) }
}
