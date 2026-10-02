// B49 (Telegram: a contact whose chat left the list goes to contactsNoChatsList, data_session.cpp:5771-5775, and the
// chat-list search shows that list too, dialogs_inner_widget.cpp:4335): searching the chat list also finds the people
// with no row in it — a 1:1 that left the list (nothing left after a delete for everyone, or hidden here), contact or
// not, and a contact with no 1:1 at all. Each person once; a row of the list or a new chat already shown wins.
export interface UnlistedDirect { chatId: string; peerUid: string; title: string }
export interface NoChatPerson { uid: string; title: string; chatId: string | null }
export function peopleWithoutRows(input: {
  matches(title: string): boolean
  listedPeers: ReadonlySet<string>
  pendingPeers: ReadonlySet<string>
  unlisted: readonly UnlistedDirect[]
  contacts: readonly { uid: string; name: string }[]
  self: string
}, limit = 50): NoChatPerson[] {
  const out: NoChatPerson[] = [], seen = new Set<string>([...input.listedPeers, ...input.pendingPeers, input.self])
  for (const room of input.unlisted) {
    if (seen.has(room.peerUid) || !input.matches(room.title)) continue
    seen.add(room.peerUid); out.push({ uid: room.peerUid, title: room.title, chatId: room.chatId })
  }
  for (const contact of input.contacts) {
    if (seen.has(contact.uid) || !contact.name || !input.matches(contact.name)) continue
    seen.add(contact.uid); out.push({ uid: contact.uid, title: contact.name, chatId: null })
  }
  return out.slice(0, limit)
}
