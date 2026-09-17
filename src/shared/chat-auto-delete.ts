import type { DialogSummary } from './model'
import { tr } from './i18n'

// ChatRoomAutoDeleteSheet choices; the server accepts only these durations (morse-message-authority).
export const autoDeleteChoices = [0, 3600, 86400, 604800, 2592000, 31536000] as const
export function autoDeleteSecondsValue(value: number): number { return (autoDeleteChoices as readonly number[]).includes(value) ? value : 0 }
export const autoDeleteOptions: { seconds: number; label: string; detail: string; short: string }[] = [
  { seconds: 0, label: tr('자동 삭제 꺼짐'), detail: tr('메시지 영구 보관'), short: '' },
  { seconds: 3600, label: tr('1시간 후'), detail: tr('전송 1시간 후 자동 삭제'), short: tr('1시간') },
  { seconds: 86400, label: tr('1일 후'), detail: tr('전송 24시간 후 자동 삭제'), short: tr('1일') },
  { seconds: 604800, label: tr('1주일 후'), detail: tr('전송 7일 후 자동 삭제'), short: tr('1주일') },
  { seconds: 2592000, label: tr('1개월 후'), detail: tr('전송 30일 후 자동 삭제'), short: tr('1개월') },
  { seconds: 31536000, label: tr('1년 후'), detail: tr('전송 365일 후 자동 삭제'), short: tr('1년') }
]
// Chat.canChangeAutoDeletePolicy: in a group of three or more only its creator may change it.
// Secret chats cannot be opened on Desktop, so their policy is not offered here.
export function canChangeAutoDelete(dialog: Pick<DialogSummary, 'kind' | 'participantUids' | 'createdBy'>, uid: string): boolean {
  if (dialog.kind === 'secret' || !dialog.participantUids.includes(uid)) return false
  if (dialog.kind !== 'group' || dialog.participantUids.length < 3) return true
  return Boolean(dialog.createdBy) && dialog.createdBy === uid
}
// autodelete.myMsgFormat / autodelete.allMsgFormat
export function autoDeleteSummary(seconds: number, myOnly: boolean): string {
  const option = autoDeleteOptions.find(item => item.seconds > 0 && item.seconds === seconds)
  if (!option) return tr('자동 삭제 꺼짐')
  return myOnly ? tr('내 메시지가 {0} 후 삭제됨', [option.short]) : tr('메시지가 {0} 후 삭제됨', [option.short])
}
