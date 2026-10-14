// Telegram R-66 (history_widget.cpp:8481-8482, 8532-8533): when the area above the composer gets shorter — the
// composer grows a line, a reply or edit bar opens — a chat that was at its bottom is scrolled to its bottom again; one
// scrolled up keeps its place. Returns the new height, the one the next resize is compared with.
export interface ScrollBox { readonly clientHeight: number; readonly scrollHeight: number; scrollTop: number }
export function keepBottomOnResize(box: ScrollBox, previousHeight: number, atBottom: boolean): number {
  const height = box.clientHeight
  if (atBottom && height < previousHeight) box.scrollTop = box.scrollHeight
  return height
}
// B184: only a window that reaches the newest message follows its bottom. One read down from a jump is at its
// bottom only until the next page comes, and that page is added below with the view kept where it is — tdesktop's
// loadMessagesDown adds rows and scrolls nowhere until the history is loadedAtBottom (history_widget.cpp:4990-5001).
export function followsBottom(distance: number, newerAvailable: boolean): boolean {
  return distance < 80 && !newerAvailable
}
// B307 (tdesktop HistoryWidget::updateListSize, history_widget.cpp:8661-8713): when the list changes with nothing asked
// of the scroll — a message grows by a reaction shown at once, shrinks by one taken back — a history followed at its
// bottom is put at its bottom in the same pass; one read away from it keeps its place.
export function keepsBottomOnChange(asked: boolean, atBottom: boolean, settled: boolean): boolean {
  return !asked && atBottom && settled
}
// B372: the end of a list with no paging of its own (the 1:1 inquiry room), by the chat history's rule above. Read at its
// bottom (followsBottom) it follows what is added at its end and what grows; a send from here takes it there (tdesktop
// MessageSent → scrollTopMax, history_widget.cpp:846-847); read further up, a message that arrives keeps the place, and
// «최근 메시지로 이동» stays (historyToDown).
export class EndFollower {
  private atBottom = true
  private sent = 0
  // The reading place after a scroll; returns how far the bottom is.
  scrolled(box: ScrollBox): number {
    const distance = box.scrollHeight - box.scrollTop - box.clientHeight
    this.atBottom = followsBottom(distance, false)
    return distance
  }
  // The list changed at its end; `sending` counts this device's messages still on their way, so a new one is a send.
  changed(box: ScrollBox, sending: number): void {
    if (sending > this.sent) this.atBottom = true
    this.sent = sending
    this.follow(box)
  }
  // A message grew or a picture was measured.
  follow(box: ScrollBox): void { if (keepsBottomOnChange(false, this.atBottom, true)) box.scrollTop = box.scrollHeight }
  toBottom(box: ScrollBox): void { this.atBottom = true; this.follow(box) }
}
