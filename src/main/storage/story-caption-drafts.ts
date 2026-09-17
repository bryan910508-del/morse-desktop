import { storyCaptionRebaseRequest, rebasedStoryCaptionDraft, type StoryCaptionRebaseRequest } from '../../shared/story-caption-rebase'
import { pendingStoryCaptionSave } from './story-caption-save-table'
import type Database from 'better-sqlite3-multiple-ciphers'
import { storyCaptionDraft, storyCaptionDraftTarget, storyCaptionDraftWrite, type StoryCaptionDraft, type StoryCaptionDraftTarget, type StoryCaptionDraftRecord, type StoryCaptionDraftRow, type StoryCaptionDraftWrite } from '../../shared/story-caption-drafts'
import { backgroundPhotoId } from '../../shared/chat-background'
export type StoryCaptionDraftCommand = { kind: 'story-caption-draft-rebase'; request: StoryCaptionRebaseRequest } | { kind: 'story-caption-draft-list' } | { kind: 'story-caption-draft-read'; target: StoryCaptionDraftTarget } | { kind: 'story-caption-draft-seed'; target: StoryCaptionDraftTarget; draft: StoryCaptionDraft; revision: string } | { kind: 'story-caption-draft-write'; request: StoryCaptionDraftWrite }
const conflict = (): never => { throw Object.assign(new Error('Story caption draft changed'), { deliveryCode: 'conflict' }) }
const capacity = (): never => { throw Object.assign(new Error('Story caption draft capacity'), { deliveryCode: 'capacity' }) }
function read(db: Database.Database, target: StoryCaptionDraftTarget): StoryCaptionDraftRecord {
  const row = db.prepare('SELECT payload,revision FROM story_caption_drafts WHERE privacy=? AND story_id=?').get(target.privacy, target.storyId) as { payload: string | null; revision: string } | undefined
  if (row?.payload && row.payload.length > 100000) return conflict()
  return { ...target, revision: row ? backgroundPhotoId(row.revision) : null, draft: row && row.payload !== null ? storyCaptionDraft(JSON.parse(row.payload)) : null }
}
export function executeStoryCaptionDraft(db: Database.Database, command: StoryCaptionDraftCommand): StoryCaptionDraftRecord | StoryCaptionDraftRow[] {
  if (command.kind === 'story-caption-draft-read') return read(db, storyCaptionDraftTarget(command.target))
  if (command.kind === 'story-caption-draft-list') {
    const rows = db.prepare('SELECT story_id,privacy FROM story_caption_drafts WHERE payload IS NOT NULL ORDER BY privacy,story_id LIMIT 101').all() as { story_id: string; privacy: string }[]
    if (rows.length > 100) return capacity()
    return rows.map(row => { const value = read(db, storyCaptionDraftTarget({ storyId: row.story_id, privacy: row.privacy })); if (!value.draft || !value.revision) return conflict(); return { storyId: value.storyId, privacy: value.privacy, preview: value.draft.caption.slice(0, 160).replace(/\s+/g, ' '), revision: value.revision } })
  }
  return db.transaction(() => {
    if (command.kind === 'story-caption-draft-seed') {
      const target = storyCaptionDraftTarget(command.target), draft = storyCaptionDraft(command.draft), revision = backgroundPhotoId(command.revision), current = read(db, target)
      if (current.draft) return current
      const pending = pendingStoryCaptionSave(db)
      if (pending?.privacy === target.privacy && pending.storyId === target.storyId) return conflict()
      if (draft.caption !== draft.baseCaption || db.prepare('SELECT 1 FROM story_caption_drafts WHERE revision=?').get(revision)) return conflict()
      if (!current.revision && (db.prepare('SELECT COUNT(*) AS n FROM story_caption_drafts').get() as { n: number }).n >= 10000) return capacity()
      if ((db.prepare('SELECT COUNT(*) AS n FROM story_caption_drafts WHERE payload IS NOT NULL').get() as { n: number }).n >= 100) return capacity()
      db.prepare('INSERT INTO story_caption_drafts(privacy,story_id,payload,revision) VALUES(?,?,?,?) ON CONFLICT(privacy,story_id) DO UPDATE SET payload=excluded.payload,revision=excluded.revision').run(target.privacy, target.storyId, JSON.stringify(draft), revision)
      return read(db, target)
    }
    if (command.kind === 'story-caption-draft-rebase') {
      const request = storyCaptionRebaseRequest(command.request), target = { storyId: request.storyId, privacy: request.privacy }, current = read(db, target), next = rebasedStoryCaptionDraft(request)
      const pending = pendingStoryCaptionSave(db)
      if (pending?.privacy === target.privacy && pending.storyId === target.storyId) return conflict()
      if (current.revision === request.revision) { if (JSON.stringify(current.draft) === JSON.stringify(next)) return current; return conflict() }
      if (current.revision !== request.draftRevision || !current.draft || JSON.stringify(current.draft) !== JSON.stringify(request.draft) || db.prepare('SELECT 1 FROM story_caption_drafts WHERE revision=?').get(request.revision)) return conflict()
      db.prepare('UPDATE story_caption_drafts SET payload=?,revision=? WHERE privacy=? AND story_id=?').run(JSON.stringify(next), request.revision, target.privacy, target.storyId)
      return read(db, target)
    }
    const request = storyCaptionDraftWrite(command.request), target = { storyId: request.storyId, privacy: request.privacy }, current = read(db, target)
    const pending = pendingStoryCaptionSave(db)
    if (pending?.privacy === target.privacy && pending.storyId === target.storyId) return conflict()
    if (current.revision === request.revision) { if (JSON.stringify(current.draft) === JSON.stringify(request.draft)) return current; return conflict() }
    if (current.revision !== request.expected || db.prepare('SELECT 1 FROM story_caption_drafts WHERE revision=?').get(request.revision)) return conflict()
    if (request.draft && (!current.draft || request.draft.baseVersion !== current.draft.baseVersion || request.draft.baseCaption !== current.draft.baseCaption)) return conflict()
    db.prepare('UPDATE story_caption_drafts SET payload=?,revision=? WHERE privacy=? AND story_id=?').run(request.draft ? JSON.stringify(request.draft) : null, request.revision, target.privacy, target.storyId)
    return read(db, target)
  })()
}
