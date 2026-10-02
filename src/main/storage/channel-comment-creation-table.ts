import type Database from 'better-sqlite3-multiple-ciphers'
import { sameCommentReply, commentReplyTarget } from '../../shared/channel-comment-drafts'
import { randomUUID } from 'node:crypto'
import { commentCreationRequest, type CommentCreationRequest, type CommentCreationState, type PendingCommentCreation } from '../../shared/channel-comment-creation'
import { backgroundPhotoId } from '../../shared/chat-background'
export type CommentCreationCommand = { kind: 'comment-creation-read' } | { kind: 'comment-creation-prepare'; request: CommentCreationRequest } | { kind: 'comment-creation-state'; id: string; expected: CommentCreationState; state: CommentCreationState | 'dismissed' } |
  { kind: 'comment-creation-rebase'; id: string; expected: 'prepared' | 'submitted'; request: CommentCreationRequest }
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
// A comment that is not going to be posted after all gives its words back to the post's draft, unless something new
// has been written there since.
function restoreDraft(db: Database.Database, request: CommentCreationRequest): void {
  const draft = db.prepare('SELECT text,parent_id FROM channel_comment_drafts WHERE channel_id=? AND post_id=?').get(request.channelId, request.postId) as { text: string; parent_id: string | null } | undefined
  if (draft && (draft.text || draft.parent_id !== null)) return
  db.prepare('INSERT INTO channel_comment_drafts(channel_id,post_id,text,revision,parent_id,parent_revision) VALUES(?,?,?,?,?,?) ON CONFLICT(channel_id,post_id) DO UPDATE SET text=excluded.text,revision=excluded.revision,parent_id=excluded.parent_id,parent_revision=excluded.parent_revision')
    .run(request.channelId, request.postId, request.text, randomUUID(), request.parent?.id ?? null, request.parent?.revision ?? null)
}
// What a comment says and answers is fixed when it is handed over; the post's count and revision, and the names it
// carries, may be brought up to date before it goes again.
const content = (request: CommentCreationRequest): string => JSON.stringify([request.id, request.channelId, request.postId, request.surface ?? null, request.draftRevision, request.text, request.parent ?? null, request.authorId])
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
      // The comment now holds its words; the post's draft is free for the next one at once.
      db.prepare('UPDATE channel_comment_drafts SET text=?,revision=?,parent_id=NULL,parent_revision=NULL WHERE channel_id=? AND post_id=?').run('', randomUUID(), request.channelId, request.postId)
    } else if (command.kind === 'comment-creation-rebase') {
      // Before it goes again: the same comment under the same id, against the post as it is now.
      const request = commentCreationRequest(command.request)
      if (!current || current.id !== command.id || request.id !== command.id || current.state !== command.expected || current.authorId !== uid || content(request) !== content(current)) return conflict()
      db.prepare("UPDATE channel_comment_creations SET state='prepared',payload=? WHERE id=?").run(JSON.stringify(request), command.id)
    } else {
      backgroundPhotoId(command.id)
      if (!current || current.id !== command.id || current.state !== command.expected || current.authorId !== uid) return conflict()
      // submitted → prepared: the attempt never left, or the server has been seen not to have the comment.
      // prepared → rejected: the post refused it before it was sent.
      if (!(command.state === 'dismissed' || (current.state === 'prepared' && ['submitted', 'rejected'].includes(command.state)) ||
        (current.state === 'submitted' && ['confirmed', 'rejected', 'prepared'].includes(command.state)))) return conflict()
      if (command.state === 'rejected' || (command.state === 'dismissed' && ['prepared', 'submitted'].includes(current.state))) restoreDraft(db, current)
      db.prepare('UPDATE channel_comment_creations SET state=?,payload=CASE WHEN ? THEN NULL ELSE payload END WHERE id=?').run(command.state, command.state === 'dismissed' ? 1 : 0, command.id)
    }
    return pendingCommentCreation(db)
  })()
}
