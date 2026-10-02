// B57 (Telegram R-66, Core::Settings::incrementRecentEmoji): the emoji panel opens with the ones this person uses,
// most used first, up to 54; until there are that many, Telegram's default recent set fills the rest. Each pick adds
// one to its count and moves it up past those used less; a new one comes in at the end, pushing out the least used.
// Kept on this device only, as Telegram keeps it in the app's own settings, not on the server or per account.
export const recentEmojiLimit = 54
export const defaultRecentEmoji = ['😂', '😘', '❤️', '😍', '😊', '😁', '👍', '☺️', '😔', '😄', '😭', '💋', '😒', '😳', '😜', '🙈', '😉',
  '😃', '😢', '😝', '😱', '😡', '😏', '😞', '😅', '😚', '🙊', '😌', '😀', '😋', '😆', '👌', '😐', '😕']
export interface RecentEmoji { emoji: string; count: number }
const storageKey = 'morse.recentEmoji'
const valid = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 32

// The list as the panel shows it: what was used, then the defaults not yet among them, up to the limit.
export function recentEmojiShown(used: readonly RecentEmoji[], defaults: readonly string[] = defaultRecentEmoji): string[] {
  const out: string[] = []
  for (const emoji of [...used.map(item => item.emoji), ...defaults]) {
    if (out.length === recentEmojiLimit) break
    if (!out.includes(emoji)) out.push(emoji)
  }
  return out
}
export function addRecentEmoji(used: readonly RecentEmoji[], emoji: string): RecentEmoji[] {
  if (!valid(emoji)) return [...used]
  let list = used.map(item => ({ ...item }))
  let index = list.findIndex(item => item.emoji === emoji)
  if (index < 0) {
    if (list.length >= recentEmojiLimit) list = list.slice(0, recentEmojiLimit - 1)
    list.push({ emoji, count: 0 }); index = list.length - 1
  }
  list[index]!.count++
  // Counts are halved when one grows large, so an old favourite can still be overtaken.
  if (list[index]!.count > 0x8000) list = list.map(item => ({ ...item, count: Math.ceil(item.count / 2) }))
  while (index > 0 && list[index - 1]!.count <= list[index]!.count) {
    [list[index - 1], list[index]] = [list[index]!, list[index - 1]!]; index--
  }
  return list
}
export function readRecentEmoji(): RecentEmoji[] {
  try {
    const raw = JSON.parse(localStorage.getItem(storageKey) ?? '[]') as unknown
    if (!Array.isArray(raw)) return []
    return raw.flatMap(item => item && valid(item.emoji) && Number.isInteger(item.count) && item.count > 0 ? [{ emoji: item.emoji as string, count: item.count as number }] : [])
      .slice(0, recentEmojiLimit)
  } catch { return [] }
}
export function recordRecentEmoji(emoji: string): void {
  try { localStorage.setItem(storageKey, JSON.stringify(addRecentEmoji(readRecentEmoji(), emoji))) } catch { /* this device's convenience only */ }
}
