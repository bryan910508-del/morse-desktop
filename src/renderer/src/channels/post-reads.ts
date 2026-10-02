import { useEffect, type RefObject } from 'react'

// Telegram reads what its list shows — an item any part of which is on screen (ListView immediateDisplayedItemRange) —
// and only while it can read history: the app active and the list on screen (ChatHistoryListNode canReadHistory).
// iOS MorseChannelFeedReadTracker does the same for channel posts. The posts inside `container` that carry
// data-channel-id and data-post-id are watched; those on screen go to the main process, which moves each channel's
// read mark to the furthest of them.
// B60 (Telegram MainWindow::markingAsRead needs no layer shown, mainwindow.cpp:597-606; HistoryInner reads nothing
// where its content is overlapped, history_inner_widget.cpp:1410-1416): a post under a box, the post viewer, a menu or
// the side panel is not seen. An overlay that holds the feed itself (the side panel showing the channel) does not count.
export const readCoveringSelector = '.layer, .channel-viewer, .popup-menu, .main-menu-layer, .third-layer'
interface Box { getBoundingClientRect(): { left: number; top: number; right: number; bottom: number }; contains(other: unknown): boolean }
export function postUncovered(post: Box, feed: Box, overlays: Iterable<Box>, hit: (x: number, y: number) => unknown, viewport: { width: number; height: number }): boolean {
  for (const overlay of overlays) if (!overlay.contains(feed)) return false
  // A point in the part of the post that is on screen must be the post itself (the chat read's elementFromPoint).
  const r = post.getBoundingClientRect()
  const top = Math.max(r.top, 0), bottom = Math.min(r.bottom, viewport.height), left = Math.max(r.left, 0), right = Math.min(r.right, viewport.width)
  if (bottom <= top || right <= left) return false
  return post.contains(hit((left + right) / 2, (top + bottom) / 2))
}

export function usePostReads(accountUid: string, container: RefObject<HTMLElement | null>, ready: boolean): void {
  useEffect(() => {
    const element = container.current
    if (!element || !ready) return
    const visible = new Map<Element, { channelId: string; postId: string }>()
    let timer: ReturnType<typeof setTimeout> | undefined
    const report = (): void => {
      clearTimeout(timer)
      timer = setTimeout(() => {
        if (document.visibilityState !== 'visible' || !document.hasFocus() || !visible.size) return
        const overlays = [...document.querySelectorAll(readCoveringSelector)], viewport = { width: innerWidth, height: innerHeight }
        const byChannel = new Map<string, Set<string>>()
        let covered = false
        for (const [node, { channelId, postId }] of visible) {
          if (!postUncovered(node, element, overlays, (x, y) => document.elementFromPoint(x, y), viewport)) { covered = true; continue }
          byChannel.set(channelId, (byChannel.get(channelId) ?? new Set()).add(postId))
        }
        // Looked at again once whatever covers it may have gone.
        if (covered) { clearTimeout(timer); timer = setTimeout(report, 1000) }
        for (const [channelId, ids] of byChannel) void window.morse.channelPostsSeen(accountUid, channelId, [...ids].slice(0, 50)).catch(() => {})
      }, 400)
    }
    // Clipping by the scrolling list counts: only what is really on screen intersects the viewport.
    const observer = new IntersectionObserver(entries => {
      for (const entry of entries) {
        const target = entry.target as HTMLElement, channelId = target.dataset.channelId, postId = target.dataset.postId
        if (entry.isIntersecting && channelId && postId) visible.set(target, { channelId, postId }); else visible.delete(target)
      }
      report()
    }, { threshold: 0 })
    const watch = (): void => { element.querySelectorAll('[data-channel-id][data-post-id]').forEach(node => observer.observe(node)) }
    watch()
    const mutations = new MutationObserver(() => {
      for (const node of [...visible.keys()]) if (!node.isConnected) { visible.delete(node); observer.unobserve(node) }
      watch()
    })
    mutations.observe(element, { childList: true, subtree: true })
    window.addEventListener('focus', report); document.addEventListener('visibilitychange', report)
    return () => {
      clearTimeout(timer); observer.disconnect(); mutations.disconnect()
      window.removeEventListener('focus', report); document.removeEventListener('visibilitychange', report)
    }
  }, [accountUid, container, ready])
}
