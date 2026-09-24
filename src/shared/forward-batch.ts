import { forwardSource, maxForwardTargets, type ForwardSource } from './forward'
import { identifier, object } from './validation'
import { tr } from './i18n'

export const maxForwardMessages = 10
export interface ForwardBatchRequest {
  id: string
  sources: ForwardSource[]
  targets: { chatId: string; messageIds: string[] }[]
}
export function forwardBatchRequest(raw: unknown): ForwardBatchRequest {
  const value = object(raw)
  if (!Array.isArray(value.sources) || !value.sources.length || value.sources.length > maxForwardMessages ||
      !Array.isArray(value.targets) || !value.targets.length || value.targets.length > maxForwardTargets) throw new Error(tr('메시지와 전달 대상은 각각 10개까지 선택해 주세요.'))
  const sources = value.sources.map(forwardSource)
  if (new Set(sources.map(source => source.messageId)).size !== sources.length || sources.some(source => source.chatId !== sources[0]!.chatId)) throw new Error(tr('같은 대화의 서로 다른 메시지를 선택해 주세요.'))
  const targets = value.targets.map(raw => {
    const target = object(raw), chatId = identifier(target.chatId)
    // Saved Messages takes several messages at once like any other room; only the room they are already
    // in is refused.
    if (chatId === sources[0]!.chatId || !Array.isArray(target.messageIds) || target.messageIds.length !== sources.length) throw new Error(tr('전달 대상과 메시지 수를 확인해 주세요.'))
    return { chatId, messageIds: target.messageIds.map(identifier) }
  }).sort((a, b) => a.chatId.localeCompare(b.chatId, 'en'))
  if (new Set(targets.map(target => target.chatId)).size !== targets.length || new Set(targets.flatMap(target => target.messageIds)).size !== sources.length * targets.length) throw new Error(tr('전달 식별자가 중복되었습니다.'))
  return { id: identifier(value.id), sources, targets }
}
