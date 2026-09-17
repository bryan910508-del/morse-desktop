import { storyReplySourceRebase, type StoryReplySourceRebase } from '../../shared/story-reply-source-review'
import { draftText } from '../../shared/validation'
import { storyReplyTextWrite, type StoryReplyTextWrite } from '../../shared/story-reply-text'
import type Database from 'better-sqlite3-multiple-ciphers'
import { storyReplyDraftRequest, type StoryReplyDraftRequest, type PendingStoryReplyDraft } from '../../shared/story-reply-draft'
import { backgroundPhotoId } from '../../shared/chat-background'
export type StoryReplyDraftCommand = { kind: 'story-reply-source-rebase'; request: StoryReplySourceRebase } | { kind: 'story-reply-draft-read' } | { kind: 'story-reply-draft-prepare'; request: StoryReplyDraftRequest } | { kind: 'story-reply-text-write'; request: StoryReplyTextWrite } | { kind: 'story-reply-draft-dismiss'; id: string; expected: 'prepared'; revision: string }
const conflict = (): never => { throw Object.assign(new Error('Story reply draft changed'), { deliveryCode: 'conflict' }) }
export function pendingStoryReplyDraft(db: Database.Database, uid: string): PendingStoryReplyDraft | null {
  const rows = db.prepare('SELECT id,payload,state FROM story_reply_drafts WHERE payload IS NOT NULL LIMIT 2').all() as { id: string; payload: string; state: string }[]
  if (rows.length > 1) return conflict()
  const row = rows[0]; if (!row) return null
  if (row.state !== 'prepared' || row.payload.length > 16000) return conflict()
  const request = storyReplyDraftRequest(JSON.parse(row.payload))
  if (request.id !== row.id || request.viewerId !== uid) return conflict()
  const content = db.prepare('SELECT text,revision FROM story_reply_texts WHERE draft_id=?').get(request.id) as { text: string; revision: string } | undefined
  if (!content) return conflict()
  return { ...request, state: 'prepared', text: draftText(content.text), revision: backgroundPhotoId(content.revision) }
}
export function executeStoryReplyDraft(db: Database.Database, command: StoryReplyDraftCommand, uid: string): PendingStoryReplyDraft | null {
  if (command.kind === 'story-reply-draft-read') return pendingStoryReplyDraft(db, uid)
  return db.transaction(() => {
    const current = pendingStoryReplyDraft(db, uid)
    if (command.kind === 'story-reply-draft-prepare') {
      const request = storyReplyDraftRequest(command.request)
      if (request.viewerId !== uid) return conflict()
      if (current) { const { state: _state, text: _text, revision: _revision, ...previous } = current; if (JSON.stringify(previous) === JSON.stringify(request)) return current; return conflict() }
      if (db.prepare('SELECT 1 FROM story_reply_drafts WHERE id=?').get(request.id)) return conflict()
      if ((db.prepare('SELECT COUNT(*) AS n FROM story_reply_drafts').get() as { n: number }).n >= 10000) throw Object.assign(new Error('Story reply draft capacity'), { deliveryCode: 'capacity' })
      const payload = JSON.stringify(request); if (payload.length > 16000) return conflict()
      db.prepare("INSERT INTO story_reply_drafts(id,payload,state) VALUES(?,?,'prepared')").run(request.id, payload)
      db.prepare('INSERT INTO story_reply_texts(draft_id,text,revision) VALUES(?,?,?)').run(request.id, '', request.id)
    } else if (command.kind === 'story-reply-source-rebase') {
      const request = storyReplySourceRebase(command.request)
      if (!current || current.id !== request.id) return conflict()
      const matches = current.version === request.current.version && current.expiresAt === request.current.expiresAt && current.captionPreview === request.current.captionPreview
      if (current.revision === request.revision && matches) return current
      if (current.revision !== request.expected || request.current.expiresAt <= Date.now()) return conflict()
      const { state: _state, text: _text, revision: _revision, ...source } = current
      // Destination, identity and ordinary chat draft are never part of this update.
      const next = storyReplyDraftRequest({ ...source, ...request.current }), payload = JSON.stringify(next)
      if (payload.length > 16000) return conflict()
      db.prepare('UPDATE story_reply_drafts SET payload=? WHERE id=?').run(payload, current.id)
      db.prepare('UPDATE story_reply_texts SET revision=? WHERE draft_id=? AND revision=?').run(request.revision, current.id, request.expected)
    } else if (command.kind === 'story-reply-text-write') {
      const request = storyReplyTextWrite(command.request)
      if (!current || current.id !== request.id) return conflict()
      if (current.revision === request.revision && current.text === request.text) return current
      if (current.revision !== request.expected) return conflict()
      db.prepare('UPDATE story_reply_texts SET text=?,revision=? WHERE draft_id=? AND revision=?').run(request.text, request.revision, request.id, request.expected)
    } else {
      backgroundPhotoId(command.id)
      if (command.kind !== 'story-reply-draft-dismiss' || command.expected !== 'prepared' || !current || current.id !== command.id || current.revision !== backgroundPhotoId(command.revision)) return conflict()
      db.prepare("UPDATE story_reply_drafts SET state='dismissed',payload=NULL WHERE id=?").run(command.id)
      db.prepare('DELETE FROM story_reply_texts WHERE draft_id=?').run(command.id)
    }
    return pendingStoryReplyDraft(db, uid)
  })()
}
