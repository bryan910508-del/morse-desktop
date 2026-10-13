// Portions of this file follow Telegram Desktop (https://github.com/telegramdesktop/tdesktop, v7.3.1, 6fed91ff),
// Copyright (c) 2014-2026 The Telegram Desktop Authors. Licensed under GPL-3.0-or-later; see LEGAL.
import type { DialogSummary } from './model'

// What deleting a message can be, in one place for the message's menu, the selection and the delete box.
// - «모두에게»: the message can be changed (mutable) and, in a channel's discussion room, it is one's own or one moderates
//   it (A1 §3-6; tdesktop HistoryItem::canDelete, history_item.cpp:3488-3498).
// - «나에게만» (B327b, contract §2-5): Telegram has no delete for me in a supergroup — a channel's discussion room
//   deletes for everyone or not at all (canDeleteForEveryone is false for a channel, :3511-3513, and canDelete only for
//   one's own or a moderator) — nor in a secret chat, where its one delete is for both. Saved messages are deleted
//   for real. 1:1 chats, groups and inquiry rooms keep it.
export interface DeletionChoices { everyone: boolean; me: boolean }
export function deletionChoices(room: Pick<DialogSummary, 'kind' | 'discussion' | 'moderates'> & { saved: boolean }, own: boolean, mutable: boolean): DeletionChoices {
  return {
    everyone: mutable && (!room.discussion || own || room.moderates === true),
    me: room.kind !== 'secret' && !room.discussion && !room.saved
  }
}
export function canDelete(choices: DeletionChoices): boolean { return choices.everyone || choices.me }
