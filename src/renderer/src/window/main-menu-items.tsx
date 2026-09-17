import type { ReactNode } from 'react'
import { CircleUser, Megaphone, MessageSquare, Radio, Settings, User, Users } from 'lucide-react'
import { errorText } from '../app/format'
import { waitFor } from '../app/contacts'
import { desktop } from '../app/store'
import { controller } from '../app/ui'
import { showChannelCreateBox } from '../boxes/channel-create-box'
import { showContactsBox } from '../boxes/contacts-box'
import { showCreateGroupBox } from '../boxes/group-boxes'
import { showSettingsBox } from '../settings/settings-box'
import { tr } from '../../../shared/i18n'

export interface MainMenuEntry { icon: ReactNode; label: string; onClick(): void; separatorBefore?: boolean }

// Saved Messages: the server creates chats/memo_{uid} once; it then appears in the list.
async function openMemo(accountUid: string): Promise<void> {
  try {
    const chatId = await window.morse.prepareMemoChat(accountUid)
    await waitFor(() => desktop.value?.dialogs.some(dialog => dialog.id === chatId) ? true : null, 15000, tr('내 메모를 여는 데 시간이 걸리고 있습니다. 잠시 후 대화 목록을 확인해 주세요.'))
    controller.openChat(chatId)
  } catch (reason) { controller.toast(errorText(reason, tr('내 메모를 열지 못했습니다.')), 'error') }
}

// Window::MainMenu::setupMenu (tdesktop 272f6f5c): My Profile, a separator, New Group, New Channel,
// Contacts, Saved Messages and Settings; Night Mode follows as a toggle row. Morse has no calls. «채널»
// opens iOS's channel tab above New Group. Channel search, invites, notes, stories and keyboard
// shortcuts live where iOS keeps them: the channel tab, the contacts box, the chat list and settings.
export function mainMenuItems(accountUid: string): MainMenuEntry[] {
  return [
    { icon: <CircleUser size={20} />, label: tr('내 프로필'), onClick: () => showSettingsBox(accountUid, 'profile') },
    { icon: <Radio size={20} />, label: tr('채널'), separatorBefore: true, onClick: () => { controller.showChats('channels'); controller.setChannelExplore(false); controller.setQuery('') } },
    { icon: <Users size={20} />, label: tr('새 그룹'), onClick: () => showCreateGroupBox(accountUid) },
    { icon: <Megaphone size={20} />, label: tr('새 채널'), onClick: () => showChannelCreateBox(accountUid) },
    { icon: <User size={20} />, label: tr('연락처'), onClick: () => showContactsBox(accountUid) },
    { icon: <MessageSquare size={20} />, label: tr('내 메모'), onClick: () => { void openMemo(accountUid) } },
    { icon: <Settings size={20} />, label: tr('설정'), onClick: () => showSettingsBox(accountUid) }
  ]
}
