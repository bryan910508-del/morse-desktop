// B76 (Telegram ChatData::setFlags, data_chat.cpp:136-146: «if (wasIn && !amIn()) … closeChatFromWindows»; channels the
// same on Left|Forbidden, data_channel.cpp:215-228): a chat that was on screen and is no longer one of this account's
// chats — the group was deleted, or someone removed this account — closes with its side panel, instead of staying as
// an empty «대화를 찾을 수 없습니다.» pane. A chat this account still has but no longer lists (deleted here, or
// emptied for everyone) stays open as it is (DesktopSnapshot.openDialogs); a 1:1 not created yet is not a chat yet.
export interface OpenChatFacts {
  // The list is the account's own and complete: read, and not hidden behind the passcode lock.
  listReady: boolean
  // The chat is a row of the list or an open unlisted dialog (dialogById).
  present: boolean
  // A 1:1 waiting for its first message.
  pending: boolean
}
export function chatGone(wasPresent: boolean, now: OpenChatFacts): boolean {
  return wasPresent && now.listReady && !now.present && !now.pending
}
