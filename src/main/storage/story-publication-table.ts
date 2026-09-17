import { preparedStoryAudioSource } from './story-prepared-audio'
import { storyPublicationAudioSource,prepareStoryPublicationAudio,storeStoryPublicationAudio,requireStoryPublicationAudio } from './story-publication-audios'
import { pendingStoryVideoPublication } from './story-video-publication-table'
import { readStoryPublicationTime, mutateStoryPublicationCommit, type StoryPublicationCommitCommand } from './story-publication-commit-table'
import { readStoryPhotoTransfers, mutateStoryPhotoTransfer, type StoryPhotoUploadCommand } from './story-photo-upload-table'
import { storyPhotoPart, type StoryPhotoUploadSource } from '../media/story-photo-upload-record'
import type Database from 'better-sqlite3-multiple-ciphers'
import { createHash } from 'node:crypto'
import { backgroundPhotoId } from '../../shared/chat-background'
import { storyPublicationIntent, storyPublicationPrepare, type PendingStoryPublication, type StoryPublicationPrepare } from '../../shared/story-publication'
import { storyComposerPhotoPair } from '../../shared/story-composer-photo'
import { backgroundImageInfo } from '../../shared/background-photo-bytes'
import { storedStoryComposerDraft } from './story-composer-drafts'
export type StoryPublicationCommand = {kind:'story-publication-audio-source';request:import('../../shared/story-prepared-audio').StoryPreparedAudioRequest} | StoryPublicationCommitCommand | StoryPhotoUploadCommand | { kind: 'story-publication-read' } | { kind: 'story-publication-prepare'; request: StoryPublicationPrepare } | { kind: 'story-publication-dismiss'; id: string } | { kind: 'story-publication-source'; id: string }
const fail = (code: 'conflict' | 'capacity' = 'conflict'): never => { throw Object.assign(new Error('Story publication ' + code), { deliveryCode: code }) }
const sha = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex')
const md5 = (bytes: Uint8Array): string => createHash('md5').update(bytes).digest('base64')
export function pendingStoryPublication(db: Database.Database): PendingStoryPublication | null {
  const rows = db.prepare('SELECT id,payload,state FROM story_publications WHERE payload IS NOT NULL LIMIT 2').all() as { id: string; payload: string; state: string }[]
  if (rows.length > 1) return fail()
  const row = rows[0]
  if (!row) return null
  if (!['prepared', 'uploading', 'uploaded', 'submitted', 'confirmed', 'rejected'].includes(row.state) || row.payload.length > 250000) return fail()
  const intent = storyPublicationIntent(JSON.parse(row.payload))
  if (intent.id !== row.id) return fail()
  requireStoryPublicationAudio(db,intent)
  const transfers = readStoryPhotoTransfers(db, intent)
  if ((row.state === 'prepared') !== (transfers === null) || (['uploaded', 'submitted', 'confirmed', 'rejected'].includes(row.state) && (!transfers || Object.values(transfers).some(part=>part.state!=='acknowledged'))) || (row.state === 'uploading' && transfers && Object.values(transfers).every(part=>part.state==='acknowledged'))) return fail()
  const time = readStoryPublicationTime(db, intent.id)
  if (['submitted', 'confirmed', 'rejected'].includes(row.state) !== Boolean(time)) return fail()
  return { ...intent, time, state: row.state as PendingStoryPublication['state'], uploads: transfers ? { full: transfers.full.state, thumbnail: transfers.thumbnail.state,...(transfers.audio?{audio:transfers.audio.state}:{}) } : null }
}
function source(db: Database.Database, pending: PendingStoryPublication): { full: Uint8Array; thumbnail: Uint8Array } {
  const row = db.prepare('SELECT CASE WHEN length(full)<=2097152 THEN full END AS full,CASE WHEN length(thumbnail)<=2097152 THEN thumbnail END AS thumbnail FROM story_publications WHERE id=?').get(pending.id) as { full: Uint8Array; thumbnail: Uint8Array } | undefined
  if (!row) return fail()
  const pair = storyComposerPhotoPair(row.full, row.thumbnail)
  if (pair.full.byteLength !== pending.fullBytes || pair.thumbnail.byteLength !== pending.thumbnailBytes || sha(pair.full) !== pending.fullSHA256 || sha(pair.thumbnail) !== pending.thumbnailSHA256 || md5(pair.full) !== pending.fullMD5 || md5(pair.thumbnail) !== pending.thumbnailMD5) return fail()
  return pair
}
export function executeStoryPublication(db: Database.Database, command: StoryPublicationCommand, uid: string): import('../../shared/story-composer-audio-storage').StoryComposerAudioStoredSource | PendingStoryPublication | StoryPhotoUploadSource | { bytes: Uint8Array } | null {
  const pending = pendingStoryPublication(db)
  if (pending && pending.ownerId !== uid) return fail()
  if(command.kind==='story-publication-audio-source')return preparedStoryAudioSource(db,pending,command.request,'photo',uid)
  if (command.kind === 'story-publication-read') return pending
  if (command.kind === 'story-publication-source') {
    if (!pending || pending.id !== backgroundPhotoId(command.id)) return fail()
    return { bytes: new Uint8Array(source(db, pending).full) }
  }
  if (command.kind === 'story-publication-upload-source') {
    if (!pending || pending.state !== 'uploading' || pending.id !== backgroundPhotoId(command.id)) return fail()
    const part = storyPhotoPart(command.part), transfers = readStoryPhotoTransfers(db, pending)
    if (!transfers || !transfers[part] || (part === 'thumbnail' && transfers.full.state !== 'acknowledged') || (part==='audio' && (transfers.full.state!=='acknowledged' || transfers.thumbnail.state!=='acknowledged'))) return fail()
    const { state: _state, uploads: _uploads, time: _time, ...intent } = pending
    return { intent, part, transfer: transfers[part]!, bytes: part==='audio'?storyPublicationAudioSource(db,pending):new Uint8Array(source(db, pending)[part]) }
  }
  return db.transaction(() => {
    const current = pendingStoryPublication(db)
    if (current && current.ownerId !== uid) return fail()
    if (command.kind === 'story-publication-dismiss') {
      if (!current || current.id !== backgroundPhotoId(command.id)) return fail()
      db.prepare('DELETE FROM story_publication_audios WHERE publication_id=?').run(current.id)
      db.prepare('DELETE FROM story_publication_commits WHERE publication_id=?').run(current.id)
      db.prepare('DELETE FROM story_photo_uploads WHERE publication_id=?').run(current.id)
      db.prepare("UPDATE story_publications SET payload=NULL,full=NULL,thumbnail=NULL,state='dismissed' WHERE id=?").run(current.id)
      return null
    }
    if (command.kind === 'story-publication-submit' || command.kind === 'story-publication-outcome') {
      if (!current || current.id !== backgroundPhotoId(command.id)) return fail()
      source(db, current)
      if(current.audio){const audio=storyPublicationAudioSource(db,current);audio.fill(0)}
      mutateStoryPublicationCommit(db, current, command); return pendingStoryPublication(db)
    }
    if (command.kind !== 'story-publication-prepare') {
      if (!current || current.id !== backgroundPhotoId(command.id)) return fail()
      mutateStoryPhotoTransfer(db, current, command); return pendingStoryPublication(db)
    }
    const request = storyPublicationPrepare(command.request)
    if (current) { if (current.id === request.id && current.draftId === request.draftId && current.draftRevision === request.draftRevision && current.photoRevision === request.photoRevision && current.audioRevision === request.audioRevision) return current; return fail() }
    if (pendingStoryVideoPublication(db) || db.prepare('SELECT 1 FROM story_video_publications WHERE id=?').get(request.id)) return fail()
    if (db.prepare('SELECT 1 FROM story_publications WHERE id=?').get(request.id)) return fail()
    if ((db.prepare('SELECT COUNT(*) AS n FROM story_publications').get() as { n: number }).n >= 10000) return fail('capacity')
    if (db.prepare('SELECT 1 FROM story_composer_videos WHERE draft_id=? AND source_id IS NOT NULL').get(request.draftId)) return fail()
    const local = storedStoryComposerDraft(db, { id: request.draftId })
    if (!local.draft || local.revision !== request.draftRevision) return fail()
    const photo = db.prepare('SELECT revision,photo_id AS photoId,CASE WHEN length(full)<=2097152 THEN full END AS full,CASE WHEN length(thumbnail)<=2097152 THEN thumbnail END AS thumbnail FROM story_composer_photos WHERE draft_id=?').get(request.draftId) as { revision: string; photoId: string | null; full: Uint8Array; thumbnail: Uint8Array } | undefined
    if (!photo?.photoId || photo.revision !== request.photoRevision) return fail()
    const pair = storyComposerPhotoPair(photo.full, photo.thumbnail), full = backgroundImageInfo(pair.full, true), thumb = backgroundImageInfo(pair.thumbnail, true)
    const audio=prepareStoryPublicationAudio(db,request.draftId,request.audioRevision)
    try{
    const intent = storyPublicationIntent({ ...request, ...audio.fields,...local.draft, ownerId: uid, photoId: photo.photoId, width: full.width, height: full.height, thumbnailWidth: thumb.width, thumbnailHeight: thumb.height, fullBytes: pair.full.byteLength, thumbnailBytes: pair.thumbnail.byteLength, fullSHA256: sha(pair.full), thumbnailSHA256: sha(pair.thumbnail), fullMD5: md5(pair.full), thumbnailMD5: md5(pair.thumbnail) })
    const payload = JSON.stringify(intent)
    if (payload.length > 250000) return fail('capacity')
    db.prepare("INSERT INTO story_publications(id,payload,full,thumbnail,state) VALUES(?,?,?,?,'prepared')").run(intent.id, payload, Buffer.from(pair.full), Buffer.from(pair.thumbnail))
    storeStoryPublicationAudio(db,intent.id,audio.bytes)
    return pendingStoryPublication(db)
    }finally{audio.bytes?.fill(0)}
  })()
}
