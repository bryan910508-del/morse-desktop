import { requireStoryPublicationAudioDraft } from './story-publication-audios'
import { randomUUID } from 'node:crypto'
import type Database from 'better-sqlite3-multiple-ciphers'
import type { PendingStoryPublication } from '../../shared/story-publication'
import { storyPublicationTime, type StoryPublicationTime } from '../../shared/story-publication-commit'
import { storedStoryComposerDraft } from './story-composer-drafts'
export type StoryPublicationCommitCommand = { kind: 'story-publication-submit'; id: string } | { kind: 'story-publication-outcome'; id: string; outcome: 'confirmed' | 'rejected' }
const fail = (): never => { throw Object.assign(new Error('Story publication or source draft changed'), { deliveryCode: 'conflict' }) }
export function readStoryPublicationTime(db: Database.Database, id: string): StoryPublicationTime | null {
  const row = db.prepare('SELECT created_at AS createdAt,expires_at AS expiresAt FROM story_publication_commits WHERE publication_id=?').get(id)
  return row ? storyPublicationTime(row) : null
}
function requireDraft(db: Database.Database, current: PendingStoryPublication): void {
  requireStoryPublicationAudioDraft(db,current)
  const draft = storedStoryComposerDraft(db, { id: current.draftId })
  const photo = db.prepare('SELECT revision,photo_id AS photoId FROM story_composer_photos WHERE draft_id=?').get(current.draftId) as { revision: string; photoId: string | null } | undefined
  if (!draft.draft || draft.revision !== current.draftRevision || draft.draft.caption !== current.caption || draft.draft.privacy !== current.privacy || JSON.stringify(draft.draft.hiddenFrom) !== JSON.stringify(current.hiddenFrom) || photo?.revision !== current.photoRevision || photo.photoId !== current.photoId) return fail()
}
export function mutateStoryPublicationCommit(db: Database.Database, current: PendingStoryPublication, command: StoryPublicationCommitCommand): void {
  if(current.audio && current.uploads?.audio!=='acknowledged')return fail()
  if (current.id !== command.id || current.uploads?.full !== 'acknowledged' || current.uploads.thumbnail !== 'acknowledged') return fail()
  if (command.kind === 'story-publication-submit') {
    if (current.state !== 'uploaded' || current.time || readStoryPublicationTime(db, current.id)) return fail()
    requireDraft(db, current)
    const createdAt = Date.now(), time = storyPublicationTime({ createdAt, expiresAt: createdAt + 86400000 })
    db.prepare('INSERT INTO story_publication_commits(publication_id,created_at,expires_at) VALUES(?,?,?)').run(current.id, time.createdAt, time.expiresAt)
    db.prepare("UPDATE story_publications SET state='submitted' WHERE id=?").run(current.id)
  } else {
    if (current.state !== 'submitted' || !current.time || !['confirmed', 'rejected'].includes(command.outcome)) return fail()
    if (command.outcome === 'confirmed') {
      requireDraft(db, current)
      // Consume only the exact original draft and pair together with the acknowledged result.
      if(current.audio)db.prepare('UPDATE story_composer_audios SET revision=?,source_id=NULL,audio=NULL WHERE draft_id=?').run(randomUUID(),current.draftId)
      db.prepare('UPDATE story_composer_drafts SET payload=NULL,revision=? WHERE id=?').run(randomUUID(), current.draftId)
      db.prepare('UPDATE story_composer_photos SET revision=?,photo_id=NULL,full=NULL,thumbnail=NULL WHERE draft_id=?').run(randomUUID(), current.draftId)
    }
    db.prepare('UPDATE story_publications SET state=? WHERE id=?').run(command.outcome, current.id)
  }
}
