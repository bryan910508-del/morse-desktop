import { useSyncExternalStore } from 'react'
import { controller } from '../app/ui'

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

// The 1:1 inquiry in the third column: the owner's list (thread null) or one room.
let inquiry: { channelId: string; thread: string | null; fromList: boolean } | null = null
export function openInquiries(channelId: string, thread: string | null): void {
  inquiry = { channelId, thread, fromList: thread === null }
  for (const listener of [...listeners]) listener()
  controller.setRight('inquiry')
}
export function showInquiryThread(channelId: string, thread: string | null): void {
  if (inquiry?.channelId !== channelId) return
  inquiry = { ...inquiry, thread }
  for (const listener of [...listeners]) listener()
}
export function useInquiryTarget(channelId: string): { channelId: string; thread: string | null; fromList: boolean } | null {
  const value = useSyncExternalStore(subscribe, () => inquiry)
  return value?.channelId === channelId ? value : null
}
