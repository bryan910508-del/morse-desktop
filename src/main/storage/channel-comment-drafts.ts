import { pendingCommentCreation } from './channel-comment-creation-table'
import type Database from 'better-sqlite3-multiple-ciphers'
import { commentDraftParent, commentReplyTarget, sameCommentReply, type CommentDraftParent, commentDraftTarget, commentDraftText, commentDraftWrite, type CommentDraftRecord, type CommentDraftTarget, type CommentDraftWrite } from '../../shared/channel-comment-drafts'
import { backgroundPhotoId } from '../../shared/chat-background'
export type CommentDraftCommand = { kind: 'comment-draft-list' } | { kind: 'comment-draft-read'; target: CommentDraftTarget } | { kind: 'comment-draft-write'; request: CommentDraftWrite } | { kind: 'comment-draft-parent'; request: CommentDraftParent }
const conflict = (): never => { throw Object.assign(new Error('Comment draft changed'), { deliveryCode: 'conflict' }) }
const capacity = (): never => { throw Object.assign(new Error('Comment draft capacity'), { deliveryCode: 'capacity' }) }
function read(db: Database.Database, target: CommentDraftTarget): CommentDraftRecord {
  const row = db.prepare('SELECT text,revision,parent_id,parent_revision FROM channel_comment_drafts WHERE channel_id=? AND post_id=?').get(target.channelId, target.postId) as { text: string; revision: string; parent_id: string | null; parent_revision: string | null } | undefined
  const parent = row && (row.parent_id !== null || row.parent_revision !== null) ? commentReplyTarget({ id: row.parent_id, revision: row.parent_revision }) : null
  return { ...target, parent, text: row ? commentDraftText(row.text) : '', revision: row ? backgroundPhotoId(row.revision) : null }
}
export function executeCommentDraft(db: Database.Database, command: CommentDraftCommand): CommentDraftRecord | CommentDraftRecord[] {
  if (command.kind === 'comment-draft-read') return read(db, commentDraftTarget(command.target))
  if (command.kind === 'comment-draft-list') {
    const rows = db.prepare("SELECT channel_id,post_id FROM channel_comment_drafts WHERE (text<>'' OR parent_id IS NOT NULL) ORDER BY channel_id,post_id LIMIT 101").all() as { channel_id: string; post_id: string }[]
    if (rows.length > 100) return capacity()
    return rows.map(row => read(db, commentDraftTarget({ channelId: row.channel_id, postId: row.post_id })))
  }
  return db.transaction(() => {
    const request = command.kind === 'comment-draft-parent' ? commentDraftParent(command.request) : commentDraftWrite(command.request), target = { channelId: request.channelId, postId: request.postId }, current = read(db, target)
    const creation = pendingCommentCreation(db)
    if (creation?.channelId === target.channelId && creation.postId === target.postId) return conflict()
    const parent = 'parent' in request ? request.parent : current.parent, text = 'text' in request ? request.text : current.text
    if (current.revision === request.revision) { if (current.text === text && sameCommentReply(current.parent, parent)) return current; return conflict() }
    if (current.revision !== request.expected || db.prepare('SELECT 1 FROM channel_comment_drafts WHERE revision=?').get(request.revision)) return conflict()
    if (!current.revision && (db.prepare('SELECT COUNT(*) AS n FROM channel_comment_drafts').get() as { n: number }).n >= 10000) return capacity()
    if ((text || parent) && !current.text && !current.parent && (db.prepare("SELECT COUNT(*) AS n FROM channel_comment_drafts WHERE (text<>'' OR parent_id IS NOT NULL)").get() as { n: number }).n >= 100) return capacity()
    // Empty drafts retain a version, so an old "absent" writer cannot overwrite after clearing.
    db.prepare('INSERT INTO channel_comment_drafts(channel_id,post_id,text,revision,parent_id,parent_revision) VALUES(?,?,?,?,?,?) ON CONFLICT(channel_id,post_id) DO UPDATE SET text=excluded.text,revision=excluded.revision,parent_id=excluded.parent_id,parent_revision=excluded.parent_revision').run(target.channelId, target.postId, text, request.revision, parent?.id ?? null, parent?.revision ?? null)
    return read(db, target)
  })()
}
