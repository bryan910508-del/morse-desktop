import { locale, tr } from './i18n'

// A10 §4 (Telegram R-56): what an account the operator sanctioned is told. The server refuses with
// {reason, until?} (firebase/functions/morse-sanctions.js, the same file in talky-server):
// - ACCOUNT_RESTRICTED + until (ms): until then only mutual contacts can be written to (Telegram PEER_FLOOD's notice);
// - ACCOUNT_BANNED: no session and no write (Telegram PHONE_NUMBER_BANNED, with its «help» mail, SendToBannedHelp);
// - CHAT_RESTRICTED: the room is closed to everyone (Telegram restriction_reason).
// A refusal is kept on the message as «CODE» or «CODE:until», so the device's queue holds the date too.
export const operatorMailAddress = 'bryan910508@gmail.com'
export type Sanction = 'restricted' | 'banned'

export function rejectionCode(reason: string): string { return reason.split(':', 1)[0] ?? '' }
export function rejectionUntil(reason: string): number | null {
  const [code, value] = reason.split(':', 2)
  const until = code === 'ACCOUNT_RESTRICTED' && value ? Number(value) : NaN
  return Number.isSafeInteger(until) && until > 0 ? until : null
}
export function storedRejection(reason: string, until?: number): string {
  return reason === 'ACCOUNT_RESTRICTED' && until !== undefined && Number.isSafeInteger(until) && until > 0 ? `${reason}:${until}` : reason
}
export function sanctionOf(reason: string): Sanction | null {
  const code = rejectionCode(reason)
  return code === 'ACCOUNT_RESTRICTED' ? 'restricted' : code === 'ACCOUNT_BANNED' ? 'banned' : null
}
const untilText = (until: number): string => new Intl.DateTimeFormat(locale(), { month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(until)
export function restrictedNotice(until: number | null): string {
  return until ? tr('지금은 서로 연락처인 사람에게만 보낼 수 있습니다({0}까지).', [untilText(until)]) : tr('지금은 서로 연락처인 사람에게만 보낼 수 있습니다.')
}
export const bannedNotice = (): string => tr('이 계정은 이용이 정지되었습니다.')
export const roomRestrictedNotice = (): string => tr('이 채널은 Morse 운영 정책 위반으로 볼 수 없습니다.')
export const chatRestrictedNotice = (): string => tr('이 대화는 Morse 운영 정책 위반으로 볼 수 없습니다.')

// «자세히·이의 제기» and «도움»: a new mail to the operator with what the operator needs to find the account, as
// Telegram's SendToBannedHelp fills the number, the app version and the system.
export interface MailFacts { uid: string; userId: string; appVersion: string; system: string; until?: number | null }
export function operatorMailURL(sanction: Sanction, facts: MailFacts): string {
  // 6A-5 decision (10-02 21:3x, as Telegram's SendToBannedHelp writes the number typed in, LoginActivity.java:1258-1263):
  // the Morse ID when it is known; where it is not, an empty «Morse 아이디:» line for the person to fill in. Nothing
  // secret is ever written — the recovery code is not one of the facts this mail is made from.
  const account = facts.userId ? `@${facts.userId} (${facts.uid})` : facts.uid
  const subject = account ? (sanction === 'banned' ? tr('Morse 계정 정지 이의 제기: {0}', [account]) : tr('Morse 보내기 제한 이의 제기: {0}', [account]))
    : sanction === 'banned' ? tr('Morse 계정 정지 이의 제기') : tr('Morse 보내기 제한 이의 제기')
  const opening = sanction === 'banned' ? tr('Morse 에서 이 계정의 이용이 정지되었다고 나옵니다. 확인을 부탁드립니다.')
    : facts.until ? tr('Morse 에서 {0}까지 서로 연락처인 사람에게만 보낼 수 있다고 나옵니다. 확인을 부탁드립니다.', [untilText(facts.until)])
      : tr('Morse 에서 서로 연락처인 사람에게만 보낼 수 있다고 나옵니다. 확인을 부탁드립니다.')
  // B73: a restriction's end on a line of its own, as the notice under the message shows it.
  const ends = sanction === 'restricted' && facts.until ? [tr('제한 끝: {0}', [untilText(facts.until)])] : []
  const body = [opening, '', `${tr('Morse 아이디:')} ${account}`, ...ends, tr('앱: Morse Desktop {0}', [facts.appVersion]), tr('시스템: {0}', [facts.system]), tr('언어: {0}', [locale()]), '', tr('(여기에 내용을 적어 주세요)')].join('\n')
  return `mailto:${operatorMailAddress}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
}
