import { identifier, object } from './validation'
import { tr } from './i18n'

// iOS ChannelService.reportUser / reportChannel / reportPost / reportGroup: a reports/{auto-id} document with
// type, targetId (and channelId for a post), reporterId, category, extra when written, and createdAt.
export type ReportTarget = { type: 'user'; targetId: string } | { type: 'channel'; targetId: string } | { type: 'group'; targetId: string } | { type: 'post'; targetId: string; channelId: string }
export interface ReportRequest { target: ReportTarget; category: string; extra: string }

// UserReportView UserReportCategory.
export const userReportCategories: { id: string; title: string; detail: string }[] = [
  { id: 'harassment', title: tr('괴롭힘/욕설'), detail: tr('불쾌한 메시지나 위협') }, { id: 'impersonation', title: tr('사칭'), detail: tr('다른 사람인 척 행동') },
  { id: 'threat', title: tr('위협/협박'), detail: tr('폭력 위협이나 협박') }, { id: 'scam', title: tr('사기/피싱'), detail: tr('금전 요구나 피싱 시도') },
  { id: 'spam', title: tr('스팸/광고'), detail: tr('반복적인 스팸 메시지') }, { id: 'hate', title: tr('혐오/차별'), detail: tr('혐오 발언이나 차별') },
  { id: 'minor_safety', title: tr('미성년자 위험'), detail: tr('아동 안전 관련 우려') }, { id: 'other', title: tr('기타'), detail: tr('위 항목에 해당하지 않는 경우') }
]
// Models.swift ReportCategory, for channels, posts and groups.
export const contentReportCategories: { id: string; title: string }[] = [
  { id: 'spam', title: tr('스팸/광고') }, { id: 'hate', title: tr('욕설/혐오') }, { id: 'scam', title: tr('사기/허위 정보') }, { id: 'adult', title: tr('음란물') },
  { id: 'violence', title: tr('폭력/위험') }, { id: 'copyright', title: tr('저작권 침해') }, { id: 'other', title: tr('기타') }
]
export const maxReportExtra = 1000

export function reportRequest(raw: unknown): ReportRequest {
  const value = object(raw), target = object(value.target)
  const type = target.type
  if (type !== 'user' && type !== 'channel' && type !== 'group' && type !== 'post') throw new Error(tr('신고 대상을 다시 선택해 주세요.'))
  const categories = type === 'user' ? userReportCategories : contentReportCategories
  if (typeof value.category !== 'string' || !categories.some(item => item.id === value.category)) throw new Error(tr('신고 사유를 선택해 주세요.'))
  if (typeof value.extra !== 'string' || value.extra.length > maxReportExtra) throw new Error(tr('추가 설명은 {0}자까지 적을 수 있어요.', [maxReportExtra]))
  const targetId = identifier(target.targetId)
  return { target: type === 'post' ? { type, targetId, channelId: identifier(target.channelId) } : { type, targetId }, category: value.category, extra: value.extra.trim() }
}
