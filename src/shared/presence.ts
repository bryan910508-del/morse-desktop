import { locale, tr } from './i18n'
// Viewer-redacted presence (RTDB presenceRedacted/{viewer}/{target}, server morse-presence-redaction):
// { s: online | present (t: last seen, seconds) | lastWeek | lastMonth | longTimeAgo | hidden | none }. The server
// follows Telegram's buckets: lastMonth within a month, longTimeAgo beyond (Telegram's «a long time ago»).
export type PresenceCode = 'online' | 'present' | 'lastWeek' | 'lastMonth' | 'longTimeAgo' | 'hidden' | 'none'
export interface PeerPresence { s: PresenceCode; t?: number }
export interface PresenceText { text: string; online: boolean }

const codes: PresenceCode[] = ['online', 'present', 'lastWeek', 'lastMonth', 'longTimeAgo', 'hidden', 'none']

// MorseUserPresence.fromRedactedPayload
export function peerPresence(raw: unknown): PeerPresence {
  if (!raw || typeof raw !== 'object') return { s: 'none' }
  const value = raw as { s?: unknown; t?: unknown }
  const code = codes.includes(value.s as PresenceCode) ? value.s as PresenceCode : 'none'
  if (code !== 'present') return { s: code }
  return typeof value.t === 'number' && Number.isFinite(value.t) && value.t > 0 ? { s: 'present', t: Math.floor(value.t) } : { s: 'hidden' }
}

const timeFormat = new Intl.DateTimeFormat(locale(), { timeStyle: 'short' })
const dateFormat = new Intl.DateTimeFormat(locale(), { dateStyle: 'short' })
function dayStart(ms: number): number { const date = new Date(ms); date.setHours(0, 0, 0, 0); return date.getTime() }

// MorsePresenceStrings wording; a hidden last seen reads like Telegram's OnlineTextCommon
// (isHidden -> lng_status_recently, Korean "최근에 접속함"). Unknown presence shows nothing.
export function presenceText(presence: PeerPresence, now = Date.now()): PresenceText | null {
  switch (presence.s) {
    case 'online': return { text: tr('온라인'), online: true }
    case 'lastWeek': return { text: tr('일주일 이내'), online: false }
    case 'lastMonth': return { text: tr('한 달 이내'), online: false }
    case 'longTimeAgo': return { text: tr('오래 전'), online: false }
    case 'hidden': return { text: tr('최근에 접속함'), online: false }
    case 'present': {
      if (!presence.t) return { text: tr('최근에 접속함'), online: false }
      const at = presence.t * 1000, seconds = Math.floor((now - at) / 1000)
      if (seconds < 60) return { text: tr('방금 전'), online: false }
      if (seconds < 3600) return { text: tr('{0}분 전', [Math.max(1, Math.floor(seconds / 60))]), online: false }
      const today = dayStart(now)
      if (at >= today) return { text: tr('오늘 {0}', [timeFormat.format(at)]), online: false }
      if (at >= today - 86400000) return { text: tr('어제 {0}', [timeFormat.format(at)]), online: false }
      return { text: tr('마지막 접속 {0}', [dateFormat.format(at)]), online: false }
    }
    default: return null
  }
}

// When the text changes next (Telegram OnlineChangeTimeout, 1 s .. 1 day).
export function presenceChangeIn(presence: PeerPresence, now = Date.now()): number | null {
  if (presence.s !== 'present' || !presence.t) return null
  const seconds = Math.floor((now - presence.t * 1000) / 1000)
  if (seconds < 60) return (60 - seconds + 1) * 1000
  if (seconds < 3600) return (60 - (seconds % 60) + 1) * 1000
  const nextDay = dayStart(now) + 86400000
  return Math.min(86400000, Math.max(1000, nextDay - now + 1000))
}
