// A group's or a channel's title, as Telegram has it: 1 to 128 characters, counted the way the limit is enforced
// everywhere — UTF-16 code units (tdesktop boxes/peers/edit_peer_common.h kMaxGroupChannelTitle = 128 on a Qt
// QString; TDLib createNewBasicGroupChat and setChatTitle «1-128 characters») — and never only spaces
// (edit_peer_info_box.cpp and add_contact_box.cpp refuse a title that is empty once trimmed). The server holds the
// same limit (firestore.rules v4.8.13, createMorseGroup — user decision 10, 2026-09-27).
export const maxChatTitle = 128

// Whether a title may be saved: something other than spaces, and no more than 128 units.
export function validChatTitle(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= maxChatTitle
}

// What a title input keeps of what was typed or pasted: at most 128 units, and never half of a character at the end —
// an emoji whose second half would fall past the limit is left out whole.
export function clampChatTitle(value: string): string {
  if (value.length <= maxChatTitle) return value
  const cut = value.slice(0, maxChatTitle), last = cut.charCodeAt(cut.length - 1)
  return last >= 0xd800 && last <= 0xdbff ? cut.slice(0, -1) : cut
}
