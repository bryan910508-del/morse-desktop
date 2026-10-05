import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { dialogById, useDesktop } from '../app/store'
import { usePowerSavingReport, useReducedMotion } from '../app/power-saving'
import { useContentProtection } from '../app/content-protection'
import { controller, ui, useUi } from '../app/ui'
import { useShortcut } from '../app/shortcuts'
import { LayerHost, ToastHost } from '../ui/layers'
import { MenuHost } from '../ui/popup-menu'
import { AvatarScope } from '../ui/avatar'
import { Intro } from '../auth/intro'
import { DialogsWidget } from '../dialogs/dialogs-widget'
import { HistoryWidget } from '../history/history-widget'
import { ChatSearchPanel } from '../history/chat-search'
import { InfoPanel } from '../info/info-panel'
import { ChannelSection } from '../channels/channel-section'
import { ChannelsWidget } from '../channels/channels-widget'
import { ChannelSidePanel } from '../channels/channel-info-panel'
import { ChannelInquiryPanel, InquiryPeerPanel } from '../channels/channel-inquiry-panel'
import { NotesWidget } from '../notes/notes-widget'
import { useNotesSession } from '../notes/notes-state'
import { NoteEditor } from '../notes/note-editor'
import { MainMenu } from './main-menu'
import { LockScreen } from './lock-screen'
import { UpdateRequiredScreen } from './update-required'
import { chatGone } from './chat-gone'
import { tr } from '../../../shared/i18n'

// window.style: columnMinimalWidthLeft/MaximalWidthLeft/MinimalWidthMain/MinimalWidthThird/MaximalWidthThird.
const leftMin = 260, leftMax = 540, mainMin = 380, thirdMin = 292, thirdMax = 392
// core_settings: kDefaultDialogsWidthRatio.
const defaultRatio = 5 / 14

function useWindowWidth(): number {
  const [width, setWidth] = useState(window.innerWidth)
  useEffect(() => {
    const resize = (): void => setWidth(window.innerWidth)
    window.addEventListener('resize', resize)
    return () => window.removeEventListener('resize', resize)
  }, [])
  return width
}

export function MainWindow() {
  useReducedMotion()
  usePowerSavingReport()
  useContentProtection()
  const locked = useDesktop(snapshot => snapshot?.appLock?.locked ?? false)
  const blocked = useDesktop(snapshot => snapshot?.versionGate?.blocked ?? false)
  const accountUid = useDesktop(snapshot => snapshot?.activeAccountUid ?? null)
  const adding = useDesktop(snapshot => snapshot?.addingAccount ?? false)
  if (blocked) return <><UpdateRequiredScreen /><ToastHost /></>
  if (locked) return <><LockScreen /><LayerHost /><ToastHost /></>
  if (!accountUid || adding) return <><Intro /><LayerHost /><MenuHost /><ToastHost /></>
  return <SessionWindow key={accountUid} accountUid={accountUid} />
}

function ColumnResizer({ left }: { left: number }) {
  const start = (event: ReactPointerEvent<HTMLDivElement>): void => {
    event.preventDefault()
    const target = event.currentTarget, origin = event.clientX, base = left
    target.setPointerCapture(event.pointerId)
    const move = (next: PointerEvent): void => controller.setDialogsWidth(base + next.clientX - origin)
    const end = (): void => { target.removeEventListener('pointermove', move); target.removeEventListener('pointerup', end); target.removeEventListener('pointercancel', end) }
    target.addEventListener('pointermove', move); target.addEventListener('pointerup', end); target.addEventListener('pointercancel', end)
  }
  return <div className="column-resizer" role="separator" aria-orientation="vertical" aria-label={tr('대화 목록 너비 조절')} onPointerDown={start} />
}

function focusRegion(step: 1 | -1): void {
  const regions = [...document.querySelectorAll<HTMLElement>('[data-region]')].filter(region => region.getClientRects().length && !region.closest('[inert]'))
  if (!regions.length) return
  const index = regions.findIndex(region => region.contains(document.activeElement))
  const next = regions[(index + step + regions.length) % regions.length]!
  const target = next.querySelector<HTMLElement>('[data-region-focus]') ?? next
  target.focus({ preventScroll: true })
}

function SessionWindow({ accountUid }: { accountUid: string }) {
  const width = useWindowWidth()
  const stored = useUi(state => state.dialogsWidth)
  const section = useUi(state => state.section)
  const chatId = useUi(state => state.chatId)
  const channelId = useUi(state => state.channelId)
  const noteId = useUi(state => state.noteId)
  const inquiry = useUi(state => state.inquiry)
  const right = useUi(state => state.right)
  const mainMenu = useUi(state => state.mainMenu)
  const notes = section === 'notes', channels = section === 'channels'
  // The open room became the pair's dialog under another id: show that dialog (a dialog is its peer).
  const movedTo = useDesktop(snapshot => chatId ? snapshot?.pendingDirects.find(item => item.chatId === chatId)?.supersededBy ?? null : null)
  useEffect(() => { if (movedTo) controller.openChat(movedTo) }, [movedTo])
  // B76: the open chat left this account (group deleted, or this account removed) — close it and its panel (chat-gone.ts).
  const chatPresent = useDesktop(snapshot => Boolean(chatId && dialogById(snapshot, chatId)))
  const chatPending = useDesktop(snapshot => Boolean(chatId && snapshot?.pendingDirects.some(item => item.chatId === chatId)))
  const listReady = useDesktop(snapshot => snapshot?.dialogStatus === 'ready' && !snapshot.appLock.locked && snapshot.activeAccountUid === accountUid)
  const seenChat = useRef<{ chatId: string | null; present: boolean }>({ chatId: null, present: false })
  useEffect(() => {
    if (seenChat.current.chatId !== chatId) seenChat.current = { chatId, present: false }
    if (chatGone(seenChat.current.present, { listReady, present: chatPresent, pending: chatPending })) { seenChat.current.present = false; controller.closeChat(); return }
    if (chatPresent) seenChat.current.present = true
  }, [chatId, chatPresent, chatPending, listReady])
  const oneColumn = width < leftMin + mainMin
  // A room opened from the chat list has no channel screen behind it: it is the conversation, so it takes
  // the main column, as a chat does. Beside an open channel it stays that channel's third column.
  const inquiryMain = inquiry !== null && channelId === null && chatId === null
  const hasMain = chatId !== null || channelId !== null || inquiryMain || (notes && noteId !== null)
  const left = oneColumn ? width : Math.round(Math.max(leftMin, Math.min(leftMax, width - mainMin, stored || width * defaultRatio)))
  const thirdSpace = width - left - mainMin
  const panel = chatId ? right === 'search' ? <ChatSearchPanel key={chatId} accountUid={accountUid} chatId={chatId} /> : <InfoPanel key={chatId} accountUid={accountUid} chatId={chatId} />
    : channelId ? <ChannelSidePanel key={channelId} accountUid={accountUid} channelId={channelId} right={right} />
      // The person on the other side of a room, beside the room itself, as a chat's peer is.
      : inquiryMain && inquiry.thread ? <InquiryPeerPanel key={inquiry.thread} accountUid={accountUid} inquiryId={inquiry.thread} /> : null
  const third = !oneColumn && hasMain && right !== null && panel && thirdSpace >= thirdMin ? Math.min(thirdMax, thirdSpace) : 0
  const showLeft = !oneColumn || !hasMain, showMain = !oneColumn || hasMain
  const dialogs = useDesktop(snapshot => snapshot?.dialogs)

  useShortcut(0, command => {
    const state = ui()
    switch (command) {
      case 'back':
        if (state.right) { controller.setRight(null); return true }
        if (state.dialogsQuery) { controller.setQuery(''); return true }
        if (state.chatId || state.channelId) { controller.closeChat(); return true }
        if (state.section === 'notes') { if (state.noteId || state.chatId) controller.showNotes(); else controller.showChats(); return true }
        if (state.section === 'channels') { controller.showChats(); return true }
        if (state.archived) { controller.setArchived(false); return true }
        return false
      case 'find-dialog': if (oneColumn && (state.chatId || state.channelId)) controller.closeChat(); controller.focusSearch(); return true
      case 'find-message': if (state.chatId) controller.setRight('search'); return true
      case 'focus-composer': controller.focusComposer(); return true
      case 'show-chats': controller.showChats('all'); return true
      case 'show-channels': controller.showChannels(); return true
      case 'next-region': focusRegion(1); return true
      case 'previous-region': focusRegion(-1); return true
      case 'previous-dialog': case 'next-dialog': {
        const list = (dialogs ?? []).filter(dialog => dialog.archived === state.archived)
        if (!list.length) return true
        const index = list.findIndex(dialog => dialog.id === state.chatId)
        const next = command === 'next-dialog' ? Math.min(list.length - 1, index + 1) : Math.max(0, index < 0 ? 0 : index - 1)
        controller.openChat(list[next]!.id)
        return true
      }
      default: return false
    }
  })

  useNotesSession(accountUid, notes)

  return <AvatarScope accountUid={accountUid} enabled surface="dialogs"><AvatarScope accountUid={accountUid} enabled surface="contacts">
    <div className={`window${oneColumn ? ' one-column' : ''}`}>
      {showLeft && <aside className="column-left" data-region style={oneColumn ? undefined : { width: left }}>
        {notes ? <NotesWidget accountUid={accountUid} /> : channels ? <ChannelsWidget accountUid={accountUid} /> : <DialogsWidget accountUid={accountUid} />}
      </aside>}
      {showLeft && showMain && <ColumnResizer left={left} />}
      {showMain && <main className="column-main" data-region>
        {chatId ? <HistoryWidget key={chatId} accountUid={accountUid} chatId={chatId} oneColumn={oneColumn} leftmost={!showLeft} />
          : inquiryMain ? <ChannelInquiryPanel key={inquiry.channelId} accountUid={accountUid} channelId={inquiry.channelId} thread={inquiry.thread} fromList={inquiry.fromList} oneColumn={oneColumn} />
          : channelId ? <ChannelSection key={channelId} accountUid={accountUid} channelId={channelId} oneColumn={oneColumn} leftmost={!showLeft} />
            : notes && noteId ? <NoteEditor key={noteId} accountUid={accountUid} noteId={noteId} oneColumn={oneColumn} leftmost={!showLeft} />
              : <div className="empty-main"><span className="service-pill">{notes ? tr('노트를 선택해 주세요') : tr('대화를 선택해 주세요')}</span></div>}
      </main>}
      {third > 0 && panel && <aside className="column-third" data-region style={{ width: third }}>{panel}</aside>}
    </div>
    {right && panel && third === 0 && showMain && <div className="third-layer" onMouseDown={event => { if (event.target === event.currentTarget) controller.setRight(null) }}>
      <aside className="third-layer-panel" data-region>{panel}</aside>
    </div>}
    {mainMenu && <MainMenu accountUid={accountUid} />}
    <LayerHost /><MenuHost /><ToastHost />
  </AvatarScope></AvatarScope>
}
