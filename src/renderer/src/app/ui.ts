import { useCallback, useRef, useSyncExternalStore, type ReactNode } from 'react'

// The left column shows chats (with folder tabs), the Morse note list, or the channels.
// Telegram keeps a channel out of the folder strip - «All chats» and the folders a person made are
// the only tabs (ChatListFilterTabContainerNode), and iOS shows channels in their own tab
// (ChannelFeedView), not as a chat list filter.
export type Section = 'chats' | 'notes' | 'channels'
export type Folder = 'all' | 'personal' | 'groups' | 'unread' | `folder:${string}`
export interface LayerEntry { id: string; render(close: () => void): ReactNode; dismissible: boolean; onClose?: () => void }
export interface ToastEntry { id: string; text: string; tone: 'default' | 'error'; action?: { label: string; run(): void } }
export type RightPanel = null | 'info' | 'search' | 'comments' | 'inquiry'
// The 1:1 inquiry the third column holds: one room, or the owner's list of a channel's rooms
// (`thread` null). It is opened from the channel screen and from the chat list, and a chat list row
// opens the room alone — the channel itself is reached from the channels tab and from a profile.
export interface InquiryTarget { channelId: string; thread: string | null; fromList: boolean }

export interface UiState {
  section: Section
  folder: Folder
  archived: boolean
  chatId: string | null
  channelId: string | null
  // A post the channel opens at (a post pressed in the channel tab's feed).
  channelPostId: string | null
  // The channel tab shows ChannelExplorePane instead of the feed.
  channelExplore: boolean
  noteId: string | null
  right: RightPanel
  inquiry: InquiryTarget | null
  dialogsQuery: string
  mainMenu: boolean
  layers: LayerEntry[]
  toasts: ToastEntry[]
  composerFocus: number
  searchFocus: number
  dialogsWidth: number
}

function storedWidth(): number {
  try {
    const value = Number(localStorage.getItem('morse.dialogsWidth'))
    return Number.isFinite(value) && value >= 260 && value <= 540 ? value : 0
  } catch { return 0 }
}

let state: UiState = {
  section: 'chats', folder: 'all', archived: false, chatId: null, channelId: null, channelPostId: null, channelExplore: false, noteId: null, right: null, inquiry: null,
  dialogsQuery: '', mainMenu: false, layers: [], toasts: [], composerFocus: 0, searchFocus: 0, dialogsWidth: storedWidth()
}
const listeners = new Set<() => void>()
function set(patch: Partial<UiState>): void {
  state = { ...state, ...patch }
  for (const listener of [...listeners]) listener()
}
export function ui(): UiState { return state }
const subscribe = (listener: () => void): (() => void) => { listeners.add(listener); return () => { listeners.delete(listener) } }

export function useUi<T>(select: (state: UiState) => T): T {
  const cache = useRef<{ source: UiState; select: typeof select; value: T } | null>(null)
  const get = useCallback((): T => {
    const cached = cache.current
    if (cached && cached.source === state && cached.select === select) return cached.value
    const value = select(state)
    cache.current = { source: state, select, value: cached && Object.is(cached.value, value) ? cached.value : value }
    return cache.current.value
  }, [select])
  return useSyncExternalStore(subscribe, get)
}

// Window::SessionController: navigation is immediate. Editors persist their
// own drafts continuously, so switching chats never waits for a dialog.
export const controller = {
  openChat(chatId: string): void {
    set({ section: 'chats', chatId, channelId: null, noteId: null, inquiry: null, mainMenu: false, right: state.right === 'info' ? 'info' : null, composerFocus: state.composerFocus + 1 })
  },
  closeChat(): void { set({ chatId: null, channelId: null, inquiry: null, right: null }) },
  openChannel(channelId: string, postId: string | null = null): void { set({ section: 'channels', channelId, channelPostId: postId, chatId: null, noteId: null, inquiry: null, mainMenu: false, right: null }) },
  showChannels(): void { set({ section: 'channels', chatId: null, noteId: null, inquiry: null, right: null, mainMenu: false, dialogsQuery: '', channelExplore: false, archived: false }) },
  clearChannelPost(): void { if (state.channelPostId) set({ channelPostId: null }) },
  setChannelExplore(channelExplore: boolean): void { if (state.channelExplore !== channelExplore) set({ channelExplore }) },
  // A channel opened from a row that is not in the channels tab: ChatListView keeps the list where
  // it is, so the row a person just pressed stays in front of them.
  openChannelPanel(channelId: string): void { set({ section: 'chats', channelId, chatId: null, noteId: null, inquiry: null, mainMenu: false, right: null }) },
  showNotes(): void { set({ section: 'notes', chatId: null, channelId: null, inquiry: null, right: null, mainMenu: false, dialogsQuery: '' }) },
  openNote(noteId: string | null): void { set({ section: 'notes', noteId, chatId: null, channelId: null, inquiry: null, right: null, mainMenu: false }) },
  // «저장한 메시지» lives inside the notes screen, as iOS keeps the memo behind its notes hub
  // (ChatListView+Table: a `.memo` row opens openNotesHub, never a chat room). The list beside it stays
  // the note list, so the room opens without leaving the notes screen.
  openSavedMessages(chatId: string): void { set({ section: 'notes', chatId, noteId: null, channelId: null, inquiry: null, right: null, mainMenu: false, composerFocus: state.composerFocus + 1 }) },
  showChats(folder: Folder = state.folder): void { set({ section: 'chats', folder, channelId: null, noteId: null, inquiry: null, mainMenu: false, archived: false }) },
  // A room opened from the chat list is that conversation alone, and it is where a conversation goes: the
  // main column. The channel screen does not come with it.
  openInquiryRoom(channelId: string, thread: string | null): void {
    set({ section: 'chats', inquiry: { channelId, thread, fromList: thread === null }, chatId: null, channelId: null, noteId: null, mainMenu: false, right: null })
  },
  // Its picture and name lead to the channel, as iOS ChannelInquiryChatView.handleProfileTap does for the
  // side that is asking (ChannelInquiryProfileView).
  openChannelInfo(channelId: string): void { set({ section: 'chats', channelId, chatId: null, noteId: null, inquiry: null, mainMenu: false, right: 'info' }) },
  // The channel screen's own inquiries: the third column beside the channel, as its comments are.
  openChannelInquiry(channelId: string, thread: string | null): void {
    set({ inquiry: { channelId, thread, fromList: thread === null }, right: 'inquiry' })
  },
  setInquiryThread(thread: string | null): void { if (state.inquiry) set({ inquiry: { ...state.inquiry, thread } }) },
  setRight(right: RightPanel): void { set({ right }) },
  closeInquiry(): void { set({ right: null, inquiry: null }) },
  toggleRight(panel: Exclude<RightPanel, null>): void { set({ right: state.right === panel ? null : panel }) },
  setQuery(dialogsQuery: string): void { set({ dialogsQuery }) },
  focusSearch(): void { set({ section: 'chats', mainMenu: false, searchFocus: state.searchFocus + 1 }) },
  setFolder(folder: Folder): void { set({ folder, archived: false, channelExplore: false }) },
  setArchived(archived: boolean): void { set({ archived }) },
  setMainMenu(mainMenu: boolean): void { set({ mainMenu }) },
  focusComposer(): void { set({ composerFocus: state.composerFocus + 1 }) },
  setDialogsWidth(width: number): void {
    const dialogsWidth = Math.round(Math.min(540, Math.max(260, width)))
    set({ dialogsWidth })
    try { localStorage.setItem('morse.dialogsWidth', String(dialogsWidth)) } catch { /* per-viewer convenience only */ }
  },
  resetAccount(): void {
    for (const layer of state.layers) layer.onClose?.()
    set({ section: 'chats', folder: 'all', archived: false, chatId: null, channelId: null, noteId: null, inquiry: null, right: null, dialogsQuery: '', layers: [], mainMenu: false })
  },
  showLayer(render: LayerEntry['render'], options: { dismissible?: boolean; onClose?: () => void } = {}): string {
    const id = crypto.randomUUID()
    set({ layers: [...state.layers, { id, render, dismissible: options.dismissible ?? true, onClose: options.onClose }], mainMenu: false })
    return id
  },
  closeLayer(id: string): void {
    const layer = state.layers.find(item => item.id === id)
    if (!layer) return
    set({ layers: state.layers.filter(item => item.id !== id) })
    layer.onClose?.()
  },
  closeAllLayers(): void {
    const layers = state.layers
    set({ layers: [] })
    for (const layer of layers) layer.onClose?.()
  },
  closeTopLayer(): boolean {
    const top = state.layers[state.layers.length - 1]
    if (!top) return false
    if (top.dismissible) controller.closeLayer(top.id)
    return true
  },
  toast(text: string, tone: ToastEntry['tone'] = 'default', action?: ToastEntry['action']): void {
    if (!text) return
    const id = crypto.randomUUID()
    set({ toasts: [...state.toasts.slice(-2), { id, text, tone, action }] })
    setTimeout(() => set({ toasts: state.toasts.filter(toast => toast.id !== id) }), action ? 5000 : 3500)
  },
  dismissToast(id: string): void { set({ toasts: state.toasts.filter(toast => toast.id !== id) }) }
}
