import { identifier, object } from './validation'
import { tr } from './i18n'

export interface BlockedUser { uid: string; userId: string; displayName: string; blockedAt: number | null }
export interface BlockTarget { uid: string; userId: string; displayName: string }
// A6 §4: a row of the account's session list as Telegram shows one (tdesktop api_authorizations.cpp: the device model,
// «app version», the system, the last activity). How the device signed in is not shown, as Telegram does not.
export type SessionPlatform = 'iOS' | 'Android' | 'macOS' | 'Windows' | 'other'
export interface SignInSession {
  id: string; deviceModel: string; appName: string; appVersion: string; systemVersion: string; platform: SessionPlatform
  lastSeenAt: number | null; createdAt: number | null; current: boolean
}
// Telegram's «automatically terminate old sessions» choices (account.setAuthorizationTTL, telegram-refs R-14):
// 1 week, 3, 6 or 12 months; 6 months when the account has chosen none (A6 §3-2).
export const sessionTtlDayOptions = [7, 90, 183, 365] as const
export const defaultSessionTtlDays = 183
export interface SignInSessions { sessions: SignInSession[]; ttlDays: number }
export function sessionTtlDays(raw: unknown): number {
  if (!sessionTtlDayOptions.includes(raw as typeof sessionTtlDayOptions[number])) throw new Error(tr('기간을 다시 선택해 주세요.'))
  return raw as number
}
export type LastSeenMode = 'everybody' | 'contacts' | 'nobody'
// AccountSecurityView: «비공개 모드» (users.isPrivate) and «자동 회원 탈퇴» (privacy.autoDeleteAccountMonths).
export interface AccountPrivacy { isPrivate: boolean; autoDeleteMonths: number }
// Privacy policy v2 (D4): an account with no stored choice is not deleted for being away — «끔», not six months.
export function autoDeleteMonthsOf(stored: number | undefined): number { return stored === undefined ? 0 : Math.trunc(stored) }
export const autoDeleteMonthOptions = [0, 1, 3, 6, 12] as const
export interface DataExport { downloadURL: string; expiresAt: number; fileSizeBytes: number }
export interface LastSeenPrivacy { mode: LastSeenMode; alwaysShareWith: string[]; neverShareWith: string[] }
export const lastSeenModes: Record<LastSeenMode, string> = { everybody: tr('모든 사람'), contacts: tr('내 연락처'), nobody: tr('아무도 없음') }

export function blockTarget(raw: unknown): BlockTarget {
  const v = object(raw)
  if (Object.keys(v).some(key => !['uid', 'userId', 'displayName'].includes(key)) || typeof v.userId !== 'string' || v.userId.length > 160 ||
    typeof v.displayName !== 'string' || v.displayName.length > 512) throw new Error(tr('차단할 사용자를 다시 선택해 주세요.'))
  return { uid: identifier(v.uid), userId: v.userId, displayName: v.displayName }
}
export function lastSeenPrivacy(raw: unknown): LastSeenPrivacy {
  const v = object(raw)
  const list = (value: unknown): string[] => { if (!Array.isArray(value) || value.length > 200) throw new Error(tr('예외 목록을 확인해 주세요.')); return value.map(item => identifier(item)) }
  if (Object.keys(v).some(key => !['mode', 'alwaysShareWith', 'neverShareWith'].includes(key)) || !['everybody', 'contacts', 'nobody'].includes(String(v.mode))) throw new Error(tr('공개 범위를 다시 선택해 주세요.'))
  return { mode: v.mode as LastSeenMode, alwaysShareWith: list(v.alwaysShareWith), neverShareWith: list(v.neverShareWith) }
}
export function signInSessionId(raw: unknown): string | null {
  if (raw === null) return null
  if (typeof raw !== 'string' || !/^[A-Za-z0-9_.:-]{1,200}$/.test(raw)) throw new Error(tr('종료할 세션을 다시 선택해 주세요.'))
  return raw
}

export interface InviteLink { token: string; url: string; expiresAt: number }
export interface InviteCreator { uid: string; userId: string; displayName: string; bio: string }
// InviteLinkService.parseToken: https://host/i/{16-character token}; a bare token is also accepted.
export function inviteToken(raw: unknown): string {
  if (typeof raw !== 'string' || raw.length > 2048) throw new Error(tr('초대 링크를 확인해 주세요.'))
  const value = raw.trim()
  let token = value
  if (value.includes('/')) {
    try { const parts = new URL(value).pathname.split('/'); token = parts[1] === 'i' && parts.length >= 3 ? parts[2] ?? '' : '' }
    catch { token = '' }
  }
  if (!/^[A-Za-z0-9_-]{16}$/.test(token)) throw new Error(tr('초대 링크를 확인해 주세요.'))
  return token
}
