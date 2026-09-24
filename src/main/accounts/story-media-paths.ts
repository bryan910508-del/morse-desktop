import type { FirestoreDocument } from '../network/firestore-values'
import { ownStoryPhotoPath } from '../media/own-story-photo-document'
import { ownStoryVideoPath } from '../media/own-story-video-document'
import { ownStoryAudioPath } from '../media/own-story-audio-document'

// Telegram reads a peer's stories once (stories.getPeerStories) and downloads what that answer names;
// it does not read the story again when the viewer reaches it. The list here holds the same answer, so
// where each story's media lives is taken from it. A story whose address cannot be read now simply has
// none here, and the viewer falls back to reading that story document itself.
export interface StoryMediaPaths { image: string | null; poster: string | null; video: string | null; audio: string | null }

export function storyMediaPaths(doc: FirestoreDocument, ownerId: string): StoryMediaPaths {
  const read = (take: () => string): string | null => { try { return take() } catch { return null } }
  return {
    image: read(() => ownStoryPhotoPath(doc, ownerId, 'image')),
    poster: read(() => ownStoryPhotoPath(doc, ownerId, 'video-poster')),
    video: read(() => ownStoryVideoPath(doc, ownerId)),
    audio: read(() => ownStoryAudioPath(doc, ownerId)),
  }
}
