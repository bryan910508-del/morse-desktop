// B515: a channel joined by an approved request shows «가입 요청이 승인되었어요» once, on this device, the first time it is
// opened — Telegram's service message in the person's own history (Telegram-iOS `.joinedByRequest`, «Your request to join
// the channel was approved», ServiceMessageStrings.swift:425-427; Telegram-Android RequestToJoinChannelApproved). A Morse
// channel's posts are everyone's, so the line is drawn here and remembered here (the server report b515 §5).
const key = (accountUid: string): string => `morse.joinApprovedSeen.${accountUid}`
const maxSeen = 500

function read(accountUid: string): string[] {
  try {
    const value = JSON.parse(localStorage.getItem(key(accountUid)) ?? '[]') as unknown
    return Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : []
  } catch { return [] }
}
// Whether the line is drawn now, and remembered as seen once it is.
export function takeJoinApprovedLine(accountUid: string, channelId: string, joinedByRequest: boolean): boolean {
  if (!joinedByRequest) return false
  const seen = read(accountUid)
  if (seen.includes(channelId)) return false
  try { localStorage.setItem(key(accountUid), JSON.stringify([...seen, channelId].slice(-maxSeen))) } catch { /* drawn this once anyway */ }
  return true
}
