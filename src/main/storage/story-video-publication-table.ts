import { preparedStoryAudioSource } from './story-prepared-audio'
import { storyPublicationAudioSource,prepareStoryPublicationAudio,storeStoryPublicationAudio,requireStoryPublicationAudio } from './story-publication-audios'
import { readStoryVideoTime, mutateStoryVideoCommit, type StoryVideoCommitCommand } from './story-video-commit-table'
import { createHash } from 'node:crypto'
import { storyVideoHeaders } from '../media/story-video-headers'
import { backgroundImageInfo } from '../../shared/background-photo-bytes'
import { readStoryVideoTransfers, mutateStoryVideoTransfer, type StoryVideoUploadCommand } from './story-video-upload-table'
import { storyVideoPart, type StoryVideoUploadSource } from '../media/story-video-upload-record'
import type Database from 'better-sqlite3-multiple-ciphers'
import { backgroundPhotoId } from '../../shared/chat-background'
import { storyVideoPublicationIntent, storyVideoPublicationPrepare, type StoryVideoPublicationPrepare, type PendingStoryVideoPublication } from '../../shared/story-video-publication'
import type { StoryComposerVideoRecord, StoryComposerVideoStoredSource } from '../../shared/story-composer-video-storage'
import { storedStoryComposerDraft } from './story-composer-drafts'
import { executeStoryComposerVideo } from './story-composer-videos'
import { pendingStoryPublication } from './story-publication-table'
export type StoryVideoPublicationCommand = {kind:'story-video-publication-audio-source';request:import('../../shared/story-prepared-audio').StoryPreparedAudioRequest} | StoryVideoCommitCommand | StoryVideoUploadCommand | { kind: 'story-video-publication-read' } | { kind: 'story-video-publication-prepare'; request: StoryVideoPublicationPrepare } | { kind: 'story-video-publication-dismiss'; id: string }
const fail = (code: 'conflict' | 'capacity' = 'conflict'): never => { throw Object.assign(new Error('Story video publication ' + code), { deliveryCode: code }) }
export function pendingStoryVideoPublication(db: Database.Database): PendingStoryVideoPublication | null {
  const rows = db.prepare('SELECT id,payload,state FROM story_video_publications WHERE payload IS NOT NULL LIMIT 2').all() as { id: string; payload: string; state: string }[]
  if (rows.length > 1) return fail()
  const row = rows[0]
  if (!row) return null
  if (!['prepared','uploading','uploaded','submitted','confirmed','rejected'].includes(row.state) || row.payload.length > 250000) return fail()
  const value = storyVideoPublicationIntent(JSON.parse(row.payload))
  if (value.id !== row.id) return fail()
  requireStoryPublicationAudio(db,value)
  const transfers = readStoryVideoTransfers(db,value)
  if ((row.state === 'prepared') !== (transfers === null) || (['uploaded','submitted','confirmed','rejected'].includes(row.state) && (!transfers || Object.values(transfers).some(part=>part.state!=='acknowledged'))) || (row.state === 'uploading' && transfers && Object.values(transfers).every(part=>part.state==='acknowledged'))) return fail()
  const time = readStoryVideoTime(db,value.id)
  if (['submitted','confirmed','rejected'].includes(row.state) !== (time !== null)) return fail()
  return { ...value, state: row.state as PendingStoryVideoPublication['state'], time, uploads: transfers ? { video: transfers.video.state, poster: transfers.poster.state,...(transfers.audio?{audio:transfers.audio.state}:{}) } : null }
}
function uploadSource(db: Database.Database, current: PendingStoryVideoPublication, part: import('../../shared/story-video-publication').StoryVideoPart): StoryVideoUploadSource {
  const row = db.prepare('SELECT CASE WHEN length(video)<52428800 THEN video END AS video,CASE WHEN length(poster)<=2097152 THEN poster END AS poster FROM story_video_publications WHERE id=?').get(current.id) as { video: Uint8Array | null; poster: Uint8Array | null } | undefined
  try {
    if (!(row?.video instanceof Uint8Array) || !(row.poster instanceof Uint8Array)) return fail()
    const video = Buffer.from(row.video.buffer,row.video.byteOffset,row.video.byteLength), poster = row.poster, info = storyVideoHeaders(video), image = backgroundImageInfo(poster,true), expected = current.video
    const sha = (b: Uint8Array): string => createHash('sha256').update(b).digest('hex'), md5 = (b: Uint8Array): string => createHash('md5').update(b).digest('base64')
    if (video.byteLength !== expected.bytes || poster.byteLength !== expected.posterBytes || sha(video) !== expected.sha256 || sha(poster) !== expected.posterSha256 || md5(video) !== expected.md5 || md5(poster) !== expected.posterMD5 || info.declaredDuration !== expected.declaredDuration || info.trackWidth !== expected.trackWidth || info.trackHeight !== expected.trackHeight || image.width !== expected.posterWidth || image.height !== expected.posterHeight) return fail()
    const transfers = readStoryVideoTransfers(db,current)
    if (!transfers || !transfers[part] || (part === 'poster' && transfers.video.state !== 'acknowledged') || (part==='audio' && (transfers.video.state!=='acknowledged' || transfers.poster.state!=='acknowledged'))) return fail()
    const { state: _state, uploads: _uploads, time: _time, ...intent } = current
    return { intent, part, transfer: transfers[part]!, bytes: part==='audio'?storyPublicationAudioSource(db,current):new Uint8Array(part === 'video' ? video : poster) }
  } finally { row?.video?.fill(0); row?.poster?.fill(0) }
}
export function executeStoryVideoPublication(db: Database.Database, command: StoryVideoPublicationCommand, uid: string): import('../../shared/story-composer-audio-storage').StoryComposerAudioStoredSource | PendingStoryVideoPublication | StoryVideoUploadSource | null {
  if(command.kind==='story-video-publication-audio-source')return preparedStoryAudioSource(db,pendingStoryVideoPublication(db),command.request,'video',uid)
  if (command.kind === 'story-video-publication-upload-source') { const current = pendingStoryVideoPublication(db); if (!current || current.ownerId !== uid || current.id !== backgroundPhotoId(command.id) || current.state !== 'uploading') return fail(); return uploadSource(db,current,storyVideoPart(command.part)) }
  if (command.kind === 'story-video-publication-read') { const value = pendingStoryVideoPublication(db); if (value && value.ownerId !== uid) return fail(); return value }
  return db.transaction((): PendingStoryVideoPublication | null => {
    const current = pendingStoryVideoPublication(db)
    if (current && current.ownerId !== uid) return fail()
    if (command.kind === 'story-video-publication-dismiss') {
      const id = backgroundPhotoId(command.id)
      if (!current) { if (db.prepare("SELECT 1 FROM story_video_publications WHERE id=? AND state='dismissed' AND payload IS NULL AND video IS NULL AND poster IS NULL").get(id)) return null; return fail() }
      if (current.id !== id) return fail()
      db.prepare('DELETE FROM story_publication_audios WHERE publication_id=?').run(current.id)
      db.prepare('DELETE FROM story_video_commits WHERE publication_id=?').run(id)
      db.prepare('DELETE FROM story_video_uploads WHERE publication_id=?').run(id)
      db.prepare("UPDATE story_video_publications SET payload=NULL,video=NULL,poster=NULL,state='dismissed' WHERE id=?").run(id)
      return null
    }
    if (command.kind === 'story-video-publication-submit' || command.kind === 'story-video-publication-outcome') {
      if (!current || current.id !== backgroundPhotoId(command.id)) return fail()
      const source = uploadSource(db,current,'poster'); source.bytes.fill(0)
      if(current.audio){const audio=storyPublicationAudioSource(db,current);audio.fill(0)}
      mutateStoryVideoCommit(db,current,command); return pendingStoryVideoPublication(db)
    }
    if (command.kind !== 'story-video-publication-prepare') { if (!current || current.id !== backgroundPhotoId(command.id)) return fail(); mutateStoryVideoTransfer(db,current,command); return pendingStoryVideoPublication(db) }
    const request = storyVideoPublicationPrepare(command.request)
    if (current) { if (current.id === request.id && current.draftId === request.draftId && current.draftRevision === request.draftRevision && current.videoRevision === request.videoRevision && current.audioRevision === request.audioRevision) return current; return fail() }
    if (pendingStoryPublication(db) || db.prepare('SELECT 1 FROM story_video_publications WHERE id=?').get(request.id) || db.prepare('SELECT 1 FROM story_publications WHERE id=?').get(request.id)) return fail()
    if ((db.prepare('SELECT COUNT(*) AS n FROM story_video_publications').get() as { n: number }).n >= 10000) return fail('capacity')
    const draft = storedStoryComposerDraft(db, { id: request.draftId })
    if (!draft.draft || draft.revision !== request.draftRevision) return fail()
    const saved = executeStoryComposerVideo(db, { kind: 'story-composer-video-read', target: { id: request.draftId } }) as StoryComposerVideoRecord
    if (!saved.video || saved.revision !== request.videoRevision || db.prepare('SELECT 1 FROM story_composer_photos WHERE draft_id=? AND photo_id IS NOT NULL').get(request.draftId)) return fail()
    const source = executeStoryComposerVideo(db, { kind: 'story-composer-video-source', reference: { id: request.draftId, revision: request.videoRevision, sourceId: saved.video.sourceId, posterId: saved.video.posterId } }) as StoryComposerVideoStoredSource
    let audio:ReturnType<typeof prepareStoryPublicationAudio>|null=null
    try {
      audio=prepareStoryPublicationAudio(db,request.draftId,request.audioRevision)
      if (JSON.stringify(source.record) !== JSON.stringify(saved)) return fail()
      const value = storyVideoPublicationIntent({ ...request, ...audio.fields,...draft.draft, ownerId: uid, video: saved.video }), payload = JSON.stringify(value)
      if (payload.length > 250000) return fail('capacity')
      const { video, poster } = source.pair
      db.prepare("INSERT INTO story_video_publications(id,payload,video,poster,state) VALUES(?,?,?,?,'prepared')").run(value.id,payload,Buffer.from(video.buffer,video.byteOffset,video.byteLength),Buffer.from(poster.buffer,poster.byteOffset,poster.byteLength))
      storeStoryPublicationAudio(db,value.id,audio.bytes)
      return { ...value, state: 'prepared', time: null, uploads: null }
    } finally { audio?.bytes?.fill(0);source.pair.video.fill(0); source.pair.poster.fill(0) }
  })()
}
