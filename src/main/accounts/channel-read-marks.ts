import { comparePosition, type MessagePosition } from '../../shared/model'

// iOS MorseChannelPostReadMarks (docs/read-history-push-contract-2026-09-22.md §5, §7): a channel's posts are read
// where they are shown, apart from its discussion room, as Telegram keeps a channel apart from its discussion group.
// The furthest post seen in a channel is written to users/{uid}/channelReadMarks/{channelId}; the server takes the
// covered post copies out of the room's unread count and tells the account's other devices. Only forward, only for a
// channel this account has joined, never for its own posts.
export interface SeenPost { id: string; position: MessagePosition; own: boolean }
type Write = (channelId: string, position: MessagePosition, postId: string) => Promise<void>

export class ChannelReadMarks {
  // The furthest post handed to the server per channel in this session, so an older one is not written again.
  private readonly marks = new Map<string, MessagePosition>()
  private closed = false
  constructor(private readonly write: Write) {}

  // The posts of one channel now on screen; the furthest of them that is someone else's moves the mark.
  seen(channelId: string, posts: SeenPost[], joined: boolean): boolean {
    if (this.closed || !joined) return false
    const furthest = posts.filter(post => !post.own).sort((a, b) => comparePosition(b.position, a.position))[0]
    if (!furthest) return false
    const known = this.marks.get(channelId)
    if (known && comparePosition(furthest.position, known) <= 0) return false
    this.marks.set(channelId, furthest.position)
    // A refused write (another device read further; the rules keep the mark) or a lost one is let go; the next
    // post seen after it is tried again.
    void this.write(channelId, furthest.position, furthest.id).catch(() => {
      if (this.marks.get(channelId) === furthest.position) { if (known) this.marks.set(channelId, known); else this.marks.delete(channelId) }
    })
    return true
  }
  close(): void { this.closed = true; this.marks.clear() }
}
