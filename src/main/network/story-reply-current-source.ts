import { storyReplyCurrentSource, type StoryReplyCurrentSource } from '../../shared/story-reply-source-review'
import type { StoryReplyDraftRequest } from '../../shared/story-reply-draft'
import type { FirestoreDocument } from './firestore-values'
import { feedCopyPath, feedStoryFromDocument } from './story-feed-document'
// B408 S2: a reply's story is checked by this account's copy of it (users/{me}/storyFeed) — the copy is there while
// the server lets this account see the story; the owner's own story document is not read.
export function replyCurrentSource(pending: StoryReplyDraftRequest, doc: FirestoreDocument): StoryReplyCurrentSource {
  if (doc.name !== feedCopyPath(pending.viewerId, pending.ownerId, pending.storyId)) throw new Error('Story reply source inaccessible')
  const copy = feedStoryFromDocument(doc, pending.viewerId)
  if (copy.ownerType !== 'user' || copy.ownerId !== pending.ownerId || copy.storyId !== pending.storyId || copy.privacy !== pending.privacy) throw new Error('Story reply source inaccessible')
  return storyReplyCurrentSource({ version: copy.version, expiresAt: copy.expiresAt, captionPreview: Array.from(copy.caption).slice(0, 160).join('') })
}
