import type { DialogSummary } from '../../../shared/model'
import { controller } from '../app/ui'
import { errorText } from '../app/format'
import { trackWrite } from '../app/drafts'
import { Box, confirmBox } from '../ui/layers'
import { DeleteChoice } from '../ui/delete-choice'
import { tr } from '../../../shared/i18n'

// B327 «대화 기록 삭제»: Telegram's «Clear history» (ClearHistoryHandler, window/window_peer_menu.cpp:862-880), whose box
// clears it for me unless «also for everyone» is ticked (boxes/delete_messages_box.cpp:157-163). Here the two are the
// box's two buttons, as «대화 삭제» has them. For me: every device of this account (clearMorseHistoryForMe), and the
// row stays without its messages. For everyone: clearMorseChatHistory, as before. The official notice chat has only its
// own clear, for this account (B154 §2-2).
export function showClearHistoryBox(accountUid: string, dialog: Pick<DialogSummary, 'id' | 'service' | 'kind'>): void {
  if (dialog.service) { void clearForEveryone(accountUid, dialog, true); return }
  controller.showLayer(close => {
    const choose = (forEveryone: boolean): void => { close(); void (forEveryone ? clearForEveryone(accountUid, dialog, false) : clearForMe(accountUid, dialog.id)) }
    return <Box title={tr('대화 기록 삭제')} width={360} onClose={close} buttons={<button className="button flat" onClick={close}>{tr('취소')}</button>}>
      <p className="box-text">{tr('나에게만 지우면 내 모든 기기에서 이 대화의 기록이 지워지고, 대화는 목록에 남아요. 모두에게서 지우면 참여자 모두의 기록에서 지워지고 되돌릴 수 없어요.')}</p>
      <DeleteChoice rows={[
        { label: tr('나에게만 삭제'), choose: () => choose(false) },
        { label: tr('모두에게 삭제'), detail: dialog.kind === 'direct' ? tr('상대방 화면에서도 삭제돼요') : tr('모든 참여자의 화면에서 삭제돼요'), danger: true, choose: () => choose(true) }
      ]} />
    </Box>
  })
}

async function clearForMe(accountUid: string, chatId: string): Promise<void> {
  try {
    await trackWrite(window.morse.clearChatHistoryForMe(accountUid, chatId))
    controller.toast(tr('대화 기록을 삭제했습니다.'))
  } catch (reason) { controller.toast(errorText(reason, tr('대화 기록을 삭제하지 못했습니다.')), 'error') }
}

async function clearForEveryone(accountUid: string, dialog: Pick<DialogSummary, 'id' | 'service'>, service: boolean): Promise<void> {
  if (service && !await confirmBox({ title: tr('대화 기록 삭제'), text: tr('이 대화의 알림을 모두 지웁니다. 새 알림이 오면 대화가 다시 보여요.'), confirm: tr('모두 삭제'), danger: true })) return
  try {
    const result = await trackWrite(window.morse.clearChatHistory(accountUid, dialog.id))
    controller.toast(result === 'done' ? tr('대화 기록을 삭제했습니다.') : tr('삭제 결과를 확인하고 있습니다. 잠시 후 대화를 확인해 주세요.'))
  } catch (reason) { controller.toast(errorText(reason, tr('대화 기록을 삭제하지 못했습니다.')), 'error') }
}
