import type { ChannelDiscussionNavigation } from '../../../shared/channel-discussion-navigation'
import { controller } from '../app/ui'
import { errorText } from '../app/format'
import { trackWrite } from '../app/drafts'
import { confirmBox } from '../ui/layers'
import { tr } from '../../../shared/i18n'

// Leaves only the discussion group; the channel subscription and ownership stay. Shared by the
// channel info panel and the chat list, where deleting a discussion room leaves it the way iOS does.
export async function leaveDiscussionRoom(accountUid: string, selection: ChannelDiscussionNavigation): Promise<void> {
  try {
    const target = await window.morse.resolveDiscussionDeparture(accountUid, selection)
    const work = await window.morse.discussionLeaveWork(accountUid, selection).catch(() => null)
    const waiting = work ? work.outgoing + work.actions : 0
    const text = [
      target.owner ? tr('채널 구독과 소유권은 그대로 유지됩니다. 이후 소유자 동기화로 다시 참여 목록에 포함될 수 있습니다.') : tr('채널 구독은 그대로 유지됩니다. 다시 들어오려면 토론방 참여를 다시 해야 합니다.'),
      waiting ? tr('이 토론방에 보내지 않은 메시지 작업 {0}건이 남아 있습니다.', [waiting]) : '',
      work?.selectedAttachment ? tr('선택 중인 첨부가 있으면 먼저 보내거나 취소해야 합니다.') : ''
    ].filter(Boolean).join(' ')
    if (!await confirmBox({ title: tr('토론방 나가기'), text, confirm: tr('나가기'), danger: true })) return
    const result = await trackWrite(window.morse.leaveGroup(accountUid, { id: crypto.randomUUID(), ...target }))
    controller.toast(result === 'done' ? tr('토론방에서 나갔습니다.') : tr('나가기 결과를 아직 확인하지 못했습니다. 잠시 후 대화 목록을 확인해 주세요.'))
  } catch (reason) { controller.toast(errorText(reason, tr('토론방에서 나가지 못했습니다.')), 'error') }
}
