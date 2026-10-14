import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react'
import type { DesktopSnapshot } from '../../../shared/model'
import { commentCountView, nudgeCommentCount, type ChannelOperationItem, type ChannelOperationRequest, type CommentCountNudge } from '../../../shared/channel-operations'
import { useDesktop } from '../app/store'
import { controller } from '../app/ui'
import { errorText } from '../app/format'
import { trackWrite } from '../app/drafts'
import { tr } from '../../../shared/i18n'

// What the device queue holds for channel posts and comments (main/accounts/channel-operations.ts), drawn as already
// done, as Telegram draws an action the moment it is taken: the heart as last chosen, the words as last written, a
// deleted post or comment gone. A confirmed one stays drawn a few seconds more, until the screens' copies show it; one
// the queue lets go otherwise (the post is gone, or a refusal reported) gives the post back to the server's copy.
const none: ChannelOperationItem[] = []
const same = (a: ChannelOperationItem[], b: ChannelOperationItem[]): boolean => a.length === b.length &&
  a.every((item, index) => { const other = b[index]!; return item.id === other.id && item.state === other.state && item.reason === other.reason })

export function useChannelOperations(accountUid: string, channelId: string | null): ChannelOperationItem[] {
  const select = useCallback((snapshot: DesktopSnapshot | null) => {
    if (!snapshot || snapshot.activeAccountUid !== accountUid) return none
    const items = channelId ? snapshot.channelOperations.filter(item => item.channelId === channelId) : snapshot.channelOperations
    return items.length ? items : none
  }, [accountUid, channelId])
  return useDesktop(select, same)
}
export { likeView, editView, removedPosts, removedComments } from '../../../shared/channel-operations'
// B373 S2: this device's comment sends and deletes, per post, until the server's count moves (commentCountView).
const nudges = new Map<string, CommentCountNudge>(), nudgeListeners = new Set<() => void>()
const nudgeKey = (accountUid: string, channelId: string, postId: string): string => `${accountUid}/${channelId}/${postId}`
export function nudgeComments(accountUid: string, channelId: string, postId: string, server: number | null, delta: 1 | -1): void {
  if (server === null) return
  const key = nudgeKey(accountUid, channelId, postId)
  nudges.set(key, nudgeCommentCount(nudges.get(key), server, delta, Date.now()))
  for (const listener of nudgeListeners) listener()
  // Drawn again once the nudge has run out, so a count the server never moved goes back to the server's.
  setTimeout(() => { for (const listener of nudgeListeners) listener() }, 15100)
}
let nudgeVersion = 0
nudgeListeners.add(() => { nudgeVersion++ })
const subscribeNudges = (listener: () => void): (() => void) => { nudgeListeners.add(listener); return () => { nudgeListeners.delete(listener) } }
// A screen that shows comment counts draws again when a nudge starts or runs out.
export function useCommentNudges(): number { return useSyncExternalStore(subscribeNudges, () => nudgeVersion) }
export function commentCountFor(accountUid: string, channelId: string, postId: string, server: number | null): number | null {
  return commentCountView(server, nudges.get(nudgeKey(accountUid, channelId, postId)), Date.now())
}
export function enqueueChannelOperation(accountUid: string, request: ChannelOperationRequest): Promise<void> {
  return trackWrite(window.morse.enqueueChannelOperation(accountUid, request)).then(() => {}, reason => {
    controller.toast(errorText(reason, tr('변경을 시작하지 못했습니다.')), 'error')
  })
}

// A change the server refused, told once wherever the person is: a like, a delete or a comment delete is let go at once,
// so the screens show the server's copy again; refused words stay with their post until kept or let go.
export function useChannelOperationNotices(accountUid: string | null): void {
  const items = useChannelOperations(accountUid ?? '', null)
  const told = useRef(new Set<string>())
  useEffect(() => {
    if (!accountUid) return
    for (const item of items) {
      if (item.state !== 'failed' || told.current.has(item.id)) continue
      told.current.add(item.id)
      const what = item.kind === 'post-like' ? tr('좋아요를 반영하지 못했습니다.') : item.kind === 'post-text' ? tr('게시물 수정을 반영하지 못했습니다.')
        : item.kind === 'post-delete' ? tr('게시물을 삭제하지 못했습니다.') : tr('댓글을 삭제하지 못했습니다.')
      controller.toast(item.reason ? `${what} ${item.reason}` : what, 'error')
      if (item.kind !== 'post-text') void window.morse.discardChannelOperation(accountUid, item.id).catch(() => {})
    }
  }, [accountUid, items])
}
