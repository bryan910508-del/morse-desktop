import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Copy, Reply, Send, Trash2, X } from 'lucide-react'
import type { ChannelCommentItem } from '../../../shared/channel-comments'
import type { CommentDraftRecord, CommentReplyTarget } from '../../../shared/channel-comment-drafts'
import { channelCommentRemoval } from '../../../shared/channel-comment-removal'
import { composingKey } from '../../../shared/shortcuts'
import { useDesktop } from '../app/store'
import { controller } from '../app/ui'
import { errorText, messageTime, positionTime, serviceDate } from '../app/format'
import { copyText } from '../app/clipboard'
import { draftFlushers } from '../app/drafts'
import { DraftWriter } from '../app/channel-drafts'
import { publishComment } from '../app/channel-publish'
import { Spinner } from '../ui/controls'
import { confirmBox } from '../ui/layers'
import { popupMenu, pointFor } from '../ui/popup-menu'
import { arrangeComments } from './channel-comment-display'
import type { ChannelSurface } from './channel-media-viewer'
import { reportResult } from './channel-section'
import { UserAvatar } from '../ui/user-avatar'
import { locale, tr } from '../../../shared/i18n'

interface ReplySelection extends CommentReplyTarget { author: string }
interface ThreadPost { id: string; revision: string; commentCount: number | null }

function CommentComposer({ accountUid, channelId, postId, surface, reply, authorOf, onReply }: {
  accountUid: string; channelId: string; postId: string; surface: ChannelSurface; reply: ReplySelection | null; authorOf(id: string): string; onReply(value: ReplySelection | null): void
}) {
  const enterToSend = useDesktop(snapshot => snapshot?.preferences.enterToSend ?? true)
  const [text, setText] = useState(''), [loaded, setLoaded] = useState(false), [sending, setSending] = useState(false)
  const field = useRef<HTMLTextAreaElement>(null)
  const latest = useRef(''), dirty = useRef(false), timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const stored = useRef<CommentReplyTarget | null>(null)
  const preview = surface === 'public-preview' ? { surface: 'public-preview' as const } : {}
  const writer = useMemo(() => new DraftWriter<CommentDraftRecord>(() => window.morse.readCommentDraft(accountUid, { channelId, postId }),
    (expected, revision) => window.morse.saveCommentDraft(accountUid, { channelId, postId, text: latest.current, expected, revision })), [accountUid, channelId, postId])
  const flush = useCallback(async (): Promise<void> => {
    clearTimeout(timer.current)
    if (!dirty.current) return
    dirty.current = false
    try { await writer.save() } catch (error) { dirty.current = true; throw error }
  }, [writer])
  useEffect(() => {
    let alive = true
    void writer.load().then(record => {
      if (!alive) return
      stored.current = record.parent
      if (!dirty.current) { latest.current = record.text; setText(record.text) }
      if (record.parent) onReply({ ...record.parent, author: authorOf(record.parent.id) })
    }).catch(() => {}).finally(() => { if (alive) setLoaded(true) })
    draftFlushers.add(flush)
    return () => { alive = false; draftFlushers.delete(flush); void flush().catch(() => {}) }
  }, [writer, flush])
  // The reply target is part of the stored draft (selectCommentDraftParent).
  useEffect(() => {
    if (!loaded) return
    const next = reply ? { id: reply.id, revision: reply.revision } : null
    if (stored.current?.id === next?.id && stored.current?.revision === next?.revision) return
    stored.current = next
    void flush().catch(() => {})
    void writer.change((expected, revision) => window.morse.selectCommentDraftParent(accountUid, { ...preview, channelId, postId, expected, revision, parent: next }))
      .catch(reason => controller.toast(errorText(reason, tr('답글 대상을 저장하지 못했습니다.')), 'error'))
    field.current?.focus({ preventScroll: true })
  }, [loaded, reply?.id, reply?.revision])
  useLayoutEffect(() => {
    const element = field.current
    if (!element) return
    element.style.height = 'auto'
    element.style.height = `${Math.min(160, element.scrollHeight)}px`
  }, [text])
  function change(next: string): void {
    latest.current = next; dirty.current = true; setText(next)
    clearTimeout(timer.current)
    timer.current = setTimeout(() => { void flush().catch(() => {}) }, 300)
  }
  async function send(): Promise<void> {
    const content = latest.current
    if (sending || !loaded || !content.trim()) return
    setSending(true)
    clearTimeout(timer.current); dirty.current = false
    try {
      const saved = await writer.save()
      if (!saved.revision) throw new Error(tr('초안을 저장하지 못했습니다.'))
      latest.current = ''; setText('')
      const result = await publishComment(accountUid, { ...preview, channelId, postId, text: saved.text, draftRevision: saved.revision, parent: saved.parent })
      if (result === 'unconfirmed') controller.toast(tr('댓글 등록 결과를 확인하고 있습니다. 잠시 후 댓글을 확인해 주세요.'))
      const record = await writer.load()
      if (result === 'done' && record.parent) onReply(null)
    } catch (reason) {
      if (!latest.current) { latest.current = content; setText(content) }
      controller.toast(errorText(reason, tr('댓글을 등록하지 못했습니다.')), 'error')
      await writer.load().catch(() => {})
    } finally { setSending(false); field.current?.focus({ preventScroll: true }) }
  }
  return <div className="compose">
    {reply && <div className="compose-bar"><Reply size={20} className="compose-bar-icon" /><div className="compose-bar-text"><strong>{tr('{0}에게 답글', [reply.author])}</strong></div>
      <button className="icon-button small" aria-label={tr('답글 취소')} disabled={sending} onClick={() => onReply(null)}><X size={18} /></button></div>}
    <div className="compose-row">
      <textarea ref={field} className="compose-field" rows={1} value={text} maxLength={1000} disabled={!loaded || sending} placeholder={tr('댓글 남기기')} aria-label={tr('댓글 작성')}
        onChange={event => change(event.target.value)} onBlur={() => { void flush().catch(() => {}) }}
        onKeyDown={event => {
          if (event.key !== 'Enter' || composingKey(event.nativeEvent)) return
          const modifier = event.metaKey || event.ctrlKey
          if (enterToSend ? !event.shiftKey && !modifier && !event.altKey : modifier) { event.preventDefault(); void send() }
        }} />
      <button className="compose-send" aria-label={tr('댓글 등록')} disabled={!loaded || sending || !text.trim()} onClick={() => { void send() }}>{sending ? <Spinner size={18} /> : <Send size={20} />}</button>
    </div>
  </div>
}

// Replies of one post with the reply composer; used by the channel column and the public preview.
export function CommentsThread({ accountUid, channelId, requestId, post, surface }: { accountUid: string; channelId: string; requestId: string; post: ThreadPost; surface: ChannelSurface }) {
  const [selectionId, setSelectionId] = useState<string | null>(null)
  const [reply, setReply] = useState<ReplySelection | null>(null)
  const postId = post.id, revision = post.revision
  useEffect(() => {
    const id = crypto.randomUUID()
    setSelectionId(id)
    const request = { selectionId: id, requestId, channelId, postId, revision }
    void (surface === 'public-preview' ? window.morse.openPublicPreviewComments(accountUid, request) : window.morse.openChannelComments(accountUid, request))
      .catch(reason => controller.toast(errorText(reason, tr('댓글을 불러오지 못했습니다.')), 'error'))
    return () => { void (surface === 'public-preview' ? window.morse.closePublicPreviewComments(accountUid, id) : window.morse.closeChannelComments(accountUid, id)).catch(() => {}) }
  }, [accountUid, channelId, postId, requestId, revision, surface])
  const snapshot = useDesktop(state => { const value = surface === 'public-preview' ? state?.channelPublicPreview?.comments : state?.channels?.posts?.comments; return value && value.selectionId === selectionId ? value : null })
  const last = useRef<ChannelCommentItem[] | null>(null)
  if (snapshot?.status === 'ready') last.current = snapshot.items
  const items = snapshot?.status === 'ready' ? snapshot.items : last.current
  const rows = useMemo(() => arrangeComments(items ?? [], 'threads').rows, [items])
  const authorOf = (id: string): string => items?.find(item => item.id === id)?.authorName ?? tr('원댓글')

  function replyTo(item: ChannelCommentItem): void {
    if (item.parent !== 'none' && item.parent !== 'present') return
    const root = item.parent === 'none' ? item : items?.find(candidate => candidate.id === item.parentId && candidate.parent === 'none')
    if (!root) { controller.toast(tr('원댓글을 찾을 수 없습니다.')); return }
    setReply({ id: root.id, revision: root.revision, author: item.authorName })
  }
  async function remove(item: ChannelCommentItem): Promise<void> {
    if (!selectionId || snapshot?.status !== 'ready') return
    let request
    try { request = channelCommentRemoval({ id: crypto.randomUUID(), selectionId, requestId, channelId, postId, revision, commentId: item.id, commentRevision: item.revision, text: item.text, count: snapshot.items.length }) }
    catch (reason) { controller.toast(errorText(reason, tr('댓글 목록을 다시 확인해 주세요.')), 'error'); return }
    if (!await confirmBox({ title: tr('댓글 삭제'), text: tr('이 댓글을 삭제할까요?'), confirm: tr('삭제'), danger: true })) return
    reportResult(surface === 'public-preview' ? window.morse.removePublicPreviewComment(accountUid, request) : window.morse.removeChannelComment(accountUid, request), tr('댓글을 삭제했습니다.'))
  }
  const openMenu = (item: ChannelCommentItem, point: { x: number; y: number }): void => {
    const removable = item.own && snapshot?.status === 'ready' && post.commentCount === snapshot.items.length
    popupMenu.open(point, [
      item.parent === 'none' || item.parent === 'present' ? { label: tr('답글'), icon: <Reply size={18} />, onSelect: () => replyTo(item) } : null,
      item.text ? { label: tr('텍스트 복사'), icon: <Copy size={18} />, onSelect: () => { const copied = copyText(item.text); controller.toast(copied ? tr('텍스트를 복사했습니다.') : tr('텍스트를 복사하지 못했습니다.'), copied ? 'default' : 'error') } } : null,
      removable ? 'separator' : null,
      removable ? { label: tr('삭제'), icon: <Trash2 size={18} />, danger: true, onSelect: () => { void remove(item) } } : null
    ])
  }

  return <>
    <div className="channel-comments-list">
      {!items ? <div className="empty-state">{snapshot && snapshot.status !== 'loading' ? snapshot.message || tr('댓글을 불러오지 못했습니다.') : <Spinner size={22} />}</div>
        : !rows.length ? <div className="empty-state">{tr('아직 댓글이 없습니다. 첫 댓글을 남겨 보세요.')}</div>
          : rows.map(({ item, depth }) => {
            const time = positionTime(item.position)
            return <div key={item.id} className={`channel-comment${depth ? ' reply' : ''}`} onContextMenu={event => { event.preventDefault(); openMenu(item, pointFor(event, event.currentTarget)) }}>
              <UserAvatar uid={item.authorId} name={item.authorName} size={depth ? 28 : 34} image={item.photo} />
              <div className="channel-comment-body">
                <div className="channel-comment-head"><strong className="ellipsis">{item.authorName}</strong>{item.own && <span className="channel-comment-own">{tr('나')}</span>}
                  {time !== null && <time dateTime={new Date(time).toISOString()} title={serviceDate(time)}>{messageTime(time)}</time>}</div>
                {depth === 0 && item.parent !== 'none' && item.parentAuthorName && <span className="channel-comment-parent">{tr('{0}에게 답글', [item.parentAuthorName])}</span>}
                <p className="channel-comment-text selectable">{item.text}</p>
                {(item.parent === 'none' || item.parent === 'present') && <button type="button" className="channel-comment-reply" onClick={() => replyTo(item)}>{tr('답글')}</button>}
              </div>
            </div>
          })}
    </div>
    <CommentComposer accountUid={accountUid} channelId={channelId} postId={postId} surface={surface} reply={reply} authorOf={authorOf} onReply={setReply} />
  </>
}

// Replies section for one channel post, shown in the third column.
export function ChannelCommentsPanel({ accountUid, channelId, postId }: { accountUid: string; channelId: string; postId: string }) {
  const posts = useDesktop(state => { const value = state?.channels?.posts; return value?.channelId === channelId && value.status === 'ready' ? value : null })
  const post = posts?.posts.find(item => item.id === postId) ?? null
  const total = post?.commentCount ?? 0
  return <section className="side-panel channel-comments-panel" aria-label={tr('댓글')}>
    <header className="top-bar">
      <strong className="side-title">{tr('댓글{0}', [total ? ` ${total.toLocaleString(locale())}` : ''])}</strong>
      <button className="icon-button" aria-label={tr('댓글 닫기')} onClick={() => controller.setRight(null)}><X size={20} /></button>
    </header>
    {!post || !posts ? <div className="empty-state">{tr('게시물을 찾을 수 없습니다.')}</div> : <>
      {post.text && <p className="channel-comments-post">{post.text}</p>}
      <CommentsThread accountUid={accountUid} channelId={channelId} requestId={posts.requestId} post={post} surface="channel" />
    </>}
  </section>
}
