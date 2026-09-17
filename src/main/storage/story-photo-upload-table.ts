import type Database from 'better-sqlite3-multiple-ciphers'
import type { PendingStoryPublication, StoryPublicationIntent, StoryPhotoPart } from '../../shared/story-publication'
import { storyPhotoPart, storyPhotoReceipt, storyPhotoSession, type StoryPhotoReceipt, type StoryPhotoTransfer } from '../media/story-photo-upload-record'
export type StoryPhotoUploadCommand = { kind: 'story-publication-upload-begin'; id: string } | { kind: 'story-publication-upload-source'; id: string; part: StoryPhotoPart } | { kind: 'story-publication-upload-session'; id: string; part: StoryPhotoPart; session: string } | { kind: 'story-publication-upload-ack'; id: string; part: StoryPhotoPart; session: string; receipt: StoryPhotoReceipt } | { kind: 'story-publication-upload-block'; id: string; part: StoryPhotoPart; reason: 'unknown' | 'expired' }
const fail = (): never => { throw Object.assign(new Error('Story upload record changed'), { deliveryCode: 'conflict' }) }
export function readStoryPhotoTransfers(db: Database.Database, intent: StoryPublicationIntent): (Record<Exclude<StoryPhotoPart,'audio'>, StoryPhotoTransfer> & {audio?:StoryPhotoTransfer}) | null {
  const rows = db.prepare('SELECT part,state,session,receipt FROM story_photo_uploads WHERE publication_id=? LIMIT 4').all(intent.id) as { part: string; state: string; session: string | null; receipt: string | null }[]
  if (!rows.length) return null
  if (rows.length !== (intent.audio?3:2)) return fail()
  const result: Partial<Record<StoryPhotoPart, StoryPhotoTransfer>> = {}
  for (const row of rows) {
    const part = storyPhotoPart(row.part)
    if ((part==='audio' && !intent.audio) || result[part] || !['pending', 'acknowledged', 'unknown', 'expired'].includes(row.state)) return fail()
    const session = row.session === null ? null : storyPhotoSession(row.session, intent.ownerId, intent.id, part)
    if (row.receipt !== null && row.receipt.length > 512) return fail()
    const receipt = row.receipt === null ? null : storyPhotoReceipt(JSON.parse(row.receipt))
    if ((row.state === 'acknowledged') !== Boolean(receipt) || (row.state !== 'pending' && !session)) return fail()
    result[part] = { state: row.state as StoryPhotoTransfer['state'], session, receipt }
  }
  if (!result.full || !result.thumbnail) return fail()
  if(Boolean(result.audio)!==Boolean(intent.audio))return fail()
  return { full: result.full, thumbnail: result.thumbnail,...(result.audio?{audio:result.audio}:{}) }
}
export function mutateStoryPhotoTransfer(db: Database.Database, current: PendingStoryPublication, command: Exclude<StoryPhotoUploadCommand, { kind: 'story-publication-upload-source' }>): void {
  if (current.id !== command.id) return fail()
  if (command.kind === 'story-publication-upload-begin') {
    if (current.state !== 'prepared' || readStoryPhotoTransfers(db, current)) return fail()
    for (const part of (current.audio?['full','thumbnail','audio']:['full','thumbnail'])) db.prepare("INSERT INTO story_photo_uploads(publication_id,part,state) VALUES(?,?,'pending')").run(current.id, part)
    db.prepare("UPDATE story_publications SET state='uploading' WHERE id=?").run(current.id); return
  }
  if (current.state !== 'uploading') return fail()
  const part = storyPhotoPart(command.part), transfers = readStoryPhotoTransfers(db, current), transfer = transfers?.[part]
  if (!transfer || transfer.state !== 'pending') return fail()
  if (part === 'thumbnail' && transfers?.full.state !== 'acknowledged') return fail()
  if(part==='audio' && (transfers?.full.state!=='acknowledged' || transfers?.thumbnail.state!=='acknowledged'))return fail()
  if (command.kind === 'story-publication-upload-session') {
    const session = storyPhotoSession(command.session, current.ownerId, current.id, part)
    if (transfer.session && transfer.session !== session) return fail()
    db.prepare('UPDATE story_photo_uploads SET session=? WHERE publication_id=? AND part=?').run(session, current.id, part)
  } else if (command.kind === 'story-publication-upload-ack') {
    const session = storyPhotoSession(command.session, current.ownerId, current.id, part), receipt = storyPhotoReceipt(command.receipt)
    if (!transfer.session || transfer.session !== session) return fail()
    db.prepare("UPDATE story_photo_uploads SET state='acknowledged',receipt=? WHERE publication_id=? AND part=?").run(JSON.stringify(receipt), current.id, part)
    const updated = readStoryPhotoTransfers(db, current)!
    if (Object.values(updated).every(value=>value.state==='acknowledged')) db.prepare("UPDATE story_publications SET state='uploaded' WHERE id=?").run(current.id)
  } else {
    if (!transfer.session || !['unknown', 'expired'].includes(command.reason)) return fail()
    db.prepare('UPDATE story_photo_uploads SET state=? WHERE publication_id=? AND part=?').run(command.reason, current.id, part)
  }
}
