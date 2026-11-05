// B545 (contracts/B545-reaction-push.md §5): users/{uid}/settings/notify.reactions — whose reactions to this account's
// messages and stories notify it, whether the banner names them, and its sound. Nothing written reads as my contacts for
// both, the sender shown and the chat's own sound (Telegram-iOS PeerReactionNotificationSettings.default,
// SyncCore_TelegramPeerNotificationSettings.swift:468-499). The stories value is only stored here (B545b sends those).
export type ReactionSource = 'nobody' | 'contacts' | 'everyone'
export interface ReactionSettings { messages: ReactionSource; stories: ReactionSource; showSender: boolean; sound: 'default' | 'none' | null }
export const defaultReactionSettings: ReactionSettings = { messages: 'contacts', stories: 'contacts', showSender: true, sound: null }
// What the window may change: one or more of the four, each a value the phones write too (sound only as default or none).
export type ReactionSettingsPatch = Partial<Pick<ReactionSettings, 'messages' | 'stories' | 'showSender'>> & { sound?: 'default' | 'none' }
const sources: readonly ReactionSource[] = ['nobody', 'contacts', 'everyone']
export function reactionSettingsPatch(value: unknown): ReactionSettingsPatch {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid reaction settings')
  const input = value as Record<string, unknown>, patch: ReactionSettingsPatch = {}
  for (const key of Object.keys(input)) {
    const item = input[key]
    if ((key === 'messages' || key === 'stories') && sources.includes(item as ReactionSource)) patch[key] = item as ReactionSource
    else if (key === 'showSender' && typeof item === 'boolean') patch.showSender = item
    else if (key === 'sound' && (item === 'default' || item === 'none')) patch.sound = item
    else throw new Error('Invalid reaction settings')
  }
  if (!Object.keys(patch).length) throw new Error('Invalid reaction settings')
  return patch
}
// The «반응» row's line: the kinds that notify (Telegram-iOS NotificationsAndSoundsController.swift:579-600).
export function reactionKinds(settings: ReactionSettings): ('messages' | 'stories')[] {
  return (['messages', 'stories'] as const).filter(kind => settings[kind] !== 'nobody')
}
