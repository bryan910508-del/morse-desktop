import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, Copy, EllipsisVertical, File as FileIcon, Film, Image as ImageIcon, Mic, Pencil, Plus, Send, Trash2, X } from 'lucide-react'
import { maxInquiryText, type InquiryMessageItem } from '../../../shared/channel-inquiries'
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
import { positionAt, type ChatMessage } from '../../../shared/model'
import { LocalMessageView, MessageView, type MessageLayout } from '../history/message'
import type { LocalOutgoing } from '../../../shared/delivery'
import { showMediaViewer } from '../media/media-viewer'
import { showAttachmentBox } from '../boxes/send-files-box'
import { InquiryVoiceBar, type InquiryVoiceSend } from './inquiry-voice'
import { RecordButton, type HeldRef } from '../history/record-button'
import { RoundVideoRecorder, type RoundVideoTarget } from '../history/round-video-record'
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
  return <div className="inquiry-list">{list.items.map(item => <button key={item.id} type="button" className="inquiry-row" onClick={() => showInquiryThread(channelId, item.id)}>
    <UserAvatar uid={item.peerUid} name={item.peerName} size={42} image={item.photo} />
    <span className="inquiry-row-body">
      <span className="inquiry-row-line"><strong className="ellipsis">{item.peerName}</strong><time>{dialogTime(item.lastMessageAt)}</time></span>
      <span className="inquiry-row-line"><span className="inquiry-row-preview ellipsis">{item.lastMessage || tr('메시지')}</span>{item.unread > 0 && <span className="inquiry-row-badge">{item.unread > 999 ? '999+' : item.unread}</span>}</span>
    </span>
  </button>)}</div>
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
function inquiryChatMessage(item: InquiryMessageItem, inquiryId: string): ChatMessage {
  const media = Boolean(item.attachments?.length) && item.kind !== 'text'
  const plain = !media && item.kind !== 'text'
  return { id: item.id, chatId: inquiryId, senderId: item.own ? 'me' : 'peer', kind: plain ? 'text' : item.kind,
    text: item.kind === 'text' ? item.text : plain ? [item.label, item.text].filter(Boolean).join('\n') : '', caption: media ? item.text : '',
    attachments: item.attachments, mediaMetadata: item.mediaMetadata ?? null, circular: item.circular ?? false, position: positionAt(item.createdAt ?? 0, item.id), version: item.version,
    serverConfirmed: true, encrypted: false, silent: false, state: 'sent', readEligible: false, edited: item.edited, system: item.system === true, reactions: [] } as ChatMessage
}
// A message being sent, drawn as a chat draws one of its own on the way (LocalMessageView).
function inquiryLocal(entry: { id: string; text: string; at: number }, inquiryId: string): LocalOutgoing {
  return { id: entry.id, chatId: inquiryId, text: entry.text, createdAt: entry.at, state: 'queued', reason: '', busy: true, retryable: false }
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
  const [text, setText] = useState(''), [pending, setPending] = useState<{ id: string; text: string; at: number }[]>([]), [picking, setPicking] = useState(false)
  const [recording, setRecording] = useState<false | 'voice' | 'video'>(false)
  // Telegram's record button, as in a chat: a click switches voice and video, a held press records.
  const recordVideo = useDesktop(snapshot => snapshot?.preferences.recordVideoMessages ?? false)
  const held = useRef<HeldRef | undefined>(undefined), composeArea = useRef<HTMLDivElement>(null)
  const list = useRef<HTMLDivElement>(null), field = useRef<HTMLTextAreaElement>(null)
  const items = thread?.items ?? [], ready = thread?.status === 'ready'
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
    setPending(current => [...current, entry]); setText('')
    try {
      const result = await trackWrite(window.morse.sendInquiryMessage(accountUid, { requestId, inquiryId, messageId: entry.id, text: value }))
      if (result === 'unconfirmed') controller.toast(tr('전송 결과를 확인하지 못했습니다. 잠시 후 대화를 확인해 주세요.'))
    } catch (reason) {
      setPending(current => current.filter(item => item.id !== entry.id)); setText(current => current || value)
      controller.toast(errorText(reason, tr('메시지를 보내지 못했습니다.')), 'error')
    }
  }
  // ChannelInquiryChatView photo send: one picked file, re-encoded to JPEG before it leaves.
  async function sendPhoto(): Promise<void> {
    if (!ready || picking) return
    setPicking(true)
    const entry = { id: crypto.randomUUID().toUpperCase(), text: tr('사진'), at: Date.now() }
    try {
      const picked = await window.morse.pickInquiryPhoto(accountUid)
      if (!picked) return
      const bytes = await prepareChannelPostPhoto(picked, new AbortController().signal)
      setPending(current => [...current, entry])
      const result = await trackWrite(window.morse.sendInquiryPhoto(accountUid, { requestId, inquiryId, messageId: entry.id, caption: '' }, bytes))
      if (result === 'unconfirmed') controller.toast(tr('전송 결과를 확인하지 못했습니다. 잠시 후 대화를 확인해 주세요.'))
    } catch (reason) {
      setPending(current => current.filter(item => item.id !== entry.id))
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
        try {
          const result = await trackWrite(window.morse.sendInquiryAttachment(accountUid, { requestId, inquiryId, messageId: entry.id, draftId: picked.id, itemId: itemIds[0]!, caption }, video))
          if (result === 'unconfirmed') controller.toast(tr('전송 결과를 확인하지 못했습니다. 잠시 후 대화를 확인해 주세요.'))
        } catch (reason) { setPending(current => current.filter(item => item.id !== entry.id)); throw reason }
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
      try {
        const result = await trackWrite(window.morse.sendInquiryRoundVideo(accountUid, { requestId, inquiryId, captureId, messageId: entry.id, duration: facts.duration, thumb: facts.thumb }, bytes))
        if (result === 'unconfirmed') controller.toast(tr('전송 결과를 확인하지 못했습니다. 잠시 후 대화를 확인해 주세요.'))
      } catch (reason) { setPending(current => current.filter(item => item.id !== entry.id)); throw reason }
    }
  }
  const endRecording = (): void => { held.current = undefined; setRecording(false) }
  // ChannelInquiryChatView.uploadAndSendVoice: the previewed recording goes to the room; a retry keeps its message id.
  async function sendVoice(voice: InquiryVoiceSend): Promise<void> {
    const entry = { id: voice.messageId, text: tr('음성 메시지 · {0}:{1}', [Math.floor(voice.duration / 60), String(Math.round(voice.duration) % 60).padStart(2, '0')]), at: Date.now() }
    setPending(current => current.some(item => item.id === entry.id) ? current : [...current, entry])
    try {
      const result = await trackWrite(window.morse.sendInquiryVoice(accountUid, { requestId, inquiryId, messageId: voice.messageId, duration: voice.duration, waveform: voice.waveform, captureId: voice.captureId, sha256: voice.sha256 }))
      if (result === 'unconfirmed') controller.toast(tr('전송 결과를 확인하지 못했습니다. 잠시 후 대화를 확인해 주세요.'))
    } catch (reason) { setPending(current => current.filter(item => item.id !== entry.id)); throw reason }
  }
  // HistoryWidget's layout: a date above a new day, and messages from one side within 15 minutes joined.
  const rows = useMemo(() => items.map((item, index) => {
    const previous = items[index - 1], next = items[index + 1], time = item.createdAt ?? 0
    const joins = (a: InquiryMessageItem | undefined, b: InquiryMessageItem | undefined): boolean => Boolean(a && b && a.own === b.own &&
      a.createdAt !== null && b.createdAt !== null && sameDay(a.createdAt, b.createdAt) && b.createdAt - a.createdAt < attachWindowMs)
    const layout: MessageLayout = { date: !previous || !sameDay(previous.createdAt ?? 0, time), unread: false, top: joins(previous, item), bottom: joins(item, next), name: false, photo: false, gutter: false }
    return { item, message: inquiryChatMessage(item, inquiryId), layout }
  }), [items, inquiryId])
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
  async function remove(item: InquiryMessageItem): Promise<void> {
    if (!await confirmBox({ title: tr('메시지 삭제'), text: tr('이 메시지를 양쪽 모두에게서 삭제할까요?'), confirm: tr('삭제'), danger: true })) return
    try { await trackWrite(window.morse.deleteInquiryMessage(accountUid, { requestId, inquiryId, messageId: item.id })) }
    catch (reason) { controller.toast(errorText(reason, tr('메시지를 삭제하지 못했습니다.')), 'error') }
  }
  async function clear(): Promise<void> {
    if (!await confirmBox({ title: tr('대화 기록 모두 삭제'), text: tr('이 문의의 모든 메시지를 양쪽 모두에게서 삭제합니다. 되돌릴 수 없어요.'), confirm: tr('모두 삭제'), danger: true })) return
    try {
      const result = await trackWrite(window.morse.clearInquiryHistory(accountUid, { requestId, inquiryId }))
      controller.toast(result === 'done' ? tr('대화 기록을 삭제했습니다.') : tr('삭제 결과를 확인하고 있습니다. 잠시 후 대화를 확인해 주세요.'))
    } catch (reason) { controller.toast(errorText(reason, tr('대화 기록을 삭제하지 못했습니다.')), 'error') }
  }
  const openMenu = (item: InquiryMessageItem, point: { x: number; y: number }): void => {
    popupMenu.open(point, [
      item.text ? { label: tr('텍스트 복사'), icon: <Copy size={18} />, onSelect: () => { const copied = copyText(item.text); controller.toast(copied ? tr('텍스트를 복사했습니다.') : tr('텍스트를 복사하지 못했습니다.'), copied ? 'default' : 'error') } } : null,
      item.own && item.kind === 'text' && ready ? { label: tr('수정'), icon: <Pencil size={18} />, onSelect: () => edit(item) } : null,
      item.own && ready ? 'separator' : null,
      item.own && ready ? { label: tr('삭제'), icon: <Trash2 size={18} />, danger: true, onSelect: () => { void remove(item) } } : null
    ])
  }

  return <section className="side-panel channel-comments-panel inquiry-panel" aria-label={tr('1:1 문의')}>
    <header className="top-bar">
      {fromList && <button className="icon-button" aria-label={tr('문의 목록으로')} onClick={() => showInquiryThread(channelId, null)}><ArrowLeft size={20} /></button>}
      <strong className="side-title ellipsis">{thread?.title || tr('1:1 문의')}</strong>
      <button className="icon-button" aria-label={tr('더 보기')} disabled={!ready} onClick={event => popupMenu.open(pointFor(event, event.currentTarget), [
        { label: tr('대화 기록 모두 삭제'), icon: <Trash2 size={18} />, danger: true, onSelect: () => { void clear() } }
      ])}><EllipsisVertical size={20} /></button>
      <button className="icon-button" aria-label={tr('문의 닫기')} onClick={() => controller.setRight(null)}><X size={20} /></button>
    </header>
    <div ref={list} className="channel-comments-list inquiry-messages">
      {!thread || (thread.status === 'loading' && !items.length) ? <div className="empty-state"><Spinner size={22} /></div>
        : thread.status === 'error' ? <div className="empty-state">{thread.message || tr('문의를 열지 못했습니다.')}</div>
          : !items.length && !waiting.length ? <div className="empty-state">{thread.role === 'subscriber' ? tr('채널 운영자에게 궁금한 점을 남겨 보세요.') : tr('아직 메시지가 없습니다.')}</div>
            : <>
              {rows.map(({ item, message, layout }) => <div key={item.id} className="history-row inquiry-thread-row">
                {layout.date && <div className="history-date"><span className="service-pill">{serviceDate(item.createdAt ?? 0)}</span></div>}
                <MessageView accountUid={accountUid} chatId={inquiryId} message={message} own={item.own} layout={layout} read="sent" selecting={false} selected={false} highlighted={false}
                  autoTranslate={false} onMenu={(_message, point) => openMenu(item, point)} onReply={() => {}} onJumpReply={() => {}} onToggle={() => {}} onReaction={() => {}}
                  onOpenMedia={(opened, index) => showMediaViewer(accountUid, inquiryId, opened, index, item.own ? tr('나') : thread?.title ?? '')} />
              </div>)}
              {waiting.map(entry => <div key={entry.id} className="history-row inquiry-thread-row">
                <LocalMessageView accountUid={accountUid} item={inquiryLocal(entry, inquiryId)} layout={{ date: false, unread: false, top: false, bottom: false, name: false, photo: false, gutter: false }} onMenu={() => {}} />
              </div>)}
            </>}
    </div>
    <div className="compose" ref={composeArea}>
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
        {/* Telegram's send button turns into the microphone while there is nothing typed. */}
        {text.trim() ? <button className="compose-send" aria-label={tr('보내기')} disabled={!ready} onClick={() => { void send() }}><Send size={20} /></button>
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
