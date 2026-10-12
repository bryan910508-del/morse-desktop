import type { ForwardInfo } from '../../../shared/model'
import { forwardHeaderOf, type ForwardAction } from '../../../shared/forward'
import { tr } from '../../../shared/i18n'
import { fullTime } from '../app/format'
import { useDesktop } from '../app/store'
import { controller } from '../app/ui'

// B263: «Forwarded from {name}» at the top of a bubble, as tdesktop's paintForwardedInfo draws it after the sender's name
// and before the reply (history_view_message.cpp:2073-2078), with the original's date on hover (lng_forwarded_date).
// A sticker carries it too (media_unwrapped.cpp:180-181 drawSurrounding).
export function ForwardedHeader({ accountUid, forward, disabled }: { accountUid: string; forward: ForwardInfo; disabled?: boolean }) {
  const uid = forward.fromUid ?? ''
  const self = useDesktop(snapshot => snapshot?.activeAccountUid ?? '')
  const contactName = useDesktop(snapshot => uid ? snapshot?.contacts?.items.find(contact => contact.uid === uid)?.displayName ?? '' : '')
  const { name, action } = forwardHeaderOf(forward, { self, contactName })
  const title = forward.date ? tr('원본: {0}', [fullTime(forward.date)]) : undefined
  const words = tr('전달됨: {0}', [name])
  if (!action || disabled) return <div className="bubble-forward ellipsis" title={title}>{words}</div>
  return <button type="button" className="bubble-forward ellipsis" title={title}
    onClick={event => { event.stopPropagation(); open(action, name) }}>{words}</button>
}

// The person's panel (B266), the channel's post, or the notice that the account was hidden.
function open(action: ForwardAction, name: string): void {
  if (action.kind === 'channel') controller.openChannel(action.channelId, action.postId)
  else if (action.kind === 'hidden') controller.toast(tr('이 계정은 사용자가 숨겼어요.'))
  else controller.openPersonInfo(action.uid, name)
}
