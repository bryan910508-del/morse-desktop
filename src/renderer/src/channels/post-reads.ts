import { useEffect, type RefObject } from 'react'

// Telegram reads what its list shows — an item any part of which is on screen (ListView immediateDisplayedItemRange) —
// and only while it can read history: the app active and the list on screen (ChatHistoryListNode canReadHistory).
// iOS MorseChannelFeedReadTracker does the same for channel posts. The posts inside `container` that carry
// data-channel-id and data-post-id are watched; those on screen go to the main process, which moves each channel's
// read mark to the furthest of them.
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
        const byChannel = new Map<string, Set<string>>()
        for (const { channelId, postId } of visible.values()) byChannel.set(channelId, (byChannel.get(channelId) ?? new Set()).add(postId))
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
