// Telegram orders the reaction strip by what has been used lately — its list comes from the server
// (Data::Reactions, availableReactions/recent) and moves as a person reacts. Morse's server carries no
// reaction list at all: any string of 32 characters or less is accepted, so the choices themselves stay
// the client's. iOS keeps them in order of use in an account-scoped list of its own
// (MorseRecentReactionEmojis: 5 slots, 32 stored, recorded only when a reaction is ADDED), and this is
// the same list for this window, kept the way the sidebar's width is kept — per device, per account.
export const reactionFallback = ['👍', '❤️', '😂', '😮', '😢', '👏', '🔥', '🙏']
// The strip here is a hover strip with more room than a phone's, so it keeps all of its own choices.
export const reactionSlots = reactionFallback.length
export const maxStoredReactions = 32
const storageKey = (accountUid: string): string => `morse.recentReactions.${accountUid}`

// compactStrip: what was used lately first, then the rest of the choices, each appearing once.
export function reactionStrip(recent: readonly string[], fallback: readonly string[] = reactionFallback, count = reactionSlots): string[] {
  const out: string[] = []
  for (const emoji of [...recent, ...fallback]) {
    if (!emoji || emoji.length > 32 || out.includes(emoji)) continue
    out.push(emoji)
    if (out.length === count) break
  }
  return out
}
export function readRecentReactions(accountUid: string): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(storageKey(accountUid)) ?? '[]') as unknown
    return Array.isArray(raw) ? raw.filter((value): value is string => typeof value === 'string' && Boolean(value) && value.length <= 32).slice(0, maxStoredReactions) : []
  } catch { return [] }
}
// Taking a reaction back says nothing about what this person reaches for, as iOS's recordIfAdding says.
export function recordReaction(accountUid: string, emoji: string, alreadySelected: boolean): void {
  if (alreadySelected || !emoji || emoji.length > 32) return
  const next = [emoji, ...readRecentReactions(accountUid).filter(value => value !== emoji)].slice(0, maxStoredReactions)
  try { localStorage.setItem(storageKey(accountUid), JSON.stringify(next)) } catch { /* per-viewer convenience only */ }
}
