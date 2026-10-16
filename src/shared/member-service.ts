// Portions of this file follow Telegram Desktop (https://github.com/telegramdesktop/tdesktop, 42f8a36d4),
// Copyright (c) 2014-2026 The Telegram Desktop Authors. Licensed under GPL-3.0-or-later; see LEGAL.
import { tr } from './i18n'

// B440a (reports/server/2026-10-16-b440a-member-service-messages.md §2): a group's service lines for who came in, who
// was removed, who left and who owns it now. As Telegram's, the line carries people, not words — its actor and targets —
// and each app draws it in its own language at the moment it is shown (tdesktop HistoryItem prepareChatAddUserText /
// prepareChatDeleteUser, history/history_item.cpp:6148-6207·:6288-6310).
export type MemberServiceKind = 'memberAdded' | 'memberRemoved' | 'memberLeft' | 'groupOwnerChanged'
export const memberServiceKinds: ReadonlySet<string> = new Set<MemberServiceKind>(['memberAdded', 'memberRemoved', 'memberLeft', 'groupOwnerChanged'])
export interface MemberServiceEvent {
  kind: MemberServiceKind
  actorUid: string
  targetUids: string[]
  // The names the server copied when the line was written (`systemNames`): a removed person or one who left is no
  // longer in the room's participants, and may not be a contact.
  names: Record<string, string>
}

// A person's name, as the three apps find it (§2-1): the name this account knows now (the room's, a contact's), else the
// copy the line carries, else «알 수 없는 사용자».
export function memberServiceText(event: MemberServiceEvent, current: (uid: string) => string): string {
  const name = (uid: string): string => current(uid).trim() || event.names[uid]?.trim() || tr('알 수 없는 사용자')
  const targets = event.targetUids.map(name).join(', ')
  switch (event.kind) {
    // lng_action_user_joined when the one added is the actor (:6153-6158), else lng_action_add_user / _add_users (:6161-6198).
    case 'memberAdded':
      return event.targetUids.length === 1 && event.targetUids[0] === event.actorUid
        ? tr('{0}님이 들어왔어요', [name(event.actorUid)])
        : tr('{0}님이 {1}님을 초대했어요', [name(event.actorUid), targets])
    // lng_action_kick_user (:6298-6306).
    case 'memberRemoved': return tr('{0}님이 {1}님을 내보냈어요', [name(event.actorUid), targets])
    // lng_action_user_left (:6290-6296).
    case 'memberLeft': return tr('{0}님이 나갔어요', [name(event.actorUid)])
    // Telegram's basic groups have no owner to hand over; Morse's own line.
    case 'groupOwnerChanged': return tr('{0}님이 이제 그룹 주인이에요', [targets])
  }
}
