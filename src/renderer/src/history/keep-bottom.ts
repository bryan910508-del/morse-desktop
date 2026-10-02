// Telegram R-66 (history_widget.cpp:8481-8482, 8532-8533): when the area above the composer gets shorter — the
// composer grows a line, a reply or edit bar opens — a chat that was at its bottom is scrolled to its bottom again; one
// scrolled up keeps its place. Returns the new height, the one the next resize is compared with.
export interface ScrollBox { readonly clientHeight: number; readonly scrollHeight: number; scrollTop: number }
export function keepBottomOnResize(box: ScrollBox, previousHeight: number, atBottom: boolean): number {
  const height = box.clientHeight
  if (atBottom && height < previousHeight) box.scrollTop = box.scrollHeight
  return height
}
