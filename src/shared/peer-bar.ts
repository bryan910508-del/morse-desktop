// B52 (Telegram R-64, HistoryWidget's «unknown person» bar — ContactStatus: Block · Add contact · ×): a 1:1 the other
// person opened, while they are not a contact, not blocked, not withdrawn and the bar has not been closed. A room
// without createdBy (made before the field) never shows it: who wrote first is not known there. Answering does not
// hide it; adding the contact, blocking or closing it does — closing on every device of the account
// (users/{me}/settings/peerBar_{peer}).
export interface PeerBarFacts {
  accountUid: string
  chatId: string
  kind: 'direct' | 'group' | 'secret'
  createdBy?: string
  peerUid: string | null
  peerDeleted?: boolean
  // null while not known yet: the bar waits rather than flashing.
  contact: boolean | null
  blocked: boolean | null
  hidden: boolean | null
}
export function peerBarShown(facts: PeerBarFacts): boolean {
  const peer = facts.peerUid
  return facts.kind === 'direct' && Boolean(peer) && peer !== facts.accountUid && !facts.chatId.startsWith('memo_') && facts.createdBy === peer
    && !facts.peerDeleted && facts.contact === false && facts.blocked === false && facts.hidden === false
}
// Whether the bar's setting is worth reading at all: everything else already says it would be shown.
export function peerBarWorthAsking(facts: PeerBarFacts): boolean { return peerBarShown({ ...facts, hidden: false }) }
