import { autoDeleteOptions } from './chat-auto-delete'
import { tr } from './i18n'

// The server writes the auto-delete notice (onChatAutoDeletePolicyUpdated / onInquiryAutoDeletePolicyUpdated) as a
// system message: the sentence it composed, behind «__TALKY_AUTODEL__:», and the values behind that sentence. The line
// is drawn in this app's language from those values, as iOS Message.AutoDeleteNotice does; a notice from before those
// fields, or a period this app does not offer, keeps the sentence the server stored. In an inquiry room the name is
// the channel's when the channel's owner set it, so nobody behind the channel is named.
export const autoDeleteWirePrefix = '__TALKY_AUTODEL__:'
export interface AutoDeleteNotice { actorName: string; seconds: number; myOnly: boolean }

export function autoDeleteNoticeText(notice: AutoDeleteNotice | null, stored: string): string {
  const sentence = (stored.startsWith(autoDeleteWirePrefix) ? stored.slice(autoDeleteWirePrefix.length) : stored).trim()
  const actorName = notice?.actorName.trim() ?? ''
  if (notice && actorName) {
    if (notice.seconds <= 0) return tr('{0}님이 이 대화의 자동 삭제를 껐어요.', [actorName])
    const period = autoDeleteOptions.find(option => option.seconds === notice.seconds)?.short
    if (period) return notice.myOnly
      ? tr('{0}님이 본인이 보낸 메시지만 {1} 후 자동 삭제로 설정했어요.', [actorName, period])
      : tr('{0}님이 모든 메시지를 {1} 후 자동 삭제로 설정했어요.', [actorName, period])
  }
  return sentence
}
