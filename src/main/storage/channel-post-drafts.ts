import { pendingPostCreation } from './channel-post-creation-table'
import type Database from 'better-sqlite3-multiple-ciphers'
import { postDraftTarget, postDraftContent, postDraftWrite, type PostDraftRecord, type PostDraftTarget, type PostDraftWrite } from '../../shared/channel-post-drafts'
import { backgroundPhotoId } from '../../shared/chat-background'
export type PostDraftCommand = { kind: 'post-draft-list' } | { kind: 'post-draft-read'; target: PostDraftTarget } | { kind: 'post-draft-write'; request: PostDraftWrite }
const conflict = (): never => { throw Object.assign(new Error('Post draft changed'), { deliveryCode: 'conflict' }) }
const capacity = (): never => { throw Object.assign(new Error('Post draft capacity'), { deliveryCode: 'capacity' }) }
function read(db: Database.Database, target: PostDraftTarget): PostDraftRecord {
  const row = db.prepare('SELECT text,visibility,revision FROM channel_post_drafts WHERE channel_id=?').get(target.channelId) as { text: string; visibility: string; revision: string } | undefined
  return { ...target, ...(row ? postDraftContent({ text: row.text, visibility: row.visibility }) : { text: '', visibility: 'public' as const }), revision: row ? backgroundPhotoId(row.revision) : null }
}
export function executePostDraft(db: Database.Database, command: PostDraftCommand): PostDraftRecord | PostDraftRecord[] {
  if (command.kind === 'post-draft-read') return read(db, postDraftTarget(command.target))
  if (command.kind === 'post-draft-list') {
    const rows = db.prepare("SELECT channel_id FROM channel_post_drafts WHERE text<>'' OR visibility<>'public' ORDER BY channel_id LIMIT 101").all() as { channel_id: string }[]
    if (rows.length > 100) return capacity()
    return rows.map(row => read(db, postDraftTarget({ channelId: row.channel_id })))
  }
  return db.transaction(() => {
    const request = postDraftWrite(command.request), target = { channelId: request.channelId }, current = read(db, target)
    if (pendingPostCreation(db)?.channelId === target.channelId) return conflict()
    if (current.revision === request.revision) { if (current.text === request.text && current.visibility === request.visibility) return current; return conflict() }
    if (current.revision !== request.expected || db.prepare('SELECT 1 FROM channel_post_drafts WHERE revision=?').get(request.revision)) return conflict()
    if (!current.revision && (db.prepare('SELECT COUNT(*) AS n FROM channel_post_drafts').get() as { n: number }).n >= 10000) return capacity()
    if ((request.text || request.visibility !== 'public') && !current.text && current.visibility === 'public' && (db.prepare("SELECT COUNT(*) AS n FROM channel_post_drafts WHERE text<>'' OR visibility<>'public'").get() as { n: number }).n >= 100) return capacity()
    // Keep a version even after clearing, preventing an old absent writer from overwriting it.
    db.prepare('INSERT INTO channel_post_drafts(channel_id,text,visibility,revision) VALUES(?,?,?,?) ON CONFLICT(channel_id) DO UPDATE SET text=excluded.text,visibility=excluded.visibility,revision=excluded.revision').run(target.channelId, request.text, request.visibility, request.revision)
    return read(db, target)
  })()
}
