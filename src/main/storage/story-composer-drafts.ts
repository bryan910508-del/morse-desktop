import { pendingStoryVideoPublication } from './story-video-publication-table'
import { pendingStoryPublication } from './story-publication-table'
import { randomUUID } from 'node:crypto'
import type Database from 'better-sqlite3-multiple-ciphers'
import { storyComposerDraftContent, storyComposerDraftTarget, storyComposerDraftWrite, type StoryComposerDraftRecord, type StoryComposerDraftRow, type StoryComposerDraftTarget, type StoryComposerDraftWrite } from '../../shared/story-composer-drafts'
import { backgroundPhotoId } from '../../shared/chat-background'
export type StoryComposerDraftCommand = { kind: 'story-composer-draft-list' } | { kind: 'story-composer-draft-read'; target: StoryComposerDraftTarget } | { kind: 'story-composer-draft-write'; request: StoryComposerDraftWrite }
const conflict = (): never => { throw Object.assign(new Error('Story composer draft changed'), { deliveryCode: 'conflict' }) }
const capacity = (): never => { throw Object.assign(new Error('Story composer draft capacity'), { deliveryCode: 'capacity' }) }
export function storedStoryComposerDraft(db: Database.Database, target: StoryComposerDraftTarget): StoryComposerDraftRecord {
  const row = db.prepare('SELECT payload,revision FROM story_composer_drafts WHERE id=?').get(target.id) as { payload: string | null; revision: string } | undefined
  if (!row) return { ...target, draft: null, revision: null }
  if (row.payload !== null && row.payload.length > 250000) return capacity()
  return { ...target, draft: row.payload === null ? null : storyComposerDraftContent(JSON.parse(row.payload)), revision: backgroundPhotoId(row.revision) }
}
export function executeStoryComposerDraft(db: Database.Database, command: StoryComposerDraftCommand, uid: string): StoryComposerDraftRecord | StoryComposerDraftRow[] {
  if (command.kind === 'story-composer-draft-read') return storedStoryComposerDraft(db, storyComposerDraftTarget(command.target))
  if (command.kind === 'story-composer-draft-list') {
    const rows = db.prepare('SELECT id FROM story_composer_drafts WHERE payload IS NOT NULL ORDER BY id LIMIT 101').all() as { id: string }[]
    if (rows.length > 100) return capacity()
    return rows.map(row => {
      const value = storedStoryComposerDraft(db, storyComposerDraftTarget(row))
      if (!value.draft || !value.revision) return conflict()
      return { id: value.id, revision: value.revision, privacy: value.draft.privacy, hiddenCount: value.draft.hiddenFrom.length, preview: value.draft.caption.slice(0, 160).replace(/\s+/g, ' ') }
    })
  }
  return db.transaction(() => {
    const request = storyComposerDraftWrite(command.request), target = { id: request.id }, current = storedStoryComposerDraft(db, target)
    if (pendingStoryPublication(db)?.draftId === target.id || pendingStoryVideoPublication(db)?.draftId === target.id) return conflict()
    if (request.draft?.hiddenFrom.includes(uid)) return conflict()
    const payload = request.draft === null ? null : JSON.stringify(request.draft)
    if (payload !== null && payload.length > 250000) return capacity()
    if (current.revision === request.revision) { if (JSON.stringify(current.draft) === JSON.stringify(request.draft)) return current; return conflict() }
    if (current.revision !== request.expected || db.prepare('SELECT 1 FROM story_composer_drafts WHERE revision=?').get(request.revision)) return conflict()
    if (!current.revision && (db.prepare('SELECT COUNT(*) AS n FROM story_composer_drafts').get() as { n: number }).n >= 10000) return capacity()
    if (request.draft && !current.draft && (db.prepare('SELECT COUNT(*) AS n FROM story_composer_drafts WHERE payload IS NOT NULL').get() as { n: number }).n >= 100) return capacity()
    if (request.draft === null) db.prepare('UPDATE story_composer_audios SET revision=?,source_id=NULL,audio=NULL WHERE draft_id=?').run(randomUUID(),target.id)
    if (request.draft === null) db.prepare('UPDATE story_composer_videos SET revision=?,source_id=NULL,poster_id=NULL,video=NULL,poster=NULL,frame_time=NULL WHERE draft_id=?').run(randomUUID(), target.id)
    if (request.draft === null) db.prepare('UPDATE story_composer_photos SET revision=?,photo_id=NULL,full=NULL,thumbnail=NULL WHERE draft_id=?').run(randomUUID(), target.id)
    // Retain a revision even when cleared. Blank captions remain valid active drafts.
    db.prepare('INSERT INTO story_composer_drafts(id,payload,revision) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload,revision=excluded.revision').run(target.id, payload, request.revision)
    return storedStoryComposerDraft(db, target)
  })()
}
