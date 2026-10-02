import type { GroupPhotoImage } from './group-photo'
import { messageKindLabel } from './message-kinds'
import { identifier, object } from './validation'
import { tr } from './i18n'

// Telegram's personal channel (account.updatePersonalChannel, userFull.personal_channel_id): the one channel a person
// shows on their profile. Morse keeps it in users/{uid}.personalChannelId, as iOS writes it (MorsePersonalChannel.swift,
// MorseIOS e373a9dd): a person links one of the channels they own, public or private, and linking leaves the channel
// as it is — it is the channel's plain share link, shown where the bio is shown.

// A channel as a profile and the chooser draw it.
export interface PersonalChannelSummary { id: string; name: string; subscriberCount: number; avatar: GroupPhotoImage | null }
// The newest post the viewer may read: none from a private channel the viewer has not joined, since the rules
// refuse the read (canReadChannelPost).
export interface PersonalChannelPost { text: string; kind: 'image' | 'video' | null; time: number }
export interface PersonalChannelCard {
  requestId: string
  profileUid: string
  channelId: string
  // «hidden»: the link names a channel that is gone or is no longer this person's, and nothing is shown.
  status: 'loading' | 'ready' | 'hidden' | 'error'
  channel: PersonalChannelSummary | null
  post: PersonalChannelPost | null
}
// The channels this account owns, newest activity first: what the chooser offers.
export interface OwnedChannelList { requestId: string; status: 'loading' | 'ready' | 'error'; channels: PersonalChannelSummary[] }
export interface PersonalChannelsSnapshot { cards: PersonalChannelCard[]; owned: OwnedChannelList | null }

export interface PersonalChannelCardRequest { requestId: string; profileUid: string; channelId: string }
export function personalChannelCardRequest(raw: unknown): PersonalChannelCardRequest {
  const value = object(raw)
  if (Object.keys(value).some(key => !['requestId', 'profileUid', 'channelId'].includes(key))) throw new Error(tr('잘못된 요청입니다.'))
  return { requestId: identifier(value.requestId), profileUid: identifier(value.profileUid), channelId: identifier(value.channelId) }
}
// The channel to link, or null to take the link away («채널 숨기기»).
export interface PersonalChannelLink { channelId: string | null }
export function personalChannelLink(raw: unknown): PersonalChannelLink {
  const value = object(raw)
  if (Object.keys(value).some(key => key !== 'channelId')) throw new Error(tr('잘못된 요청입니다.'))
  return { channelId: value.channelId === null ? null : identifier(value.channelId) }
}

// MorsePersonalChannel.previewText: the post's words, else the kind of its first media.
export function personalChannelPreview(post: PersonalChannelPost): string {
  return post.text || (post.kind ? messageKindLabel(post.kind) : '')
}
