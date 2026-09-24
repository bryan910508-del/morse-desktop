import type { ReactNode } from 'react'
import { CircleUser, Megaphone, NotebookPen, Radio, Settings, User, Users } from 'lucide-react'
import { controller } from '../app/ui'
import { showChannelCreateBox } from '../boxes/channel-create-box'
import { showContactsBox } from '../boxes/contacts-box'
import { showCreateGroupBox } from '../boxes/group-boxes'
import { showSettingsBox } from '../settings/settings-box'
import { tr } from '../../../shared/i18n'

export interface MainMenuEntry { icon: ReactNode; label: string; onClick(): void; separatorBefore?: boolean }

// Window::MainMenu::setupMenu (tdesktop 272f6f5c): My Profile, a separator, New Group, New Channel,
// Contacts, Saved Messages and Settings; Night Mode follows as a toggle row. Morse has no calls. «채널»
// opens iOS's channel tab above New Group. Channel search, invites, notes, stories and keyboard
// shortcuts live where iOS keeps them: the channel tab, the contacts box, the chat list and settings.
export function mainMenuItems(accountUid: string): MainMenuEntry[] {
  return [
    { icon: <CircleUser size={20} />, label: tr('내 프로필'), onClick: () => showSettingsBox(accountUid, 'profile') },
    { icon: <Radio size={20} />, label: tr('채널'), separatorBefore: true, onClick: () => controller.showChannels() },
    { icon: <Users size={20} />, label: tr('새 그룹'), onClick: () => showCreateGroupBox(accountUid) },
    { icon: <Megaphone size={20} />, label: tr('새 채널'), onClick: () => showChannelCreateBox(accountUid) },
    { icon: <User size={20} />, label: tr('연락처'), onClick: () => showContactsBox(accountUid) },
    // Saved Messages is not a chat of its own in the list: iOS keeps it behind the notes hub, and so
    // does this menu — the notes screen holds «저장한 메시지» and the notes together.
    { icon: <NotebookPen size={20} />, label: tr('노트'), onClick: () => controller.showNotes() },
    { icon: <Settings size={20} />, label: tr('설정'), onClick: () => showSettingsBox(accountUid) }
  ]
}
