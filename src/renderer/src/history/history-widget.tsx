import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type DragEvent } from 'react'
import { useVirtualizer, type Virtualizer } from '@tanstack/react-virtual'
import { ArrowDown, ArrowLeft, Check, Copy, EllipsisVertical, File as FileIcon, Forward, Images, Info, Pencil, Reply, RotateCcw, Search, Trash2, X, Timer, Languages, Link, Pin, PinOff, Download, Sticker } from 'lucide-react'
import type { ChatMessage, DialogSummary, HistorySnapshot } from '../../../shared/model'
import type { LocalOutgoing, OutgoingSnapshot } from '../../../shared/delivery'
import type { ReplyDraftSnapshot } from '../../../shared/reply-draft'
import type { MessageActionsSnapshot } from '../../../shared/message-actions'
import type { ChatBackgroundRecord } from '../../../shared/chat-background'
import type { AttachmentDropMode } from '../../../shared/uploads'
import { defaultChatBackground } from '../../../shared/chat-background'
import { positionMilliseconds } from '../../../shared/model'
import { readCovers, readCursor } from '../../../shared/read-receipts'
import { canForwardMessage } from '../../../shared/forward'
import { maxForwardMessages } from '../../../shared/forward-batch'
import { canReply } from '../../../shared/reply-draft'
import { maxAlbumPhotos } from '../../../shared/uploads'
import { dialogById, useDesktop, useDesktopEvent } from '../app/store'
import { controller, useUi } from '../app/ui'
import { errorText, sameDay, serviceDate } from '../app/format'
import { copyText } from '../app/clipboard'
import { hasFiles } from '../app/drop'
import { trackWrite } from '../app/drafts'
import { useShortcut } from '../app/shortcuts'
import { Avatar, PeerAvatar } from '../ui/avatar'
import { Spinner } from '../ui/controls'
import { Box, confirmBox } from '../ui/layers'
import { popupMenu, pointFor, type MenuEntry } from '../ui/popup-menu'
import { showShareBox } from '../boxes/share-box'
import { showSendFilesBox } from '../boxes/send-files-box'
import { showMediaViewer } from '../media/media-viewer'
import { BackgroundSurface } from './background'
import { showChatBackgroundBox } from '../boxes/chat-background-box'
import { showChatAutoDeleteBox } from '../boxes/auto-delete-box'
import { canChangeAutoDelete } from '../../../shared/chat-auto-delete'
import { Compose } from './compose'
import { PlaybackBar } from './playback-bar'
import { showDateJumpBox } from './date-jump-box'
import { CategoryBar } from './category-bar'
import { inCategory } from '../../../shared/forum'
import { LocalMessageView, MessageView, type MessageLayout, type MessageMenuTarget } from './message'
import { deleteMessage, overlayMessage, reconcileActions, reconcileMessages, toggleReaction, useMessageOverlay } from './message-overlay'
import { useVisibleRead } from './visible-read'
import { autoTranslate, offerTranslation, toggleTranslation, translationShown } from '../app/translations'
import { usePresence } from '../app/presence'
import { useTyping } from '../app/typing'
import { PinnedBar, togglePin } from './pinned-bar'
import { DeferredBar } from './deferred-send'
import { tr } from '../../../shared/i18n'

const initialHistory: HistorySnapshot = { revision: -1, messages: [], before: null, hasMore: false, status: 'loading', message: '', newerAvailable: false }
const initialOutgoing: OutgoingSnapshot = { revision: -1, items: [], canCompose: false, message: '' }
const noReply: ReplyDraftSnapshot = { revision: -1, selection: null, status: 'none', preview: null }
// Message reaction choices used by Morse.
export const quickReactions = ['👍', '❤️', '😂', '😮', '😢', '👏', '🔥', '🙏']
// history_view_element.cpp kAttachMessageToPreviousSecondsDelta.
const attachWindowMs = 900 * 1000

type Entry = { kind: 'message'; key: string; message: ChatMessage; own: boolean; time: number } | { kind: 'local'; key: string; item: LocalOutgoing; time: number }

function canMutate(message: ChatMessage, dialog: DialogSummary | null): boolean {
  return Boolean(dialog && dialog.kind !== 'secret' && message.version && !message.encrypted && !message.system && message.serverConfirmed &&
    (dialog.historyAccess === undefined || dialog.historyAccess === 'ready'))
}
function attachable(entry: Entry): boolean {
  return entry.kind === 'local' || (!entry.message.system && !entry.message.encrypted && entry.message.kind !== 'channelPost' && entry.message.kind !== 'unsupported')
}

function ReactionStrip({ onPick }: { onPick(emoji: string): void }) {
  return <div className="reaction-strip">{quickReactions.map(emoji => <button key={emoji} type="button" aria-label={tr('{0} 반응', [emoji])} onClick={() => onPick(emoji)}>{emoji}</button>)}</div>
}

// HistoryWidget: top bar, virtualized history over the chat background, and
// compose controls. Every action reflects immediately in the list.
export function HistoryWidget({ accountUid, chatId, oneColumn, leftmost }: { accountUid: string; chatId: string; oneColumn: boolean; leftmost: boolean }) {
  const dialog = useDesktop(snapshot => dialogById(snapshot, chatId))
  const pending = useDesktop(snapshot => snapshot?.pendingDirects.find(item => item.chatId === chatId) ?? null)
  const connection = useDesktop(snapshot => snapshot?.connection ?? 'offline')
  const deviceBackground = useDesktop(snapshot => snapshot?.preferences.chatBackground ?? defaultChatBackground)
  const right = useUi(state => state.right)
  const layerCount = useUi(state => state.layers.length)
  const [history, setHistory] = useState(initialHistory)
  const [outgoing, setOutgoing] = useState(initialOutgoing)
  const [reply, setReply] = useState(noReply)
  const [background, setBackground] = useState<ChatBackgroundRecord | null>(null)
  const [editing, setEditing] = useState<ChatMessage | null>(null)
  const [selection, setSelection] = useState<string[] | null>(null)
  const [highlight, setHighlight] = useState<string | null>(null)
  const [away, setAway] = useState(false)
  const [paging, setPaging] = useState(false)
  const [dragging, setDragging] = useState<AttachmentDropMode | 'none' | null>(null)
  const overlayRevision = useMessageOverlay()
  const scroll = useRef<HTMLDivElement>(null)
  const revisions = useRef({ history: -1, outgoing: -1, reply: -1, actions: -1 })
  const current = useRef(history)
  const outgoingRef = useRef(outgoing); outgoingRef.current = outgoing
  const dialogRef = useRef(dialog); dialogRef.current = dialog
  const bottom = useRef(true), pagingRef = useRef(false)
  const pendingScroll = useRef<null | 'bottom' | { key: string; align: 'start' | 'center' }>('bottom')
  const anchor = useRef<{ key: string; offset: number } | null>(null)
  const firstUnread = useRef<string | null | undefined>(undefined)
  const virtualRef = useRef<Virtualizer<HTMLDivElement, Element> | null>(null)

  const captureAnchor = (): void => {
    const element = scroll.current, virtual = virtualRef.current
    if (bottom.current) { pendingScroll.current ??= 'bottom'; return }
    if (!element || !virtual || pendingScroll.current) return
    const offset = element.scrollTop, first = virtual.getVirtualItems().find(item => item.end > offset)
    anchor.current = first ? { key: String(first.key), offset: offset - first.start } : null
  }
  const applyHistory = (next: HistorySnapshot): void => {
    if (next.revision <= revisions.current.history) return
    revisions.current.history = next.revision
    const previous = current.current
    if (next.focusMessageId && next.focusMessageId !== previous.focusMessageId) {
      pendingScroll.current = { key: next.focusMessageId, align: 'center' }; bottom.current = false; setHighlight(next.focusMessageId)
    } else if (next.status !== 'ready') {
      pendingScroll.current = 'bottom'; bottom.current = true
    } else if (firstUnread.current === undefined) {
      const owner = dialogRef.current, count = owner?.unreadCount ?? 0
      let unread: ChatMessage | undefined
      if (owner && count > 0) {
        const cursor = owner.readPositions[accountUid]
        unread = cursor ? next.messages.find(message => message.senderId !== accountUid && message.readEligible && !message.system && !readCovers(cursor, readCursor(message.position)))
          : next.messages[Math.max(0, next.messages.length - count)]
      }
      firstUnread.current = unread?.id ?? null
      pendingScroll.current = unread ? { key: unread.id, align: 'start' } : 'bottom'
      bottom.current = !unread
    } else captureAnchor()
    current.current = next
    setHistory(next)
  }
  const applyOutgoing = (next: OutgoingSnapshot): void => {
    if (next.revision <= revisions.current.outgoing) return
    revisions.current.outgoing = next.revision; captureAnchor(); setOutgoing(next)
  }
  const applyReply = (next: ReplyDraftSnapshot): void => { if (next.revision > revisions.current.reply) { revisions.current.reply = next.revision; setReply(next) } }
  const applyActions = (next: MessageActionsSnapshot): void => { if (next.revision > revisions.current.actions) { revisions.current.actions = next.revision; reconcileActions(accountUid, chatId, next) } }

  useDesktopEvent(event => {
    if (!('chatId' in event) || !('accountUid' in event) || event.accountUid !== accountUid || event.chatId !== chatId) return
    if (event.type === 'history-changed') applyHistory(event.history)
    else if (event.type === 'outgoing-changed') applyOutgoing(event.outgoing)
    else if (event.type === 'reply-draft-changed') applyReply(event.reply)
    else if (event.type === 'actions-changed') applyActions(event.actions)
    else if (event.type === 'chat-background-changed') setBackground(event.background)
  })

  const dialogExists = dialog !== null
  useEffect(() => {
    if (!dialogExists) return
    let alive = true
    firstUnread.current = undefined; revisions.current.history = -1; revisions.current.actions = -1
    pendingScroll.current = 'bottom'; bottom.current = true
    void window.morse.history(accountUid, chatId).then(next => { if (alive) applyHistory(next) })
      .catch(reason => { if (alive) { current.current = { ...initialHistory, status: 'error', message: errorText(reason, tr('대화를 불러오지 못했습니다.')) }; setHistory(current.current) } })
    void window.morse.messageActions(accountUid, chatId).then(next => { if (alive) applyActions(next) }).catch(() => {})
    return () => { alive = false }
  }, [accountUid, chatId, dialogExists])
  useEffect(() => {
    let alive = true
    revisions.current.outgoing = -1; revisions.current.reply = -1
    void window.morse.outgoing(accountUid, chatId).then(next => { if (alive) applyOutgoing(next) }).catch(() => {})
    void window.morse.replyDraft(accountUid, chatId).then(next => { if (alive) applyReply(next) }).catch(() => {})
    return () => { alive = false; void window.morse.closeHistory(accountUid, chatId).catch(() => {}) }
  }, [accountUid, chatId, dialogExists])
  const historyReady = history.status === 'ready'
  const secret = dialog?.kind === 'secret'
  useEffect(() => {
    if (!historyReady || !dialogExists || secret) return
    let alive = true
    void window.morse.chatBackground(accountUid, chatId).then(value => { if (alive) setBackground(value) }).catch(() => {})
    return () => { alive = false }
  }, [accountUid, chatId, historyReady, dialogExists, secret])
  useEffect(() => { reconcileMessages(chatId, history.messages) }, [chatId, history.messages])
  useEffect(() => {
    if (!highlight) return
    const timer = setTimeout(() => setHighlight(null), 2500)
    return () => clearTimeout(timer)
  }, [highlight])

  // iOS MorseGroupCategorySelection.messageMatchesFilter: with a topic chosen, the history shows that topic only.
  const forum = dialog?.forum ?? null, forumSelected = dialog?.forumSelected ?? null
  const entries = useMemo<Entry[]>(() => {
    const list: Entry[] = [], ids = new Set<string>()
    for (const raw of history.messages) {
      ids.add(raw.id)
      if (forum && !raw.system && !inCategory(raw, forum, forumSelected)) continue
      const message = overlayMessage(raw)
      if (message) list.push({ kind: 'message', key: message.id, message, own: message.senderId === accountUid, time: positionMilliseconds(message.position) })
    }
    for (const item of outgoing.items) if (!ids.has(item.id)) list.push({ kind: 'local', key: item.id, item, time: item.createdAt })
    return list
  }, [history.messages, outgoing.items, overlayRevision, accountUid, forum, forumSelected])
  const group = dialog?.kind === 'group'
  const layouts = useMemo<MessageLayout[]>(() => entries.map((entry, index) => {
    const previous = entries[index - 1], next = entries[index + 1]
    const sender = (value: Entry): string => value.kind === 'local' ? accountUid : value.message.senderId
    const joins = (a: Entry | undefined, b: Entry | undefined): boolean => Boolean(a && b && attachable(a) && attachable(b) && sender(a) === sender(b) &&
      sameDay(a.time, b.time) && b.time - a.time < attachWindowMs && !(b.kind === 'message' && b.key === firstUnread.current))
    const top = joins(previous, entry), bottomJoined = joins(entry, next)
    const incoming = entry.kind === 'message' && !entry.own && !entry.message.system
    return { date: !previous || !sameDay(previous.time, entry.time), unread: entry.kind === 'message' && entry.key === firstUnread.current,
      top, bottom: bottomJoined, name: group && incoming && !top, photo: group && incoming && !bottomJoined, gutter: group && incoming }
  }), [entries, group, accountUid])

  const virtual = useVirtualizer({
    count: entries.length, getScrollElement: () => scroll.current, overscan: 12, paddingStart: 10, paddingEnd: 8,
    estimateSize: index => {
      const entry = entries[index], layout = layouts[index]
      let size = 46
      if (entry?.kind === 'message' && (entry.message.attachments?.length ?? 0) > 0) size += 150
      if (entry?.kind === 'message' && entry.message.reply) size += 44
      if (layout?.date) size += 44
      if (layout?.unread) size += 40
      return size
    },
    getItemKey: index => entries[index]!.key
  })
  virtualRef.current = virtual
  // "전체번역" (every chat but memo and secret chats): translate received text rows as they come on screen.
  const autoTranslateOn = useDesktop(snapshot => snapshot?.preferences.autoTranslateChats ?? false) && !chatId.startsWith('memo_') && dialog?.kind !== 'secret'
  const autoTranslateRef = useRef(autoTranslateOn); autoTranslateRef.current = autoTranslateOn
  const pinnedSnapshot = useDesktop(snapshot => snapshot?.pinnedMessages?.chatId === chatId ? snapshot.pinnedMessages : null)
  const pinnedRef = useRef(pinnedSnapshot); pinnedRef.current = pinnedSnapshot
  const translatableOnScreen = virtual.getVirtualItems().flatMap(item => {
    const entry = entries[item.index]
    return entry?.kind === 'message' && !entry.own && entry.message.kind === 'text' && !entry.message.system && !entry.message.encrypted && entry.message.text.trim() ? [entry.message] : []
  })
  const translatableKey = translatableOnScreen.map(message => `${message.id}:${message.text.length}`).join(',')
  useEffect(() => {
    if (autoTranslateOn && historyReady) autoTranslate(accountUid, chatId, translatableOnScreen)
  }, [autoTranslateOn, historyReady, translatableKey, accountUid, chatId])
  // HistoryWidget paints a chat only after its rows are measured and scrolled into place,
  // so opening it does not show rows jumping from estimated heights.
  const [settled, setSettled] = useState(false)
  useLayoutEffect(() => {
    if (settled || history.status === 'loading') return
    if (!entries.length) { setSettled(true); return }
    let frames = 0, handle = 0
    const step = (): void => {
      if (bottom.current && virtualRef.current) virtualRef.current.scrollToIndex(entries.length - 1, { align: 'end' })
      if (++frames < 2) handle = requestAnimationFrame(step); else setSettled(true)
    }
    handle = requestAnimationFrame(step)
    return () => cancelAnimationFrame(handle)
  }, [settled, history.status, entries.length])

  useLayoutEffect(() => {
    const element = scroll.current
    if (!element || !entries.length) return
    for (const row of element.querySelectorAll<HTMLElement>('[data-index]')) virtual.measureElement(row)
    const target = pendingScroll.current
    if (target === 'bottom') { virtual.scrollToIndex(entries.length - 1, { align: 'end' }); pendingScroll.current = null }
    else if (target) {
      const index = entries.findIndex(entry => entry.key === target.key)
      if (index >= 0) virtual.scrollToIndex(index, { align: target.align })
      pendingScroll.current = null
    } else if (anchor.current) {
      const saved = anchor.current; anchor.current = null
      const index = entries.findIndex(entry => entry.key === saved.key)
      const offset = index >= 0 ? virtual.getOffsetForIndex(index, 'start') : undefined
      if (offset) virtual.scrollToOffset(offset[0] + saved.offset)
    }
  }, [entries])

  async function loadOlder(): Promise<void> {
    const value = current.current
    if (pagingRef.current || value.status !== 'ready' || !value.hasMore || !value.before) return
    pagingRef.current = true; setPaging(true); bottom.current = false
    try { applyHistory(await window.morse.history(accountUid, chatId, value.before)) }
    catch (reason) { controller.toast(errorText(reason, tr('이전 메시지를 불러오지 못했습니다.')), 'error') }
    finally { pagingRef.current = false; setPaging(false) }
  }
  const onScroll = (): void => {
    const element = scroll.current
    if (!element) return
    const distance = element.scrollHeight - element.scrollTop - element.clientHeight
    bottom.current = distance < 80
    setAway(distance > 480)
    if (element.scrollTop < 400) void loadOlder()
  }
  async function jumpLatest(): Promise<void> {
    bottom.current = true; pendingScroll.current = 'bottom'
    if (current.current.newerAvailable) {
      try { applyHistory(await window.morse.latestHistory(accountUid, chatId)) } catch (reason) { controller.toast(errorText(reason, tr('최근 메시지를 불러오지 못했습니다.')), 'error') }
    } else if (entries.length) { virtual.scrollToIndex(entries.length - 1, { align: 'end' }); pendingScroll.current = null }
  }

  const readError = useVisibleRead(scroll, { accountUid, chatId, history, enabled: historyReady && connection === 'ready' && layerCount === 0 && selection === null && !secret })
  useEffect(() => { if (readError) controller.toast(readError, 'error') }, [readError])

  const peers = useMemo(() => dialog ? [...new Set(dialog.participantUids)].filter(uid => uid !== accountUid) : [], [dialog?.participantUids, accountUid])
  // TopBarWidget::updateOnlineDisplay: a 1:1 chat's subtitle is the peer's last seen.
  const peerPresence = usePresence(dialog?.kind === 'direct' && !chatId.startsWith('memo_') ? peers[0] ?? null : null)
  const readPositions = dialog?.readPositions
  const readState = (message: ChatMessage): 'sent' | 'partial' | 'read' => {
    if (!readPositions || !message.readEligible || !peers.length) return 'sent'
    const target = readCursor(message.position), readers = peers.filter(uid => readCovers(readPositions[uid], target)).length
    return readers === 0 ? 'sent' : readers === peers.length ? 'read' : 'partial'
  }

  const selectReply = useCallback(async (message: ChatMessage): Promise<void> => {
    if (!canReply(message) || !outgoingRef.current.canCompose) return
    setEditing(null)
    try { await trackWrite(window.morse.selectReply(accountUid, chatId, message.id, message.version)); controller.focusComposer() }
    catch (reason) { controller.toast(errorText(reason, tr('답장할 메시지를 선택하지 못했습니다.')), 'error') }
  }, [accountUid, chatId])
  // iOS DeleteConfirmOverlay / Telegram DeleteMessagesBox: for everyone where the room allows it, or for me only.
  const removeMessages = useCallback(async (messages: ChatMessage[]): Promise<void> => {
    if (!messages.length) return
    const forEveryone = !chatId.startsWith('memo_') && messages.every(message => canMutate(message, dialogRef.current))
    const choice = await chooseDeletion(messages.length, forEveryone, messages.every(message => message.senderId === accountUid))
    if (!choice) return
    setSelection(null)
    if (choice === 'everyone') { for (const message of messages) void deleteMessage(accountUid, message); return }
    void trackWrite(window.morse.hideMessages(accountUid, chatId, messages.map(message => message.id))).catch(reason => controller.toast(errorText(reason, tr('메시지를 삭제하지 못했습니다.')), 'error'))
  }, [accountUid, chatId])
  const openMessageMenu = useCallback((message: ChatMessage, point: { x: number; y: number }, target?: MessageMenuTarget) => {
    const link = target?.link
    // Telegram «Save As…» / iOS «저장»·«파일로 저장»: the attachment under the pointer, or the first one.
    const parts = (message.attachments ?? []).filter(part => part.available && !part.blind)
    const savable = !message.encrypted && mediaSavable(dialogRef.current) ? parts.find(part => part.index === target?.part) ?? parts[0] : undefined
    const owner = dialogRef.current, mutable = canMutate(message, owner), own = message.senderId === accountUid
    const text = message.kind === 'text' ? message.text : message.caption ?? ''
    const deletable = Boolean(message.version)
    // MorseChatRoom message menu «번역»: received text in another language; chosen again, the original returns.
    const translatable = !own && message.kind === 'text' && !message.encrypted && !message.system && owner?.kind !== 'secret' && Boolean(message.text.trim())
    const shown = translationShown(accountUid, chatId, message.id, message.text, autoTranslateRef.current)
    const open = (offer: boolean): void => {
      const entries: MenuEntry[] = [
        // Telegram puts «Copy link» / «Copy email» first when the menu opens on a link.
        link ? { label: link.email ? tr('이메일 복사') : tr('링크 복사'), icon: <Link size={18} />, onSelect: () => { const copied = copyText(link.email ? link.url.replace(/^mailto:/, '') : link.url); controller.toast(copied ? tr('복사했습니다.') : tr('복사하지 못했습니다.'), copied ? 'default' : 'error') } } : null,
        link ? 'separator' : null,
        canReply(message) && outgoingRef.current.canCompose ? { label: tr('답장'), icon: <Reply size={18} />, onSelect: () => { void selectReply(message) } } : null,
        mutable && own && message.kind === 'text' ? { label: tr('수정'), icon: <Pencil size={18} />, onSelect: () => { setEditing(message) } } : null,
        text && !message.encrypted ? { label: tr('텍스트 복사'), icon: <Copy size={18} />, onSelect: () => { const copied = copyText(text); controller.toast(copied ? tr('복사했습니다.') : tr('복사하지 못했습니다.'), copied ? 'default' : 'error') } } : null,
        offer ? { label: shown ? tr('원문 보기') : tr('번역'), icon: <Languages size={18} />, onSelect: () => { void toggleTranslation(accountUid, chatId, message, autoTranslateRef.current) } } : null,
        message.version && message.serverConfirmed && !message.system && !message.encrypted && owner?.kind !== 'secret'
          ? (pinnedRef.current?.items.some(item => item.id === message.id)
            ? { label: tr('고정 해제'), icon: <PinOff size={18} />, onSelect: () => { void togglePin(accountUid, chatId, message.id, pinnedRef.current) } }
            : { label: tr('고정'), icon: <Pin size={18} />, onSelect: () => { void togglePin(accountUid, chatId, message.id, pinnedRef.current) } }) : null,
        // MorseStickerPreview: a received sticker can be kept in my library.
        message.kind === 'sticker' && savable ? { label: tr('스티커 저장'), icon: <Sticker size={18} />, onSelect: () => { void saveSticker(accountUid, chatId, message) } } : null,
        savable && message.kind !== 'sticker' ? { label: message.kind === 'voice' ? tr('파일로 저장') : tr('저장'), icon: <Download size={18} />, onSelect: () => { void saveAttachment(accountUid, chatId, message, savable.index) } } : null,
        canForwardMessage(message) ? { label: tr('전달'), icon: <Forward size={18} />, onSelect: () => showShareBox(accountUid, [message]) } : null,
        message.version && !message.system ? { label: tr('선택'), icon: <Check size={18} />, onSelect: () => setSelection([message.id]) } : null,
        deletable ? 'separator' : null,
        deletable ? { label: tr('삭제'), icon: <Trash2 size={18} />, danger: true, onSelect: () => { void removeMessages([message]) } } : null
      ]
      popupMenu.open(point, entries, { header: mutable ? <ReactionStrip onPick={emoji => { popupMenu.close(); void toggleReaction(accountUid, message, emoji) }} /> : undefined })
    }
    if (!translatable) open(false)
    else if (shown) open(true)
    else void offerTranslation(accountUid, chatId, message.id).then(open)
  }, [accountUid, chatId, selectReply, removeMessages])
  const openLocalMenu = useCallback((item: LocalOutgoing, point: { x: number; y: number }) => {
    const failed = item.state === 'failed' || item.state === 'upload-failed'
    popupMenu.open(point, [
      item.retryable ? { label: tr('다시 보내기'), icon: <RotateCcw size={18} />, onSelect: () => { void window.morse.retryMessage(accountUid, chatId, item.id).catch(reason => controller.toast(errorText(reason, tr('다시 보내지 못했습니다.')), 'error')) } } : null,
      item.text ? { label: tr('텍스트 복사'), icon: <Copy size={18} />, onSelect: () => { controller.toast(copyText(item.text) ? tr('복사했습니다.') : tr('복사하지 못했습니다.')) } } : null,
      { label: failed ? tr('삭제') : tr('보내기 취소'), icon: <Trash2 size={18} />, danger: true, onSelect: () => { void window.morse.discardOutgoing(accountUid, chatId, item.id).catch(reason => controller.toast(errorText(reason, tr('처리하지 못했습니다.')), 'error')) } }
    ])
  }, [accountUid, chatId])
  const jumpReply = useCallback((message: ChatMessage) => {
    void window.morse.jumpReply(accountUid, chatId, message.id, message.version).catch(reason => controller.toast(errorText(reason, tr('원본 메시지로 이동하지 못했습니다.')), 'error'))
  }, [accountUid, chatId])
  const openMedia = useCallback((message: ChatMessage, index: number) => {
    showMediaViewer(accountUid, chatId, message, index, message.senderId === accountUid ? tr('나') : message.senderName || dialogRef.current?.title || '')
  }, [accountUid, chatId])
  const toggleSelected = useCallback((message: ChatMessage) => {
    if (!message.version || message.system) return
    setSelection(list => list?.includes(message.id) ? list.filter(id => id !== message.id) : [...(list ?? []), message.id])
  }, [])
  const react = useCallback((message: ChatMessage, emoji: string) => {
    if (canMutate(message, dialogRef.current)) void toggleReaction(accountUid, message, emoji)
  }, [accountUid])
  const replyByDoubleClick = useCallback((message: ChatMessage) => { void selectReply(message) }, [selectReply])

  useShortcut(30, command => {
    if (command === 'back' && selection !== null) { setSelection(null); return true }
    return false
  })

  const selected = selection === null ? [] : entries.flatMap(entry => entry.kind === 'message' && selection.includes(entry.message.id) ? [entry.message] : [])
  const canForwardSelection = selected.length > 0 && selected.length <= maxForwardMessages && selected.every(canForwardMessage)
  const canDeleteSelection = selected.length > 0 && selected.length <= 100 && selected.every(message => Boolean(message.version))
  const canAttach = Boolean(dialog) && !secret && outgoing.canCompose && !editing

  function dropMode(target: EventTarget): AttachmentDropMode | null {
    const mode = target instanceof Element ? target.closest('[data-drop-mode]')?.getAttribute('data-drop-mode') : null
    return mode === 'media' || mode === 'file' ? mode : null
  }
  function dragOver(event: DragEvent<HTMLDivElement>): void {
    if (!hasFiles(event.dataTransfer)) return
    event.preventDefault()
    const mode = canAttach ? dropMode(event.target) : null
    event.dataTransfer.dropEffect = mode ? 'copy' : 'none'
    setDragging(mode ?? 'none')
  }
  function drop(event: DragEvent<HTMLDivElement>): void {
    if (!hasFiles(event.dataTransfer)) return
    event.preventDefault()
    const mode = canAttach ? dropMode(event.target) : null, files = Array.from(event.dataTransfer.files)
    setDragging(null)
    if (!mode || !files.length) return
    if (files.length > maxAlbumPhotos || (mode === 'file' && files.length > 1)) { controller.toast(mode === 'file' ? tr('파일은 한 번에 한 개씩 보낼 수 있습니다.') : tr('사진은 한 번에 {0}장까지 보낼 수 있습니다.', [maxAlbumPhotos]), 'error'); return }
    void window.morse.dropAttachments(accountUid, chatId, files, mode).then(draft => { if (draft) showSendFilesBox(accountUid, chatId, draft, () => reply.selection) })
      .catch(reason => controller.toast(errorText(reason, tr('첨부를 준비하지 못했습니다.')), 'error'))
  }

  // Deletes every message of the chat for all participants (clearMorseChatHistory).
  async function clearHistory(): Promise<void> {
    if (!await confirmBox({ title: tr('대화 기록 모두 삭제'), text: tr('이 대화의 모든 메시지를 참여자 모두에게서 삭제합니다. 되돌릴 수 없어요.'), confirm: tr('모두 삭제'), danger: true })) return
    try {
      const result = await trackWrite(window.morse.clearChatHistory(accountUid, chatId))
      controller.toast(result === 'done' ? tr('대화 기록을 삭제했습니다.') : tr('삭제 결과를 확인하고 있습니다. 잠시 후 대화를 확인해 주세요.'))
    } catch (reason) { controller.toast(errorText(reason, tr('대화 기록을 삭제하지 못했습니다.')), 'error') }
  }
  function openMore(point: { x: number; y: number }): void {
    popupMenu.open(point, [
      dialog && !secret ? { label: tr('대화 안 검색'), icon: <Search size={18} />, disabled: !historyReady, onSelect: () => controller.setRight('search') } : null,
      dialog ? { label: tr('정보 보기'), icon: <Info size={18} />, onSelect: () => controller.setRight('info') } : null,
      dialog && historyReady && !secret ? { label: tr('메시지 선택'), icon: <Check size={18} />, onSelect: () => setSelection([]) } : null,
      dialog && !secret ? { label: tr('배경 설정'), icon: <Images size={18} />, onSelect: () => showChatBackgroundBox(accountUid, chatId) } : null,
      dialog && !secret ? { label: tr('자동 삭제'), icon: <Timer size={18} />, disabled: !canChangeAutoDelete(dialog, accountUid), onSelect: () => showChatAutoDeleteBox(accountUid, dialog) } : null,
      dialog && !secret && !chatId.startsWith('memo_') ? { label: tr('대화 기록 모두 삭제'), icon: <Trash2 size={18} />, danger: true, onSelect: () => { void clearHistory() } } : null,
      !dialog && pending ? { label: tr('새 대화 삭제'), icon: <Trash2 size={18} />, danger: true, onSelect: () => {
        void window.morse.discardDirectDraft(accountUid, chatId).then(() => controller.closeChat()).catch(reason => controller.toast(errorText(reason, tr('새 대화를 삭제하지 못했습니다.')), 'error'))
      } } : null
    ])
  }

  const title = dialog?.title ?? pending?.displayName ?? tr('대화')
  const typing = useTyping(chatId)
  const subtitle = !dialog ? pending ? tr('새 대화') : '' : connection !== 'ready' ? tr('연결 중…') : secret ? tr('비밀 대화') : typing ? tr('입력 중...') : group ? tr('참여자 {0}명', [dialog.participantUids.length]) : peerPresence?.text ?? ''
  const surface = secret ? defaultChatBackground : background?.value ?? deviceBackground
  const scope = background?.value ? { kind: 'chat' as const, accountUid, chatId } : { kind: 'device' as const }
  const bodyNotice = !dialog ? pending ? tr('첫 메시지를 보내면 대화가 시작됩니다.') : tr('대화를 찾을 수 없습니다.')
    : history.status === 'loading' && !entries.length ? null : history.status !== 'ready' && !entries.length ? history.message || tr('대화를 불러오지 못했습니다.') : historyReady && !entries.length ? tr('아직 메시지가 없습니다.') : ''

  return <section className="history-widget" aria-label={tr('{0} 대화', [title])}>
    <header className={`top-bar${leftmost ? ' leftmost' : ''}`}>
      {oneColumn && selection === null && <button className="icon-button" aria-label={tr('대화 목록으로')} onClick={() => controller.closeChat()}><ArrowLeft size={22} /></button>}
      {selection !== null ? <>
        <button className="icon-button" aria-label={tr('선택 취소')} onClick={() => setSelection(null)}><X size={22} /></button>
        <strong className="top-bar-selection">{tr('{0}개 선택', [selected.length])}</strong>
        <button className="button flat" disabled={!canForwardSelection} onClick={() => { showShareBox(accountUid, selected); setSelection(null) }}><Forward size={18} />{tr('전달')}</button>
        <button className="button flat danger" disabled={!canDeleteSelection} onClick={() => { void removeMessages(selected) }}><Trash2 size={18} />{tr('삭제')}</button>
      </> : <>
        <button type="button" className="top-bar-peer" onClick={() => { if (dialog) controller.toggleRight('info') }}>
          {dialog ? <PeerAvatar id={dialog.id} name={dialog.title} image={secret ? null : dialog.avatar} surface="dialogs" kind={secret ? 'secret' : undefined} size={36} priority /> : pending ? <PeerAvatar id={chatId} name={title} image={pending.avatar ?? null} surface="dialogs" size={36} priority /> : <Avatar name={title} size={36} />}
          <span className="top-bar-title"><strong className="ellipsis">{title}</strong>{subtitle && <span className={`ellipsis${typing && subtitle === tr('입력 중...') ? ' typing' : peerPresence?.online && subtitle === peerPresence.text ? ' online' : ''}`}>{subtitle}</span>}</span>
        </button>
        {dialog && !secret && <button className={`icon-button${right === 'search' ? ' active' : ''}`} aria-label={tr('대화 안 검색')} disabled={!historyReady} onClick={() => controller.toggleRight('search')}><Search size={20} /></button>}
        {dialog && <button className={`icon-button${right === 'info' ? ' active' : ''}`} aria-label={tr('정보')} onClick={() => controller.toggleRight('info')}><Info size={20} /></button>}
        <button className="icon-button" aria-label={tr('더 보기')} onClick={event => openMore(pointFor(event, event.currentTarget))}><EllipsisVertical size={20} /></button>
      </>}
    </header>
    {dialog && !secret && <PinnedBar accountUid={accountUid} chatId={chatId} />}
    {dialog && forum && <CategoryBar accountUid={accountUid} chatId={chatId} forum={forum} selected={forumSelected} />}
    <PlaybackBar chatId={chatId} />
    {dialog && !secret && <DeferredBar accountUid={accountUid} chatId={chatId} />}
    {dialog?.historyMessage && <p className="history-banner" role="status">{dialog.historyMessage}</p>}
    <div className="history" onDragEnter={dragOver} onDragOver={dragOver} onDrop={drop}
      onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(null) }}>
      <BackgroundSurface value={surface} scope={scope} />
      <div ref={scroll} className={`history-scroll${selection !== null ? ' selecting' : ''}`} onScroll={onScroll} tabIndex={-1} data-region-focus aria-busy={paging || history.status === 'loading'}>
        <div className={`history-inner${settled ? '' : ' settling'}`} style={{ height: virtual.getTotalSize() }}>
          {virtual.getVirtualItems().map(item => {
            const entry = entries[item.index]!, layout = layouts[item.index]!
            return <div key={item.key} data-index={item.index} ref={virtual.measureElement} className="history-row" style={{ transform: `translateY(${item.start}px)` }}>
              {layout.date && <div className="history-date"><button type="button" className="service-pill" title={tr('날짜로 이동')}
                onClick={() => { if (dialog && !secret && historyReady) showDateJumpBox(accountUid, chatId, entry.time) }}>{serviceDate(entry.time)}</button></div>}
              {layout.unread && <div className="history-unread-bar">{tr('읽지 않은 메시지')}</div>}
              {entry.kind === 'message'
                ? <MessageView accountUid={accountUid} chatId={chatId} message={entry.message} own={entry.own} layout={layout} read={entry.own ? readState(entry.message) : 'sent'}
                  selecting={selection !== null} selected={selection?.includes(entry.message.id) ?? false} highlighted={highlight === entry.message.id}
                  autoTranslate={autoTranslateOn} onMenu={openMessageMenu} onReply={replyByDoubleClick} onJumpReply={jumpReply} onOpenMedia={openMedia} onToggle={toggleSelected} onReaction={react} />
                : <LocalMessageView accountUid={accountUid} item={entry.item} layout={layout} onMenu={openLocalMenu} />}
            </div>
          })}
        </div>
        {paging && <div className="history-paging"><Spinner size={18} /></div>}
      </div>
      {(bodyNotice || (history.status === 'loading' && dialog && !entries.length)) && <div className="history-notice" role="status">
        {bodyNotice ? <span className="service-pill">{bodyNotice}</span> : <Spinner size={24} />}
        {history.status === 'error' && dialog && <button className="button secondary" onClick={() => { void window.morse.latestHistory(accountUid, chatId).then(applyHistory).catch(() => {}) }}>{tr('다시 불러오기')}</button>}
      </div>}
      {historyReady && (away || history.newerAvailable) && <button className="history-down" aria-label={tr('최근 메시지로 이동')} onClick={() => { void jumpLatest() }}>
        <ArrowDown size={22} />{(dialog?.unreadCount ?? 0) > 0 && <span>{dialog!.unreadCount > 99 ? '99+' : dialog!.unreadCount}</span>}
      </button>}
      {dragging !== null && <div className="drop-overlay">
        {canAttach ? <>
          <div className={`drop-zone${dragging === 'media' ? ' active' : ''}`} data-drop-mode="media"><Images size={40} /><strong>{tr('사진·동영상으로 보내기')}</strong><span>{tr('압축된 미리보기로 보냅니다')}</span></div>
          <div className={`drop-zone${dragging === 'file' ? ' active' : ''}`} data-drop-mode="file"><FileIcon size={40} /><strong>{tr('파일로 보내기')}</strong><span>{tr('원본 그대로 보냅니다')}</span></div>
        </> : <div className="drop-zone disabled"><strong>{tr('지금은 이 대화에 첨부할 수 없습니다')}</strong></div>}
      </div>}
    </div>
    {(dialog || pending) && <Compose accountUid={accountUid} chatId={chatId} dialog={dialog} outgoing={outgoing} reply={reply} editing={editing}
      onCancelEdit={() => setEditing(null)}
      onEditLast={() => {
        const last = [...entries].reverse().find(entry => entry.kind === 'message' && entry.own && entry.message.kind === 'text' && canMutate(entry.message, dialog))
        if (last?.kind === 'message') setEditing(last.message)
      }}
      onSent={() => { bottom.current = true; if (current.current.newerAvailable) void jumpLatest() }} />}
  </section>
}

function DeleteMessagesBox({ count, forEveryone, direct, choose, close }: { count: number; forEveryone: boolean; direct: boolean; choose(value: 'everyone' | 'me'): void; close(): void }) {
  return <Box title={count > 1 ? tr('{0}개 메시지 삭제', [count]) : tr('메시지 삭제')} width={360} onClose={close} buttons={<button className="button flat" onClick={close}>{tr('취소')}</button>}>
    <p className="box-text">{tr('삭제된 메시지는 복구할 수 없어요.')}</p>
    <div className="delete-choice">
      {forEveryone && <button type="button" className="delete-choice-row danger" onClick={() => { choose('everyone'); close() }}>
        <span className="delete-choice-icon"><Trash2 size={18} /></span>
        <span><strong>{tr('모두에게 삭제')}</strong><small>{direct ? tr('상대방 화면에서도 삭제돼요') : tr('모든 참여자의 화면에서 삭제돼요')}</small></span>
      </button>}
      <button type="button" className="delete-choice-row" onClick={() => { choose('me'); close() }}>
        <span className="delete-choice-icon"><Trash2 size={18} /></span>
        <span><strong>{tr('나에게만 삭제')}</strong><small>{tr('내 화면에서만 삭제돼요')}</small></span>
      </button>
    </div>
  </Box>
}

function chooseDeletion(count: number, forEveryone: boolean, direct: boolean): Promise<'everyone' | 'me' | null> {
  return new Promise(resolve => {
    let settled = false
    const settle = (value: 'everyone' | 'me' | null): void => { if (!settled) { settled = true; resolve(value) } }
    controller.showLayer(close => <DeleteMessagesBox count={count} forEveryone={forEveryone} direct={direct} choose={settle} close={() => { settle(null); close() }} />, { onClose: () => settle(null) })
  })
}

// A secret room's media is never saved (iOS hides «저장» there).
function mediaSavable(dialog: DialogSummary | null): boolean { return Boolean(dialog && dialog.kind !== 'secret') }

async function saveAttachment(accountUid: string, chatId: string, message: ChatMessage, index: number): Promise<void> {
  const requestId = crypto.randomUUID()
  try {
    await window.morse.openMedia(accountUid, chatId, { requestId, messageId: message.id, version: message.version, index })
    if (await window.morse.saveMedia(accountUid, requestId)) controller.toast(tr('파일을 저장했습니다.'))
  } catch (reason) { controller.toast(errorText(reason, tr('파일을 저장하지 못했습니다.')), 'error') }
  finally { void window.morse.closeMedia(accountUid, requestId).catch(() => {}) }
}

async function saveSticker(accountUid: string, chatId: string, message: ChatMessage): Promise<void> {
  const requestId = crypto.randomUUID()
  try {
    const ready = await window.morse.openMedia(accountUid, chatId, { requestId, messageId: message.id, version: message.version, index: 0 })
    if (!ready.url) throw new Error(tr('스티커를 불러오지 못했습니다.'))
    const bytes = new Uint8Array(await (await fetch(ready.url)).arrayBuffer())
    await window.morse.addSticker(accountUid, bytes)
    controller.toast(tr('스티커를 저장했습니다.'))
  } catch (reason) { controller.toast(errorText(reason, tr('처리하지 못했습니다. 다시 시도해 주세요.')), 'error') }
  finally { void window.morse.closeMedia(accountUid, requestId).catch(() => {}) }
}
