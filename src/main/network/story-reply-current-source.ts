import { positionMilliseconds } from '../../shared/model'
import { storyReplyCurrentSource, type StoryReplyCurrentSource } from '../../shared/story-reply-source-review'
import type { StoryReplyDraftRequest } from '../../shared/story-reply-draft'
import { documents, type FirestoreDocument } from './firestore-values'
import { ownStoryCollections, ownStoryFromDocument } from './own-story-document'
import { storyHiddenFrom } from './story-hidden-audience'
export function replyCurrentSource(pending: StoryReplyDraftRequest, doc: FirestoreDocument): StoryReplyCurrentSource {
  if (doc.name !== `${documents}/users/${pending.ownerId}/${ownStoryCollections[pending.privacy]}/${pending.storyId}` || storyHiddenFrom(doc).hiddenFrom.includes(pending.viewerId)) throw new Error('Story reply source inaccessible')
  const story = ownStoryFromDocument(doc, pending.ownerId, pending.privacy)
  return storyReplyCurrentSource({ version: story.version, expiresAt: positionMilliseconds(story.expires), captionPreview: Array.from(story.caption).slice(0, 160).join('') })
}
