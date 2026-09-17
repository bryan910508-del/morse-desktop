import { useEffect, useRef, useState } from 'react'
import { Lock, Pause, Play, Save, Send, Square, Trash2, X } from 'lucide-react'
import type { LocalOutgoing } from '../../../shared/delivery'
import type { ReplyBinding, ReplyDraftSnapshot } from '../../../shared/reply-draft'
import { maxVoiceCaptureBytes, voiceCaptureMime, type VoiceCapturePreview, type VoiceCaptureTarget } from '../../../shared/voice-capture'
import type { VoiceDraftRecord, VoiceDraftWrite } from '../../../shared/voice-draft'
import type { VoiceQueueView } from '../../../shared/voice-queue-preview'
import type { VoiceSendRequest } from '../../../shared/voice-send'
import { controller } from '../app/ui'
import { errorText } from '../app/format'
import { trackWrite } from '../app/drafts'
import { useShortcut } from '../app/shortcuts'
import { Spinner } from '../ui/controls'
import { confirmBox } from '../ui/layers'
import { recordTips, type HeldRef } from './record-button'
import { tr } from '../../../shared/i18n'

function mediaDuration(url: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const audio = new Audio()
    const timer = setTimeout(() => { cleanup(); reject(new Error(tr('녹음 길이를 확인하지 못했습니다.'))) }, 10000)
    const cleanup = (): void => { clearTimeout(timer); audio.removeAttribute('src'); audio.load() }
    audio.preload = 'metadata'
    audio.onloadedmetadata = () => { const value = audio.duration; cleanup(); Number.isFinite(value) ? resolve(value) : reject(new Error(tr('녹음 길이를 확인하지 못했습니다.'))) }
    audio.onerror = () => { cleanup(); reject(new Error(tr('녹음한 음성을 읽지 못했습니다.'))) }
    audio.src = url
  })
}

const clock = (seconds: number): string => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`

function replyBinding(reply: ReplyDraftSnapshot): ReplyBinding | null {
  if (reply.status !== 'none' && reply.status !== 'ready') throw new Error(tr('답장 원본을 확인한 뒤 보내 주세요.'))
  return reply.selection
}

// Plays a local preview URL; pauses when the window loses focus or is hidden.
export function usePreviewAudio(url: string | null) {
  const element = useRef<HTMLAudioElement | null>(null), autoplay = useRef(false)
  const [playing, setPlaying] = useState(false), [progress, setProgress] = useState(0)
  useEffect(() => {
    if (!url) return
    const audio = new Audio(url)
    audio.preload = 'auto'
    audio.ontimeupdate = () => setProgress(audio.duration ? audio.currentTime / audio.duration : 0)
    audio.onplay = () => setPlaying(true)
    audio.onpause = () => setPlaying(false)
    audio.onended = () => { setPlaying(false); setProgress(0) }
    element.current = audio
    const pause = (): void => audio.pause()
    const hidden = (): void => { if (document.hidden) audio.pause() }
    window.addEventListener('blur', pause); document.addEventListener('visibilitychange', hidden)
    if (autoplay.current) { autoplay.current = false; void audio.play().catch(() => {}) }
    return () => {
      window.removeEventListener('blur', pause); document.removeEventListener('visibilitychange', hidden)
      audio.onpause = null; audio.pause(); audio.removeAttribute('src'); audio.load()
      element.current = null; setPlaying(false); setProgress(0)
    }
  }, [url])
  return {
    playing, progress,
    toggle(): void { const audio = element.current; if (!audio) { autoplay.current = true; return } if (audio.paused) void audio.play().catch(() => {}); else audio.pause() },
    pause(): void { autoplay.current = false; element.current?.pause() }
  }
}

// HistoryView::Controls::VoiceRecordBar: record, then send at once or stop to
// listen (ListenWrap), where the recording can be deleted, kept or sent.
export function VoiceRecordBar({ accountUid, chatId, reply, held, onSaved, onClose }: { accountUid: string; chatId: string; reply(): ReplyDraftSnapshot; held?: HeldRef; onSaved(record: VoiceDraftRecord): void; onClose(): void }) {
  // Held from the record button: releasing sends or cancels until the recording is locked by dragging up.
  const [locked, setLocked] = useState(!held)
  const [elapsed, setElapsed] = useState(0), [level, setLevel] = useState(0)
  const [phase, setPhase] = useState<'starting' | 'recording' | 'finishing' | 'preview'>('starting')
  const [preview, setPreview] = useState<{ capture: VoiceCapturePreview; duration: number } | null>(null)
  const [busy, setBusy] = useState<'send' | 'save' | null>(null)
  const target = useRef<VoiceCaptureTarget>({ id: crypto.randomUUID(), chatId })
  const recorder = useRef<MediaRecorder | null>(null), stream = useRef<MediaStream | null>(null), chunks = useRef<Blob[]>([]), size = useRef(0)
  const started = useRef(0), finished = useRef(false), stopping = useRef(false), sending = useRef(false), alive = useRef(true)
  const sendAttempt = useRef<VoiceSendRequest | null>(null), saveAttempt = useRef<VoiceDraftWrite | null>(null)
  const ticking = useRef<ReturnType<typeof setInterval> | null>(null)
  const phaseRef = useRef(phase); phaseRef.current = phase
  const closeRef = useRef(onClose); closeRef.current = onClose
  const player = usePreviewAudio(preview?.capture.url ?? null)

  const stopTracks = (): void => { stream.current?.getTracks().forEach(track => track.stop()); stream.current = null }
  const release = (): void => { void window.morse.releaseVoiceCapture(target.current.id).catch(() => {}) }
  const cancel = (message?: string): void => {
    if (finished.current || sending.current) return
    finished.current = true
    const current = recorder.current; recorder.current = null
    if (current) { current.ondataavailable = null; current.onstop = null; if (current.state !== 'inactive') current.stop() }
    stopTracks(); chunks.current = []
    release()
    if (message) controller.toast(message, 'error')
    else if (sendAttempt.current) controller.toast(tr('녹음을 닫았습니다. 이미 보내졌다면 전송은 취소되지 않습니다.'))
    if (alive.current) closeRef.current()
  }
  async function send(capture: VoiceCapturePreview, duration: number): Promise<void> {
    if (sending.current || finished.current) return
    let request = sendAttempt.current
    if (!request) {
      try { request = { id: target.current.id, chatId, duration: Math.min(60, duration), sha256: capture.sha256, reply: replyBinding(reply()) } }
      catch (reason) { controller.toast(errorText(reason, tr('답장 원본을 확인해 주세요.')), 'error'); setPreview({ capture, duration }); setPhase('preview'); return }
    }
    sendAttempt.current = request; sending.current = true
    setBusy('send'); player.pause()
    try {
      await trackWrite(window.morse.sendVoiceCapture(accountUid, request))
      finished.current = true
      if (alive.current) closeRef.current()
    } catch (reason) {
      if (alive.current) { setPreview({ capture, duration }); setPhase('preview') }
      controller.toast(tr('{0} 다시 보내면 같은 메시지로 확인합니다.', [errorText(reason, tr('음성 메시지를 보내지 못했습니다.'))]), 'error')
    } finally {
      sending.current = false
      if (alive.current) setBusy(null)
      else if (!finished.current) { finished.current = true; release() }
    }
  }
  async function deliver(mode: 'send' | 'review'): Promise<void> {
    const parts = chunks.current; chunks.current = []
    const data = new Uint8Array(await new Blob(parts, { type: voiceCaptureMime }).arrayBuffer())
    let capture: VoiceCapturePreview, duration: number
    try {
      capture = await window.morse.finishVoiceCapture(accountUid, target.current, data)
      duration = await mediaDuration(capture.url)
      if (duration < .5) throw new Error(tr('0.5초보다 짧은 음성은 보낼 수 없습니다.'))
    } catch (reason) { sending.current = false; cancel(errorText(reason, tr('녹음을 준비하지 못했습니다.'))); return }
    finally { data.fill(0) }
    sending.current = false
    if (!alive.current && mode !== 'send') { cancel(); return }
    if (mode === 'send') { await send(capture, duration); return }
    setPreview({ capture, duration }); setPhase('preview')
  }
  const stop = (mode: 'send' | 'review'): void => {
    const current = recorder.current
    if (!current || stopping.current || finished.current) return
    stopping.current = true
    // The clock stops where the recording does, while it is finished and sent.
    if (ticking.current) { clearInterval(ticking.current); ticking.current = null }
    setElapsed(Math.min(60, (performance.now() - started.current) / 1000))
    // A send keeps running when the bar closes; a review is released instead.
    sending.current = mode === 'send'
    setPhase('finishing')
    current.onstop = () => { stopTracks(); void deliver(mode) }
    if (current.state === 'recording') current.stop()
  }
  async function save(): Promise<void> {
    if (!preview || busy || sending.current || sendAttempt.current) return
    setBusy('save'); player.pause()
    try {
      if (!saveAttempt.current) {
        const current = await window.morse.readVoiceDraft(accountUid, chatId)
        saveAttempt.current = { chatId, expected: current.revision, revision: crypto.randomUUID(), voice: { id: target.current.id, bytes: preview.capture.bytes, sha256: preview.capture.sha256, duration: Math.min(60, preview.duration) } }
      }
      const request = saveAttempt.current
      const record = await trackWrite(window.morse.writeVoiceDraft(accountUid, request))
      if (record.revision !== request.revision) throw new Error(tr('음성 보관 결과를 확인하지 못했습니다.'))
      saveAttempt.current = null
      onSaved(record)
      controller.toast(tr('음성을 보관했습니다. 이 대화에서 나중에 보낼 수 있습니다.'))
      cancel()
    } catch (reason) { controller.toast(errorText(reason, tr('음성을 보관하지 못했습니다.')), 'error') }
    finally { if (alive.current) setBusy(null) }
  }
  useShortcut(40, command => { if (command === 'back' && !busy) { cancel(); return true } return false })
  const heldActions = useRef({ stop, cancel }); heldActions.current = { stop, cancel }
  useEffect(() => {
    if (!held) return
    held.api = {
      release: send => {
        const { stop: finish, cancel: drop } = heldActions.current
        if (!send) { drop(); return }
        // Too short to be a message, as Telegram drops one under its minimum and shows the hold tip.
        if (phaseRef.current !== 'recording' || performance.now() - started.current < 500) { drop(); controller.toast(recordTips.hold); return }
        finish('send')
      },
      lock: () => setLocked(true)
    }
    if (held.pending !== null) held.api.release(held.pending)
    return () => { held.api = null }
  }, [held])

  useEffect(() => {
    alive.current = true
    let meter: { context: AudioContext; interval: ReturnType<typeof setInterval> } | null = null, timer: ReturnType<typeof setTimeout> | null = null
    const hidden = (): void => { if (document.hidden && (phaseRef.current === 'starting' || phaseRef.current === 'recording')) cancel(tr('화면이 숨겨져 녹음을 취소했습니다.')) }
    const blur = (): void => { if (phaseRef.current === 'starting' || phaseRef.current === 'recording') cancel(tr('창이 포커스를 잃어 녹음을 취소했습니다.')) }
    const unsubscribe = window.morse.onEvent(event => {
      if (event.type !== 'voice-capture-revoked' || event.id !== target.current.id || sending.current || finished.current) return
      finished.current = true
      controller.toast(tr('녹음을 더 이상 사용할 수 없어 닫았습니다.'), 'error')
      if (alive.current) closeRef.current()
    })
    document.addEventListener('visibilitychange', hidden); window.addEventListener('blur', blur)
    void (async () => {
      try {
        const report = (step: string, reason?: unknown): void => { window.morse.recordVoiceStep({ surface: 'chat', step, ...(reason instanceof Error ? { name: reason.name } : {}) }) }
        if (typeof MediaRecorder === 'undefined' || !MediaRecorder.isTypeSupported(voiceCaptureMime)) { report('recorder-unsupported'); throw new Error(tr('이 환경에서는 Morse 음성 형식(AAC)으로 녹음할 수 없습니다.')) }
        try { await window.morse.beginVoiceCapture(accountUid, target.current) } catch (reason) { report('begin-failed', reason); throw reason }
        if (finished.current) return
        let input: MediaStream
        try { input = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, sampleRate: 16000 }, video: false }) }
        catch (reason) { report('mic-open-failed', reason); throw reason }
        if (finished.current) { input.getTracks().forEach(track => track.stop()); return }
        stream.current = input
        if (input.getAudioTracks().length !== 1) throw new Error(tr('하나의 마이크 입력을 확인해 주세요.'))
        try { await window.morse.activateVoiceCapture(accountUid, target.current) } catch (reason) { report('activate-failed', reason); throw reason }
        // No bitrate is set: Chromium's AAC encoder refuses 24 kbps at 16 and 48 kHz (EncodingError right after
        // start, depending on the microphone), and only its own choice works for every input.
        const next = new MediaRecorder(input, { mimeType: voiceCaptureMime })
        next.ondataavailable = event => {
          if (!event.data.size) return
          size.current += event.data.size
          if (size.current >= maxVoiceCaptureBytes || chunks.current.length >= 256) { cancel(tr('녹음 크기 한도를 넘었습니다.')); return }
          chunks.current.push(event.data)
        }
        next.onerror = () => { report('recorder-error'); cancel(tr('마이크 녹음 중 오류가 발생했습니다.')) }
        input.getAudioTracks()[0]!.addEventListener('ended', () => { if (phaseRef.current === 'recording') cancel(tr('마이크 입력이 중단되었습니다.')) }, { once: true })
        recorder.current = next
        started.current = performance.now()
        next.start(1000); setPhase('recording'); report('recording-started')
        timer = setTimeout(() => stop('send'), 60000)
        const context = new AudioContext(), analyser = context.createAnalyser(), samples = new Float32Array(1024)
        analyser.fftSize = samples.length
        context.createMediaStreamSource(input).connect(analyser)
        meter = { context, interval: setInterval(() => {
          setElapsed((performance.now() - started.current) / 1000)
          analyser.getFloatTimeDomainData(samples)
          let sum = 0; for (const sample of samples) sum += sample * sample
          const db = 20 * Math.log10(Math.sqrt(sum / samples.length) || 1e-6)
          setLevel(Math.max(0, Math.min(1, (db + 50) / 50)))
        }, 100) }
        ticking.current = meter.interval
      } catch (reason) { cancel(errorText(reason, tr('녹음을 시작하지 못했습니다.'))) }
    })()
    return () => {
      alive.current = false
      unsubscribe()
      document.removeEventListener('visibilitychange', hidden); window.removeEventListener('blur', blur)
      if (timer) clearTimeout(timer)
      if (meter) { clearInterval(meter.interval); void meter.context.close().catch(() => {}) }
      cancel()
    }
  }, [])
  useEffect(() => { if (phase === 'finishing' || phase === 'preview') setLevel(0) }, [phase])
  useEffect(() => {
    if (!preview) return
    const timer = setTimeout(() => cancel(tr('미리 듣기 시간이 지나 녹음을 닫았습니다.')), Math.max(0, preview.capture.expiresAt - Date.now()))
    return () => clearTimeout(timer)
  }, [preview])

  if (phase === 'preview' && preview) return <div className="voice-record-bar preview" role="group" aria-label={tr('녹음 미리 듣기')}>
    <button className="icon-button" aria-label={tr('녹음 삭제')} disabled={Boolean(busy)} onClick={() => cancel()}><Trash2 size={20} /></button>
    <button type="button" className="voice-preview-play" aria-label={player.playing ? tr('일시 정지') : tr('미리 듣기')} onClick={player.toggle}>{player.playing ? <Pause size={18} /> : <Play size={18} />}</button>
    <span className="voice-preview-track" aria-hidden="true"><i style={{ width: `${player.progress * 100}%` }} /></span>
    <span className="voice-record-time">{clock(preview.duration)}</span>
    <button className="icon-button" aria-label={tr('보내지 않고 보관')} title={tr('보내지 않고 보관')} disabled={Boolean(busy) || Boolean(sendAttempt.current)} onClick={() => { void save() }}>{busy === 'save' ? <Spinner size={18} /> : <Save size={20} />}</button>
    <button className="compose-send" aria-label={tr('음성 메시지 보내기')} disabled={Boolean(busy)} onClick={() => { void send(preview.capture, preview.duration) }}>{busy === 'send' ? <Spinner size={18} /> : <Send size={20} />}</button>
  </div>
  const seconds = Math.min(60, elapsed)
  if (!locked) return <div className="voice-record-bar held" role="status" aria-label={tr('음성 녹음')}>
    <span className="voice-record-dot" style={{ transform: `scale(${1 + level * .6})` }} />
    <span className="voice-record-time">{Math.floor(seconds / 60)}:{String(Math.floor(seconds % 60)).padStart(2, '0')},{Math.floor((seconds % 1) * 10)}</span>
    <span className="voice-record-hint">{phase === 'starting' ? tr('마이크를 준비하고 있습니다…') : recordTips.held}</span>
    <span className="voice-record-lock" aria-hidden="true"><Lock size={18} /></span>
  </div>
  return <div className="voice-record-bar" role="status" aria-label={tr('음성 녹음')}>
    <span className="voice-record-dot" style={{ transform: `scale(${1 + level * .6})` }} />
    <span className="voice-record-time">{Math.floor(seconds / 60)}:{String(Math.floor(seconds % 60)).padStart(2, '0')},{Math.floor((seconds % 1) * 10)}</span>
    <span className="voice-record-hint">{phase === 'starting' ? tr('마이크를 준비하고 있습니다…') : phase === 'finishing' ? tr('녹음을 마무리하는 중…') : tr('Esc를 누르면 취소됩니다')}</span>
    <button className="icon-button" aria-label={tr('녹음 취소')} disabled={phase === 'finishing'} onClick={() => cancel()}><X size={22} /></button>
    <button className="icon-button" aria-label={tr('멈추고 들어보기')} title={tr('멈추고 들어보기')} disabled={phase !== 'recording'} onClick={() => stop('review')}><Square size={20} /></button>
    <button className="compose-send" aria-label={tr('음성 메시지 보내기')} disabled={phase !== 'recording'} onClick={() => stop('send')}><Send size={20} /></button>
  </div>
}

// Morse voice draft: a recording kept on this device for the chat. It must be
// reopened (restored) before it can be played or sent.
export function VoiceDraftBar({ accountUid, chatId, record, reply, onChange }: { accountUid: string; chatId: string; record: VoiceDraftRecord; reply(): ReplyDraftSnapshot; onChange(record: VoiceDraftRecord): void }) {
  const voice = record.voice!, revision = record.revision!
  const [opened, setOpened] = useState<{ url: string; expiresAt: number } | null>(null)
  const [busy, setBusy] = useState<'open' | 'send' | 'delete' | null>(null)
  const restored = useRef(false), alive = useRef(true)
  const sendAttempt = useRef<VoiceSendRequest | null>(null), removeAttempt = useRef<VoiceDraftWrite | null>(null)
  const player = usePreviewAudio(opened?.url ?? null)
  const release = (): void => { if (!restored.current) return; restored.current = false; void window.morse.releaseVoiceCapture(voice.id).catch(() => {}) }

  useEffect(() => {
    alive.current = true
    const unsubscribe = window.morse.onEvent(event => { if (event.type === 'voice-capture-revoked' && event.id === voice.id) { restored.current = false; setOpened(null) } })
    return () => { alive.current = false; unsubscribe(); release() }
  }, [voice.id, revision])
  useEffect(() => {
    if (!opened) return
    const timer = setTimeout(() => { release(); setOpened(null) }, Math.max(0, opened.expiresAt - Date.now()))
    return () => clearTimeout(timer)
  }, [opened])

  async function restore(): Promise<void> {
    if (restored.current) return
    const result = await window.morse.restoreVoiceDraft(accountUid, { chatId, revision, id: voice.id })
    restored.current = true
    if (!alive.current) { release(); throw new Error(tr('대화가 바뀌었습니다.')) }
    if (result.record.revision !== revision || result.preview.id !== voice.id || result.preview.sha256 !== voice.sha256) { release(); throw new Error(tr('보관한 음성이 바뀌었습니다.')) }
    setOpened({ url: result.preview.url, expiresAt: result.preview.expiresAt })
  }
  async function play(): Promise<void> {
    if (opened) { player.toggle(); return }
    if (busy) return
    setBusy('open')
    try { await restore(); player.toggle() }
    catch (reason) { controller.toast(errorText(reason, tr('보관한 음성을 열지 못했습니다.')), 'error') }
    finally { if (alive.current) setBusy(null) }
  }
  async function send(): Promise<void> {
    if (busy) return
    let request = sendAttempt.current
    if (!request) {
      try { request = { id: voice.id, chatId, duration: voice.duration, sha256: voice.sha256, reply: replyBinding(reply()), draftRevision: revision } }
      catch (reason) { controller.toast(errorText(reason, tr('답장 원본을 확인해 주세요.')), 'error'); return }
    }
    setBusy('send'); player.pause()
    try {
      await restore()
      sendAttempt.current = request
      await trackWrite(window.morse.sendVoiceCapture(accountUid, request))
      sendAttempt.current = null; restored.current = false
      onChange(await window.morse.readVoiceDraft(accountUid, chatId).catch(() => ({ chatId, revision: null, voice: null })))
    } catch (reason) {
      // The draft leaves the device once its send is queued.
      const latest = await window.morse.readVoiceDraft(accountUid, chatId).catch(() => null)
      if (latest && latest.revision !== revision) { sendAttempt.current = null; restored.current = false; onChange(latest); return }
      controller.toast(errorText(reason, tr('보관한 음성을 보내지 못했습니다.')), 'error')
    } finally { if (alive.current) setBusy(null) }
  }
  async function remove(): Promise<void> {
    if (busy) return
    if (!removeAttempt.current && !await confirmBox({ title: tr('보관한 음성 삭제'), text: tr('이 대화에 보관한 음성을 삭제할까요?'), confirm: tr('삭제'), danger: true })) return
    const request = removeAttempt.current ?? { chatId, expected: revision, revision: crypto.randomUUID(), voice: null }
    removeAttempt.current = request
    setBusy('delete'); player.pause()
    try {
      const next = await trackWrite(window.morse.writeVoiceDraft(accountUid, request))
      removeAttempt.current = null
      release()
      onChange(next)
    } catch (reason) { controller.toast(errorText(reason, tr('보관한 음성을 삭제하지 못했습니다.')), 'error') }
    finally { if (alive.current) setBusy(null) }
  }

  return <div className="voice-record-bar preview" role="group" aria-label={tr('보관한 음성')}>
    <button className="icon-button" aria-label={tr('보관한 음성 삭제')} disabled={Boolean(busy)} onClick={() => { void remove() }}>{busy === 'delete' ? <Spinner size={18} /> : <Trash2 size={20} />}</button>
    <button type="button" className="voice-preview-play" aria-label={player.playing ? tr('일시 정지') : tr('들어보기')} disabled={busy === 'open' || busy === 'send'} onClick={() => { void play() }}>
      {busy === 'open' ? <Spinner size={16} /> : player.playing ? <Pause size={18} /> : <Play size={18} />}
    </button>
    <span className="voice-draft-label">{tr('보관한 음성')}</span>
    <span className="voice-preview-track" aria-hidden="true"><i style={{ width: `${player.progress * 100}%` }} /></span>
    <span className="voice-record-time">{clock(voice.duration)}</span>
    <button className="compose-send" aria-label={tr('보관한 음성 보내기')} disabled={Boolean(busy)} onClick={() => { void send() }}>{busy === 'send' ? <Spinner size={18} /> : <Send size={20} />}</button>
  </div>
}

// Plays the device copy of a voice message that is still waiting to be sent.
export function QueuedVoicePlay({ accountUid, item }: { accountUid: string; item: LocalOutgoing }) {
  const [view, setView] = useState<VoiceQueueView | null>(null), [busy, setBusy] = useState(false)
  const requestId = useRef<string | null>(null)
  const player = usePreviewAudio(view?.url ?? null)
  const release = (): void => { const id = requestId.current; requestId.current = null; setView(null); if (id) void window.morse.releaseQueuedVoice(id).catch(() => {}) }
  useEffect(() => {
    const unsubscribe = window.morse.onEvent(event => { if (event.type === 'queued-voice-revoked' && event.requestId === requestId.current) { requestId.current = null; setView(null) } })
    return () => { unsubscribe(); const id = requestId.current; requestId.current = null; if (id) void window.morse.releaseQueuedVoice(id).catch(() => {}) }
  }, [])
  useEffect(() => {
    if (!view) return
    const timer = setTimeout(release, Math.max(0, view.expiresAt - Date.now()))
    return () => clearTimeout(timer)
  }, [view])
  async function toggle(): Promise<void> {
    const metadata = item.voicePreview
    if (view) { player.toggle(); return }
    if (busy || !metadata) return
    const id = crypto.randomUUID()
    requestId.current = id; setBusy(true)
    try {
      const loaded = await window.morse.openQueuedVoice(accountUid, { id: item.id, chatId: item.chatId, sha256: metadata.sha256, bytes: metadata.bytes, duration: metadata.duration, requestId: id })
      if (requestId.current !== id) { void window.morse.releaseQueuedVoice(id).catch(() => {}); return }
      player.toggle(); setView(loaded)
    } catch (reason) {
      void window.morse.releaseQueuedVoice(id).catch(() => {})
      if (requestId.current === id) requestId.current = null
      controller.toast(errorText(reason, tr('보내는 중인 음성을 열지 못했습니다.')), 'error')
    } finally { setBusy(false) }
  }
  return <button type="button" className="voice-message-play" aria-label={player.playing ? tr('일시 정지') : tr('보내는 중인 음성 듣기')} disabled={busy}
    onClick={event => { event.stopPropagation(); void toggle() }}>{busy ? <Spinner size={16} /> : player.playing ? <Pause size={18} /> : <Play size={18} />}</button>
}
