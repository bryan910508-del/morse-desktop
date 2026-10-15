// Portions of this file follow Telegram Desktop (https://github.com/telegramdesktop/tdesktop, 7.2.8, 272f6f5c),
// Copyright (c) 2014-2026 The Telegram Desktop Authors. Licensed under GPL-3.0-or-later; see LEGAL.
import { PeerStoryRing, usePeerStoryEntry } from '../stories/peer-story-ring'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type DragEvent } from 'react'
import { useVirtualizer, type Virtualizer } from '@tanstack/react-virtual'
import { ArrowDown, ArrowLeft, Bookmark, Check, ChevronDown, Copy, Download, FolderOpen, EllipsisVertical, File as FileIcon, Flag, Forward, Images, Info, Link, Pencil, Pin, PinOff, Reply, RotateCcw, Search, Star, StarOff, Timer, Trash2, X } from 'lucide-react'
import { fileReady } from './file-states'
import type { ChatMessage, DialogSummary, HistorySnapshot } from '../../../shared/model'
import { deliveryFailed, type LocalOutgoing, type OutgoingSnapshot } from '../../../shared/delivery'
import type { ReplyDraftSnapshot } from '../../../shared/reply-draft'
import type { MessageActionsSnapshot } from '../../../shared/message-actions'
import type { ChatBackgroundRecord } from '../../../shared/chat-background'
import type { AttachmentDropMode } from '../../../shared/uploads'
import { defaultChatBackground } from '../../../shared/chat-background'
import { positionMilliseconds } from '../../../shared/model'
import { readCovers, readCursor } from '../../../shared/read-receipts'
import { canForwardMessage } from '../../../shared/forward'
import { canReply } from '../../../shared/reply-draft'
import { maxAlbumPhotos } from '../../../shared/uploads'
import { desktop, dialogById, useDesktop, useDesktopEvent } from '../app/store'
import { controller, useUi } from '../app/ui'
import { errorText, sameDay, serviceDate } from '../app/format'
import { copyText } from '../app/clipboard'
import { selectedMessagesText } from '../../../shared/message-copy'
import { selectionActions, selectionMenuRows } from '../../../shared/message-selection'
import { canDelete, deletionChoices, vanishedFromHistory, type DeletionChoices } from '../../../shared/message-deletion'
import { copyImage } from '../app/copy-image'
import { hasFiles } from '../app/drop'
import { trackWrite } from '../app/drafts'
import { showClearHistoryBox } from '../dialogs/clear-history-box'
import { useShortcut } from '../app/shortcuts'
import { Avatar, PeerAvatar } from '../ui/avatar'
import { Spinner } from '../ui/controls'
import { Box, confirmBox } from '../ui/layers'
import { DeleteChoice } from '../ui/delete-choice'
import { popupMenu, pointFor, type MenuEntry } from '../ui/popup-menu'
import { OfficialMark } from '../ui/official-mark'
import { showReportBox } from '../boxes/report-box'
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
import { MessageView, type MessageLayout, type MessageMenuTarget } from './message'
import { localChatMessage } from './local-media'
import { isPressedItem, stillPressed, withPressed, type PressedSend } from './pressed-sends'
import { appendedCount, reveal, revealAllowed } from './item-reveal'
import { deleteMessage, overlayMessage, reconcileActions, reconcileMessages, toggleReaction, useMessageOverlay } from './message-overlay'
import { useVisibleRead } from './visible-read'
import { useScrollDate } from './scroll-date'
import { followsBottom, keepBottomOnResize, keepsBottomOnChange } from './keep-bottom'
import { autoTranslate, translationMenuEntry } from '../app/translations'
import { usePresence } from '../app/presence'
import { useTyping } from '../app/typing'
import { PinnedBar, togglePin } from './pinned-bar'
import { DeferredBar } from './deferred-send'
import { linkLabel, useShownConnection } from '../app/connection'
import { tr } from '../../../shared/i18n'
import { translationAvailable } from '../../../shared/translation'
import { expandedReactions, reactionStrip, readRecentReactions, recordReaction } from './recent-reactions'
import emojiList from './emoji-data.json'
import { chatRestrictedNotice } from '../../../shared/sanctions'
import { PeerBar } from './peer-bar'
import { SwipeBack, SwipeReply, useSwipe } from './use-swipe'
import { swipeAllowed } from './swipe-gesture'
import { historyEntries, type Entry } from './history-entries'
import { messageReportAllowed } from '../../../shared/reports'
import { setChatFlag } from '../app/chat-flags'

const initialHistory: HistorySnapshot = { revision: -1, messages: [], before: null, hasMore: false, status: 'loading', message: '', newerAvailable: false }
const initialOutgoing: OutgoingSnapshot = { revision: -1, items: [], canCompose: false, message: '' }
const noReply: ReplyDraftSnapshot = { revision: -1, selection: null, status: 'none', preview: null }
// history_view_element.cpp kAttachMessageToPreviousSecondsDelta.
const attachWindowMs = 900 * 1000


// B113: nothing in the official notice chat changes from here — no reaction, edit or delete for everyone (the server's).
function canMutate(message: ChatMessage, dialog: DialogSummary | null): boolean {
  return Boolean(dialog && dialog.kind !== 'secret' && !dialog.service && message.version && !message.encrypted && !message.system && message.serverConfirmed &&
    (dialog.historyAccess === undefined || dialog.historyAccess === 'ready'))
}
// «Delete for everyone» (A1 §3-6, Telegram's supergroup rule, telegram-refs R-1/R-2): in a channel's discussion room
// only the channel's owner or a canDeleteMessages admin removes someone else's message; anyone their own. Other rooms
// keep their rule.
// B327b: «모두에게» and «나에게만» by the room's rule (shared/message-deletion.ts — none for me in a discussion room or a
// secret chat).
function messageDeletion(message: ChatMessage, dialog: DialogSummary | null, accountUid: string): DeletionChoices {
  if (!dialog) return { everyone: false, me: false }
  return deletionChoices({ kind: dialog.kind, discussion: dialog.discussion, moderates: dialog.moderates, saved: dialog.id === `memo_${accountUid}` },
    message.senderId === accountUid, canMutate(message, dialog))
}
function attachable(entry: Entry): boolean {
  return entry.kind === 'local' || (!entry.message.system && !entry.message.encrypted && entry.message.kind !== 'channelPost' && entry.message.kind !== 'unsupported')
}

// The strip a message's menu carries. What was reacted with lately comes first, as Telegram's own strip
// follows the server's recent list and iOS follows its stored one; `mine` are the reactions this account
// has already left on the message, which are not recorded again.
// B285: its last button expands it, in the menu's place, into every reaction this account may leave (ReactionPanel).
export function ReactionStrip({ accountUid, mine = [], onPick }: { accountUid: string; mine?: readonly string[]; onPick(emoji: string): void }) {
  return <div className="reaction-strip">{reactionStrip(readRecentReactions(accountUid)).map(emoji =>
    <button key={emoji} type="button" aria-label={tr('{0} 반응', [emoji])}
      onClick={() => { recordReaction(accountUid, emoji, mine.includes(emoji)); onPick(emoji) }}>{emoji}</button>)}
    <button type="button" className="reaction-expand" aria-label={tr('반응 더 보기')}
      onClick={() => popupMenu.expand(<ReactionPanel accountUid={accountUid} mine={mine} onPick={onPick} />)}><ChevronDown size={18} /></button></div>
}
function ReactionPanel({ accountUid, mine, onPick }: { accountUid: string; mine: readonly string[]; onPick(emoji: string): void }) {
  // Read once, so nothing moves under the pointer while it is open (as the emoji panel's recent row, B57).
  const [sections] = useState(() => expandedReactions(readRecentReactions(accountUid), emojiList as string[]))
  const button = (emoji: string, key: string) => <button key={key} type="button" aria-label={tr('{0} 반응', [emoji])} aria-pressed={mine.includes(emoji)}
    onClick={() => { recordReaction(accountUid, emoji, mine.includes(emoji)); onPick(emoji) }}>{emoji}</button>
  return <div className="reaction-panel entity-emoji" role="group" aria-label={tr('반응 더 보기')}>
    {sections.recent.length > 0 && <><div className="entity-emoji-label">{tr('최근 반응')}</div>{sections.recent.map(emoji => button(emoji, `recent-${emoji}`))}</>}
    <div className="entity-emoji-label">{tr('이모지')}</div>
    {sections.all.map(emoji => button(emoji, emoji))}
  </div>
}

// HistoryWidget: top bar, virtualized history over the chat background, and
// compose controls. Every action reflects immediately in the list.
export function HistoryWidget({ accountUid, chatId, oneColumn, leftmost }: { accountUid: string; chatId: string; oneColumn: boolean; leftmost: boolean }) {
  const dialog = useDesktop(snapshot => dialogById(snapshot, chatId))
  const pending = useDesktop(snapshot => snapshot?.pendingDirects.find(item => item.chatId === chatId) ?? null)
  const connection = useDesktop(snapshot => snapshot?.connection ?? 'offline')
  // The header says «연결 중…» only once the connection has been away a moment, as Telegram's does.
  const shownConnection = useShownConnection()
  const deviceBackground = useDesktop(snapshot => snapshot?.preferences.chatBackground ?? defaultChatBackground)
  const right = useUi(state => state.right)
  const layerCount = useUi(state => state.layers.length)
  const [history, setHistory] = useState(initialHistory)
  const [outgoing, setOutgoing] = useState(initialOutgoing)
  const [reply, setReply] = useState(noReply)
  const [background, setBackground] = useState<ChatBackgroundRecord | null>(null)
  const [editing, setEditing] = useState<ChatMessage | null>(null)
  const [selection, setSelection] = useState<string[] | null>(null)
  const selectionRef = useRef(selection); selectionRef.current = selection
  const [highlight, setHighlight] = useState<string | null>(null)
  const [away, setAway] = useState(false)
  const [paging, setPaging] = useState(false)
  const [dragging, setDragging] = useState<AttachmentDropMode | 'none' | null>(null)
  const overlayRevision = useMessageOverlay()
  const scroll = useRef<HTMLDivElement>(null)
  const revisions = useRef({ history: -1, outgoing: -1, reply: -1, actions: -1 })
  const current = useRef(history)
  const outgoingRef = useRef(outgoing); outgoingRef.current = outgoing
  // B306: texts drawn as the composer empties, until the queue's item or the history's message takes their place.
  const [pressed, setPressed] = useState<readonly PressedSend[]>([])
  useEffect(() => { setPressed([]) }, [chatId])
  const dialogRef = useRef(dialog); dialogRef.current = dialog
  const bottom = useRef(true), pagingRef = useRef(false)
  const pendingScroll = useRef<null | 'bottom' | { key: string; align: 'start' | 'center' }>('bottom')
  const anchor = useRef<{ key: string; offset: number } | null>(null)
  const revealKeys = useRef<readonly string[]>([])
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
  // B113: Morse's official notice chat — read-only, no person's actions (tdesktop isServiceUser).
  const service = dialog?.service === true
  useEffect(() => {
    if (!historyReady || !dialogExists || secret) return
    let alive = true
    void window.morse.chatBackground(accountUid, chatId).then(value => { if (alive) setBackground(value) }).catch(() => {})
    return () => { alive = false }
  }, [accountUid, chatId, historyReady, dialogExists, secret])
  useEffect(() => { reconcileMessages(chatId, history.messages) }, [chatId, history.messages])
  // B354: the message being edited was deleted (for everyone or for me) — the edit ends.
  useEffect(() => { if (editing && history.status === 'ready' && vanishedFromHistory(editing, history)) setEditing(null) }, [editing, history])
  useEffect(() => {
    if (!highlight) return
    const timer = setTimeout(() => setHighlight(null), 2500)
    return () => clearTimeout(timer)
  }, [highlight])

  // iOS MorseGroupCategorySelection.messageMatchesFilter: with a topic chosen, the history shows that topic only.
  const forum = dialog?.forum ?? null, forumSelected = dialog?.forumSelected ?? null
  useEffect(() => { setPressed(list => stillPressed(list, outgoing.items, new Set(history.messages.map(message => message.id)))) }, [outgoing.items, history.messages])
  const pressedSend = useCallback((send: PressedSend): void => {
    bottom.current = true
    if (!current.current.newerAvailable) pendingScroll.current = 'bottom'
    setPressed(list => [...list, send])
  }, [])
  // A refused send leaves at once (its text is back in the field); a stored one leaves when its item shows, or after a
  // moment if the window never lists it (its chat was left meanwhile).
  const pressSettled = useCallback((id: string, stored: boolean): void => {
    const drop = (): void => setPressed(list => list.some(send => send.id === id) ? list.filter(send => send.id !== id) : list)
    if (stored) setTimeout(drop, 2000); else drop()
  }, [])
  const entries = useMemo<Entry[]>(() => historyEntries(history.messages, withPressed(outgoing.items, pressed), raw => {
    if (forum && !raw.system && !inCategory(raw, forum, forumSelected)) return null
    const message = overlayMessage(raw)
    return message ? { kind: 'message', key: message.id, message, own: message.senderId === accountUid, time: positionMilliseconds(message.position) } : null
  }), [history.messages, outgoing.items, pressed, overlayRevision, accountUid, forum, forumSelected])
  const currentEntries = useRef(entries); currentEntries.current = entries
  const entryTimes = useMemo(() => entries.map(entry => entry.time), [entries])
  const group = dialog?.kind === 'group'
  // A channel's discussion room shows only what the room itself carries; see UserAvatar's roomOnly.
  const roomOnly = Boolean(dialog?.discussion)
  const layouts = useMemo<MessageLayout[]>(() => entries.map((entry, index) => {
    const previous = entries[index - 1], next = entries[index + 1]
    const sender = (value: Entry): string => value.kind === 'local' ? accountUid : value.message.senderId
    const joins = (a: Entry | undefined, b: Entry | undefined): boolean => Boolean(a && b && attachable(a) && attachable(b) && sender(a) === sender(b) &&
      sameDay(a.time, b.time) && b.time - a.time < attachWindowMs && !(b.kind === 'message' && b.key === firstUnread.current))
    const top = joins(previous, entry), bottomJoined = joins(entry, next)
    const incoming = entry.kind === 'message' && !entry.own && !entry.message.system
    return { date: !previous || !sameDay(previous.time, entry.time), unread: entry.kind === 'message' && entry.key === firstUnread.current,
      top, bottom: bottomJoined, name: group && incoming && !top, photo: group && incoming && !bottomJoined, gutter: group && incoming, roomOnly }
  }), [entries, group, accountUid, roomOnly])

  const virtual = useVirtualizer({
    count: entries.length, getScrollElement: () => scroll.current, overscan: 12, paddingStart: 10, paddingEnd: 8,
    estimateSize: index => {
      const entry = entries[index], layout = layouts[index]
      let size = 46
      if (entry?.kind === 'message' && (entry.message.attachments?.length ?? 0) > 0) size += 150
      if ((entry?.kind === 'message' && entry.message.reply) || (entry?.kind === 'local' && entry.item.replyToId)) size += 44
      if (layout?.date) size += 44
      if (layout?.unread) size += 40
      return size
    },
    getItemKey: index => entries[index]!.key
  })
  virtualRef.current = virtual
  // "전체번역" (every chat but memo and secret chats): translate received text rows as they come on screen.
  const autoTranslateOn = useDesktop(snapshot => (snapshot?.preferences.autoTranslateChats ?? false) && translationAvailable(snapshot?.translationRoute)) && !chatId.startsWith('memo_') && dialog?.kind !== 'secret'
  const autoTranslateRef = useRef(autoTranslateOn); autoTranslateRef.current = autoTranslateOn
  const pinnedSnapshot = useDesktop(snapshot => snapshot?.pinnedMessages?.chatId === chatId ? snapshot.pinnedMessages : null)
  const pinnedRef = useRef(pinnedSnapshot); pinnedRef.current = pinnedSnapshot
  const translatableOnScreen = virtual.getVirtualItems().flatMap(item => {
    const entry = entries[item.index]
    return entry?.kind === 'message' && !entry.own && entry.message.kind === 'text' && !entry.message.system && !entry.message.encrypted && entry.message.text.trim() ? [entry.message] : []
  })
  const translatableKey = translatableOnScreen.map(message => `${message.id}:${message.text.length}`).join(',')
  useEffect(() => {
    if (autoTranslateOn && historyReady) autoTranslate(accountUid, chatId, translatableOnScreen, desktop.value?.translationRoute === 'server')
  }, [autoTranslateOn, historyReady, translatableKey, accountUid, chatId])
  // HistoryWidget paints a chat only after its rows are measured and scrolled into place,
  // so opening it does not show rows jumping from estimated heights.
  const [settled, setSettled] = useState(false)
  // ListWidget::countItemsTop: `(_minHeight > full) ? (_minHeight - full) : 0`. Messages shorter than
  // the visible area are pushed down by the difference, so a room with a few of them shows them above
  // the composer instead of floating at the top of an empty window. It is a margin rather than the
  // scroller's own alignment: `justify-content: flex-end` puts a taller list's overflow above the
  // scroll origin, where it cannot be reached at all.
  const [viewport, setViewport] = useState(0)
  useLayoutEffect(() => {
    const element = scroll.current
    if (!element) return
    let height = element.clientHeight
    const observer = new ResizeObserver(() => { height = keepBottomOnResize(element, height, bottom.current); setViewport(height) })
    observer.observe(element); setViewport(height)
    return () => observer.disconnect()
  }, [])
  // B307: the list's height follows a message's new size a render or a layout later (a reaction's chip, a picture
  // measured); a history at its bottom follows it there too (keepsBottomOnChange, tdesktop updateListSize).
  useLayoutEffect(() => {
    const element = scroll.current, inner = element?.querySelector<HTMLElement>('.history-inner')
    if (!element || !inner || !settled) return
    const observer = new ResizeObserver(() => { if (keepsBottomOnChange(false, bottom.current, true)) element.scrollTop = element.scrollHeight })
    observer.observe(inner)
    return () => observer.disconnect()
  }, [settled])
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
    // B306 ②: what joined the bottom of a history followed at its bottom rises into place (item-reveal.ts).
    const keys = entries.map(entry => entry.key), added = appendedCount(revealKeys.current, keys)
    revealKeys.current = keys
    if (added && settled && revealAllowed(target === 'bottom', document.visibilityState === 'visible', document.documentElement.classList.contains('reduce-motion'))) {
      let height = 0
      for (let index = entries.length - added; index < entries.length; index++) height += element.querySelector<HTMLElement>(`[data-index="${index}"]`)?.getBoundingClientRect().height ?? 0
      const inner = element.querySelector<HTMLElement>('.history-inner')
      if (inner && height > 0) reveal(element, inner, height)
    }
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
    } else if (keepsBottomOnChange(false, bottom.current, settled)) {
      // B307: a reaction shown at once (message-overlay.ts) grows its bubble in this pass, so the bottom follows now, not
      // when the server's copy of the message arrives.
      virtual.scrollToIndex(entries.length - 1, { align: 'end' })
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
  // B184: reading down a window that does not reach the newest message — tdesktop's preloadHistoryByScroll calls
  // loadMessagesDown within a few screens of the bottom (history_widget.cpp:5203-5208); here within one screen.
  async function loadNewer(): Promise<void> {
    const value = current.current
    if (pagingRef.current || value.status !== 'ready' || !value.newerAvailable || !value.after) return
    pagingRef.current = true; setPaging(true); bottom.current = false
    try { applyHistory(await window.morse.newerHistory(accountUid, chatId, value.after)) }
    catch (reason) { controller.toast(errorText(reason, tr('다음 메시지를 불러오지 못했습니다.')), 'error') }
    finally { pagingRef.current = false; setPaging(false) }
  }
  const onScroll = (): void => {
    const element = scroll.current
    if (!element) return
    const distance = element.scrollHeight - element.scrollTop - element.clientHeight
    bottom.current = followsBottom(distance, current.current.newerAvailable)
    setAway(distance > 480)
    scrollDate.check()
    if (element.scrollTop < 400) void loadOlder()
    else if (distance < element.clientHeight) void loadNewer()
  }
  async function jumpLatest(): Promise<void> {
    bottom.current = true; pendingScroll.current = 'bottom'
    if (current.current.newerAvailable) {
      try { applyHistory(await window.morse.latestHistory(accountUid, chatId)) } catch (reason) { controller.toast(errorText(reason, tr('최근 메시지를 불러오지 못했습니다.')), 'error') }
    } else if (entries.length) { virtual.scrollToIndex(entries.length - 1, { align: 'end' }); pendingScroll.current = null }
  }

  // HistoryInner's scroll date: the day of the topmost message, floating over the history while it is scrolled.
  const inlineDates = useMemo(() => layouts.map(layout => layout.date), [layouts])
  const scrollDate = useScrollDate(scroll, virtual, entryTimes, inlineDates, settled)
  useEffect(() => { scrollDate.reset() }, [chatId])

  const readError = useVisibleRead(scroll, { accountUid, chatId, history, enabled: historyReady && connection === 'ready' && layerCount === 0 && selection === null && !secret, serverUnread: dialog?.unreadCount ?? 0 })
  useEffect(() => { if (readError) controller.toast(readError, 'error') }, [readError])

  const peers = useMemo(() => dialog ? [...new Set(dialog.participantUids)].filter(uid => uid !== accountUid) : [], [dialog?.participantUids, accountUid])
  // TopBarWidget::updateOnlineDisplay: a 1:1 chat's subtitle is the peer's last seen.
  // B113: a service chat's is «서비스 알림» instead (tdesktop OnlineTextSpecial → lng_status_support, data_peer_values.cpp:69-70).
  const peerPresence = usePresence(dialog?.kind === 'direct' && !service && !chatId.startsWith('memo_') ? peers[0] ?? null : null)
  // History::isServerSideUnread: an own message is read once it is within the room's one outbox boundary.
  const outboxRead = dialog?.outboxRead ?? null
  const readState = (message: ChatMessage): 'sent' | 'read' =>
    message.readEligible && readCovers(outboxRead, readCursor(message.position)) ? 'read' : 'sent'

  const selectReply = useCallback(async (message: ChatMessage): Promise<void> => {
    if (!canReply(message) || !outgoingRef.current.canCompose) return
    setEditing(null)
    try { await trackWrite(window.morse.selectReply(accountUid, chatId, message.id, message.version)); controller.focusComposer() }
    catch (reason) { controller.toast(errorText(reason, tr('답장할 메시지를 선택하지 못했습니다.')), 'error') }
  }, [accountUid, chatId])
  // iOS DeleteConfirmOverlay / Telegram DeleteMessagesBox: for everyone where the room allows it, or for me only.
  // B327b: a message the room lets be deleted at all — the selection offers «삭제» only when every chosen one is.
  const removableMessage = useCallback((message: ChatMessage): boolean => dialogRef.current?.service === true || canDelete(messageDeletion(message, dialogRef.current, accountUid)), [accountUid])
  const removeMessages = useCallback(async (messages: ChatMessage[]): Promise<void> => {
    if (!messages.length) return
    // Saved Messages holds one copy and nobody else sees it, so there is nothing to choose between:
    // Telegram's box there offers a plain Delete, and it takes the note off the server. Deleting it
    // only in this window left it on the phone and brought it back on the next install.
    const saved = chatId === `memo_${accountUid}`
    // B154 §2-1: a notice of the official notice chat is deleted with one question — this account is the room's only
    // person, so «for me» and «for everyone» are the same — and goes as a 1:1 delete for everyone.
    if (dialogRef.current?.service) {
      if (!await confirmBox({ text: messages.length > 1 ? tr('알림 {0}개를 삭제할까요?', [messages.length]) : tr('이 알림을 삭제할까요?'), confirm: tr('삭제'), danger: true })) return
      setSelection(null)
      // A notice the device could not hand over comes back; several are said once.
      void Promise.all(messages.map(message => deleteMessage(accountUid, message, true))).then(done => {
        if (done.includes(false)) controller.toast(done.length > 1 ? tr('알림 일부를 삭제하지 못했습니다.') : tr('알림을 삭제하지 못했습니다.'), 'error')
      })
      return
    }
    const choices = messages.map(message => messageDeletion(message, dialogRef.current, accountUid))
    const forEveryone = choices.every(choice => choice.everyone), forMe = choices.every(choice => choice.me)
    if (!forEveryone && !forMe) return
    const choice = saved ? (forEveryone && await confirmBox({ title: messages.length > 1 ? tr('메모 {0}개 삭제', [messages.length]) : tr('메모 삭제'),
      text: tr('저장한 메시지에서 지웁니다. 다른 기기에서도 사라져요. 되돌릴 수 없어요.'), confirm: tr('삭제'), danger: true }) ? 'everyone' : null)
      : await chooseDeletion(messages.length, forEveryone, messages.every(message => message.senderId === accountUid), forMe)
    if (!choice) return
    setSelection(null)
    if (choice === 'everyone') { for (const message of messages) void deleteMessage(accountUid, message); return }
    void trackWrite(window.morse.hideMessages(accountUid, chatId, messages.map(message => message.id))).then(hideAnswered, reason => controller.toast(errorText(reason, tr('메시지를 삭제하지 못했습니다.')), 'error'))
  }, [accountUid, chatId])
  // B58 (Telegram R-66, history_inner_widget.cpp:641-809): two-finger swipes over the messages. Fingers right close
  // the chat (showBackFromStack with nothing stacked); fingers left reply to the message under the pointer, where a
  // reply is possible and nothing is being chosen.
  const historyBox = useRef<HTMLDivElement>(null)
  const swipeTarget = useRef<{ message: ChatMessage; row: HTMLElement } | null>(null)
  const swipeFrame = useSwipe(scroll, {
    enabled: () => true,
    resolve: (direction, place) => {
      swipeTarget.current = null
      if (direction === 'right-to-left') return 'back'
      if (!swipeAllowed('reply', Boolean(dialogRef.current)) || selectionRef.current !== null) return null
      const row = document.elementFromPoint(place.x, place.y)?.closest<HTMLElement>('.history-message[data-message-id]') ?? null
      const entry = row ? currentEntries.current.find(item => item.kind === 'message' && item.message.id === row.dataset.messageId) : undefined
      const message = entry?.kind === 'message' ? entry.message : null
      if (!row || !message || message.system || message.encrypted || !canReply(message) || !outgoingRef.current.canCompose) return null
      swipeTarget.current = { message, row }
      return 'reply'
    },
    finish: kind => {
      if (kind === 'back') controller.closeChat()
      else if (swipeTarget.current) void selectReply(swipeTarget.current.message)
    },
    row: () => swipeTarget.current?.row ?? null
  })
  // B53: the chosen messages as one text — the author's name, «나»'s own for this account (shared/message-copy.ts).
  const copyMessages = useCallback((messages: ChatMessage[]) => {
    const self = desktop.value?.selfProfile
    const mine = (self?.status === 'ready' ? self.profile?.displayName : '') || tr('나')
    const text = selectedMessagesText(messages, message => message.senderId === accountUid ? mine : message.senderName || dialogRef.current?.title || '')
    if (!text) return
    const copied = copyText(text)
    controller.toast(copied ? tr('복사했습니다.') : tr('복사하지 못했습니다.'), copied ? 'default' : 'error')
  }, [accountUid])
  const openMessageMenu = useCallback((message: ChatMessage, point: { x: number; y: number }, target?: MessageMenuTarget) => {
    // B61: while messages are chosen, the menu on one of them acts on all of them, as Telegram's does — what the
    // selection bar offers, under its rules, and clearing the selection.
    if (selectionRef.current !== null) {
      const chosen = currentEntries.current.flatMap(entry => entry.kind === 'message' && selectionRef.current!.includes(entry.message.id) ? [entry.message] : [])
      popupMenu.open(point, selectionMenuRows(selectionActions(chosen, removableMessage)).map(row =>
        row === 'copy' ? { label: tr('선택한 메시지 복사'), icon: <Copy size={18} />, onSelect: () => copyMessages(chosen) }
        : row === 'forward' ? { label: tr('선택 전달'), icon: <Forward size={18} />, onSelect: () => { showShareBox(accountUid, chosen); setSelection(null) } }
        : row === 'delete' ? { label: tr('선택 삭제'), icon: <Trash2 size={18} />, danger: true, onSelect: () => { void removeMessages(chosen) } }
        : { label: tr('선택 해제'), icon: <X size={18} />, onSelect: () => setSelection(null) }))
      return
    }
    const link = target?.link
    // Telegram «Save As…» / iOS «저장»·«파일로 저장»: the attachment under the pointer, or the first one.
    const parts = (message.attachments ?? []).filter(part => part.available && !part.blind)
    const savable = !message.encrypted && mediaSavable(dialogRef.current) ? parts.find(part => part.index === target?.part) ?? parts[0] : undefined
    const owner = dialogRef.current, mutable = canMutate(message, owner), own = message.senderId === accountUid
    const text = message.kind === 'text' ? message.text : message.caption ?? ''
    const deletable = Boolean(message.version)
    const removable = deletable && canDelete(messageDeletion(message, owner, accountUid))
    // Message menu «번역»: text in another language, one's own too (B356); chosen again, the original returns.
    // A sticker's menu waits a moment for whether it is a favourite (its bytes hashed once per message); not known by
    // then, it offers the add, which for a favourite only moves it to the front.
    let faved: { id: string; favourite: boolean } | null = null
    const open = (translate: MenuEntry): void => {
      const favourite = faved
      const copyLink: MenuEntry | null = link ? { label: link.email ? tr('이메일 복사') : tr('링크 복사'), icon: <Link size={18} />, onSelect: () => { const copied = copyText(link.email ? link.url.replace(/^mailto:/, '') : link.url); controller.toast(copied ? tr('복사했습니다.') : tr('복사하지 못했습니다.'), copied ? 'default' : 'error') } } : null
      const copyMessage: MenuEntry | null = text && !message.encrypted ? { label: tr('텍스트 복사'), icon: <Copy size={18} />, onSelect: () => { const copied = copyText(text); controller.toast(copied ? tr('복사했습니다.') : tr('복사하지 못했습니다.'), copied ? 'default' : 'error') } } : null
      // B113: a notice of the official notice chat offers copying (A13-5 §3-2), and B154 §2-1 one «삭제» (Telegram lets
      // a 777000 message be deleted — MessageObject.canDeleteMessage).
      if (owner?.service) {
        const notice = deletable && message.serverConfirmed && !message.encrypted
        popupMenu.open(point, [copyLink, copyMessage, notice && (copyLink || copyMessage) ? 'separator' : null,
          notice ? { label: tr('삭제'), icon: <Trash2 size={18} />, danger: true, onSelect: () => { void removeMessages([message]) } } : null])
        return
      }
      const entries: MenuEntry[] = [
        // Telegram puts «Copy link» / «Copy email» first when the menu opens on a link.
        copyLink,
        link ? 'separator' : null,
        canReply(message) && outgoingRef.current.canCompose ? { label: tr('답장'), icon: <Reply size={18} />, onSelect: () => { void selectReply(message) } } : null,
        mutable && own && message.kind === 'text' ? { label: tr('수정'), icon: <Pencil size={18} />, onSelect: () => { setEditing(message) } } : null,
        copyMessage,
        translate,
        message.version && message.serverConfirmed && !message.system && !message.encrypted && owner?.kind !== 'secret'
          ? (pinnedRef.current?.items.some(item => item.id === message.id)
            ? { label: tr('고정 해제'), icon: <PinOff size={18} />, onSelect: () => { void togglePin(accountUid, chatId, message.id, pinnedRef.current) } }
            : { label: tr('고정'), icon: <Pin size={18} />, onSelect: () => { void togglePin(accountUid, chatId, message.id, pinnedRef.current) } }) : null,
        // B208: a sticker is added to this device's favourites or taken out of them, by whether it is one
        // (tdesktop history_view_context_menu.cpp:480-489 «Add to Favorites» / «Remove from Favorites»).
        message.kind === 'sticker' && savable ? (favourite?.favourite
          ? { label: tr('즐겨찾기에서 삭제'), icon: <StarOff size={18} />, onSelect: () => { void window.morse.removeSticker(accountUid, favourite.id).then(() => controller.toast(tr('즐겨찾기에서 삭제했어요')), reason => controller.toast(errorText(reason, tr('처리하지 못했습니다. 다시 시도해 주세요.')), 'error')) } }
          : { label: tr('즐겨찾기에 추가'), icon: <Star size={18} />, onSelect: () => { void saveSticker(accountUid, chatId, message) } }) : null,
        savable && message.kind !== 'sticker' ? { label: message.kind === 'voice' ? tr('파일로 저장') : tr('저장'), icon: <Download size={18} />, onSelect: () => { void saveAttachment(accountUid, chatId, message, savable.index) } } : null,
        savable ? showInFolderItem(accountUid, chatId, message, savable.index) : null,
        // AddPhotoActions: «Copy Image» beside the save, under the same restriction.
        savable?.kind === 'image' ? { label: tr('이미지 복사'), icon: <Copy size={18} />, onSelect: () => { void copyAttachmentImage(accountUid, chatId, message, savable.index) } } : null,
        canForwardMessage(message) ? { label: tr('전달'), icon: <Forward size={18} />, onSelect: () => showShareBox(accountUid, [message]) } : null,
        message.version && !message.system ? { label: tr('선택'), icon: <Check size={18} />, onSelect: () => setSelection([message.id]) } : null,
        // A10 §3-1: 메시지 자체를 신고한다(type message + chatId, 규칙이 신고자가 그 방 참여자인지 본다). 6A-5 결정(텔레그램
        // suggestReport): 그룹(토론방 포함)에서만 — 1:1·비밀 대화는 사람 신고(정보 칸·모르는 사람 줄)로 한다. 내가 참여자가
        // 아닌 토론방은 옛 모양 — 보낸 사람 + 설명의 좌표 — 그대로 보낸다(규칙이 여전히 받는다).
        !own && !message.system && message.senderId && messageReportAllowed(owner?.kind) ? { label: tr('신고'), icon: <Flag size={18} />, danger: true,
          onSelect: () => owner && owner.participantUids.includes(accountUid)
            ? showReportBox(accountUid, { type: 'message', targetId: message.id, chatId }, tr('메시지 신고'))
            : showReportBox(accountUid, { type: 'user', targetId: message.senderId }, tr('메시지 신고'), null, tr('신고한 메시지: 대화 {0}, 메시지 {1}', [chatId, message.id])) } : null,
        removable ? 'separator' : null,
        removable ? { label: tr('삭제'), icon: <Trash2 size={18} />, danger: true, onSelect: () => { void removeMessages([message]) } } : null
      ]
      popupMenu.open(point, entries, { header: mutable ? <ReactionStrip accountUid={accountUid} mine={message.reactions.filter(item => item.selected).map(item => item.emoji)}
        onPick={emoji => { popupMenu.close(); void toggleReaction(accountUid, message, emoji) }} /> : undefined })
    }
    const proceed = (): void => {
      void translationMenuEntry(accountUid, chatId, message, owner?.kind, desktop.value?.translationRoute, autoTranslateRef.current).then(open, () => open(null))
    }
    if (message.kind !== 'sticker' || !savable || !message.version) { proceed(); return }
    void Promise.race([window.morse.stickerMessageFavourite(accountUid, chatId, message.id, message.version).catch(() => null), new Promise<null>(resolve => setTimeout(() => resolve(null), 600))])
      .then(state => { faved = state; proceed() })
  }, [accountUid, chatId, selectReply, removeMessages, copyMessages])
  const openLocalMenu = useCallback((item: LocalOutgoing, point: { x: number; y: number }) => {
    // Pressed a moment ago and not yet in the queue: nothing to retry or cancel there yet.
    if (isPressedItem(item)) return
    const failed = deliveryFailed(item.state)
    popupMenu.open(point, [
      item.retryable ? { label: tr('다시 보내기'), icon: <RotateCcw size={18} />, onSelect: () => { void window.morse.retryMessage(accountUid, chatId, item.id).catch(reason => controller.toast(errorText(reason, tr('다시 보내지 못했습니다.')), 'error')) } } : null,
      // B269: a medium's file name is not its text; its caption is.
      (item.media ? item.media.caption : item.text) ? { label: tr('텍스트 복사'), icon: <Copy size={18} />, onSelect: () => { controller.toast(copyText(item.media ? item.media.caption : item.text) ? tr('복사했습니다.') : tr('복사하지 못했습니다.')) } } : null,
      // A10 §4 (Telegram R-56): refused because the operator restricted or banned this account — the operator's mail.
      item.sanction ? { label: tr('자세히·이의 제기'), icon: <Info size={18} />, onSelect: () => { void window.morse.operatorMail(accountUid, item.sanction!, item.sanctionUntil ?? null).catch(reason => controller.toast(errorText(reason, tr('메일을 열지 못했습니다.')), 'error')) } } : null,
      // A sent item is already the server's message; only the history's own menu changes it.
      item.state !== 'sent' && { label: failed ? tr('삭제') : tr('보내기 취소'), icon: <Trash2 size={18} />, danger: true, onSelect: () => { void window.morse.discardOutgoing(accountUid, chatId, item.id).catch(reason => controller.toast(errorText(reason, tr('처리하지 못했습니다.')), 'error')) } }
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
  const { copy: canCopySelection, forward: canForwardSelection, delete: canDeleteSelection } = selectionActions(selected, removableMessage)
  // Telegram: Cmd/Ctrl+C with messages chosen, and no words selected on the page, copies them.
  useEffect(() => {
    if (!canCopySelection) return
    const keydown = (event: KeyboardEvent): void => {
      if (!(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey || (event.code !== 'KeyC' && event.key.toLowerCase() !== 'c')) return
      if ((event.target as HTMLElement | null)?.closest?.('input, textarea, [contenteditable="true"]') || window.getSelection()?.toString()) return
      event.preventDefault(); copyMessages(selected)
    }
    document.addEventListener('keydown', keydown)
    return () => document.removeEventListener('keydown', keydown)
  }, [canCopySelection, selected, copyMessages])
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

  // B327: «나에게만» (every device of this account) or «모두에게» (clear-history-box.tsx); the notice chat clears for this
  // account only.
  function clearHistory(): void { if (dialog) showClearHistoryBox(accountUid, dialog) }
  function openMore(point: { x: number; y: number }): void {
    popupMenu.open(point, [
      dialog && !secret ? { label: tr('대화 안 검색'), icon: <Search size={18} />, disabled: !historyReady, onSelect: () => controller.setRight('search') } : null,
      dialog ? { label: tr('정보 보기'), icon: <Info size={18} />, onSelect: () => controller.setRight('info') } : null,
      dialog && historyReady && !secret && !service ? { label: tr('메시지 선택'), icon: <Check size={18} />, onSelect: () => setSelection([]) } : null,
      dialog && !secret ? { label: tr('배경 설정'), icon: <Images size={18} />, onSelect: () => showChatBackgroundBox(accountUid, chatId) } : null,
      dialog && !secret && !service ? { label: tr('자동 삭제'), icon: <Timer size={18} />, disabled: !canChangeAutoDelete(dialog, accountUid), onSelect: () => showChatAutoDeleteBox(accountUid, dialog) } : null,
      dialog && !secret && !chatId.startsWith('memo_') ? { label: tr('대화 기록 삭제'), icon: <Trash2 size={18} />, danger: true, onSelect: () => clearHistory() } : null,
      !dialog && pending ? { label: tr('새 대화 삭제'), icon: <Trash2 size={18} />, danger: true, onSelect: () => {
        void window.morse.discardDirectDraft(accountUid, chatId).then(() => controller.closeChat()).catch(reason => controller.toast(errorText(reason, tr('새 대화를 삭제하지 못했습니다.')), 'error'))
      } } : null
    ])
  }

  // Saved Messages is one thing with one name, wherever it is shown: the notes screen lists it and this
  // header names it the same, as Telegram gives Saved Messages one name and one bookmark everywhere.
  // Its stored chat title is whatever the client that made the room wrote there; iOS never shows it.
  const saved = chatId === `memo_${accountUid}`
  // A 1:1 chat's other person, whose stories the header's picture shows (a secret chat keeps its picture hidden).
  const storyPeer = dialog?.kind === 'direct' && !service && !saved ? dialog.participantUids.find(uid => uid !== accountUid) ?? null : null
  const storyEntry = usePeerStoryEntry(accountUid, storyPeer)
  const title = saved ? tr('저장한 메시지') : dialog?.title ?? pending?.displayName ?? tr('대화')
  const typing = useTyping(chatId)
  const subtitle = !dialog ? pending ? tr('새 대화') : '' : shownConnection !== 'ready' ? linkLabel(shownConnection) : secret ? tr('비밀 대화') : service ? tr('서비스 알림') : typing ? tr('입력 중...') : group ? tr('참여자 {0}명', [dialog.participantUids.length]) : peerPresence?.text ?? ''
  const surface = secret ? defaultChatBackground : background?.value ?? deviceBackground
  const scope = background?.value ? { kind: 'chat' as const, accountUid, chatId } : { kind: 'device' as const }
  // A10 §4 (Telegram restriction_reason): a room the operator closed shows why instead of its messages.
  const closed = dialog?.restricted === true
  // B178 §2-2: a chat before its first message (pending) is marked by its peer's profile too.
  const titleOfficial = dialog ? dialog.official : pending?.official
  const bodyNotice = closed ? chatRestrictedNotice() : !dialog ? pending ? tr('첫 메시지를 보내면 대화가 시작됩니다.') : tr('대화를 찾을 수 없습니다.')
    : history.status === 'loading' && !entries.length ? null : history.status !== 'ready' && !entries.length ? history.message || tr('대화를 불러오지 못했습니다.') : historyReady && !entries.length ? tr('아직 메시지가 없습니다.') : ''

  return <section className="history-widget" aria-label={tr('{0} 대화', [title])}>
    <header className={`top-bar${leftmost ? ' leftmost' : ''}`}>
      {oneColumn && selection === null && <button className="icon-button" aria-label={tr('대화 목록으로')} onClick={() => controller.closeChat()}><ArrowLeft size={22} /></button>}
      {selection !== null ? <>
        <button className="icon-button" aria-label={tr('선택 취소')} onClick={() => setSelection(null)}><X size={22} /></button>
        <strong className="top-bar-selection">{tr('{0}개 선택', [selected.length])}</strong>
        <button className="button flat" disabled={!canCopySelection} onClick={() => copyMessages(selected)}><Copy size={18} />{tr('복사')}</button>
        <button className="button flat" disabled={!canForwardSelection} onClick={() => { showShareBox(accountUid, selected); setSelection(null) }}><Forward size={18} />{tr('전달')}</button>
        <button className="button flat danger" disabled={!canDeleteSelection} onClick={() => { void removeMessages(selected) }}><Trash2 size={18} />{tr('삭제')}</button>
      </> : <>
        {/* B408 S2: the other person's picture carries their stories' ring, and a press on it opens them (tdesktop
            TopBarWidget); the name beside it still opens the chat's profile. */}
        {storyEntry && dialog && storyPeer && <PeerStoryRing accountUid={accountUid} peerUid={storyPeer} name={dialog.title} entry={storyEntry}>
          <PeerAvatar id={dialog.id} name={dialog.title} image={dialog.avatar} surface="dialogs" size={32} priority />
        </PeerStoryRing>}
        <button type="button" className="top-bar-peer" onClick={() => { if (dialog) controller.toggleRight('info') }}>
          {/* A room of one's own has no one to show a picture of: the bookmark stands for it, and no photo is
              asked for (the account has no peer here, so every such request could only fail). */}
          {storyEntry && storyPeer ? null : saved ? <span className="avatar avatar-saved" style={{ width: 36, height: 36 }} aria-hidden="true"><Bookmark size={18} /></span>
            : dialog ? <PeerAvatar id={dialog.id} name={dialog.title} image={secret ? null : dialog.avatar} surface="dialogs" kind={secret ? 'secret' : undefined} size={36} priority /> : pending ? <PeerAvatar id={chatId} name={title} image={pending.avatar ?? null} surface="dialogs" size={36} priority /> : <Avatar name={title} size={36} />}
          <span className="top-bar-title"><strong className="top-bar-name"><span className="ellipsis">{title}</span>{titleOfficial && <OfficialMark kind={titleOfficial} size={15} className="title-official" />}</strong>{subtitle && <span className={`ellipsis${typing && subtitle === tr('입력 중...') ? ' typing' : peerPresence?.online && subtitle === peerPresence.text ? ' online' : ''}`}>{subtitle}</span>}</span>
        </button>
        {dialog && !secret && <button className={`icon-button${right === 'search' ? ' active' : ''}`} aria-label={tr('대화 안 검색')} disabled={!historyReady} onClick={() => controller.toggleRight('search')}><Search size={20} /></button>}
        {dialog && <button className={`icon-button${right === 'info' ? ' active' : ''}`} aria-label={tr('정보')} onClick={() => controller.toggleRight('info')}><Info size={20} /></button>}
        <button className="icon-button" aria-label={tr('더 보기')} onClick={event => openMore(pointFor(event, event.currentTarget))}><EllipsisVertical size={20} /></button>
      </>}
    </header>
    {dialog && dialog.kind === 'direct' && !service && selection === null && <PeerBar accountUid={accountUid} dialog={dialog} />}
    {dialog && !secret && <PinnedBar accountUid={accountUid} chatId={chatId} />}
    {dialog && forum && <CategoryBar accountUid={accountUid} chatId={chatId} forum={forum} selected={forumSelected}
      owner={dialog.kind === 'group' && dialog.createdBy === accountUid && !dialog.discussion} />}
    <PlaybackBar chatId={chatId} />
    {dialog && !secret && <DeferredBar accountUid={accountUid} chatId={chatId} />}
    {dialog?.historyMessage && <p className="history-banner" role="status">{dialog.historyMessage}</p>}
    <div className="history" ref={historyBox} onDragEnter={dragOver} onDragOver={dragOver} onDrop={drop}
      onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(null) }}>
      <BackgroundSurface value={surface} scope={scope} />
      {scrollDate.value && <div className={`history-floating-date${scrollDate.value.shown ? ' shown' : ''}`}>
        <button type="button" className="service-pill" tabIndex={scrollDate.value.shown ? 0 : -1} title={tr('날짜로 이동')}
          onClick={() => { if (dialog && !secret && historyReady) showDateJumpBox(accountUid, chatId, scrollDate.value!.time) }}>{serviceDate(scrollDate.value.time)}</button>
      </div>}
      <div ref={scroll} className={`history-scroll${selection !== null ? ' selecting' : ''}`} onScroll={onScroll} tabIndex={-1} data-region-focus aria-busy={paging || history.status === 'loading'}>
        <div className={`history-inner${settled ? '' : ' settling'}`} style={{ height: `calc(${virtual.getTotalSize()}px - var(--reveal, 0px))`, marginTop: Math.max(0, viewport - virtual.getTotalSize()) }}>
          {!closed && virtual.getVirtualItems().map(item => {
            const entry = entries[item.index]!, layout = layouts[item.index]!
            return <div key={item.key} data-index={item.index} ref={virtual.measureElement} className="history-row" style={{ transform: `translateY(${item.start}px)` }}>
              {layout.date && <div className="history-date"><button type="button" className="service-pill" title={tr('날짜로 이동')}
                onClick={() => { if (dialog && !secret && historyReady) showDateJumpBox(accountUid, chatId, entry.time) }}>{serviceDate(entry.time)}</button></div>}
              {layout.unread && <div className="history-unread-bar">{tr('읽지 않은 메시지')}</div>}
              {/* B409: one view for a message on its way and for its server copy (tdesktop HistoryItem::setRealId), so the
                  answer changes the row's state and not the row (localChatMessage). */}
              {entry.kind === 'message'
                ? <MessageView accountUid={accountUid} chatId={chatId} message={entry.message} own={entry.own} layout={layout} read={entry.own ? readState(entry.message) : 'sent'}
                  selecting={selection !== null} selected={selection?.includes(entry.message.id) ?? false} highlighted={highlight === entry.message.id}
                  autoTranslate={autoTranslateOn} onMenu={openMessageMenu} onReply={replyByDoubleClick} onJumpReply={jumpReply} onOpenMedia={openMedia} onToggle={toggleSelected} onReaction={react} />
                : <MessageView accountUid={accountUid} chatId={chatId} message={localChatMessage(entry.item, accountUid, entry.item.replyToId ? history.replyQuotes?.[entry.item.replyToId] ?? { state: 'loading' } : undefined)}
                  own layout={layout} read="sent" selecting={selection !== null} selected={false} highlighted={false} autoTranslate={autoTranslateOn}
                  onMenu={openMessageMenu} onReply={replyByDoubleClick} onJumpReply={jumpReply} onOpenMedia={openMedia} onToggle={toggleSelected} onReaction={react}
                  outgoing={{ item: entry.item, onMenu: openLocalMenu }} />}
            </div>
          })}
        </div>
        {paging && <div className="history-paging"><Spinner size={18} /></div>}
      </div>
      <SwipeBack frames={swipeFrame} />
      <SwipeReply frames={swipeFrame} row={() => swipeTarget.current?.row ?? null} host={() => historyBox.current} />
      {/* B103: a chat this session has not read yet shows its background and the composer while its first messages come,
          as tdesktop's paintEvent does with no history yet (history_widget.cpp:11398) — no spinner. */}
      {bodyNotice && <div className="history-notice" role="status">
        <span className="service-pill">{bodyNotice}</span>
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
    {/* B113: a read-only chat has no composer; its place holds the mute, as tdesktop's broadcast channel bar (muteUnmute). */}
    {service && dialog ? <div className="compose compose-readonly">
      <button type="button" className="button flat block" onClick={() => { void setChatFlag(accountUid, dialog.id, { muted: !dialog.muted }) }}>{dialog.muted ? tr('알림 켜기') : tr('알림 끄기')}</button>
    </div>
    : (dialog || pending) && <Compose accountUid={accountUid} chatId={chatId} dialog={dialog} outgoing={outgoing} reply={reply} editing={editing}
      onCancelEdit={() => setEditing(null)}
      onEditLast={() => {
        const last = [...entries].reverse().find(entry => entry.kind === 'message' && entry.own && entry.message.kind === 'text' && canMutate(entry.message, dialog))
        if (last?.kind === 'message') setEditing(last.message)
      }}
      onSent={() => { bottom.current = true; if (current.current.newerAvailable) void jumpLatest() }}
      onPressed={pressedSend} onPressSettled={pressSettled} />}
  </section>
}

function DeleteMessagesBox({ count, forEveryone, forMe, direct, choose, close }: { count: number; forEveryone: boolean; forMe: boolean; direct: boolean; choose(value: 'everyone' | 'me'): void; close(): void }) {
  return <Box title={count > 1 ? tr('{0}개 메시지 삭제', [count]) : tr('메시지 삭제')} width={360} onClose={close} buttons={<button className="button flat" onClick={close}>{tr('취소')}</button>}>
    <p className="box-text">{tr('삭제된 메시지는 복구할 수 없어요.')}</p>
    <DeleteChoice rows={[
      forEveryone && { label: tr('모두에게 삭제'), detail: direct ? tr('상대방 화면에서도 삭제돼요') : tr('모든 참여자의 화면에서 삭제돼요'), danger: true, choose: () => { choose('everyone'); close() } },
      forMe && { label: tr('나에게만 삭제'), detail: tr('내 화면에서만 삭제돼요'), choose: () => { choose('me'); close() } }
    ]} />
  </Box>
}

export function chooseDeletion(count: number, forEveryone: boolean, direct: boolean, forMe = true): Promise<'everyone' | 'me' | null> {
  return new Promise(resolve => {
    let settled = false
    const settle = (value: 'everyone' | 'me' | null): void => { if (!settled) { settled = true; resolve(value) } }
    controller.showLayer(close => <DeleteMessagesBox count={count} forEveryone={forEveryone} forMe={forMe} direct={direct} choose={settle} close={() => { settle(null); close() }} />, { onClose: () => settle(null) })
  })
}

// A secret room's media is never saved (iOS hides «저장» there).
function mediaSavable(dialog: DialogSummary | null): boolean { return Boolean(dialog && dialog.kind !== 'secret') }

// F2: «폴더에서 보기» for a file that is here (tdesktop lng_context_show_in_folder, shown for a loaded document only).
export function showInFolderItem(accountUid: string, chatId: string, message: ChatMessage, index: number) {
  if (message.kind !== 'file' || !fileReady(chatId, message.id, index)) return null
  return { label: tr('폴더에서 보기'), icon: <FolderOpen size={18} />, onSelect: () => {
    void window.morse.showFileInFolder(accountUid, chatId, { requestId: crypto.randomUUID(), messageId: message.id, version: message.version, index })
      .catch(reason => controller.toast(errorText(reason, tr('파일을 열지 못했습니다.')), 'error'))
  } }
}

export async function saveAttachment(accountUid: string, chatId: string, message: ChatMessage, index: number): Promise<void> {
  const requestId = crypto.randomUUID()
  try {
    await window.morse.openMedia(accountUid, chatId, { requestId, messageId: message.id, version: message.version, index })
    if (await window.morse.saveMedia(accountUid, requestId)) controller.toast(tr('파일을 저장했습니다.'))
  } catch (reason) { controller.toast(errorText(reason, tr('파일을 저장하지 못했습니다.')), 'error') }
  finally { void window.morse.closeMedia(accountUid, requestId).catch(() => {}) }
}

export async function copyAttachmentImage(accountUid: string, chatId: string, message: ChatMessage, index: number): Promise<void> {
  const requestId = crypto.randomUUID()
  try {
    const ready = await window.morse.openMedia(accountUid, chatId, { requestId, messageId: message.id, version: message.version, index })
    if (!ready.url || ready.presentation !== 'image') throw new Error(tr('이미지를 복사하지 못했습니다.'))
    await copyImage(ready.url)
  } catch (reason) { controller.toast(errorText(reason, tr('이미지를 복사하지 못했습니다.')), 'error') }
  finally { void window.morse.closeMedia(accountUid, requestId).catch(() => {}) }
}

export async function saveSticker(accountUid: string, chatId: string, message: ChatMessage): Promise<void> {
  try {
    // B210: main faves the message's sticker document (or registers its bytes first, for one sent before references).
    await window.morse.faveStickerMessage(accountUid, chatId, message.id, message.version)
    controller.toast(tr('즐겨찾기에 저장했어요'))
  } catch (reason) { controller.toast(errorText(reason, tr('처리하지 못했습니다. 다시 시도해 주세요.')), 'error') }
}

// B327b: the server's list of this room's messages deleted for me is full — this device has it, the account's others
// not; «기록 비우기(나에게만)» clears the rest everywhere (contract §2-1 TOO_MANY_HIDDEN).
export function hideAnswered(answer: 'done' | 'too-many'): void {
  if (answer === 'too-many') controller.toast(tr('이 대화에서 나에게만 삭제한 메시지가 너무 많아 다른 기기에서는 그대로 보여요. 모든 기기에서 지우려면 «대화 기록 삭제»에서 «나에게만 삭제»를 골라 주세요.'))
}
