import { documents, ReadFailure, stringField, type FirestoreDocument, type WireObject } from '../network/firestore-values'
import type { DialogSummary } from '../../shared/model'
import { directChatId } from './direct-chat-id'

// B88 §28: a person's 1:1 is the room the server's pair document names. talky-server keeps
// `directChatPairs/{key}` = { chatId, participantUids, updatedAt } for every 1:1 (morse-message-authority.js,
// key = the two accounts' `direct_` id), so one read answers which room two people share, as Telegram keys a
// private dialog by its peer (Telegram-Android DialogObject.getPeerDialogId :71-82, ChatActivity :2780
// `dialog_id = userId`). The same rules as Android's DirectChatPair (ec0a4aa).
export type PairLookup =
  // The pair's 1:1, under whatever id it was made with (an older one is a random UUID).
  | { kind: 'named'; chatId: string }
  // The two have no 1:1: a first message makes it under directChatId.
  | { kind: 'none' }
  // Not read (offline) or not understood: the device's own rooms answer instead, as before.
  | { kind: 'unreadable' }

export function directPairPath(a: string, b: string): string { return `${documents}/directChatPairs/${directChatId(a, b)}` }

export function pairLookup(doc: FirestoreDocument | null, a: string, b: string): PairLookup {
  if (!doc) return { kind: 'none' }
  const fields = doc.fields ?? {}
  let chatId: string
  try { chatId = stringField(fields, 'chatId', 200) } catch { return { kind: 'unreadable' } }
  if (!/^[A-Za-z0-9_-]{1,160}$/.test(chatId)) return { kind: 'unreadable' }
  const values = (fields.participantUids?.arrayValue as { values?: WireObject[] } | undefined)?.values ?? []
  const members = values.map(value => typeof value.stringValue === 'string' ? value.stringValue : null)
  return members.length === 2 && a !== b && members.includes(a) && members.includes(b) ? { kind: 'named', chatId } : { kind: 'unreadable' }
}

// A read that failed. The server lets only the two people read their pair (rules v4.8.23 firestore.rules:1146-1149,
// `uid() in resource.data.participantUids`), so a pair with no document answers PERMISSION_DENIED rather than
// not-found: a stranger cannot learn from two uids whether they ever talked. That refusal is «none»; anything else
// (offline, an expired sign-in) leaves it to the device. An old room the document missed is still caught by the
// refusal of the first message (DIRECT_CHAT_EXISTS), which moves it there.
export function pairReadFailed(error: unknown): PairLookup {
  return error instanceof ReadFailure && error.code === 'permission' && error.reason.startsWith('PERMISSION_DENIED') ? { kind: 'none' } : { kind: 'unreadable' }
}

type PairDialog = Pick<DialogSummary, 'kind' | 'participantUids'>
// The same two people's 1:1 in this account's list.
export function isPairDialog(dialog: PairDialog | undefined, uid: string, peerUid: string): boolean {
  return Boolean(dialog && dialog.kind === 'direct' && dialog.participantUids.length === 2 &&
    dialog.participantUids.includes(uid) && dialog.participantUids.includes(peerUid))
}

// The room that opens for the person, from what the document said and this account's list; null: none yet, the first
// message makes it under directChatId. With no document it is the `direct_` room, never another room this device
// happens to hold. Only when the document cannot be read does the list answer, as before. A named room the list does
// not hold is left to the list too: a room the window has no dialog for cannot be opened, and a first message sent
// beside it is moved there when the server refuses it.
export function pairRoom(lookup: PairLookup, uid: string, peerUid: string, dialogs: ReadonlyMap<string, PairDialog>): string | null {
  if (lookup.kind === 'named' && isPairDialog(dialogs.get(lookup.chatId), uid, peerUid)) return lookup.chatId
  if (lookup.kind === 'none') { const chatId = directChatId(uid, peerUid); return isPairDialog(dialogs.get(chatId), uid, peerUid) ? chatId : null }
  for (const [id, dialog] of dialogs) if (isPairDialog(dialog, uid, peerUid)) return id
  return null
}

// B97 §32 (user «즉시 열기 권장대로» 10-03 20:5x; Telegram opens a peer's chat from what the device holds): a 1:1 this
// account's list already holds opens at once and the document is read afterwards. The room the document names instead,
// when the list holds it as the same two people's 1:1, is where the window goes; null leaves it where it is — the
// document agreeing, naming nothing, or not read.
export function pairCorrection(held: string, lookup: PairLookup, uid: string, peerUid: string, dialogs: ReadonlyMap<string, PairDialog>): string | null {
  return lookup.kind === 'named' && lookup.chatId !== held && isPairDialog(dialogs.get(lookup.chatId), uid, peerUid) ? lookup.chatId : null
}

// B104: the window moves to remember once another chat is open: only one still made for the chat on screen.
export function settledMoves<T>(moves: ReadonlyMap<string, T>, openChatId: string): Map<string, T> {
  return new Map([...moves].filter(([chatId]) => chatId === openChatId))
}
