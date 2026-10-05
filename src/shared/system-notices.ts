import { locale, tr } from './i18n'

// B113 / A13-5: Morse's official notice chat «Morse», as Telegram's service notifications from 777000 — a 1:1 with the
// reserved account `morse-system`, read-only, written by the server alone (chats/system_{uid}, type 'system').
export const systemNoticeUid = 'morse-system'

// A notice's systemEvent (server morse-system-notices.js eventFields): the kind, and what it knows of the event.
export interface SystemNotice {
  kind: string
  deviceLabel?: string; platform?: string; appVersion?: string; country?: string; ip?: string
  // A reset's date (milliseconds), drawn in this window's own language.
  resetAt?: number
}

// Where a sign-in came from: the device's name (else its platform), the country, the IP — those it has, as the server
// joins them for its fallback (fallbackText `where`).
function where(notice: SystemNotice): string {
  return [notice.deviceLabel || notice.platform, notice.country, notice.ip ? `IP ${notice.ip}` : ''].filter(Boolean).join(' · ')
}

// The words for a notice in this window's language (contracts/A13-5 §5), drawn when it is shown, as Telegram draws its
// service messages from their action rather than from stored text. An unknown kind shows the server's own text.
export function systemNoticeText(notice: SystemNotice, fallback: string): string {
  switch (notice.kind) {
    case 'newLogin': return tr('새 기기에서 로그인했습니다: {0}. 본인이 아니면 설정 › 기기에서 이 세션을 끝내세요.', [where(notice)])
    case 'passwordStage': return tr('누군가 이 계정에 로그인해 2단계 인증 비밀번호 단계까지 왔습니다: {0}. 본인이 아니면 다른 로그인 수단을 확인하세요.', [where(notice)])
    case 'passwordEnabled': return tr('2단계 인증을 켰습니다.')
    case 'passwordChanged': return tr('2단계 인증 비밀번호를 바꿨습니다.')
    case 'passwordDisabled': return tr('2단계 인증을 껐습니다.')
    case 'hintChanged': return tr('2단계 인증 힌트를 바꿨습니다.')
    case 'passwordResetRequested': {
      const date = notice.resetAt ? new Intl.DateTimeFormat(locale(), { dateStyle: 'medium', timeStyle: 'short' }).format(notice.resetAt) : ''
      return tr('2단계 인증 재설정이 요청됐습니다. {0}에 비밀번호가 꺼집니다. 본인이 아니면 설정 › 2단계 인증에서 취소하세요.', [date])
    }
    case 'passwordResetCancelled': return tr('2단계 인증 재설정 요청을 취소했습니다.')
    case 'passwordResetDone': return tr('2단계 인증 비밀번호를 재설정해 껐습니다.')
    // A3 §9: a recovery code made by the account's Apple or Google identity, said on every other session.
    case 'backupCodeReset': return tr('복구 코드를 새로 만들었습니다: {0}. 본인이 아니면 설정 › 기기에서 세션을 확인하세요.', [where(notice)])
    default: return fallback.trim() || tr('Morse 알림')
  }
}

// A sign-in this person may not have made leads to where its session can be ended (contracts/A13-5 §3-4: «설정 ›
// 기기»); a two-step reset to the two-step verification screen, where a reset nobody asked for is cancelled (A13-2 ③).
export function systemNoticeShortcut(notice: SystemNotice): 'sessions' | 'two-step' | null {
  if (notice.kind === 'newLogin' || notice.kind === 'passwordStage') return 'sessions'
  return notice.kind.startsWith('passwordReset') ? 'two-step' : null
}
