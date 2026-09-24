import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Check, File as FileIcon, Image as ImageIcon, Images, Mic, Pencil, Reply, Send, X, Languages, Plus, BellOff, Wifi, Clock, CalendarPlus, Smile } from 'lucide-react'
import type { ChatMessage, DialogSummary } from '../../../shared/model'
import type { OutgoingSnapshot } from '../../../shared/delivery'
import type { ReplyDraftSnapshot } from '../../../shared/reply-draft'
import type { VoiceDraftRecord } from '../../../shared/voice-draft'
import { sendsOnEnter } from '../../../shared/shortcuts'
import { outgoingText } from '../../../shared/validation'
import { maxAlbumPhotos } from '../../../shared/uploads'
import { useDesktop } from '../app/store'
import { useTypingReport } from '../app/typing'
import { EntityPanel } from './entity-panel'
import { controller, useUi } from '../app/ui'
import { errorText } from '../app/format'
import { draftFlushers, trackWrite } from '../app/drafts'
import { useShortcut } from '../app/shortcuts'
import { popupMenu, pointFor } from '../ui/popup-menu'
import { pasteFiles, pickFiles } from '../boxes/send-files-box'
import { editMessage } from './message-overlay'
import { VoiceDraftBar, VoiceRecordBar } from './voice-record'
import { RecordButton, type HeldRef } from './record-button'
import { RoundVideoRecorder, type RoundVideoTarget } from './round-video-record'
import { resetAutoTranslation } from '../app/translations'
import { showScheduleBox } from './deferred-send'
import { showEventBox } from './event-box'
import { tr } from '../../../shared/i18n'


// HistoryView::ComposeControls: local draft saved on every change, immediate
// send into the durable outbox, reply/edit bars and the voice record bar.
export function Compose({ accountUid, chatId, dialog, outgoing, reply, editing, onCancelEdit, onEditLast, onSent }: {
  accountUid: string; chatId: string; dialog: DialogSummary | null; outgoing: OutgoingSnapshot; reply: ReplyDraftSnapshot
  editing: ChatMessage | null; onCancelEdit(): void; onEditLast(): void; onSent(): void
}) {
  const platform = useDesktop(snapshot => snapshot?.platform ?? 'unsupported')
  const enterToSend = useDesktop(snapshot => snapshot?.preferences.enterToSend ?? true)
  const spellCheck = useDesktop(snapshot => snapshot?.preferences.spellCheck ?? true)
  const focusToken = useUi(state => state.composerFocus)
  const [text, setText] = useState(''), [editText, setEditText] = useState('')
  const [loaded, setLoaded] = useState(false), [recording, setRecording] = useState<false | 'voice' | 'video'>(false)
  // Telegram's record button: a click switches between voice and video, a held press records.
  const recordVideo = useDesktop(snapshot => snapshot?.preferences.recordVideoMessages ?? false)
  const held = useRef<HeldRef | undefined>(undefined), root = useRef<HTMLDivElement>(null)
  const [voiceDraft, setVoiceDraft] = useState<VoiceDraftRecord | null>(null)
  const field = useRef<HTMLTextAreaElement>(null)
  const latest = useRef(''), dirty = useRef(false), available = useRef(false), sending = useRef(false)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const replyRef = useRef(reply); replyRef.current = reply
  const autoTranslateChats = useDesktop(snapshot => snapshot?.preferences.autoTranslateChats ?? false)
  const [focused, setFocused] = useState(false), [entities, setEntities] = useState(false)
  // iOS MorseEntityKeyboard insertEmoji: at the caret, replacing a selection.
  function insertEmoji(emoji: string): void {
    const element = field.current
    const current = editing ? editText : latest.current
    const start = element?.selectionStart ?? current.length, end = element?.selectionEnd ?? current.length
    const next = current.slice(0, start) + emoji + current.slice(end)
    if (next.length > 30000) return
    change(next)
    requestAnimationFrame(() => { const target = field.current; if (target) { target.focus(); target.setSelectionRange(start + emoji.length, start + emoji.length) } })
  }
  async function sendSticker(stickerId: string): Promise<void> {
    setEntities(false)
    const binding = replyRef.current.selection
    if (binding && replyRef.current.status !== 'ready') { controller.toast(tr('답장 원본을 확인한 뒤 보내 주세요.'), 'error'); return }
    try { await trackWrite(window.morse.sendSticker(accountUid, chatId, crypto.randomUUID(), stickerId, binding)); onSent() }
    catch (reason) { controller.toast(errorText(reason, tr('처리하지 못했습니다. 다시 시도해 주세요.')), 'error') }
  }
  // A sticker of an installed set (Telegram's sticker pack tabs): fetched into this device's library, then sent.
  async function sendPackSticker(setId: string, itemId: string): Promise<void> {
    setEntities(false)
    const binding = replyRef.current.selection
    if (binding && replyRef.current.status !== 'ready') { controller.toast(tr('답장 원본을 확인한 뒤 보내 주세요.'), 'error'); return }
    try { await trackWrite(window.morse.sendPackSticker(accountUid, chatId, crypto.randomUUID(), setId, itemId, binding)); onSent() }
    catch (reason) { controller.toast(errorText(reason, tr('처리하지 못했습니다. 다시 시도해 주세요.')), 'error') }
  }

  const flush = useCallback(async (): Promise<void> => {
    clearTimeout(timer.current)
    if (!dirty.current || !available.current) return
    dirty.current = false
    const value = latest.current
    try { await trackWrite(window.morse.saveDraft(accountUid, chatId, value)) }
    catch (error) { if (latest.current === value) dirty.current = true; throw error }
  }, [accountUid, chatId])

  useEffect(() => {
    let alive = true
    latest.current = ''; dirty.current = false; available.current = false
    setText(''); setLoaded(false); setRecording(false); setVoiceDraft(null)
    void window.morse.draft(accountUid, chatId).then(value => {
      if (!alive) return
      available.current = true
      if (!dirty.current) { latest.current = value; setText(value) }
      setLoaded(true)
    }).catch(() => { if (alive) setLoaded(true) })
    // A recording kept on this device takes the place of the field until it is sent or deleted.
    void window.morse.readVoiceDraft(accountUid, chatId).then(record => { if (alive && record.chatId === chatId) setVoiceDraft(record) }).catch(() => {})
    draftFlushers.add(flush)
    return () => { alive = false; draftFlushers.delete(flush); void flush().catch(() => {}) }
  }, [accountUid, chatId, flush])

  useEffect(() => {
    if (!editing) return
    setEditText(editing.text)
    requestAnimationFrame(() => { const element = field.current; if (element) { element.focus(); element.setSelectionRange(element.value.length, element.value.length) } })
  }, [editing?.id, editing?.version])
  useEffect(() => { if (focusToken && loaded) field.current?.focus({ preventScroll: true }) }, [focusToken, loaded])
  const value = editing ? editText : text
  useTypingReport(accountUid, chatId, focused && loaded && value.trim() !== '', value)
  const savedVoice = !editing && voiceDraft?.voice ? voiceDraft : null
  useLayoutEffect(() => {
    const element = field.current
    if (!element) return
    element.style.height = 'auto'
    element.style.height = `${Math.min(224, element.scrollHeight)}px`
  }, [value, recording, savedVoice])

  useShortcut(20, command => {
    if (command !== 'back' || document.activeElement !== field.current) return false
    if (editing) { onCancelEdit(); return true }
    if (reply.selection) { void cancelReply(); return true }
    return false
  })

  function change(next: string): void {
    if (editing) { setEditText(next); return }
    latest.current = next; dirty.current = true; setText(next)
    clearTimeout(timer.current)
    timer.current = setTimeout(() => { void flush().catch(() => {}) }, 300)
  }
  async function cancelReply(): Promise<void> {
    const selection = replyRef.current.selection
    if (!selection) return
    try { await trackWrite(window.morse.cancelReply(accountUid, chatId, selection.selectionId)) }
    catch (reason) { controller.toast(errorText(reason, tr('답장을 해제하지 못했습니다.')), 'error') }
  }
  async function send(options: { silent?: boolean } = {}): Promise<void> {
    if (editing) {
      const next = editText.trim()
      if (!next || next === editing.text.trim()) { onCancelEdit(); return }
      try { outgoingText(next) } catch (reason) { controller.toast(errorText(reason, tr('보낼 수 없는 내용입니다.')), 'error'); return }
      void editMessage(accountUid, editing, next)
      onCancelEdit()
      return
    }
    const raw = latest.current
    try { outgoingText(raw) } catch { return }
    if (sending.current || !outgoing.canCompose || !available.current) return
    // Only a chosen reply waits for its original; a chat without one sends at once.
    const status = replyRef.current.status
    if (replyRef.current.selection && status !== 'ready') { controller.toast(tr('답장 원본을 확인한 뒤 보내 주세요.'), 'error'); return }
    sending.current = true
    const binding = replyRef.current.selection, id = crypto.randomUUID()
    clearTimeout(timer.current)
    latest.current = ''; dirty.current = false; setText('')
    try {
      // The outbox clears the stored draft only when it still equals the sent text.
      await trackWrite(window.morse.saveDraft(accountUid, chatId, raw))
      await trackWrite(window.morse.sendText(accountUid, chatId, raw, id, binding, options.silent === true))
      onSent()
    } catch (reason) {
      if (!latest.current) { latest.current = raw; dirty.current = true; setText(raw) }
      controller.toast(errorText(reason, tr('메시지를 보내지 못했습니다.')), 'error')
    } finally { sending.current = false }
  }

  // Send menu «예약 전송» / «온라인시 보내기»: the text is queued on the server and the composer clears.
  async function sendLater(kind: 'scheduled' | 'online', scheduledAt: number | null): Promise<void> {
    const raw = latest.current
    try { outgoingText(raw) } catch { return }
    const binding = replyRef.current.selection
    if (binding && replyRef.current.status !== 'ready') { controller.toast(tr('답장 원본을 확인한 뒤 보내 주세요.'), 'error'); return }
    try {
      await trackWrite(window.morse.sendDeferred(accountUid, { chatId, messageId: crypto.randomUUID().toUpperCase(), kind, text: raw, scheduledAt, silent: false, reply: binding }))
      if (latest.current === raw) { clearTimeout(timer.current); latest.current = ''; dirty.current = false; setText(''); void trackWrite(window.morse.saveDraft(accountUid, chatId, '')).catch(() => {}) }
      controller.toast(kind === 'scheduled' ? tr('메시지가 예약됐어요') : tr('상대방이 접속하면 자동 전송돼요'))
    } catch (reason) { controller.toast(errorText(reason, tr('메시지를 보내지 못했어요.')), 'error') }
  }
  // Right click on send (Telegram SendMenu; iOS send options): silent, when online, scheduled.
  const openSendMenu = (point: { x: number; y: number }): void => {
    if (editing || !loaded || !outgoing.canCompose || !latest.current.trim()) return
    popupMenu.open(point, [
      { label: tr('무음 전송'), icon: <BellOff size={18} />, onSelect: () => { void send({ silent: true }) } },
      // Like iOS SendOptionsOverlay, the row is always offered; a chat without a single peer answers with an error.
      dialog ? { label: tr('온라인시 보내기'), icon: <Wifi size={18} />, onSelect: () => { void sendLater('online', null) } } : null,
      dialog ? { label: tr('예약 전송'), icon: <Clock size={18} />, onSelect: () => showScheduleBox(at => { void sendLater('scheduled', at) }) } : null
    ])
  }
  const secret = dialog?.kind === 'secret'
  const blocked = secret ? tr('이 기기에서는 비밀 대화에 메시지를 보낼 수 없습니다.') : outgoing.writingBlocked ? outgoing.message || tr('이 대화에는 지금 메시지를 보낼 수 없습니다.') : ''
  const canAttach = loaded && outgoing.canCompose && !editing && Boolean(dialog) && !secret
  const hasText = value.trim().length > 0
  const openAttach = (point: { x: number; y: number }): void => popupMenu.open(point, [
    { label: tr('사진 또는 동영상'), icon: <ImageIcon size={18} />, onSelect: () => { void pickFiles(accountUid, chatId, 'media', () => replyRef.current.selection) } },
    { label: tr('사진 여러 장'), icon: <Images size={18} />, onSelect: () => { void pickFiles(accountUid, chatId, 'album', () => replyRef.current.selection) } },
    { label: tr('파일'), icon: <FileIcon size={18} />, onSelect: () => { void pickFiles(accountUid, chatId, 'file', () => replyRef.current.selection) } },
    { label: tr('일정 만들기'), icon: <CalendarPlus size={18} />, onSelect: () => showEventBox(accountUid, chatId) },
    !chatId.startsWith('memo_') && 'separator',
    !chatId.startsWith('memo_') && { label: autoTranslateChats ? tr('전체번역 끄기') : tr('전체번역'), icon: <Languages size={18} />, onSelect: () => {
      if (!autoTranslateChats) resetAutoTranslation()
      void window.morse.updatePreferences({ autoTranslateChats: !autoTranslateChats }).catch(reason => controller.toast(errorText(reason, tr('전체번역 설정을 바꾸지 못했습니다.')), 'error'))
    } }
  ])
  const replyText = reply.status === 'loading' ? tr('원본을 불러오는 중…') : reply.status === 'unavailable' ? tr('원본 메시지를 볼 수 없습니다. 답장을 해제해 주세요.') : reply.status === 'error' ? tr('원본을 확인하지 못했습니다.')
    // The bar shows the original's own preview, which already names its kind (ReplyContext.originalPreview).
    : reply.preview?.state === 'ready' ? reply.preview.text : ''

  const roundVideo: RoundVideoTarget = {
    surface: 'chat',
    begin: id => window.morse.beginRoundVideo(accountUid, { id, chatId }),
    activate: id => window.morse.activateVoiceCapture(accountUid, { id, chatId }),
    send: async (id, bytes, facts) => {
      const current = replyRef.current
      if (current.status !== 'none' && current.status !== 'ready') throw new Error(tr('답장 원본을 확인한 뒤 보내 주세요.'))
      await trackWrite(window.morse.sendRoundVideo(accountUid, { id, chatId, duration: facts.duration, thumb: facts.thumb, reply: current.selection }, bytes))
      onSent()
    }
  }
  const endRecording = (): void => { held.current = undefined; setRecording(false) }

  return <div className="compose" ref={root}>
    {editing ? <div className="compose-bar"><Pencil size={20} className="compose-bar-icon" /><div className="compose-bar-text"><strong>{tr('메시지 수정')}</strong><span className="ellipsis">{editing.text}</span></div><button className="icon-button small" aria-label={tr('수정 취소')} onClick={onCancelEdit}><X size={18} /></button></div>
      : reply.selection && <div className={`compose-bar${reply.status === 'unavailable' || reply.status === 'error' ? ' warning' : ''}`}>
        <Reply size={20} className="compose-bar-icon" />
        <div className="compose-bar-text"><strong>{reply.preview?.state === 'ready' ? tr('{0}에게 답장', [reply.preview.senderName]) : tr('답장')}</strong><span className="ellipsis">{replyText}</span></div>
        {reply.selection && <button className="icon-button small" aria-label={tr('답장 해제')} onClick={() => { void cancelReply() }}><X size={18} /></button>}
      </div>}
    {!blocked && !outgoing.canCompose && outgoing.message && loaded && <p className="compose-hint" role="status">{outgoing.message}</p>}
    {blocked ? <div className="compose-blocked" role="status">{blocked}</div>
      : recording === 'voice' ? <VoiceRecordBar accountUid={accountUid} chatId={chatId} reply={() => replyRef.current} held={held.current} onSaved={setVoiceDraft} onClose={endRecording} />
      : recording === 'video' ? <RoundVideoRecorder target={roundVideo} held={held.current} onClose={endRecording} />
        : savedVoice ? <VoiceDraftBar key={savedVoice.revision} accountUid={accountUid} chatId={chatId} record={savedVoice} reply={() => replyRef.current} onChange={setVoiceDraft} />
          : <div className="compose-row">
            <button className="icon-button" aria-label={tr('첨부')} disabled={!canAttach} onClick={event => openAttach(pointFor(event, event.currentTarget))}><Plus size={24} /></button>
            <textarea ref={field} className="compose-field" rows={1} value={value} maxLength={30000} data-composer aria-label={tr('메시지 작성')} spellCheck={spellCheck}
              placeholder={loaded ? editing ? tr('메시지 수정') : tr('메시지 입력') : tr('초안을 불러오는 중…')} disabled={!loaded}
              onChange={event => change(event.target.value)} onFocus={() => setFocused(true)} onBlur={() => { setFocused(false); void flush().catch(() => {}) }}
              onKeyDown={event => {
                if (sendsOnEnter(event.nativeEvent, platform, enterToSend)) { event.preventDefault(); if (!event.repeat) void send() }
                else if (event.key === 'ArrowUp' && !editing && !value && !event.shiftKey && !event.altKey) { event.preventDefault(); onEditLast() }
              }}
              // A picture on the clipboard is sent like a dropped one; text and a message being edited paste as usual.
              onPaste={event => {
                const files = Array.from(event.clipboardData?.files ?? []).filter(file => file.type.startsWith('image/') || file.type.startsWith('video/'))
                if (!files.length || !canAttach || editing) return
                event.preventDefault()
                void pasteFiles(accountUid, chatId, files.slice(0, maxAlbumPhotos), () => replyRef.current.selection)
              }} />
            <button type="button" className={`icon-button compose-entities${entities ? ' active' : ''}`} data-entity-toggle aria-label={tr('이모지와 스티커')} aria-expanded={entities}
              disabled={!loaded} onClick={() => setEntities(value => !value)}><Smile size={22} /></button>
            {entities && <EntityPanel accountUid={accountUid} onEmoji={insertEmoji} onSticker={item => { if (!editing && canAttach) void sendSticker(item.id) }}
              onPackSticker={(setId, itemId) => { if (!editing && canAttach) void sendPackSticker(setId, itemId) }} onClose={() => setEntities(false)} />}
            {hasText || editing
              ? <button className="compose-send" aria-label={editing ? tr('수정 저장') : tr('보내기')} disabled={!loaded || (!editing && !outgoing.canCompose)} onClick={() => { void send() }}
                onContextMenu={event => { event.preventDefault(); openSendMenu(pointFor(event, event.currentTarget)) }}>{editing ? <Check size={22} /> : <Send size={20} />}</button>
              : <RecordButton mode={recordVideo ? 'video' : 'voice'} disabled={!canAttach} area={() => root.current}
                onHold={next => { void flush().catch(() => {}); held.current = next; setRecording(recordVideo ? 'video' : 'voice') }} />}
          </div>}
  </div>
}
