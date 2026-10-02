import { locale } from './i18n'
import { messageKindLabel } from './message-kinds'
import type { ChatMessage } from './model'

// B53 (Telegram R-65, HistoryInner::getSelectedText): chosen messages copy as one text in chat order, each as
// «[short date time] name: words» on its own line; a single message copies as its words alone. A message without words
// gives its kind's name and caption the way Telegram's clipboardText does («[ 사진 ]», the caption on the next line).
// What «텍스트 복사» leaves out — an end-to-end encrypted or a system message — is left out here as well.
type Copyable = Pick<ChatMessage, 'kind' | 'text' | 'caption' | 'encrypted' | 'system' | 'position'>
export function messageCopyText(message: Copyable): string {
  if (message.encrypted || message.system) return ''
  if (message.kind === 'text') return message.text
  const label = messageKindLabel(message.kind), caption = message.caption?.trim() ?? ''
  return label ? (caption ? `[ ${label} ]\n${caption}` : `[ ${label} ]`) : caption
}
export function selectedMessagesText<T extends Copyable>(messages: T[], nameOf: (message: T) => string): string {
  const order = (a: Copyable, b: Copyable) => a.position.seconds - b.position.seconds || a.position.nanoseconds - b.position.nanoseconds || (a.position.id < b.position.id ? -1 : a.position.id > b.position.id ? 1 : 0)
  const parts = [...messages].sort(order).flatMap(message => { const text = messageCopyText(message); return text ? [{ message, text }] : [] })
  if (parts.length <= 1) return parts[0]?.text ?? ''
  const when = new Intl.DateTimeFormat(locale(), { dateStyle: 'short', timeStyle: 'short' })
  return parts.map(({ message, text }) => `[${when.format(new Date(message.position.seconds * 1000))}] ${nameOf(message)}: ${text}`).join('\n')
}
