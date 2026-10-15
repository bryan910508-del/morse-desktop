import type { FirestoreDocument } from '../network/firestore-values'
import { ownStoryPhotoPath } from '../media/own-story-photo-document'
import { ownStoryVideoPath } from '../media/own-story-video-document'
import { ownStoryAudioPath } from '../media/own-story-audio-document'

// Telegram reads a peer's stories once (stories.getPeerStories) and downloads what that answer names;
// it does not read the story again when the viewer reaches it. The list here holds the same answer, so
// where each story's media lives is taken from it. A story whose address cannot be read has none, and is not
// fetched: someone else's story document is never read for it (B408 S2).
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

// B416 B: the picture a feed copy's story shows first — the photo of a photo story, the poster of a video story — by
// the same rules, from the fields the copy carries (peer-stories.ts detail reads it the same way).
export function feedStoryPicturePath(story: { storyPath: string; ownerId: string; mediaType: string; mediaURL: string; thumbnailURL: string | null }): string | null {
  const fields: Record<string, { stringValue: string }> = { mediaType: { stringValue: story.mediaType }, mediaURL: { stringValue: story.mediaURL } }
  if (story.thumbnailURL !== null) fields.thumbnailURL = { stringValue: story.thumbnailURL }
  const paths = storyMediaPaths({ name: story.storyPath, fields } as unknown as FirestoreDocument, story.ownerId)
  return story.mediaType === 'image' ? paths.image : story.mediaType === 'video' ? paths.poster : null
}

