import type Database from 'better-sqlite3-multiple-ciphers'
import { sameCommentReply, commentReplyTarget } from '../../shared/channel-comment-drafts'
import { randomUUID } from 'node:crypto'
import { commentCreationRequest, type CommentCreationRequest, type CommentCreationState, type PendingCommentCreation } from '../../shared/channel-comment-creation'
import { backgroundPhotoId } from '../../shared/chat-background'
export type CommentCreationCommand = { kind: 'comment-creation-read' } | { kind: 'comment-creation-prepare'; request: CommentCreationRequest } | { kind: 'comment-creation-state'; id: string; expected: CommentCreationState; state: CommentCreationState | 'dismissed' }
const conflict = (): never => { throw Object.assign(new Error('Comment creation record or saved draft changed'), { deliveryCode: 'conflict' }) }
export function pendingCommentCreation(db: Database.Database): PendingCommentCreation | null {
  const rows = db.prepare('SELECT id,payload,state FROM channel_comment_creations WHERE payload IS NOT NULL LIMIT 2').all() as { id: string; payload: string; state: CommentCreationState }[]
  if (rows.length > 1) return conflict()
  const row = rows[0]
  if (!row) return null
  if (!['prepared', 'submitted', 'confirmed', 'rejected'].includes(row.state) || row.payload.length > 30000) return conflict()
  const request = commentCreationRequest(JSON.parse(row.payload))
  if (request.id !== row.id) return conflict()
  return { ...request, state: row.state }
}
function requireDraft(db: Database.Database, request: CommentCreationRequest): void {
  const draft = db.prepare('SELECT text,revision,parent_id,parent_revision FROM channel_comment_drafts WHERE channel_id=? AND post_id=?').get(request.channelId, request.postId) as { text: string; revision: string; parent_id: string | null; parent_revision: string | null } | undefined
  const parent = draft && (draft.parent_id !== null || draft.parent_revision !== null) ? commentReplyTarget({ id: draft.parent_id, revision: draft.parent_revision }) : null
  if (!draft || draft.revision !== request.draftRevision || draft.text !== request.text || !sameCommentReply(parent, request.parent)) return conflict()
}
export function executeCommentCreation(db: Database.Database, command: CommentCreationCommand, uid: string): PendingCommentCreation | null {
  if (command.kind === 'comment-creation-read') return pendingCommentCreation(db)
  return db.transaction(() => {
    const current = pendingCommentCreation(db)
    if (command.kind === 'comment-creation-prepare') {
      const request = commentCreationRequest(command.request)
      if (request.authorId !== uid) return conflict()
      if (current) {
        const { state, ...previous } = current
        if (state === 'prepared' && JSON.stringify(previous) === JSON.stringify(request)) return current
        return conflict()
      }
      if (db.prepare('SELECT 1 FROM channel_comment_creations WHERE id=?').get(request.id)) return conflict()
      if ((db.prepare('SELECT COUNT(*) AS n FROM channel_comment_creations').get() as { n: number }).n >= 10000) throw Object.assign(new Error('Comment creation capacity'), { deliveryCode: 'capacity' })
      requireDraft(db, request)
      db.prepare("INSERT INTO channel_comment_creations(id,payload,state) VALUES(?,?,'prepared')").run(request.id, JSON.stringify(request))
    } else {
      backgroundPhotoId(command.id)
      if (!current || current.id !== command.id || current.state !== command.expected || current.authorId !== uid) return conflict()
      if (!(command.state === 'dismissed' || (current.state === 'prepared' && command.state === 'submitted') || (current.state === 'submitted' && ['confirmed', 'rejected'].includes(command.state)))) return conflict()
      if (command.state === 'submitted' || command.state === 'confirmed') requireDraft(db, current)
      // Only the acknowledged creation consumes the exact frozen draft, in the same local transaction.
      if (command.state === 'confirmed') db.prepare('UPDATE channel_comment_drafts SET text=?,revision=?,parent_id=NULL,parent_revision=NULL WHERE channel_id=? AND post_id=?').run('', randomUUID(), current.channelId, current.postId)
      db.prepare('UPDATE channel_comment_creations SET state=?,payload=CASE WHEN ? THEN NULL ELSE payload END WHERE id=?').run(command.state, command.state === 'dismissed' ? 1 : 0, command.id)
    }
    return pendingCommentCreation(db)
  })()
}
