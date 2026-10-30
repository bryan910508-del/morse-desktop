import type { DialogSummary } from '../../shared/model'
import { compareReadCursor, type ReadCursor } from '../../shared/read-receipts'

// B467d: in a 1:1, the other person reading what this account sent is their activity, as B467 takes a message they
// sent. TI .ReadOutbox → recordPeerActivityTimestamp for a CloudUser (AccountStateManagementUtils.swift:4740-4744), at
// the moment the read arrives; tdesktop updateReadHistoryOutbox → madeAction(unixtime::now()) while not catching up
// (api_updates.cpp:1378-1389). The moment is when a live snapshot brings the move: the cursor's own time is the read
// message's (lastReadAt = the target's createdAt, morse-read-marker.js), not the reading's. The first snapshot of a
// listen, or of a listen started again, brings what was read meanwhile, so it only sets where each one is. Groups,
// secret chats (TI: CloudUser only) and the service chat are left out; inquiries are not on this list.
export class PeerReadActivity {
  // Chat id → where its other person had read as far as the list knows (null: not yet).
  private readonly cursors = new Map<string, ReadCursor | null>()
  constructor(private readonly uid: string, private readonly seen: (peerUid: string, at: number) => void, private readonly now: () => number) {}

  observe(dialogs: Iterable<DialogSummary>, first: boolean): void {
    const listed = new Set<string>()
    let at: number | null = null
    for (const dialog of dialogs) {
      if (dialog.kind !== 'direct' || dialog.service) continue
      const peers = dialog.participantUids.filter(id => id !== this.uid), peer = peers[0]
      if (peers.length !== 1 || !peer) continue
      const cursor = dialog.readPositions[peer] ?? null
      listed.add(dialog.id)
      const known = this.cursors.has(dialog.id), before = this.cursors.get(dialog.id) ?? null
      this.cursors.set(dialog.id, cursor)
      if (first || !known || !cursor || (before && compareReadCursor(cursor, before) <= 0)) continue
      at ??= this.now()
      this.seen(peer, at)
    }
    for (const id of this.cursors.keys()) if (!listed.has(id)) this.cursors.delete(id)
  }
}
