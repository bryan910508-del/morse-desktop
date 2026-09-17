import { useEffect, useMemo, useState } from 'react'
import { Users } from 'lucide-react'
import { premiumPinLimit, type PinnedMessagesSnapshot } from '../../../shared/pinned-messages'
import { useDesktop } from '../app/store'
import { controller } from '../app/ui'
import { errorText } from '../app/format'
import { trackWrite } from '../app/drafts'
import { Box } from '../ui/layers'
import { tr } from '../../../shared/i18n'

// iOS BookmarkBar / Telegram HistoryView pinned bar: the current pinned message with its kind
// ("고정" or "모두에게 고정") and position; a click jumps to it and moves on to the next pin.
export function PinnedBar({ accountUid, chatId }: { accountUid: string; chatId: string }) {
  const pinned = useDesktop(snapshot => snapshot?.pinnedMessages?.chatId === chatId ? snapshot.pinnedMessages : null)
  const items = useMemo(() => pinned?.items.filter(item => item.status !== 'unavailable') ?? [], [pinned])
  const [index, setIndex] = useState(0)
  useEffect(() => { if (index >= items.length) setIndex(Math.max(0, items.length - 1)) }, [index, items.length])
  if (!items.length) return null
  const position = index % items.length, current = items[position]!
  const open = (): void => {
    if (current.status === 'ready') void window.morse.jumpPinned(accountUid, chatId, current.id).catch(reason => controller.toast(errorText(reason, tr('고정된 메시지로 이동하지 못했습니다.')), 'error'))
    setIndex((position + 1) % items.length)
  }
  return <button type="button" className="pinned-bar" onClick={open} aria-label={tr('고정된 메시지로 이동')}>
    <span className="pinned-bar-line" aria-hidden="true" />
    <span className="pinned-bar-text">
      <span className="pinned-bar-label">{current.forAll ? <><Users size={12} />{tr('모두에게 고정')}</> : tr('고정', [], 'label')}{items.length > 1 && <small>{position + 1}/{items.length}</small>}</span>
      <span className="pinned-bar-preview ellipsis">{current.status === 'loading' ? tr('불러오는 중…') : current.preview || tr('메시지')}</span>
    </span>
  </button>
}

function PinTypeBox({ accountUid, chatId, messageId, close }: { accountUid: string; chatId: string; messageId: string; close(): void }) {
  const pin = (scope: 'me' | 'all'): void => {
    close()
    void trackWrite(window.morse.pinMessage(accountUid, { chatId, messageId, scope, pin: true })).catch(reason => controller.toast(errorText(reason, tr('메시지를 고정하지 못했습니다.')), 'error'))
  }
  return <Box title={tr('메시지 고정')} width={360} onClose={close} buttons={<button className="button flat" onClick={close}>{tr('취소')}</button>}>
    <p className="box-text">{tr('모두에게 고정하면 상대방 채팅방에도 동일하게 표시됩니다.')}</p>
    <div className="pin-type-actions">
      <button type="button" className="button secondary block" onClick={() => pin('me')}>{tr('나에게만 고정')}</button>
      <button type="button" className="button primary block" onClick={() => pin('all')}>{tr('모두에게 고정')}</button>
    </div>
  </Box>
}

function PinLimitBox({ limit, close }: { limit: number; close(): void }) {
  return <Box title={limit < premiumPinLimit ? tr('더 많이 고정하려면 프리미엄') : tr('메시지 고정')} width={360} onClose={close} buttons={<button className="button flat" onClick={close}>{tr('확인')}</button>}>
    <p className="box-text">{limit < premiumPinLimit ? tr('무료 플랜은 메시지 최대 {0}개를 고정할 수 있어요.\n프리미엄으로 업그레이드하면 {1}개까지 고정 가능해요.', [limit, premiumPinLimit]) : tr('메시지는 최대 {0}개까지 고정할 수 있어요.', [limit])}</p>
  </Box>
}

// ChatRoomView.handleBookmarkFromMenu: a pinned message is unpinned (both kinds); otherwise the
// limit is checked, then the user chooses "나에게만 고정" or "모두에게 고정".
export async function togglePin(accountUid: string, chatId: string, messageId: string, pinned: PinnedMessagesSnapshot | null): Promise<void> {
  const item = pinned?.chatId === chatId ? pinned.items.find(entry => entry.id === messageId) : undefined
  if (item) {
    try {
      if (item.forMe) await trackWrite(window.morse.pinMessage(accountUid, { chatId, messageId, scope: 'me', pin: false }))
      if (item.forAll) await trackWrite(window.morse.pinMessage(accountUid, { chatId, messageId, scope: 'all', pin: false }))
    } catch (reason) { controller.toast(errorText(reason, tr('고정을 해제하지 못했습니다.')), 'error') }
    return
  }
  const limit = pinned?.limit ?? 3, count = pinned?.items.filter(entry => entry.status !== 'unavailable').length ?? 0
  if (count >= limit) { controller.showLayer(close => <PinLimitBox limit={limit} close={close} />); return }
  controller.showLayer(close => <PinTypeBox accountUid={accountUid} chatId={chatId} messageId={messageId} close={close} />)
}
