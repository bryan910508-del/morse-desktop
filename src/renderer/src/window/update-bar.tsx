// Portions of this file follow Telegram Desktop (https://github.com/telegramdesktop/tdesktop, 42f8a36d4),
// Copyright (c) 2014-2026 The Telegram Desktop Authors. Licensed under GPL-3.0-or-later; see LEGAL.
import { useDesktop } from '../app/store'
import { updateReady } from '../../../shared/app-updates'
import { tr } from '../../../shared/i18n'

export const useUpdateReady = (): boolean => useDesktop(snapshot => updateReady(snapshot?.appUpdate))
// Core::checkReadyUpdate + Core::Restart: the normal quit, which ends by installing the downloaded version.
export const installUpdate = (): void => { void window.morse.installAppUpdate().catch(() => {}) }

// B456, Dialogs::Widget «Update Telegram» (dialogs_widget.cpp:2624-2659, put at the bottom :4645). tdesktop's left column
// is always the chat list, so its bar stays in view whatever the window shows beside it. Morse's left column is the chats,
// the channels or the notes, so the bar belongs to the column and stands under each of them.
export function UpdateBar() {
  const ready = useUpdateReady()
  return ready ? <button type="button" className="dialogs-update" onClick={installUpdate}>{tr('Morse 업데이트')}</button> : null
}
