import type Database from 'better-sqlite3-multiple-ciphers'
import type { PendingStoryVideoPublication, StoryVideoPublicationIntent, StoryVideoPart } from '../../shared/story-video-publication'
import { storyVideoPart, storyVideoReceipt, storyVideoSession, type StoryVideoReceipt, type StoryVideoTransfer } from '../media/story-video-upload-record'
export type StoryVideoUploadCommand = { kind: 'story-video-publication-upload-begin'; id: string } | { kind: 'story-video-publication-upload-source'; id: string; part: StoryVideoPart } | { kind: 'story-video-publication-upload-session'; id: string; part: StoryVideoPart; session: string } | { kind: 'story-video-publication-upload-ack'; id: string; part: StoryVideoPart; session: string; receipt: StoryVideoReceipt } | { kind: 'story-video-publication-upload-block'; id: string; part: StoryVideoPart; reason: 'unknown' | 'expired' }
const fail = (): never => { throw Object.assign(new Error('Story upload record changed'), { deliveryCode: 'conflict' }) }
export function readStoryVideoTransfers(db: Database.Database, intent: StoryVideoPublicationIntent): (Record<Exclude<StoryVideoPart,'audio'>, StoryVideoTransfer> & {audio?:StoryVideoTransfer}) | null {
  const rows = db.prepare('SELECT part,state,session,receipt FROM story_video_uploads WHERE publication_id=? LIMIT 4').all(intent.id) as { part: string; state: string; session: string | null; receipt: string | null }[]
  if (!rows.length) return null
  if (rows.length !== (intent.audio?3:2)) return fail()
  const result: Partial<Record<StoryVideoPart, StoryVideoTransfer>> = {}
  for (const row of rows) {
    const part = storyVideoPart(row.part)
    if ((part==='audio' && !intent.audio) || result[part] || !['pending', 'acknowledged', 'unknown', 'expired'].includes(row.state)) return fail()
    const session = row.session === null ? null : storyVideoSession(row.session, intent.ownerId, intent.id, part)
    if (row.receipt !== null && row.receipt.length > 512) return fail()
    const receipt = row.receipt === null ? null : storyVideoReceipt(JSON.parse(row.receipt))
    if ((row.state === 'acknowledged') !== Boolean(receipt) || (row.state !== 'pending' && !session)) return fail()
    result[part] = { state: row.state as StoryVideoTransfer['state'], session, receipt }
  }
  if (!result.video || !result.poster) return fail()
  if(Boolean(result.audio)!==Boolean(intent.audio))return fail()
  return { video: result.video, poster: result.poster,...(result.audio?{audio:result.audio}:{}) }
}
export function mutateStoryVideoTransfer(db: Database.Database, current: PendingStoryVideoPublication, command: Exclude<StoryVideoUploadCommand, { kind: 'story-video-publication-upload-source' }>): void {
  if (current.id !== command.id) return fail()
  if (command.kind === 'story-video-publication-upload-begin') {
    if (current.state !== 'prepared' || readStoryVideoTransfers(db, current)) return fail()
    for (const part of (current.audio?['video','poster','audio']:['video','poster'])) db.prepare("INSERT INTO story_video_uploads(publication_id,part,state) VALUES(?,?,'pending')").run(current.id, part)
    db.prepare("UPDATE story_video_publications SET state='uploading' WHERE id=?").run(current.id); return
  }
  if (current.state !== 'uploading') return fail()
  const part = storyVideoPart(command.part), transfers = readStoryVideoTransfers(db, current), transfer = transfers?.[part]
  if (!transfer || transfer.state !== 'pending') return fail()
  if (part === 'poster' && transfers?.video.state !== 'acknowledged') return fail()
  if(part==='audio' && (transfers?.video.state!=='acknowledged' || transfers?.poster.state!=='acknowledged'))return fail()
  if (command.kind === 'story-video-publication-upload-session') {
    const session = storyVideoSession(command.session, current.ownerId, current.id, part)
    if (transfer.session && transfer.session !== session) return fail()
    db.prepare('UPDATE story_video_uploads SET session=? WHERE publication_id=? AND part=?').run(session, current.id, part)
  } else if (command.kind === 'story-video-publication-upload-ack') {
    const session = storyVideoSession(command.session, current.ownerId, current.id, part), receipt = storyVideoReceipt(command.receipt)
    if (!transfer.session || transfer.session !== session) return fail()
    db.prepare("UPDATE story_video_uploads SET state='acknowledged',receipt=? WHERE publication_id=? AND part=?").run(JSON.stringify(receipt), current.id, part)
    const updated = readStoryVideoTransfers(db, current)!
    if (Object.values(updated).every(value=>value.state==='acknowledged')) db.prepare("UPDATE story_video_publications SET state='uploaded' WHERE id=?").run(current.id)
  } else {
    if (!transfer.session || !['unknown', 'expired'].includes(command.reason)) return fail()
    db.prepare('UPDATE story_video_uploads SET state=? WHERE publication_id=? AND part=?').run(command.reason, current.id, part)
  }
}
