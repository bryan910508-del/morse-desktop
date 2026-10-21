import { identifier } from '../../shared/validation'
import { boolField, documents, stringField, type FirestoreDocument, type WireObject } from './firestore-values'

// B482 (reports/server/2026-10-20-b482-contract-draft.md §2, firestore.rules v4.8.42): this account's own list of whose
// stories it keeps apart — `users/{me}/storyPeers/{ownerType}_{ownerId}` with ownerType, ownerId, hidden?, storiesMuted?
// and updatedAt (the server's time). `hidden` is Telegram's stories_hidden (stories.togglePeerStoriesHidden; tdesktop
// Stories::toggleHidden, data/data_stories.cpp:1310-1330): the person's stories leave the chat list's row for the
// archive's. `storiesMuted` is the phones' per-person story notification; Desktop shows no story notifications (as
// tdesktop) and only keeps it as it is.
export type StoryPeerOwner = 'user' | 'channel'
export interface StoryPeer { ownerType: StoryPeerOwner; ownerId: string; hidden: boolean; storiesMuted: boolean | null }
// More than this many are not made from here (the contract's cap; rules cannot count).
export const maxStoryPeers = 1000

export const storyPeerId = (ownerType: StoryPeerOwner, ownerId: string): string => `${ownerType}_${identifier(ownerId)}`
const peerPath = (uid: string, ownerType: StoryPeerOwner, ownerId: string): string =>
  `${documents}/users/${identifier(uid)}/storyPeers/${storyPeerId(ownerType, ownerId)}`

export function storyPeerFromDocument(doc: FirestoreDocument, uid: string): StoryPeer {
  const id = doc.name.slice(doc.name.lastIndexOf('/') + 1), f = doc.fields
  const ownerType = stringField(f, 'ownerType', 16), ownerId = stringField(f, 'ownerId', 160)
  if ((ownerType !== 'user' && ownerType !== 'channel') || !ownerId || ownerId === uid || doc.name !== peerPath(uid, ownerType, ownerId) || id !== storyPeerId(ownerType, ownerId)) {
    throw new Error('Unexpected story peer')
  }
  const muted = f.storiesMuted?.booleanValue
  return { ownerType, ownerId, hidden: boolField(f, 'hidden'), storiesMuted: typeof muted === 'boolean' ? muted : null }
}

// Hidden: the document is made or kept, with any storiesMuted the phones set left as it is.
export function storyPeerHideWrite(uid: string, ownerType: StoryPeerOwner, ownerId: string): WireObject {
  return { update: { name: peerPath(uid, ownerType, ownerId), fields: {
    ownerType: { stringValue: ownerType }, ownerId: { stringValue: identifier(ownerId) }, hidden: { booleanValue: true }
  } }, updateMask: { fieldPaths: ['ownerType', 'ownerId', 'hidden'] }, updateTransforms: [{ fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' }] }
}
// Shown again: `hidden` goes. A document with nothing else left goes with it, as the contract asks; one that still
// says something about story notifications keeps that.
export function storyPeerUnhideWrite(uid: string, ownerType: StoryPeerOwner, ownerId: string, current: StoryPeer | undefined): WireObject {
  const name = peerPath(uid, ownerType, ownerId)
  if (current?.storiesMuted === null || current === undefined) return { delete: name }
  return { update: { name, fields: {} }, updateMask: { fieldPaths: ['hidden'] }, updateTransforms: [{ fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' }],
    currentDocument: { exists: true } }
}
