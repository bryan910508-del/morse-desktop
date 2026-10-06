// Portions of this file follow Telegram Desktop (https://github.com/telegramdesktop/tdesktop, 7.2.8, 272f6f5c),
// Copyright (c) 2014-2026 The Telegram Desktop Authors. Licensed under GPL-3.0-or-later; see LEGAL.
import type { DialogSummary, MessagePosition } from '../../shared/model'
import { comparePosition } from '../../shared/model'

// B165: the row's newest message, decided on this device when that message goes — tdesktop's
// Histories::deleteMessages destroys the item in the same pass as the request and, when it was the row's message,
// asks History::requestChatListMessage (data_histories.cpp:1019-1030), which takes the newest message it still
// holds (history.cpp:227-235). The room document's lastMessage is the server's and arrives some seconds later
// (B165: 12 s); until it does, the row shows what this device knows. Whatever the server writes next is taken as
// it comes — the line it had when the message went is what says it has not written yet — so nothing is taken away
// twice (contract B163 §3-2).
export interface ChatListTop { preview: string; top: MessagePosition | null }
type Server = { preview: string; top: MessagePosition | null }

const samePosition = (a: MessagePosition | null, b: MessagePosition | null): boolean =>
  a === null || b === null ? a === b : comparePosition(a, b) === 0

export class ChatListTops {
  private readonly server = new Map<string, Server>()
  private readonly local = new Map<string, { from: Server; next: ChatListTop }>()

  // In the list's rebuild, on each row as the room document gives it, before anything of this device's own.
  // Whether this device's own line stands in for the server's.
  apply(summary: DialogSummary): boolean {
    const server = { preview: summary.preview, top: summary.top }
    this.server.set(summary.id, server)
    const local = this.local.get(summary.id)
    if (!local) return false
    if (local.from.preview !== server.preview || !samePosition(local.from.top, server.top)) { this.local.delete(summary.id); return false }
    summary.preview = local.next.preview
    summary.top = local.next.top
    return true
  }
  // The row's message went from this device: `next` is the newest one it still holds, or null when the room has none.
  replace(chatId: string, next: { preview: string; position: MessagePosition } | null): boolean {
    const server = this.server.get(chatId)
    if (!server) return false
    // A row without a message keeps its place in the list (tdesktop leaves the chat where it was until it knows more).
    this.local.set(chatId, { from: server, next: next ? { preview: next.preview, top: { ...next.position, id: server.top?.id ?? chatId } } : { preview: '', top: server.top } })
    return true
  }
  // Rooms no longer in the list keep nothing.
  prune(keep: (chatId: string) => boolean): void {
    for (const id of [...this.server.keys()]) if (!keep(id)) { this.server.delete(id); this.local.delete(id) }
  }
}

// B163 ④: the row's message has passed its deleteAt (lastMessageDeleteAt) — tdesktop destroys it in checkTTLs and the row
// takes the newest message left (data_session.cpp:3218-3235, history.cpp:227-235). Known here only from the open
// history with its newest page read (its copy has already dropped what expired); otherwise the row shows no line until
// the server writes the room again. tdesktop asks the server for that row then (requestChatListMessage) — Desktop waits.
export function expiredTop(summary: DialogSummary, expiresAt: number | undefined, now: number,
  open: { messages: readonly { position: MessagePosition; text: string }[]; newerAvailable: boolean; ready: boolean; preview(index: number): string } | null): boolean {
  if (expiresAt === undefined || expiresAt > now) return false
  const last = open && open.ready && !open.newerAvailable ? open.messages.length - 1 : -1
  const next = last >= 0 ? open!.messages[last]! : null
  if (next && summary.top && comparePosition({ ...next.position, id: summary.top.id }, summary.top) < 0) {
    summary.preview = open!.preview(last)
    summary.top = { ...next.position, id: summary.top.id }
  } else summary.preview = ''
  return true
}
