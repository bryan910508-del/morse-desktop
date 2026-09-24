import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, CheckCheck, CircleAlert, Clock, Clock3, Copy, Download, EllipsisVertical, File as FileIcon, Film, Forward, Image as ImageIcon, Mic, Pencil, Pin, PinOff, Plus, Reply, RotateCcw, Send, Smile, Sticker, Timer, Trash2, X } from 'lucide-react'
import { inquiryChatMessage, maxInquiryText, type InquiryMessageItem } from '../../../shared/channel-inquiries'
import type { ChatMessage } from '../../../shared/model'
import { readCovers, readCursor } from '../../../shared/read-receipts'
import { canForwardMessage } from '../../../shared/forward'
import { maxForwardMessages } from '../../../shared/forward-batch'
import { showShareBox } from '../boxes/share-box'
import { prepareChannelPostPhoto } from '../photos/prepare-channel-post-photo'
import { composingKey } from '../../../shared/shortcuts'
import { useDesktop } from '../app/store'
import { controller } from '../app/ui'
import { dialogTime, errorText, messageTime, sameDay, serviceDate } from '../app/format'
import { copyText } from '../app/clipboard'
import { trackWrite } from '../app/drafts'
import { Spinner, TextField } from '../ui/controls'
import { Box, confirmBox } from '../ui/layers'
import { popupMenu, pointFor } from '../ui/popup-menu'
import { showInquiryThread } from './channel-ui'
import { UserAvatar } from '../ui/user-avatar'
import { LocalMessageView, MessageView, type MessageLayout } from '../history/message'
import { chooseDeletion, ReactionStrip, saveAttachment, saveSticker } from '../history/history-widget'
import { EntityPanel } from '../history/entity-panel'
import type { LocalOutgoing } from '../../../shared/delivery'
import { showMediaViewer } from '../media/media-viewer'
import { showAttachmentBox } from '../boxes/send-files-box'
import { showInquiryAutoDeleteBox } from '../boxes/auto-delete-box'
import { DeferredItemsBar, showScheduleBox } from '../history/deferred-send'
import { autoDeleteSummary } from '../../../shared/chat-auto-delete'
import { InquiryVoiceBar, type InquiryVoiceSend } from './inquiry-voice'
import { RecordButton, type HeldRef } from '../history/record-button'
import { RoundVideoRecorder, type RoundVideoTarget } from '../history/round-video-record'
import { inquiryRetry, markInquirySent, setInquiryRetry, updateInquiryPending, useInquiryPending, useInquirySendState, type PendingEntry } from './inquiry-sends'
import { tr } from '../../../shared/i18n'

function InquiryList({ accountUid, channelId }: { accountUid: string; channelId: string }) {
  const [requestId] = useState(() => crypto.randomUUID())
  useEffect(() => {
    void window.morse.openInquiryList(accountUid, { requestId, channelId }).catch(reason => controller.toast(errorText(reason, tr('문의 목록을 불러오지 못했습니다.')), 'error'))
    return () => { void window.morse.closeInquiryList(accountUid, requestId).catch(() => {}) }
  }, [accountUid, channelId, requestId])
  const list = useDesktop(state => { const value = state?.channelInquiries?.list; return value?.requestId === requestId ? value : null })
  if (!list || (list.status === 'loading' && !list.items.length)) return <div className="empty-state"><Spinner size={22} /></div>
  if (list.status === 'error') return <div className="empty-state">{list.message || tr('문의 목록을 불러오지 못했습니다.')}</div>
  if (!list.items.length) return <div className="empty-state">{tr('아직 받은 1:1 문의가 없습니다.')}</div>
  return <div className="inquiry-list">{list.items.map(item => <InquiryListRow key={item.id} accountUid={accountUid} channelId={channelId} item={item} />)}</div>
}
// iOS MorseInquiryListUIKitCell (1f27102b): an inquiry's row marks a message of mine that did not go beside the name,
// and a clock under the time while one is on its way, as a chat's row does.
function InquiryListRow({ accountUid, channelId, item }: { accountUid: string; channelId: string; item: import('../../../shared/channel-inquiries').InquirySummary }) {
  const sends = useInquirySendState(accountUid, item.id)
  return <button type="button" className="inquiry-row" onClick={() => showInquiryThread(channelId, item.id)}>
    <UserAvatar uid={item.peerUid} name={item.peerName} size={42} image={item.photo} />
    <span className="inquiry-row-body">
      <span className="inquiry-row-line"><strong className="ellipsis">{item.peerName}</strong>
        {sends.failed && <CircleAlert size={14} className="dialog-row-failed" aria-label={tr('보내지 못한 메시지가 있습니다')} />}<time>{dialogTime(item.lastMessageAt)}</time></span>
      <span className="inquiry-row-line"><span className="inquiry-row-preview ellipsis">{item.lastMessage || tr('메시지')}</span>
        {sends.sending && <Clock3 size={12} className="dialog-row-sending" aria-label={tr('보내는 중')} />}
        {item.unread > 0 && <span className="inquiry-row-badge">{item.unread > 999 ? '999+' : item.unread}</span>}</span>
    </span>
  </button>
}

function EditMessageBox({ initial, close, save }: { initial: string; close(): void; save(text: string): Promise<void> }) {
  const [value, setValue] = useState(initial), [busy, setBusy] = useState(false), [error, setError] = useState('')
  async function submit(): Promise<void> {
    if (busy || !value.trim()) return
    if (value === initial) { close(); return }
    setBusy(true)
    try { await save(value); close() }
    catch (reason) { setError(errorText(reason, tr('메시지를 수정하지 못했습니다.'))) }
    finally { setBusy(false) }
  }
  return <Box title={tr('메시지 수정')} width={400} onClose={close} buttons={<>
    <button className="button flat" onClick={close}>{tr('취소')}</button>
    <button className="button flat" disabled={busy || !value.trim()} onClick={() => { void submit() }}>{tr('저장')}</button>
  </>}>
    <TextField label={tr('메시지')} value={value} maxLength={maxInquiryText} multiline rows={4} autoFocus invalid={Boolean(error)} onChange={next => { setValue(next); setError('') }} onSubmit={() => { void submit() }} />
    {error && <p className="box-error" role="alert">{error}</p>}
  </Box>
}

// An inquiry room is drawn with the chat's own message view (HistoryView::Message) - text, photos, videos,
// video messages, voice messages and files alike - so it looks and behaves exactly as a chat does. iOS sends
// all of them here (ChannelInquiryChatView). A location or an event keeps its title as the message text.
// A message being sent, drawn as a chat draws one of its own on the way (LocalMessageView).
// One that did not go stays where it was, marked, until it is sent again or deleted (HistoryMessage failed state,
// iOS «다시 보내기»); only the message's own id goes again, so the server keeps one copy of it.
function inquiryLocal(entry: PendingEntry, inquiryId: string): LocalOutgoing {
  return { id: entry.id, chatId: inquiryId, text: entry.text, createdAt: entry.at, state: entry.failed !== undefined ? 'failed' : entry.sent ? 'sent' : 'queued',
    reason: entry.failed ?? '', busy: entry.failed === undefined && !entry.sent, retryable: entry.failed !== undefined }
}
const attachWindowMs = 900 * 1000

// One inquiry room: messages from both sides and the reply composer.
function InquiryThread({ accountUid, channelId, inquiryId, fromList }: { accountUid: string; channelId: string; inquiryId: string; fromList: boolean }) {
  const [requestId] = useState(() => crypto.randomUUID())
  useEffect(() => {
    void window.morse.openInquiryThread(accountUid, { requestId, inquiryId }).catch(reason => controller.toast(errorText(reason, tr('문의를 열지 못했습니다.')), 'error'))
    return () => { void window.morse.closeInquiryThread(accountUid, requestId).catch(() => {}) }
  }, [accountUid, inquiryId, requestId])
  const thread = useDesktop(state => { const value = state?.channelInquiries?.thread; return value?.requestId === requestId ? value : null })
  const enterToSend = useDesktop(state => state?.preferences.enterToSend ?? true)
  const [text, setText] = useState(''), [picking, setPicking] = useState(false)
  const pending = useInquiryPending(accountUid, inquiryId)
  const setPending = (update: (current: PendingEntry[]) => PendingEntry[]): void => updateInquiryPending(accountUid, inquiryId, update)
  const [entities, setEntities] = useState(false)
  // The message this send answers, as a chat's composer keeps its reply.
  const [replyTo, setReplyTo] = useState<InquiryMessageItem | null>(null)
  // A recorder holds the send it was given, so what it answers is read from here and never from that older frame.
  const replyRef = useRef<InquiryMessageItem | null>(null); replyRef.current = replyTo
  // A selection of messages, as a chat keeps one: null while nothing is being selected.
  const [selection, setSelection] = useState<string[] | null>(null)
  const [recording, setRecording] = useState<false | 'voice' | 'video'>(false)
  // Telegram's record button, as in a chat: a click switches voice and video, a held press records.
  const recordVideo = useDesktop(snapshot => snapshot?.preferences.recordVideoMessages ?? false)
  const held = useRef<HeldRef | undefined>(undefined), composeArea = useRef<HTMLDivElement>(null)
  const list = useRef<HTMLDivElement>(null), field = useRef<HTMLTextAreaElement>(null)
  const items = thread?.items ?? [], ready = thread?.status === 'ready', pinnedIds = thread?.pinnedIds ?? []
  const waiting = pending.filter(entry => !items.some(item => item.id === entry.id))
  useEffect(() => { setPending(current => { const next = current.filter(entry => !items.some(item => item.id === entry.id)); return next.length === current.length ? current : next }) }, [items])
  useLayoutEffect(() => { const element = list.current; if (element) element.scrollTop = element.scrollHeight }, [items.length, waiting.length])
  useLayoutEffect(() => {
    const element = field.current
    if (!element) return
    element.style.height = 'auto'
    element.style.height = `${Math.min(224, element.scrollHeight)}px`
  }, [text])

  async function send(): Promise<void> {
    const value = text.trim()
    if (!value || !ready) return
    const entry = { id: crypto.randomUUID().toUpperCase(), text: value, at: Date.now() }
    // The composer empties in the frame the message leaves, reply and all (HistoryWidget::send → cancelReply).
    const answering = takeReply()
    setPending(current => [...current, entry]); setText('')
    const attempt = async (): Promise<void> => {
      const result = await trackWrite(window.morse.sendInquiryMessage(accountUid, { requestId, inquiryId, messageId: entry.id, text: value, ...(answering ? { replyToId: answering.id } : {}) }))
      if (result === 'unconfirmed') controller.toast(tr('전송 결과를 확인하지 못했습니다. 잠시 후 대화를 확인해 주세요.'))
        markInquirySent(accountUid, inquiryId, entry.id)
    }
    await sendPending(entry.id, attempt, tr('메시지를 보내지 못했습니다.'))
  }
  // A send that failed is kept with its way of going again; the failure reads on the bubble as a chat's does.
  async function sendPending(id: string, attempt: () => Promise<void>, failure: string): Promise<void> {
    setInquiryRetry(accountUid, inquiryId, id, attempt)
    try { await attempt(); setInquiryRetry(accountUid, inquiryId, id, null) }
    catch (reason) {
      const message = errorText(reason, failure)
      setPending(current => current.map(item => item.id === id ? { ...item, failed: message } : item))
    }
  }
  function pendingMenu(entry: PendingEntry, point: { x: number; y: number }): void {
    if (entry.failed === undefined) return
    const retry = inquiryRetry(accountUid, inquiryId, entry.id)
    popupMenu.open(point, [
      retry && { label: tr('다시 보내기'), icon: <RotateCcw size={18} />, onSelect: () => {
        setPending(current => current.map(item => item.id === entry.id ? { id: item.id, text: item.text, at: item.at } : item))
        void sendPending(entry.id, retry, tr('메시지를 보내지 못했습니다.'))
      } },
      { label: tr('삭제'), icon: <Trash2 size={18} />, danger: true, onSelect: () => {
        setPending(current => current.filter(item => item.id !== entry.id))
      } },
    ])
  }
  // iOS MorseEntityKeyboard insertEmoji: at the caret, replacing a selection.
  function insertEmoji(emoji: string): void {
    const element = field.current
    const start = element?.selectionStart ?? text.length, end = element?.selectionEnd ?? text.length
    const next = text.slice(0, start) + emoji + text.slice(end)
    if (next.length > maxInquiryText) return
    setText(next)
    requestAnimationFrame(() => { const target = field.current; if (target) { target.focus(); target.setSelectionRange(start + emoji.length, start + emoji.length) } })
  }
  // A sticker of this device's library, or one of an installed set, sent into the room as into a chat.
  async function sendSticker(send: () => Promise<'sent' | 'unconfirmed'>): Promise<void> {
    setEntities(false)
    if (!ready) return
    try { if (await send() === 'unconfirmed') controller.toast(tr('전송 결과를 확인하지 못했습니다. 잠시 후 대화를 확인해 주세요.')) }
    catch (reason) { controller.toast(errorText(reason, tr('스티커를 보내지 못했습니다.')), 'error') }
  }
  // Answering a message of this room: the composer keeps it and the field takes the caret, as a chat does.
  function beginReply(item: InquiryMessageItem): void {
    if (!ready || item.system) return
    setSelection(null); setReplyTo(item)
    requestAnimationFrame(() => field.current?.focus())
  }
  // What this send answers, taken away from the composer in the same frame; a send that fails gives it back,
  // unless the composer is already answering something else by then.
  function takeReply(): InquiryMessageItem | null {
    const answering = replyRef.current
    if (answering) { replyRef.current = null; setReplyTo(null) }
    return answering
  }
  const restoreReply = (answering: InquiryMessageItem | null): void => {
    if (answering && !replyRef.current) { replyRef.current = answering; setReplyTo(current => current ?? answering) }
  }
  // The quote above a message leads to the message it answers, as pressing a chat's quote does.
  function showMessage(messageId?: string): void {
    if (!messageId) return
    const row = list.current?.querySelector(`[data-inquiry-message="${messageId}"]`)
    if (row) row.scrollIntoView({ block: 'center' })
  }
  // «예약 전송»: the text is queued on the server for this room and the composer clears, as in a chat.
  async function sendLater(scheduledAt: number): Promise<void> {
    const value = text.trim()
    if (!value || !ready) return
    try {
      await trackWrite(window.morse.scheduleInquiryMessage(accountUid, { requestId, inquiryId, messageId: crypto.randomUUID().toUpperCase(), text: value, scheduledAt }))
      setText(current => current.trim() === value ? '' : current)
      controller.toast(tr('메시지가 예약됐어요'))
    } catch (reason) { controller.toast(errorText(reason, tr('메시지를 예약하지 못했습니다.')), 'error') }
  }
  // ChannelInquiryChatView photo send: one picked file, re-encoded to JPEG before it leaves.
  async function sendPhoto(): Promise<void> {
    if (!ready || picking) return
    setPicking(true)
    const entry = { id: crypto.randomUUID().toUpperCase(), text: tr('사진'), at: Date.now() }
    let answering: InquiryMessageItem | null = null
    try {
      const picked = await window.morse.pickInquiryPhoto(accountUid)
      if (!picked) return
      const bytes = await prepareChannelPostPhoto(picked, new AbortController().signal)
      setPending(current => [...current, entry])
      answering = takeReply()
      const replying = answering
      await sendPending(entry.id, async () => {
        const result = await trackWrite(window.morse.sendInquiryPhoto(accountUid, { requestId, inquiryId, messageId: entry.id, caption: '', ...(replying ? { replyToId: replying.id } : {}) }, bytes))
        if (result === 'unconfirmed') controller.toast(tr('전송 결과를 확인하지 못했습니다. 잠시 후 대화를 확인해 주세요.'))
        markInquirySent(accountUid, inquiryId, entry.id)
      }, tr('사진을 보내지 못했습니다.'))
    } catch (reason) {
      // The picture could not be read or prepared: nothing was sent.
      setPending(current => current.filter(item => item.id !== entry.id)); restoreReply(answering)
      controller.toast(errorText(reason, tr('사진을 보내지 못했습니다.')), 'error')
    } finally { setPicking(false) }
  }
  // ChannelInquiryChatView also sends videos and files: picked in the main process, then the same send
  // box a chat uses, which reads a video's length, size and thumbnail before it goes.
  async function sendAttachment(mode: 'video' | 'file'): Promise<void> {
    if (!ready || picking) return
    setPicking(true)
    let draft
    try { draft = await window.morse.pickInquiryAttachment(accountUid, { requestId, inquiryId }, mode) }
    catch (reason) { controller.toast(errorText(reason, tr('첨부를 준비하지 못했습니다.')), 'error'); return }
    finally { setPicking(false) }
    if (!draft) return
    const picked = draft
    showAttachmentBox(picked, {
      send: async (caption, itemIds, video) => {
        const entry = { id: crypto.randomUUID().toUpperCase(), text: mode === 'video' ? tr('동영상') : picked.name, at: Date.now() }
        setPending(current => [...current, entry])
        const answering = takeReply()
        try {
          const result = await trackWrite(window.morse.sendInquiryAttachment(accountUid, { requestId, inquiryId, messageId: entry.id, draftId: picked.id, itemId: itemIds[0]!, caption, ...(answering ? { replyToId: answering.id } : {}) }, video))
          if (result === 'unconfirmed') controller.toast(tr('전송 결과를 확인하지 못했습니다. 잠시 후 대화를 확인해 주세요.'))
        markInquirySent(accountUid, inquiryId, entry.id)
        } catch (reason) { setPending(current => current.filter(item => item.id !== entry.id)); restoreReply(answering); throw reason }
      },
      discard: () => { void window.morse.discardInquiryAttachment(accountUid, picked.id).catch(() => {}) }
    })
  }
  // ChannelInquiryChatView.uploadAndSendVideo(isCircle: true): a video message goes to the room when sent.
  const roundVideo: RoundVideoTarget = {
    surface: 'inquiry',
    begin: captureId => window.morse.beginInquiryRoundVideo(accountUid, { requestId, inquiryId, captureId }),
    activate: captureId => window.morse.activateInquiryVoice(accountUid, { requestId, inquiryId, captureId }),
    send: async (captureId, bytes, facts) => {
      const entry = { id: crypto.randomUUID().toUpperCase(), text: tr('영상 메시지'), at: Date.now() }
      setPending(current => [...current, entry])
      const answering = takeReply()
      try {
        const result = await trackWrite(window.morse.sendInquiryRoundVideo(accountUid, { requestId, inquiryId, captureId, messageId: entry.id, duration: facts.duration, thumb: facts.thumb, ...(answering ? { replyToId: answering.id } : {}) }, bytes))
        if (result === 'unconfirmed') controller.toast(tr('전송 결과를 확인하지 못했습니다. 잠시 후 대화를 확인해 주세요.'))
        markInquirySent(accountUid, inquiryId, entry.id)
      } catch (reason) { setPending(current => current.filter(item => item.id !== entry.id)); restoreReply(answering); throw reason }
    }
  }
  const endRecording = (): void => { held.current = undefined; setRecording(false) }
  // ChannelInquiryChatView.uploadAndSendVoice: the previewed recording goes to the room; a retry keeps its message id.
  async function sendVoice(voice: InquiryVoiceSend): Promise<void> {
    const entry = { id: voice.messageId, text: tr('음성 메시지 · {0}:{1}', [Math.floor(voice.duration / 60), String(Math.round(voice.duration) % 60).padStart(2, '0')]), at: Date.now() }
    setPending(current => current.some(item => item.id === entry.id) ? current : [...current, entry])
    const answering = takeReply()
    try {
      const result = await trackWrite(window.morse.sendInquiryVoice(accountUid, { requestId, inquiryId, messageId: voice.messageId, duration: voice.duration, waveform: voice.waveform, captureId: voice.captureId, sha256: voice.sha256, ...(answering ? { replyToId: answering.id } : {}) }))
      if (result === 'unconfirmed') controller.toast(tr('전송 결과를 확인하지 못했습니다. 잠시 후 대화를 확인해 주세요.'))
        markInquirySent(accountUid, inquiryId, entry.id)
    } catch (reason) { setPending(current => current.filter(item => item.id !== entry.id)); restoreReply(answering); throw reason }
  }
  // A reaction shows at once, as a chat's does (message-overlay toggleReaction), and gives way to the room's own
  // copy once that copy has changed; a refused one goes back.
  const [reacting, setReacting] = useState<Record<string, { base: string; reactions: ChatMessage['reactions'] }>>({})
  useEffect(() => { setReacting(current => {
    const next = Object.fromEntries(Object.entries(current).filter(([id, entry]) => JSON.stringify(items.find(item => item.id === id)?.reactions ?? []) === entry.base))
    return Object.keys(next).length === Object.keys(current).length ? current : next
  }) }, [items])
  function react(item: InquiryMessageItem, emoji: string): void {
    if (item.system || !ready) return
    const shown = reacting[item.id]?.reactions ?? item.reactions ?? []
    const selected = new Set(shown.filter(reaction => reaction.selected).map(reaction => reaction.emoji)), adding = !selected.has(emoji)
    if (adding) selected.add(emoji); else selected.delete(emoji)
    if (selected.size > 20) { controller.toast(tr('반응은 20개까지 선택할 수 있습니다.'), 'error'); return }
    const me = { uid: accountUid, name: tr('나') }
    const reactions = shown.map(reaction => reaction.emoji === emoji ? { ...reaction, selected: adding, count: Math.max(0, reaction.count + (adding ? 1 : -1)),
      users: adding ? [me, ...(reaction.users ?? []).filter(user => user.uid !== accountUid)] : reaction.users?.filter(user => user.uid !== accountUid) } : reaction).filter(reaction => reaction.count > 0)
    if (adding && !shown.some(reaction => reaction.emoji === emoji)) reactions.push({ emoji, count: 1, selected: true, users: [me] })
    const base = JSON.stringify(item.reactions ?? [])
    setReacting(current => ({ ...current, [item.id]: { base, reactions } }))
    void trackWrite(window.morse.reactInquiryMessage(accountUid, { requestId, inquiryId, messageId: item.id, reactions: [...selected].sort() })).catch(reason => {
      setReacting(current => { const next = { ...current }; delete next[item.id]; return next })
      controller.toast(errorText(reason, tr('반응을 적용하지 못했습니다.')), 'error')
    })
  }
  // HistoryWidget's layout: a date above a new day, and messages from one side within 15 minutes joined.
  const rows = useMemo(() => items.map((item, index) => {
    const previous = items[index - 1], next = items[index + 1], time = item.createdAt ?? 0
    const joins = (a: InquiryMessageItem | undefined, b: InquiryMessageItem | undefined): boolean => Boolean(a && b && a.own === b.own &&
      a.createdAt !== null && b.createdAt !== null && sameDay(a.createdAt, b.createdAt) && b.createdAt - a.createdAt < attachWindowMs)
    const layout: MessageLayout = { date: !previous || !sameDay(previous.createdAt ?? 0, time), unread: false, top: joins(previous, item), bottom: joins(item, next), name: false, photo: false, gutter: false, roomOnly: false }
    const message = inquiryChatMessage(item, inquiryId), overlay = reacting[item.id]
    return { item, message: overlay ? { ...message, reactions: overlay.reactions } : message, layout }
  }), [items, inquiryId, reacting])
  function attachMenu(point: { x: number; y: number }): void {
    popupMenu.open(point, [
      { label: tr('사진'), icon: <ImageIcon size={18} />, onSelect: () => { void sendPhoto() } },
      { label: tr('동영상'), icon: <Film size={18} />, onSelect: () => { void sendAttachment('video') } },
      { label: tr('파일'), icon: <FileIcon size={18} />, onSelect: () => { void sendAttachment('file') } }
    ])
  }
  function edit(item: InquiryMessageItem): void {
    controller.showLayer(close => <EditMessageBox initial={item.text} close={close}
      save={next => trackWrite(window.morse.editInquiryMessage(accountUid, { requestId, inquiryId, messageId: item.id, text: next }))} />)
  }
  // A room deletes as a chat does: the sender may take a message back from both sides, anyone may drop it from
  // this device only (iOS deleteMessage hideForMe).
  async function remove(items: InquiryMessageItem[]): Promise<void> {
    if (!items.length) return
    const choice = await chooseDeletion(items.length, items.every(item => item.own), true)
    if (!choice) return
    setSelection(null)
    try {
      if (choice === 'me') { await trackWrite(window.morse.hideInquiryMessages(accountUid, inquiryId, items.map(item => item.id))); return }
      for (const item of items) await trackWrite(window.morse.deleteInquiryMessage(accountUid, { requestId, inquiryId, messageId: item.id }))
    } catch (reason) { controller.toast(errorText(reason, tr('메시지를 삭제하지 못했습니다.')), 'error') }
  }
  async function clear(): Promise<void> {
    if (!await confirmBox({ title: tr('대화 기록 모두 삭제'), text: tr('이 문의의 모든 메시지를 양쪽 모두에게서 삭제합니다. 되돌릴 수 없어요.'), confirm: tr('모두 삭제'), danger: true })) return
    try {
      const result = await trackWrite(window.morse.clearInquiryHistory(accountUid, { requestId, inquiryId }))
      controller.toast(result === 'done' ? tr('대화 기록을 삭제했습니다.') : tr('삭제 결과를 확인하고 있습니다. 잠시 후 대화를 확인해 주세요.'))
    } catch (reason) { controller.toast(errorText(reason, tr('대화 기록을 삭제하지 못했습니다.')), 'error') }
  }
  // «모두에게 고정»: both sides of the room see it, as in a chat (AppState.pinMessageForAll).
  async function setPinned(item: InquiryMessageItem, pinned: boolean): Promise<void> {
    try {
      await trackWrite(window.morse.pinInquiryMessage(accountUid, { requestId, inquiryId, messageId: item.id, pinned }))
      controller.toast(pinned ? tr('메시지를 고정했습니다.') : tr('고정을 해제했습니다.'))
    } catch (reason) { controller.toast(errorText(reason, pinned ? tr('메시지를 고정하지 못했습니다.') : tr('고정을 해제하지 못했습니다.')), 'error') }
  }
  const openMenu = (item: InquiryMessageItem, point: { x: number; y: number }): void => {
    const pinned = pinnedIds.includes(item.id)
    // The attachment this message can hand over, as a chat hands one over (Telegram «Save As…»).
    const savable = (item.attachments ?? []).find(part => part.available && !part.blind)
    const message = inquiryChatMessage(item, inquiryId)
    popupMenu.open(point, [
      item.text ? { label: tr('텍스트 복사'), icon: <Copy size={18} />, onSelect: () => { const copied = copyText(item.text); controller.toast(copied ? tr('텍스트를 복사했습니다.') : tr('텍스트를 복사하지 못했습니다.'), copied ? 'default' : 'error') } } : null,
      !item.system && ready ? { label: pinned ? tr('고정 해제') : tr('모두에게 고정'), icon: pinned ? <PinOff size={18} /> : <Pin size={18} />, onSelect: () => { void setPinned(item, !pinned) } } : null,
      // MorseStickerPreview: a sticker received here can be kept in this device's library, as in a chat.
      item.kind === 'sticker' && savable ? { label: tr('스티커 저장'), icon: <Sticker size={18} />, onSelect: () => { void saveSticker(accountUid, inquiryId, message) } } : null,
      savable && item.kind !== 'sticker' ? { label: item.kind === 'voice' ? tr('파일로 저장') : tr('저장'), icon: <Download size={18} />, onSelect: () => { void saveAttachment(accountUid, inquiryId, message, savable.index) } } : null,
      // Telegram forwards by re-sending the content: a room's message goes into a chat the same way a chat's does.
      ready && canForwardMessage(message) ? { label: tr('전달'), icon: <Forward size={18} />, onSelect: () => showShareBox(accountUid, [message], { kind: 'inquiry', inquiryId }) } : null,
      !item.system && ready ? { label: tr('답장'), icon: <Reply size={18} />, onSelect: () => beginReply(item) } : null,
      !item.system && ready ? { label: tr('선택'), icon: <CheckCheck size={18} />, onSelect: () => toggleSelected(item) } : null,
      item.own && item.kind === 'text' && ready ? { label: tr('수정'), icon: <Pencil size={18} />, onSelect: () => edit(item) } : null,
      !item.system && ready ? 'separator' : null,
      !item.system && ready ? { label: tr('삭제'), icon: <Trash2 size={18} />, danger: true, onSelect: () => { void remove([item]) } } : null
    ], { header: !item.system && ready ? <ReactionStrip accountUid={accountUid} mine={(reacting[item.id]?.reactions ?? item.reactions ?? []).filter(entry => entry.selected).map(entry => entry.emoji)}
      onPick={emoji => { popupMenu.close(); react(item, emoji) }} /> : undefined })
  }
  // The newest pinned message rides above the room, as PinnedBar does above a chat.
  const pinnedItem = pinnedIds.length ? items.find(item => item.id === pinnedIds[pinnedIds.length - 1]) ?? null : null
  // A message that is gone (deleted, expired, hidden) is no longer the one being answered.
  useEffect(() => { setReplyTo(current => current && items.some(item => item.id === current.id) ? current : null) }, [items])
  // The selection in the room's own order, and what may be done with it.
  const selected = selection === null ? [] : items.filter(item => selection.includes(item.id))
  const toggleSelected = (item: InquiryMessageItem): void => setSelection(current => current === null ? [item.id]
    : current.includes(item.id) ? current.filter(id => id !== item.id) : current.length < maxForwardMessages ? [...current, item.id] : current)
  const canForwardSelected = selected.length > 0 && selected.every(item => canForwardMessage(inquiryChatMessage(item, inquiryId)))
  const canDeleteSelected = selected.length > 0 && selected.every(item => !item.system)


  return <section className="side-panel channel-comments-panel inquiry-panel" aria-label={tr('1:1 문의')}>
    <header className="top-bar">
      {selection !== null ? <>
        <button className="icon-button" aria-label={tr('선택 취소')} onClick={() => setSelection(null)}><X size={20} /></button>
        <strong className="top-bar-selection">{tr('{0}개 선택', [selected.length])}</strong>
        <button className="button flat" disabled={!canForwardSelected} onClick={() => { showShareBox(accountUid, selected.map(item => inquiryChatMessage(item, inquiryId)), { kind: 'inquiry', inquiryId }); setSelection(null) }}><Forward size={18} />{tr('전달')}</button>
        <button className="button flat danger" disabled={!canDeleteSelected} onClick={() => { void remove(selected) }}><Trash2 size={18} />{tr('삭제')}</button>
      </> : <>
      {fromList && <button className="icon-button" aria-label={tr('문의 목록으로')} onClick={() => showInquiryThread(channelId, null)}><ArrowLeft size={20} /></button>}
      <strong className="side-title ellipsis">{thread?.title || tr('1:1 문의')}</strong>
      <button className="icon-button" aria-label={tr('더 보기')} disabled={!ready} onClick={event => popupMenu.open(pointFor(event, event.currentTarget), [
        { label: thread?.autoDeleteSeconds ? autoDeleteSummary(thread.autoDeleteSeconds) : tr('자동 삭제'), icon: <Timer size={18} />,
          onSelect: () => showInquiryAutoDeleteBox(accountUid, { requestId, inquiryId }, { seconds: thread?.autoDeleteSeconds ?? 0 }) },
        'separator',
        { label: tr('대화 기록 모두 삭제'), icon: <Trash2 size={18} />, danger: true, onSelect: () => { void clear() } }
      ])}><EllipsisVertical size={20} /></button>
      <button className="icon-button" aria-label={tr('문의 닫기')} onClick={() => controller.setRight(null)}><X size={20} /></button>
      </>}
    </header>
    {pinnedItem && <button type="button" className="pinned-bar" aria-label={tr('고정된 메시지로 이동')}
      onClick={() => list.current?.querySelector(`[data-inquiry-message="${pinnedItem.id}"]`)?.scrollIntoView({ block: 'center' })}>
      <span className="pinned-bar-line" aria-hidden="true" />
      <span className="pinned-bar-text">
        <span className="pinned-bar-label"><Pin size={12} />{tr('모두에게 고정')}{pinnedIds.length > 1 && <small>{pinnedIds.length}</small>}</span>
        <span className="ellipsis">{pinnedItem.text || pinnedItem.label || tr('메시지')}</span>
      </span>
    </button>}
    <DeferredItemsBar items={thread?.scheduled ?? []} drop={async item => { await trackWrite(window.morse.cancelInquiryScheduled(accountUid, { requestId, inquiryId, messageId: item.id })) }} />
    <div ref={list} className="channel-comments-list inquiry-messages">
      {!thread || (thread.status === 'loading' && !items.length) ? <div className="empty-state"><Spinner size={22} /></div>
        : thread.status === 'error' ? <div className="empty-state">{thread.message || tr('문의를 열지 못했습니다.')}</div>
          : !items.length && !waiting.length ? <div className="empty-state">{thread.role === 'subscriber' ? tr('채널 운영자에게 궁금한 점을 남겨 보세요.') : tr('아직 메시지가 없습니다.')}</div>
            : <>
              {rows.map(({ item, message, layout }) => <div key={item.id} className="history-row inquiry-thread-row" data-inquiry-message={item.id}>
                {layout.date && <div className="history-date"><span className="service-pill">{serviceDate(item.createdAt ?? 0)}</span></div>}
                <MessageView accountUid={accountUid} chatId={inquiryId} message={message} own={item.own} layout={layout} read={item.own && message.readEligible && !item.system && readCovers(thread.outboxRead, readCursor(message.position)) ? 'read' : 'sent'}
                  selecting={selection !== null} selected={selection?.includes(item.id) === true} highlighted={false}
                  autoTranslate={false} onMenu={(_message, point) => openMenu(item, point)} onReply={() => beginReply(item)} onJumpReply={() => showMessage(item.replyToId)}
                  onToggle={() => toggleSelected(item)} onReaction={(_message, emoji) => react(item, emoji)}
                  onOpenMedia={(opened, index) => showMediaViewer(accountUid, inquiryId, opened, index, item.own ? tr('나') : thread?.title ?? '')} />
              </div>)}
              {waiting.map(entry => <div key={entry.id} className="history-row inquiry-thread-row">
                <LocalMessageView accountUid={accountUid} item={inquiryLocal(entry, inquiryId)} layout={{ date: false, unread: false, top: false, bottom: false, name: false, photo: false, gutter: false, roomOnly: false }} onMenu={(_item, point) => pendingMenu(entry, point)} />
              </div>)}
            </>}
    </div>
    <div className="compose" ref={composeArea}>
      {replyTo && <div className="compose-bar">
        <Reply size={20} className="compose-bar-icon" />
        <div className="compose-bar-text"><strong>{tr('{0}에게 답장', [replyTo.own ? tr('나') : thread?.title || tr('상대방')])}</strong>
          <span className="ellipsis">{replyTo.text || replyTo.label || tr('메시지')}</span></div>
        <button className="icon-button small" aria-label={tr('답장 해제')} onClick={() => setReplyTo(null)}><X size={18} /></button>
      </div>}
      {thread?.role === 'owner' && thread.channelName && <p className="compose-hint">{tr('[{0}] 이름으로 답장해요', [thread.channelName])}</p>}
      {recording === 'voice' ? <InquiryVoiceBar accountUid={accountUid} requestId={requestId} inquiryId={inquiryId} held={held.current} onSend={sendVoice} onClose={endRecording} />
        : recording === 'video' ? <RoundVideoRecorder target={roundVideo} held={held.current} onClose={endRecording} /> : <div className="compose-row">
        <button className="icon-button" aria-label={tr('첨부')} title={tr('사진·동영상·파일 보내기')} disabled={!ready || picking} onClick={event => attachMenu(pointFor(event, event.currentTarget))}>
          {picking ? <Spinner size={18} /> : <Plus size={20} />}
        </button>
        <textarea ref={field} className="compose-field" rows={1} value={text} maxLength={maxInquiryText} disabled={!ready} placeholder={tr('메시지 입력')} aria-label={tr('문의 메시지 작성')}
          onChange={event => setText(event.target.value)}
          onKeyDown={event => {
            if (event.key !== 'Enter' || composingKey(event.nativeEvent)) return
            const modifier = event.metaKey || event.ctrlKey
            if (enterToSend ? !event.shiftKey && !modifier && !event.altKey : modifier) { event.preventDefault(); void send() }
          }} />
        <button type="button" className={`icon-button compose-entities${entities ? ' active' : ''}`} data-entity-toggle aria-label={tr('이모지와 스티커')} aria-expanded={entities}
          disabled={!ready} onClick={() => setEntities(value => !value)}><Smile size={22} /></button>
        {entities && <EntityPanel accountUid={accountUid} onEmoji={insertEmoji}
          onSticker={item => { void sendSticker(() => window.morse.sendInquirySticker(accountUid, { requestId, inquiryId, messageId: crypto.randomUUID().toUpperCase() }, item.id)) }}
          onPackSticker={(setId, itemId) => { void sendSticker(() => window.morse.sendInquiryPackSticker(accountUid, { requestId, inquiryId, messageId: crypto.randomUUID().toUpperCase() }, setId, itemId)) }}
          onClose={() => setEntities(false)} />}
        {/* Telegram's send button turns into the microphone while there is nothing typed. */}
        {text.trim() ? <button className="compose-send" aria-label={tr('보내기')} disabled={!ready} onClick={() => { void send() }}
          onContextMenu={event => { event.preventDefault(); if (ready) popupMenu.open(pointFor(event, event.currentTarget), [
            { label: tr('예약 전송'), icon: <Clock size={18} />, onSelect: () => showScheduleBox(at => { void sendLater(at) }) }
          ]) }}><Send size={20} /></button>
          : <RecordButton mode={recordVideo ? 'video' : 'voice'} disabled={!ready || picking} area={() => composeArea.current}
            onHold={next => { held.current = next; setRecording(recordVideo ? 'video' : 'voice') }} />}
      </div>}
    </div>
  </section>
}

export function ChannelInquiryPanel({ accountUid, channelId, thread, fromList }: { accountUid: string; channelId: string; thread: string | null; fromList: boolean }) {
  if (thread) return <InquiryThread key={thread} accountUid={accountUid} channelId={channelId} inquiryId={thread} fromList={fromList} />
  return <section className="side-panel channel-comments-panel inquiry-panel" aria-label={tr('1:1 문의')}>
    <header className="top-bar">
      <strong className="side-title">{tr('1:1 문의')}</strong>
      <button className="icon-button" aria-label={tr('문의 닫기')} onClick={() => controller.setRight(null)}><X size={20} /></button>
    </header>
    <InquiryList accountUid={accountUid} channelId={channelId} />
  </section>
}
