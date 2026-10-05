import { controller } from './ui'
import { errorText } from './format'
import { tr } from '../../../shared/i18n'

// This device's own «알림 끄기» / «보관» for a chat (ChatFlags), from the chat list or a read-only chat's bar.
export async function setChatFlag(accountUid: string, chatId: string, patch: { muted?: boolean; archived?: boolean }): Promise<void> {
  try {
    await window.morse.setChatFlags(accountUid, chatId, patch)
    if (patch.archived !== undefined) controller.toast(patch.archived ? tr('대화를 보관했습니다.') : tr('보관을 해제했습니다.'))
  } catch (reason) { controller.toast(errorText(reason, tr('변경하지 못했습니다.')), 'error') }
}
