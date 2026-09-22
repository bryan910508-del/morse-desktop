import { memo, useEffect, useMemo, useRef, type CSSProperties, type KeyboardEvent } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { Archive, ArchiveRestore, ArrowLeft, ArrowUpDown, Bell, BellOff, CircleAlert, Clock3, FolderPlus, Lock, LogOut, Mail, MailOpen, Menu, Pencil, Pin, PinOff, Search, StickyNote, Trash2, Users, X } from 'lucide-react'
import type { ContactSummary } from '../../../shared/contacts'
import { folderContains, folderTitle, type ChatFolder } from '../../../shared/chat-folders'
import type { ConnectionState, DialogSummary } from '../../../shared/model'
import type { InquiryRow } from '../../../shared/channel-inquiries'
import { openInquiries } from '../channels/channel-ui'
import { useInquirySendState } from '../channels/inquiry-sends'
import { leaveDiscussionRoom } from '../channels/discussion-leave'
import type { PendingDirect } from '../../../shared/delivery'
import { effectiveUnreadCount } from '../../../shared/manual-unread'
import { searchFold } from '../../../shared/search'
import { useDesktop } from '../app/store'
import { controller, ui, useUi, type Folder } from '../app/ui'
import { dialogTime, errorText, positionTime } from '../app/format'
import { Avatar, PeerAvatar } from '../ui/avatar'
import { Spinner } from '../ui/controls'
import { Box, confirmBox } from '../ui/layers'
import { trackWrite } from '../app/drafts'
import { popupMenu, pointFor } from '../ui/popup-menu'
import { dialogFlags, reconcileDialogs, reconcilePin, reconcileUnread, setPinned, setUnread, useDialogOverrides } from './dialog-overrides'
import { ChannelHome } from '../channels/channel-home'
import { loadChatFolders, receiveChatFolders, toggleChatPinnedInFolder, useChatFolders } from '../app/chat-folders'
import { removeChatFolder, showFolderEditBox, showFolderPickerBox, showFoldersBox } from '../boxes/chat-folder-boxes'
import { StoriesRow } from '../stories/stories-row'
import { tr } from '../../../shared/i18n'
import { useListTyping } from '../app/typing'

const noDialogs: DialogSummary[] = []
const noPending: PendingDirect[] = []
const noContacts: ContactSummary[] = []
const noInquiryRows: InquiryRow[] = []
export const folders: { id: Folder; label: string }[] = [
  { id: 'all', label: tr('전체') }, { id: 'personal', label: tr('개인') }, { id: 'groups', label: tr('그룹') }, { id: 'channels', label: tr('채널', [], 'folder') }, { id: 'unread', label: tr('읽지 않음') }
]
const connectionLabels: Record<ConnectionState, string> = {
  ready: '', offline: tr('연결 대기 중'), connecting: tr('연결 중…'), registering: tr('계정 확인 중…'), suspended: tr('연결 일시 중지'), rejected: tr('다시 로그인해 주세요')
}

type Row = { kind: 'dialog'; dialog: DialogSummary } | { kind: 'pending'; pending: PendingDirect }
  | { kind: 'inquiry'; inquiry: InquiryRow } | { kind: 'archive'; count: number; unread: number } | { kind: 'notes' }
function rowKey(row: Row): string {
  return row.kind === 'dialog' ? row.dialog.id : row.kind === 'pending' ? `pending:${row.pending.chatId}`
    : row.kind === 'inquiry' ? row.inquiry.id : row.kind
}

function inFolder(dialog: DialogSummary, folder: Folder): boolean {
  if (folder === 'personal') return dialog.kind === 'direct' || dialog.kind === 'secret'
  if (folder === 'groups') return dialog.kind === 'group'
  if (folder === 'unread') return effectiveUnreadCount(dialog) > 0
  return true
}

// Telegram's "Delete chat" asks a private room's owner which side to clear; the message pin box
// sets the pattern for a choice like this one.
function ChatDeleteBox({ close, onChoose }: { close(): void; onChoose(forEveryone: boolean): void }) {
  const choose = (forEveryone: boolean): void => { close(); onChoose(forEveryone) }
  return <Box title={tr('대화 삭제')} width={360} onClose={close} buttons={<button className="button flat" onClick={close}>{tr('취소')}</button>}>
    <p className="box-text">{tr('나에게만 지우면 이 기기에서 기록이 지워지고, 새 메시지가 오면 그 메시지부터 다시 보여요. 모두에게서 지우면 상대방 목록과 기록에서도 사라지고 되돌릴 수 없어요.')}</p>
    <div className="pin-type-actions">
      <button type="button" className="button secondary block" onClick={() => choose(false)}>{tr('나에게만 삭제')}</button>
      <button type="button" className="button primary block danger" onClick={() => choose(true)}>{tr('모두에게 삭제')}</button>
    </div>
  </Box>
}

// A subscriber's inquiry room, and an owner's folder of them (which opens that channel's list). The room marks a
// message of mine that did not go and one on its way, as iOS MorseInquiryListRowModel does; a folder is not a room.
function InquiryDialogRow({ accountUid, inquiry, style, index }: { accountUid: string; inquiry: InquiryRow; style: CSSProperties; index: number }) {
  const sends = useInquirySendState(accountUid, inquiry.kind === 'ownerFolder' ? null : inquiry.inquiryId)
  return <button type="button" className="dialog-row" style={style} data-row={index}
    onClick={() => { controller.openChannelPanel(inquiry.channelId); openInquiries(inquiry.channelId, inquiry.inquiryId) }}>
    <PeerAvatar id={inquiry.channelId} name={inquiry.title} image={inquiry.photo ?? null} surface="dialogs" />
    <span className="dialog-row-body">
      <span className="dialog-row-line">
        <span className="dialog-row-name ellipsis">{inquiry.title}</span>
        {sends.failed && <CircleAlert size={14} className="dialog-row-failed" aria-label={tr('보내지 못한 메시지가 있습니다')} />}
        <span className="dialog-row-time">{dialogTime(inquiry.lastMessageAt)}</span>
      </span>
      <span className="dialog-row-line">
        <span className="dialog-row-preview ellipsis">{inquiry.kind === 'ownerFolder' ? tr('1:1 문의 {0}개', [inquiry.rooms]) : tr('1:1 문의')} · {inquiry.preview || tr('메시지 없음')}</span>
        {sends.sending && <Clock3 size={12} className="dialog-row-sending" aria-label={tr('보내는 중')} />}
        {inquiry.unread > 0 && <span className="dialog-row-badge" aria-label={tr('읽지 않은 메시지 {0}개', [inquiry.unread])}>{inquiry.unread > 999 ? '999+' : inquiry.unread}</span>}
      </span>
    </span>
  </button>
}

const DialogRow = memo(function DialogRow({ dialog, active, style, index, flags, onMenu }: {
  dialog: DialogSummary; active: boolean; style: CSSProperties; index: number; flags: ReturnType<typeof dialogFlags>; onMenu(dialog: DialogSummary, point: { x: number; y: number }): void
}) {
  const secret = dialog.kind === 'secret'
  const typing = useListTyping(dialog.id, dialog.kind === 'group')
  // Dialogs::Row online badge (iOS MorseListOnlineIndicator) for a 1:1 peer who is online.
  const online = useDesktop(snapshot => {
    const me = snapshot?.activeAccountUid, peer = dialog.kind === 'direct' && me ? dialog.participantUids.find(uid => uid !== me) : undefined
    return Boolean(peer && snapshot?.presence?.[peer]?.s === 'online')
  })
  return <button type="button" className={`dialog-row${active ? ' active' : ''}`} style={style} data-row={index} aria-current={active ? 'true' : undefined}
    onClick={() => controller.openChat(dialog.id)}
    onContextMenu={event => { event.preventDefault(); onMenu(dialog, pointFor(event, event.currentTarget)) }}
    onKeyDown={event => { if ((event.key === 'F10' && event.shiftKey) || event.key === 'ContextMenu') { event.preventDefault(); onMenu(dialog, pointFor(null, event.currentTarget)) } }}>
    <span className="dialog-row-photo"><PeerAvatar id={dialog.id} name={dialog.title} image={secret ? null : dialog.avatar} surface="dialogs" kind={secret ? 'secret' : undefined} priority={active} />{online && <i className="online-dot" aria-label={tr('온라인')} />}</span>
    <span className="dialog-row-body">
      <span className="dialog-row-line">
        {dialog.kind === 'group' && <Users size={14} className="dialog-row-kind" aria-label={tr('그룹', [], 'kind')} />}
        {secret && <Lock size={13} className="dialog-row-kind secret" aria-label={tr('비밀 대화')} />}
        <span className="dialog-row-name ellipsis">{dialog.title}</span>
        {/* iOS MorseChatListRowDisplay: a message of mine that did not go marks the row beside its name. */}
        {!secret && dialog.sends?.failed && <CircleAlert size={14} className="dialog-row-failed" aria-label={tr('보내지 못한 메시지가 있습니다')} />}
        {dialog.muted && <BellOff size={13} className="dialog-row-status" aria-label={tr('알림 꺼짐')} />}
        <span className="dialog-row-time">{dialogTime(positionTime(dialog.top))}</span>
      </span>
      <span className="dialog-row-line">
        {typing ? <span className="dialog-row-preview typing ellipsis">{typing}</span>
          : <span className="dialog-row-preview ellipsis">{secret ? tr('이 기기에서는 열 수 없는 비밀 대화') : dialog.preview}</span>}
        {/* iOS latestReactionEmoji: someone's newest reaction to my message, before the unread count. */}
        {/* …and a clock under the time while the newest of mine is still on its way (iOS/Android sendingClock). */}
        {!secret && dialog.sends?.sending && <Clock3 size={12} className="dialog-row-sending" aria-label={tr('보내는 중')} />}
        {!secret && dialog.unseenReaction && <span className="dialog-row-reaction" aria-label={tr('새 반응 {0}', [dialog.unseenReaction.emoji])}>{dialog.unseenReaction.emoji}</span>}
        {flags.unread > 0 ? <span className={`dialog-row-badge${dialog.muted ? ' muted' : ''}`} aria-label={tr('읽지 않은 메시지 {0}개', [flags.unread])}>{flags.unread > 999 ? '999+' : flags.unread}</span>
          : flags.marked ? <span className={`dialog-row-badge mark${dialog.muted ? ' muted' : ''}`} aria-label={tr('읽지 않음 표시')} />
            : flags.pinned ? <Pin size={14} className="dialog-row-status" aria-label={tr('고정됨')} /> : null}
      </span>
    </span>
  </button>
})

// Dialogs::Widget: search, folder tabs, then the virtualized chat list.
export function DialogsWidget({ accountUid }: { accountUid: string }) {
  const dialogs = useDesktop(snapshot => snapshot?.dialogs ?? noDialogs)
  const status = useDesktop(snapshot => snapshot?.dialogStatus ?? 'loading')
  const message = useDesktop(snapshot => snapshot?.dialogMessage ?? '')
  const connection = useDesktop(snapshot => snapshot?.connection ?? 'offline')
  // A room whose pair already has a dialog is that dialog (PendingDirect.supersededBy): it is not a row.
  const pendingRooms = useDesktop(snapshot => snapshot?.pendingDirects ?? noPending)
  const pending = useMemo(() => pendingRooms.filter(item => !item.supersededBy), [pendingRooms])
  const pinState = useDesktop(snapshot => snapshot?.dialogPin ?? null)
  const unreadState = useDesktop(snapshot => snapshot?.manualUnread ?? null)
  const query = useUi(state => state.dialogsQuery)
  const folder = useUi(state => state.folder)
  const archived = useUi(state => state.archived)
  const selected = useUi(state => state.chatId)
  const searchFocus = useUi(state => state.searchFocus)
  const overridesVersion = useDialogOverrides()
  const customFolders = useChatFolders(accountUid)
  const lockEnabled = useDesktop(snapshot => snapshot?.appLock?.enabled ?? false)
  const contactItems = useDesktop(snapshot => snapshot?.contacts?.items ?? noContacts)
  const contactSet = useMemo(() => new Set(contactItems.map(item => item.uid)), [contactItems])
  const custom = folder.startsWith('folder:') ? customFolders.find(item => `folder:${item.id}` === folder) ?? null : null
  useEffect(() => { void loadChatFolders(accountUid).catch(() => {}) }, [accountUid])
  const liveFolders = useDesktop(snapshot => snapshot?.activeAccountUid === accountUid ? snapshot.chatFolders : null)
  useEffect(() => { if (liveFolders) receiveChatFolders(accountUid, liveFolders) }, [accountUid, liveFolders])
  useEffect(() => { if (folder.startsWith('folder:') && !custom) controller.setFolder('all') }, [folder, custom])
  const search = useRef<HTMLInputElement>(null), scroll = useRef<HTMLDivElement>(null)

  useEffect(() => { if (searchFocus) { search.current?.focus(); search.current?.select() } }, [searchFocus])
  useEffect(() => { reconcileDialogs(dialogs) }, [dialogs])
  useEffect(() => { reconcilePin(accountUid, pinState) }, [accountUid, pinState])
  useEffect(() => { reconcileUnread(accountUid, unreadState) }, [accountUid, unreadState])

  const folderCounts = useMemo(() => {
    const counts = new Map<Folder, number>()
    for (const tab of folders) if (tab.id !== 'channels') counts.set(tab.id, dialogs.filter(dialog => !dialog.archived && inFolder(dialog, tab.id) && effectiveUnreadCount(dialog) > 0).length)
    return counts
  }, [dialogs])
  const customCounts = useMemo(() => new Map(customFolders.map(item => [item.id, dialogs.filter(dialog => {
    const unread = effectiveUnreadCount(dialog)
    return unread > 0 && folderContains(dialog, item, { uid: accountUid, contacts: contactSet }, unread)
  }).length])), [customFolders, dialogs, accountUid, contactSet])

  const inquiryRows = useDesktop(snapshot => snapshot?.inquiryRows) ?? noInquiryRows
  const updateReady = useDesktop(snapshot => snapshot?.appUpdate?.status === 'ready')
  // MorseNotesListPreview: the newest note once the notes list has been read, else «나만 볼 수 있어요».
  const latestNote = useDesktop(snapshot => snapshot?.spaceNotes?.status === 'ready' ? snapshot.spaceNotes.rows[0] ?? null : null)
  const rows = useMemo<Row[]>(() => {
    const needle = searchFold(query)
    const matches = (title: string): boolean => !needle || searchFold(title).includes(needle)
    const result: Row[] = []
    if (!archived && !needle && folder === 'all') {
      const stored = dialogs.filter(dialog => dialog.archived)
      if (stored.length) result.push({ kind: 'archive', count: stored.length, unread: stored.filter(dialog => effectiveUnreadCount(dialog) > 0).length })
      // iOS ChatListView's notes row (MorseDialogRow.memo), pinned at the top by default.
      result.push({ kind: 'notes' })
      for (const item of pending) result.push({ kind: 'pending', pending: item })
    } else if (needle && !archived) for (const item of pending) if (matches(item.displayName)) result.push({ kind: 'pending', pending: item })
    const context = { uid: accountUid, contacts: contactSet }, inCustom = custom && !archived && !needle ? custom : null
    const pinnedChats: Row[] = [], timedChats: Row[] = []
    for (const dialog of dialogs) {
      if (!matches(dialog.title)) continue
      if (inCustom) { if (!folderContains(dialog, inCustom, context, effectiveUnreadCount(dialog))) continue }
      else if (!needle && (dialog.archived !== archived || !inFolder(dialog, folder))) continue
      ;(!inCustom && dialogFlags(dialog).pinned ? pinnedChats : timedChats).push({ kind: 'dialog', dialog })
    }
    // ChatListView keeps inquiry rooms beside the chats and orders them together by latest message;
    // they are never archived, belong to no folder, and this device cannot pin them yet.
    const inquiries: Row[] = !archived && !inCustom ? inquiryRows.flatMap(row => {
      if (!matches(row.title)) return []
      if (!needle && folder !== 'all' && !(folder === 'unread' && row.unread > 0)) return []
      return [{ kind: 'inquiry' as const, inquiry: row }]
    }) : []
    const at = (row: Row): number => row.kind === 'inquiry' ? row.inquiry.lastMessageAt ?? -Infinity
      : row.kind === 'dialog' ? positionTime(row.dialog.top) ?? -Infinity : -Infinity
    result.push(...pinnedChats, ...(inquiries.length ? [...timedChats, ...inquiries].sort((a, b) => at(b) - at(a)) : timedChats))
    // Chats pinned inside the folder come first, in their pinned order.
    if (inCustom?.pinnedChatIds.length) {
      const rank = new Map(inCustom.pinnedChatIds.map((id, index) => [id, index]))
      const key = (row: Row): number => row.kind === 'dialog' ? rank.get(row.dialog.id) ?? Infinity : Infinity
      result.sort((a, b) => { const x = key(a), y = key(b); return x === y ? 0 : x < y ? -1 : 1 })
    }
    return result
  }, [dialogs, pending, inquiryRows, query, folder, archived, overridesVersion, custom, contactSet, accountUid])

  const virtual = useVirtualizer({ count: rows.length, getScrollElement: () => scroll.current, estimateSize: () => 62, overscan: 10, getItemKey: index => rowKey(rows[index]!) })

  function openMenu(dialog: DialogSummary, point: { x: number; y: number }): void {
    const flags = dialogFlags(dialog), secret = dialog.kind === 'secret'
    const unread = flags.unread > 0 || flags.marked
    popupMenu.open(point, [
      custom ? { label: custom.pinnedChatIds.includes(dialog.id) ? tr('폴더 고정 해제') : tr('폴더에 고정'), icon: custom.pinnedChatIds.includes(dialog.id) ? <PinOff size={18} /> : <Pin size={18} />, onSelect: () => { void toggleChatPinnedInFolder(accountUid, custom, dialog.id) } }
        : { label: flags.pinned ? tr('고정 해제') : tr('고정'), icon: flags.pinned ? <PinOff size={18} /> : <Pin size={18} />, disabled: secret || status !== 'ready', onSelect: () => { void setPinned(accountUid, dialog, !flags.pinned) } },
      { label: unread ? tr('읽음으로 표시') : tr('읽지 않음으로 표시'), icon: unread ? <MailOpen size={18} /> : <Mail size={18} />, disabled: secret || status !== 'ready', onSelect: () => { void setUnread(accountUid, dialog, !unread) } },
      // Telegram's «Mute» / «Archive», kept on this device only.
      { label: dialog.muted ? tr('알림 켜기') : tr('알림 끄기'), icon: dialog.muted ? <Bell size={18} /> : <BellOff size={18} />, disabled: status !== 'ready', onSelect: () => { void setChatFlag(accountUid, dialog.id, { muted: !dialog.muted }) } },
      { label: dialog.archived ? tr('보관 해제') : tr('보관'), icon: dialog.archived ? <ArchiveRestore size={18} /> : <Archive size={18} />, disabled: status !== 'ready', onSelect: () => { void setChatFlag(accountUid, dialog.id, { archived: !dialog.archived }) } },
      'separator',
      { label: tr('폴더에 추가'), icon: <FolderPlus size={18} />, onSelect: () => showFolderPickerBox(accountUid, dialog.id) },
      // Telegram's row menu keeps clearing the history and deleting the chat apart.
      status === 'ready' && !dialog.id.startsWith('memo_') ? 'separator' : null,
      status === 'ready' && !secret && !dialog.id.startsWith('memo_')
        ? { label: tr('대화 기록 삭제'), icon: <Trash2 size={18} />, danger: true, onSelect: () => { void clearHistory(dialog) } } : null,
      status === 'ready' && !dialog.id.startsWith('memo_')
        ? dialog.discussion && dialog.channelId
          ? { label: tr('토론방 나가기'), icon: <LogOut size={18} />, danger: true, onSelect: () => { void deleteChat(dialog) } }
          : { label: tr('대화 삭제'), icon: <Trash2 size={18} />, danger: true, onSelect: () => { void deleteChat(dialog) } } : null
    ])
  }

  // "나에게만 삭제" deletes the history on this device and keeps the room out of the list until a newer
  // message arrives, which brings it back with only that message; "모두에게 삭제" removes it for both
  // sides of a private chat, and a group only for the person who created it.
  async function deleteChat(dialog: DialogSummary): Promise<void> {
    // A channel discussion room is left rather than hidden, as iOS deletes one for me: it keeps
    // bringing itself back with every new comment otherwise.
    if (dialog.discussion && dialog.channelId) {
      try { await leaveDiscussionRoom(accountUid, await window.morse.discussionRowDeparture(accountUid, dialog.id)) }
      catch (reason) { controller.toast(errorText(reason, tr('토론방에서 나가지 못했습니다.')), 'error') }
      return
    }
    const group = dialog.kind === 'group', mine = dialog.createdBy === accountUid
    // A private room can be cleared for both sides; a group only by the person who created it, and
    // everyone else leaves it from the info panel instead.
    if (dialog.kind === 'direct' || (group && mine)) {
      controller.showLayer(close => <ChatDeleteBox close={close} onChoose={forEveryone => { void runDelete(dialog, forEveryone) }} />)
      return
    }
    const text = group ? tr('이 대화와 기록을 이 기기에서만 지웁니다. 새 메시지가 오면 그 메시지부터 다시 보여요. 그룹에서 나가려면 정보 화면의 그룹 나가기를 사용해 주세요.')
      : tr('이 대화와 기록을 이 기기에서만 지웁니다. 새 메시지가 오면 그 메시지부터 다시 보여요.')
    if (!await confirmBox({ title: tr('대화 삭제'), text, confirm: tr('나에게만 삭제'), danger: true })) return
    await runDelete(dialog, false)
  }
  async function runDelete(dialog: DialogSummary, forEveryone: boolean): Promise<void> {
    // tdesktop DeleteMessagesBox::deleteAndClear: Core::App().closeChatFromWindows(peer), then deleteConversation.
    if (ui().chatId === dialog.id) controller.closeChat()
    try {
      const result = await trackWrite(window.morse.deleteChat(accountUid, dialog.id, forEveryone))
      controller.toast(result === 'unconfirmed' ? tr('삭제 결과를 확인하고 있습니다. 잠시 후 대화 목록을 확인해 주세요.')
        : forEveryone ? tr('대화를 삭제했습니다.') : tr('대화를 목록에서 지웠습니다.'))
    } catch (reason) { controller.toast(errorText(reason, tr('대화를 삭제하지 못했습니다.')), 'error') }
  }
  async function clearHistory(dialog: DialogSummary): Promise<void> {
    if (!await confirmBox({ title: tr('대화 기록 삭제'), text: tr('이 대화의 모든 메시지를 참여자 모두에게서 삭제합니다. 대화는 목록에 남아요. 되돌릴 수 없어요.'), confirm: tr('모두 삭제'), danger: true })) return
    try {
      const result = await trackWrite(window.morse.clearChatHistory(accountUid, dialog.id))
      controller.toast(result === 'done' ? tr('대화 기록을 삭제했습니다.') : tr('삭제 결과를 확인하고 있습니다. 잠시 후 대화를 확인해 주세요.'))
    } catch (reason) { controller.toast(errorText(reason, tr('대화 기록을 삭제하지 못했습니다.')), 'error') }
  }

  // Folder tab menu: edit or delete a Morse folder, add one, or open the folder list.
  function folderMenu(item: ChatFolder | null, point: { x: number; y: number }): void {
    popupMenu.open(point, [
      item && { label: tr('폴더 편집'), icon: <Pencil size={18} />, onSelect: () => showFolderEditBox(accountUid, item) },
      item && { label: tr('폴더 삭제'), icon: <Trash2 size={18} />, danger: true, onSelect: () => { void removeChatFolder(accountUid, item) } },
      item && 'separator',
      { label: tr('폴더 추가'), icon: <FolderPlus size={18} />, onSelect: () => showFolderEditBox(accountUid, null) },
      { label: tr('폴더 재정렬'), icon: <ArrowUpDown size={18} />, onSelect: () => showFoldersBox(accountUid) }
    ])
  }

  function keyboard(event: KeyboardEvent<HTMLDivElement>): void {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
    const current = (event.target as HTMLElement).closest<HTMLElement>('[data-row]')
    const index = current ? Number(current.dataset.row) : -1
    const next = Math.max(0, Math.min(rows.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1)))
    if (!rows.length) return
    event.preventDefault()
    virtual.scrollToIndex(next)
    requestAnimationFrame(() => scroll.current?.querySelector<HTMLElement>(`[data-row="${next}"]`)?.focus())
  }

  const connectionLabel = connectionLabels[connection]
  return <div className="dialogs" aria-label={tr('대화 목록')}>
    <div className="top-bar">
      <button className="icon-button" aria-label={tr('메뉴 열기')} onClick={() => controller.setMainMenu(true)}><Menu size={22} /></button>
      <label className="search-field">
        <Search size={17} />
        <input ref={search} value={query} placeholder={folder === 'channels' && !archived ? tr('채널 이름·키워드 검색') : tr('검색')} aria-label={folder === 'channels' && !archived ? tr('채널 검색') : tr('대화 검색')} maxLength={200} data-region-focus
          onChange={event => controller.setQuery(event.target.value)}
          // iOS channel tab: searching opens ChannelExplorePane.
          onFocus={() => { if (folder === 'channels' && !archived) controller.setChannelExplore(true) }}
          onKeyDown={event => {
            if (folder === 'channels' && !archived) { if (event.key === 'Escape') { controller.setQuery(''); controller.setChannelExplore(false); search.current?.blur() } return }
            if (event.key === 'ArrowDown') { event.preventDefault(); scroll.current?.querySelector<HTMLElement>('[data-row="0"]')?.focus() }
            else if (event.key === 'Enter' && rows[0]) { const row = rows[0]; if (row.kind === 'dialog') controller.openChat(row.dialog.id); else if (row.kind === 'pending') controller.openChat(row.pending.chatId) }
          }} />
        {query && <button className="icon-button small" aria-label={tr('검색어 지우기')} onClick={() => { controller.setQuery(''); search.current?.focus() }}><X size={16} /></button>}
      </label>
      {lockEnabled && !query && <button className="icon-button" aria-label={tr('앱 잠그기')} title={tr('앱 잠그기')} onClick={() => { void window.morse.appLock.lock() }}><Lock size={20} /></button>}
    </div>
    {connectionLabel && <div className="dialogs-connection" role="status">{connection !== 'offline' && connection !== 'rejected' && <Spinner size={12} />}{connectionLabel}</div>}
    {!query && !archived && <StoriesRow accountUid={accountUid} />}
    {!query && !archived && <div className="dialogs-folders" role="tablist" aria-label={tr('대화 폴더')}>
      {folders.map(tab => <button key={tab.id} role="tab" type="button" className="dialogs-folder" aria-selected={folder === tab.id} onClick={() => controller.setFolder(tab.id)}
        onContextMenu={event => { event.preventDefault(); folderMenu(null, pointFor(event, event.currentTarget)) }}>
        {tab.label}{(folderCounts.get(tab.id) ?? 0) > 0 && <span className="count">{folderCounts.get(tab.id)}</span>}
      </button>)}
      {customFolders.map(item => <button key={item.id} role="tab" type="button" className="dialogs-folder" aria-selected={folder === `folder:${item.id}`} onClick={() => controller.setFolder(`folder:${item.id}`)}
        onContextMenu={event => { event.preventDefault(); folderMenu(item, pointFor(event, event.currentTarget)) }}>
        <span className="dialogs-folder-name ellipsis">{folderTitle(item)}</span>{(customCounts.get(item.id) ?? 0) > 0 && <span className="count">{customCounts.get(item.id)}</span>}
      </button>)}
    </div>}
    {archived && !query && <div className="dialogs-subheader"><button className="icon-button small" aria-label={tr('대화 목록으로')} onClick={() => controller.setArchived(false)}><ArrowLeft size={18} /></button>{tr('보관함')}</div>}
    {folder === 'channels' && !archived ? <ChannelHome accountUid={accountUid} query={query} /> : <div ref={scroll} className="dialogs-scroll" onKeyDown={keyboard}>
      {status !== 'ready' && !rows.length ? <div className="dialogs-empty" role="status">
        {status === 'loading' ? <Spinner size={22} /> : <><p>{message || tr('대화 목록을 불러오지 못했습니다.')}</p><button className="button secondary" onClick={() => { void window.morse.refreshDialogs(accountUid).catch(() => {}) }}>{tr('다시 불러오기')}</button></>}
      </div> : !rows.length ? <div className="dialogs-empty">{query ? <p>{tr('‘{0}’에 맞는 대화가 없습니다.', [query])}</p> : <><strong>{folder === 'all' ? tr('아직 대화가 없습니다') : tr('이 폴더에 대화가 없습니다')}</strong></>}</div>
        : <div className="dialogs-virtual" style={{ height: virtual.getTotalSize() }}>
          {virtual.getVirtualItems().map(item => {
            const row = rows[item.index]!, style: CSSProperties = { transform: `translateY(${item.start}px)` }
            if (row.kind === 'dialog') return <DialogRow key={item.key} dialog={row.dialog} active={row.dialog.id === selected} style={style} index={item.index} flags={dialogFlags(row.dialog)} onMenu={openMenu} />
            // A subscriber row opens its room; an owner row opens that channel's inquiry list.
            if (row.kind === 'inquiry') return <InquiryDialogRow key={item.key} accountUid={accountUid} inquiry={row.inquiry} style={style} index={item.index} />
            if (row.kind === 'pending') return <button key={item.key} type="button" className={`dialog-row${row.pending.chatId === selected ? ' active' : ''}`} style={style} data-row={item.index} onClick={() => controller.openChat(row.pending.chatId)}>
              <PeerAvatar id={row.pending.chatId} name={row.pending.displayName} image={row.pending.avatar ?? null} surface="dialogs" />
              <span className="dialog-row-body">
                <span className="dialog-row-line"><span className="dialog-row-name ellipsis">{row.pending.displayName}</span></span>
                <span className="dialog-row-line"><span className="dialog-row-preview ellipsis">{tr('새 대화 · 첫 메시지를 보내면 시작됩니다')}</span></span>
              </span>
            </button>
            if (row.kind === 'notes') return <button key={item.key} type="button" className="dialog-row" style={style} data-row={item.index} onClick={() => controller.showNotes()}>
              <span className="avatar avatar-notes" style={{ width: 46, height: 46 }}><StickyNote size={22} /></span>
              <span className="dialog-row-body">
                <span className="dialog-row-line"><span className="dialog-row-name ellipsis">{tr('노트')}</span>{latestNote && <span className="dialog-row-time">{dialogTime(positionTime(latestNote.updated))}</span>}</span>
                <span className="dialog-row-line"><span className="dialog-row-preview ellipsis">{latestNote ? latestNote.title || latestNote.preview || tr('나만 볼 수 있어요') : tr('나만 볼 수 있어요')}</span></span>
              </span>
            </button>
            return <button key={item.key} type="button" className="dialog-row" style={style} data-row={item.index} onClick={() => controller.setArchived(true)}>
              <span className="avatar avatar-archive" style={{ width: 46, height: 46 }}><Archive size={22} /></span>
              <span className="dialog-row-body">
                <span className="dialog-row-line"><span className="dialog-row-name ellipsis">{tr('보관함')}</span></span>
                <span className="dialog-row-line"><span className="dialog-row-preview ellipsis">{tr('대화 {0}개', [row.count])}</span>{row.unread > 0 && <span className="dialog-row-badge muted">{row.unread}</span>}</span>
              </span>
            </button>
          })}
        </div>}
    </div>}
    {/* Dialogs::Widget «Update Telegram»: shown once the new version has been downloaded; restarting installs it. */}
    {updateReady && <button type="button" className="dialogs-update" onClick={() => { void window.morse.installAppUpdate().catch(() => {}) }}>{tr('Morse 업데이트')}</button>}
  </div>
}

async function setChatFlag(accountUid: string, chatId: string, patch: { muted?: boolean; archived?: boolean }): Promise<void> {
  try {
    await window.morse.setChatFlags(accountUid, chatId, patch)
    if (patch.archived !== undefined) controller.toast(patch.archived ? tr('대화를 보관했습니다.') : tr('보관을 해제했습니다.'))
  } catch (reason) { controller.toast(errorText(reason, tr('변경하지 못했습니다.')), 'error') }
}
