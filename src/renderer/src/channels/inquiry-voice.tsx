import { useEffect, useRef, useState } from 'react'
import { Lock, Pause, Play, Send, Square, Trash2, X } from 'lucide-react'
import { maxVoiceCaptureBytes, voiceCaptureMime, type VoiceCapturePreview } from '../../../shared/voice-capture'
import { controller } from '../app/ui'
import { errorText } from '../app/format'
import { Spinner } from '../ui/controls'
import { recordTips, type HeldRef } from '../history/record-button'
import { usePreviewAudio } from '../history/voice-record'
import { tr } from '../../../shared/i18n'

// The voice recording bar of a channel inquiry, built as the chat's (VoiceRecordBar): record, send at once or
// stop to listen, then delete or send. The recording is made as iOS makes one (MorseVoiceRecordingSession):
// AAC, at most 60 seconds, a waveform of the last 36 levels read every 80ms as (dB + 50) / 50, never below
// 0.06. The main process keeps the finished recording and serves it for listening; sending uses that same
// recording, and a retry after a failure sends it under the same message id. A chat can also keep a recording
// for later; an inquiry has no place for one, so that button is not here.
export interface InquiryVoiceSend { captureId: string; sha256: string; duration: number; waveform: number[]; messageId: string }
const bins = 36, meterMs = 80, maxSeconds = 60
const clock = (seconds: number): string => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`

export function InquiryVoiceBar({ accountUid, requestId, inquiryId, held, onSend, onClose }: {
  accountUid: string; requestId: string; inquiryId: string; held?: HeldRef; onSend(voice: InquiryVoiceSend): Promise<void>; onClose(): void
}) {
  const [phase, setPhase] = useState<'starting' | 'recording' | 'finishing' | 'preview'>('starting')
  const [elapsed, setElapsed] = useState(0), [level, setLevel] = useState(0), [locked, setLocked] = useState(!held)
  const [preview, setPreview] = useState<{ capture: VoiceCapturePreview; duration: number } | null>(null)
  const [busy, setBusy] = useState(false)
  const target = useRef({ requestId, inquiryId, captureId: crypto.randomUUID() })
  const recorder = useRef<MediaRecorder | null>(null), stream = useRef<MediaStream | null>(null), chunks = useRef<Blob[]>([]), size = useRef(0)
  const started = useRef(0), waveform = useRef<number[]>(Array(bins).fill(0.08)), finished = useRef(false), stopping = useRef(false), sending = useRef(false), alive = useRef(true)
  const attempt = useRef<InquiryVoiceSend | null>(null)
  const ticking = useRef<ReturnType<typeof setInterval> | null>(null)
  const phaseRef = useRef(phase); phaseRef.current = phase
  const closeRef = useRef(onClose); closeRef.current = onClose
  const sendRef = useRef(onSend); sendRef.current = onSend
  const player = usePreviewAudio(preview?.capture.url ?? null)

  const report = (step: string, reason?: unknown): void => {
    window.morse.recordVoiceStep({ surface: 'inquiry', step, ...(reason instanceof Error ? { name: reason.name } : {}) })
  }
  const stopTracks = (): void => { stream.current?.getTracks().forEach(track => track.stop()); stream.current = null }
  const release = (): void => { void window.morse.releaseVoiceCapture(target.current.captureId).catch(() => {}) }
  const cancel = (message?: string): void => {
    if (finished.current || sending.current) return
    finished.current = true
    const current = recorder.current; recorder.current = null
    if (current) { current.ondataavailable = null; current.onstop = null; if (current.state !== 'inactive') current.stop() }
    stopTracks(); chunks.current = []
    release()
    if (message) controller.toast(message, 'error')
    if (alive.current) closeRef.current()
  }
  async function send(capture: VoiceCapturePreview, duration: number): Promise<void> {
    if (sending.current || finished.current) return
    const request = attempt.current ?? { captureId: target.current.captureId, sha256: capture.sha256, duration: Math.min(maxSeconds, duration), waveform: [...waveform.current], messageId: crypto.randomUUID().toUpperCase() }
    attempt.current = request; sending.current = true
    setBusy(true); player.pause()
    try {
      await sendRef.current(request)
      report('sent')
      finished.current = true
      if (alive.current) closeRef.current()
    } catch (reason) {
      report('send-failed', reason)
      if (alive.current) { setPreview({ capture, duration }); setPhase('preview') }
      controller.toast(tr('{0} 다시 보내면 같은 메시지로 확인합니다.', [errorText(reason, tr('음성 메시지를 보내지 못했습니다.'))]), 'error')
    } finally {
      sending.current = false
      if (alive.current) setBusy(false)
      else if (!finished.current) { finished.current = true; release() }
    }
  }
  async function deliver(mode: 'send' | 'review', seconds: number): Promise<void> {
    const parts = chunks.current; chunks.current = []
    const data = new Uint8Array(await new Blob(parts, { type: voiceCaptureMime }).arrayBuffer())
    let capture: VoiceCapturePreview
    try {
      // The length is the time recorded, as iOS takes it from the recorder.
      if (seconds < .5) { report('too-short'); throw new Error(tr('0.5초보다 짧은 음성은 보낼 수 없습니다.')) }
      capture = await window.morse.finishInquiryVoice(accountUid, target.current, data)
    } catch (reason) { sending.current = false; cancel(errorText(reason, tr('녹음을 준비하지 못했습니다.'))); return }
    finally { data.fill(0) }
    sending.current = false
    if (!alive.current && mode !== 'send') { cancel(); return }
    if (mode === 'send') { await send(capture, seconds); return }
    setPreview({ capture, duration: seconds }); setPhase('preview')
  }
  const stop = (mode: 'send' | 'review'): void => {
    const current = recorder.current
    if (!current || stopping.current || finished.current) return
    stopping.current = true
    // A send keeps running when the bar closes; a review is released instead.
    sending.current = mode === 'send'
    const seconds = Math.min(maxSeconds, (performance.now() - started.current) / 1000)
    // The clock stops where the recording does, while it is finished, uploaded and sent.
    if (ticking.current) { clearInterval(ticking.current); ticking.current = null }
    setElapsed(seconds)
    setPhase('finishing')
    current.onstop = () => { stopTracks(); void deliver(mode, seconds) }
    if (current.state === 'recording') current.stop()
  }
  const actions = useRef({ stop, cancel }); actions.current = { stop, cancel }

  // Held from the record button, as in a chat: releasing sends or cancels until the recording is locked.
  useEffect(() => {
    if (!held) return
    held.api = {
      release: go => {
        if (!go) { actions.current.cancel(); return }
        if (phaseRef.current !== 'recording' || performance.now() - started.current < 500) { actions.current.cancel(); controller.toast(recordTips.hold); return }
        actions.current.stop('send')
      },
      lock: () => setLocked(true)
    }
    if (held.pending !== null) held.api.release(held.pending)
    return () => { held.api = null }
  }, [held])

  useEffect(() => {
    alive.current = true
    let meter: { context: AudioContext; interval: ReturnType<typeof setInterval> } | null = null
    let timer: ReturnType<typeof setTimeout> | undefined
    const escape = (event: KeyboardEvent): void => { if (event.key === 'Escape' && !sending.current) { event.preventDefault(); actions.current.cancel() } }
    window.addEventListener('keydown', escape)
    // The grant ends on its own when the room closes, the account changes or the screen locks.
    const unsubscribe = window.morse.onEvent(event => {
      if (event.type !== 'voice-capture-revoked' || event.id !== target.current.captureId || sending.current || finished.current) return
      report('grant-revoked'); finished.current = true
      controller.toast(tr('녹음을 더 이상 사용할 수 없어 닫았습니다.'), 'error')
      if (alive.current) closeRef.current()
    })
    void (async () => {
      try {
        if (typeof MediaRecorder === 'undefined' || !MediaRecorder.isTypeSupported(voiceCaptureMime)) { report('recorder-unsupported'); throw new Error(tr('이 환경에서는 Morse 음성 형식(AAC)으로 녹음할 수 없습니다.')) }
        try { await window.morse.beginInquiryVoice(accountUid, target.current) } catch (reason) { report('begin-failed', reason); throw reason }
        if (finished.current) return
        let input: MediaStream
        try { input = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, sampleRate: 16000 }, video: false }) }
        catch (reason) { report('mic-open-failed', reason); throw reason }
        if (finished.current) { input.getTracks().forEach(track => track.stop()); return }
        stream.current = input
        if (input.getAudioTracks().length !== 1) throw new Error(tr('하나의 마이크 입력을 확인해 주세요.'))
        try { await window.morse.activateInquiryVoice(accountUid, target.current) } catch (reason) { report('activate-failed', reason); throw reason }
        if (finished.current) return
        // No bitrate is set: Chromium's AAC encoder refuses 24 kbps at 16 and 48 kHz (EncodingError right after
        // start, depending on the microphone), and only its own choice works for every input.
        const next = new MediaRecorder(input, { mimeType: voiceCaptureMime })
        next.ondataavailable = event => {
          if (!event.data.size) return
          size.current += event.data.size
          if (size.current >= maxVoiceCaptureBytes || chunks.current.length >= 256) { report('size-limit'); actions.current.cancel(tr('녹음 크기 한도를 넘었습니다.')); return }
          chunks.current.push(event.data)
        }
        next.onerror = () => { report('recorder-error'); actions.current.cancel(tr('마이크 녹음 중 오류가 발생했습니다.')) }
        input.getAudioTracks()[0]!.addEventListener('ended', () => { if (phaseRef.current === 'recording') actions.current.cancel(tr('마이크 입력이 중단되었습니다.')) }, { once: true })
        recorder.current = next
        started.current = performance.now()
        next.start(1000); setPhase('recording'); report('recording-started')
        timer = setTimeout(() => actions.current.stop('send'), maxSeconds * 1000)
        const context = new AudioContext(), analyser = context.createAnalyser(), samples = new Float32Array(1024)
        analyser.fftSize = samples.length
        context.createMediaStreamSource(input).connect(analyser)
        meter = { context, interval: setInterval(() => {
          setElapsed((performance.now() - started.current) / 1000)
          analyser.getFloatTimeDomainData(samples)
          let sum = 0; for (const sample of samples) sum += sample * sample
          const normalized = Math.max(0, Math.min(1, (20 * Math.log10(Math.sqrt(sum / samples.length) || 1e-6) + 50) / 50))
          waveform.current = [...waveform.current.slice(1), Math.max(0.06, normalized)]
          setLevel(normalized)
        }, meterMs) }
        ticking.current = meter.interval
      } catch (reason) { actions.current.cancel(errorText(reason, tr('녹음을 시작하지 못했습니다.'))) }
    })()
    return () => {
      alive.current = false
      window.removeEventListener('keydown', escape)
      unsubscribe()
      if (timer) clearTimeout(timer)
      if (meter) { clearInterval(meter.interval); void meter.context.close().catch(() => {}) }
      actions.current.cancel()
    }
  }, [])
  useEffect(() => { if (phase === 'finishing' || phase === 'preview') setLevel(0) }, [phase])
  useEffect(() => {
    if (!preview) return
    const timer = setTimeout(() => actions.current.cancel(tr('미리 듣기 시간이 지나 녹음을 닫았습니다.')), Math.max(0, preview.capture.expiresAt - Date.now()))
    return () => clearTimeout(timer)
  }, [preview])

  if (phase === 'preview' && preview) return <div className="voice-record-bar preview" role="group" aria-label={tr('녹음 미리 듣기')}>
    <button className="icon-button" aria-label={tr('녹음 삭제')} disabled={busy} onClick={() => cancel()}><Trash2 size={20} /></button>
    <button type="button" className="voice-preview-play" aria-label={player.playing ? tr('일시 정지') : tr('미리 듣기')} onClick={player.toggle}>{player.playing ? <Pause size={18} /> : <Play size={18} />}</button>
    <span className="voice-preview-track" aria-hidden="true"><i style={{ width: `${player.progress * 100}%` }} /></span>
    <span className="voice-record-time">{clock(preview.duration)}</span>
    <button className="compose-send" aria-label={tr('음성 메시지 보내기')} disabled={busy} onClick={() => { void send(preview.capture, preview.duration) }}>{busy ? <Spinner size={18} /> : <Send size={20} />}</button>
  </div>
  const seconds = Math.min(maxSeconds, elapsed)
  const time = `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')},${Math.floor((seconds % 1) * 10)}`
  if (!locked && phase !== 'finishing') return <div className="voice-record-bar held" role="status" aria-label={tr('음성 녹음')}>
    <span className="voice-record-dot" style={{ transform: `scale(${1 + level * .6})` }} />
    <span className="voice-record-time">{time}</span>
    <span className="voice-record-hint">{phase === 'starting' ? tr('마이크를 준비하고 있습니다…') : recordTips.held}</span>
    <span className="voice-record-lock" aria-hidden="true"><Lock size={18} /></span>
  </div>
  return <div className="voice-record-bar" role="status" aria-label={tr('음성 녹음')}>
    <span className="voice-record-dot" style={{ transform: `scale(${1 + level * .6})` }} />
    <span className="voice-record-time">{time}</span>
    <span className="voice-record-hint">{phase === 'starting' ? tr('마이크를 준비하고 있습니다…') : phase === 'finishing' ? tr('녹음을 마무리하는 중…') : tr('Esc를 누르면 취소됩니다')}</span>
    <button className="icon-button" aria-label={tr('녹음 취소')} disabled={phase === 'finishing'} onClick={() => cancel()}><X size={22} /></button>
    <button className="icon-button" aria-label={tr('멈추고 들어보기')} title={tr('멈추고 들어보기')} disabled={phase !== 'recording'} onClick={() => stop('review')}><Square size={20} /></button>
    <button className="compose-send" aria-label={tr('음성 메시지 보내기')} disabled={phase !== 'recording'} onClick={() => stop('send')}><Send size={20} /></button>
  </div>
}
