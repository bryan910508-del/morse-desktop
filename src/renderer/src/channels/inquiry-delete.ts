import { tr } from '../../../shared/i18n'
import { trackWrite } from '../app/drafts'
import { errorText } from '../app/format'
import { controller } from '../app/ui'
import { confirmBox } from '../ui/layers'

// B495: «문의 삭제», one way from every place that offers it — the asking side's row in the chat list, the owner's
// «1:1 문의» list, and the room's own «더 보기», for both sides (tdesktop offers «Delete chat» on a row and in a chat's
// top menu; iOS deletes from the owner's folder). The room is one document both sides read, so it goes for the other
// person as well (channel-inquiries.ts deleteRoom). Asked first, as it cannot be undone; then the room closes here
// first, as a chat's delete does (B493 closeInquiryRoom, tdesktop DeleteMessagesBox::deleteAndClear).
export async function deleteInquiryRoom(accountUid: string, inquiryId: string, title: string): Promise<void> {
  if (!await confirmBox({ title, text: tr('이 문의를 삭제하면 상대방의 목록과 기록에서도 사라지고 되돌릴 수 없어요.'), confirm: tr('모두에게 삭제'), danger: true })) return
  controller.closeInquiryRoom(inquiryId)
  try {
    const result = await trackWrite(window.morse.deleteInquiryRoom(accountUid, inquiryId))
    controller.toast(result === 'done' ? tr('문의를 삭제했습니다.') : tr('삭제 결과를 확인하고 있습니다. 잠시 후 목록을 확인해 주세요.'))
  } catch (reason) { controller.toast(errorText(reason, tr('문의를 삭제하지 못했습니다.')), 'error') }
}
