// B109: a call that opens a chat answers only once the batch that carries that chat has gone to the window. The
// renderer opens the chat on the answer, and an answer never overtakes a batch sent before it (one IPC channel), so
// the chat is there when it is shown — as tdesktop's showPeerHistory finds the History in the session data it shows
// from. Answering first left one frame with no dialog: «대화를 찾을 수 없습니다.» for a chat that was not listed.
export function answerAfterPublish(publish: () => Promise<void>): (chatId: string | Promise<string>) => Promise<string> {
  return async chatId => {
    const id = await chatId
    await publish()
    return id
  }
}
// The same for a chat this account makes (a new group): its creation is confirmed first, then the list must hold it —
// tdesktop shows a created chat from the updates the creation returned. 'listed' is a chat the window now has, to open;
// 'done' a chat made but not in the list in time; 'unconfirmed' a creation not known to have happened.
export function answerWhenListed(publish: () => Promise<void>): (created: Promise<'done' | 'unconfirmed'>, listed: () => Promise<boolean>) => Promise<'listed' | 'done' | 'unconfirmed'> {
  return async (created, listed) => {
    const result = await created
    if (result !== 'done' || !await listed()) return result
    await publish()
    return 'listed'
  }
}
