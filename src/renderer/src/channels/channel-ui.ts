import { useSyncExternalStore } from 'react'
import { controller, ui, useUi, type InquiryTarget } from '../app/ui'

// The post whose comments fill the third column (Telegram's replies section).
let target: { channelId: string; postId: string } | null = null
const listeners = new Set<() => void>()
const subscribe = (listener: () => void): (() => void) => { listeners.add(listener); return () => { listeners.delete(listener) } }

export function openComments(channelId: string, postId: string): void {
  target = { channelId, postId }
  for (const listener of [...listeners]) listener()
  controller.setRight('comments')
}

export function useCommentsPost(channelId: string): string | null {
  const value = useSyncExternalStore(subscribe, () => target)
  return value?.channelId === channelId ? value.postId : null
}

// The 1:1 inquiry the window holds: the owner's list (thread null) or one room. It lives in the window
// state, not here, because a chat list row opens a room with no channel screen behind it.
export function openInquiries(channelId: string, thread: string | null): void { controller.openChannelInquiry(channelId, thread) }
export function showInquiryThread(channelId: string, thread: string | null): void {
  if (ui().inquiry?.channelId === channelId) controller.setInquiryThread(thread)
}
export function useInquiryTarget(channelId: string): InquiryTarget | null {
  return useUi(state => state.inquiry?.channelId === channelId ? state.inquiry : null)
}
