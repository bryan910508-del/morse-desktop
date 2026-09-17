import { useEffect, useRef, useState } from 'react'
import { Lock, Send, X } from 'lucide-react'
import { maxRoundVideoBytes, maxRoundVideoSeconds, roundVideoSide, type RoundVideoFacts } from '../../../shared/round-video'
import { controller } from '../app/ui'
import { errorText } from '../app/format'
import { Spinner } from '../ui/controls'
import { recordTips, type HeldRef } from './record-button'
import { tr } from '../../../shared/i18n'

// Telegram Desktop's video message recorder (ui/controls/round_video_recorder.cpp): the camera's centre in a
// square of kSide 400, at most kMaxDuration 60 seconds, shown as a circle while it records, with the
// microphone. The frames are drawn onto a 400px canvas, which is what gets recorded, as H.264 and AAC in MP4
// (the video at 2 Mbps as kVideoBitRate; an AAC bitrate set by hand fails in Chromium's encoder, so it keeps its
// own). The thumbnail is Telegram's 320px JPEG at quality 87. The camera and microphone are granted the way a
// voice recording's microphone is: reserved for the open room, active while recording, gone when it ends.
export interface RoundVideoTarget {
  surface: 'chat' | 'inquiry'
  begin(captureId: string): Promise<unknown>
  activate(captureId: string): Promise<unknown>
  send(captureId: string, bytes: Uint8Array, facts: RoundVideoFacts): Promise<void>
}
const videoTypes = ['video/mp4;codecs=avc1,mp4a.40.2', 'video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/mp4']

export function RoundVideoRecorder({ target, held, onClose }: { target: RoundVideoTarget; held?: HeldRef; onClose(): void }) {
  const [phase, setPhase] = useState<'starting' | 'recording' | 'sending'>('starting')
  const [elapsed, setElapsed] = useState(0), [locked, setLocked] = useState(!held)
  const preview = useRef<HTMLVideoElement | null>(null)
  const captureId = useRef(crypto.randomUUID())
  const recorder = useRef<MediaRecorder | null>(null), stream = useRef<MediaStream | null>(null), chunks = useRef<Blob[]>([]), size = useRef(0)
  const started = useRef(0), thumb = useRef(''), finished = useRef(false), alive = useRef(true)
  const ticking = useRef<ReturnType<typeof setInterval> | null>(null)
  const closeRef = useRef(onClose); closeRef.current = onClose
  const targetRef = useRef(target); targetRef.current = target

  const report = (step: string, reason?: unknown): void => {
    window.morse.recordVoiceStep({ surface: targetRef.current.surface, step, ...(reason instanceof Error ? { name: reason.name } : {}) })
  }
  const stopTracks = (): void => { stream.current?.getTracks().forEach(track => track.stop()); stream.current = null }
  const cancel = (message?: string): void => {
    if (finished.current) return
    finished.current = true
    const current = recorder.current; recorder.current = null
    if (current) { current.ondataavailable = null; current.onstop = null; if (current.state !== 'inactive') current.stop() }
    stopTracks(); chunks.current = []
    void window.morse.releaseVoiceCapture(captureId.current).catch(() => {})
    if (message) controller.toast(message, 'error')
    if (alive.current) closeRef.current()
  }
  const send = (): void => {
    const current = recorder.current
    if (!current || finished.current) return
    const seconds = Math.min(maxRoundVideoSeconds, (performance.now() - started.current) / 1000)
    if (seconds < .5) { cancel(); controller.toast(recordTips.hold); return }
    finished.current = true; setPhase('sending')
    // The clock stops where the recording does, while it is uploaded and sent.
    if (ticking.current) { clearInterval(ticking.current); ticking.current = null }
    setElapsed(seconds)
    current.onstop = () => {
      stopTracks()
      void (async () => {
        const bytes = new Uint8Array(await new Blob(chunks.current, { type: 'video/mp4' }).arrayBuffer())
        chunks.current = []
        try {
          await targetRef.current.send(captureId.current, bytes, { duration: seconds, thumb: thumb.current })
          report('sent')
        } catch (reason) {
          report('send-failed', reason)
          void window.morse.releaseVoiceCapture(captureId.current).catch(() => {})
          controller.toast(errorText(reason, tr('영상 메시지를 보내지 못했습니다.')), 'error')
        } finally { bytes.fill(0); if (alive.current) closeRef.current() }
      })()
    }
    current.stop()
  }
  const actions = useRef({ send, cancel }); actions.current = { send, cancel }

  useEffect(() => {
    if (!held) return
    held.api = {
      release: go => {
        if (!go) { actions.current.cancel(); return }
        if (!recorder.current) { actions.current.cancel(); controller.toast(recordTips.hold); return }
        actions.current.send()
      },
      lock: () => setLocked(true)
    }
    if (held.pending !== null) held.api.release(held.pending)
    return () => { held.api = null }
  }, [held])

  useEffect(() => {
    alive.current = true
    let draw: ReturnType<typeof setInterval> | undefined, tick: ReturnType<typeof setInterval> | undefined, limit: ReturnType<typeof setTimeout> | undefined
    const escape = (event: KeyboardEvent): void => { if (event.key === 'Escape') { event.preventDefault(); actions.current.cancel() } }
    window.addEventListener('keydown', escape)
    const unsubscribe = window.morse.onEvent(event => {
      if (event.type === 'voice-capture-revoked' && event.id === captureId.current && !finished.current) { report('grant-revoked'); actions.current.cancel(tr('녹화를 더 이상 사용할 수 없어 닫았습니다.')) }
    })
    void (async () => {
      try {
        const mimeType = typeof MediaRecorder === 'undefined' ? undefined : videoTypes.find(type => MediaRecorder.isTypeSupported(type))
        if (!mimeType) { report('recorder-unsupported'); throw new Error(tr('이 환경에서는 영상 메시지(MP4)를 녹화할 수 없습니다.')) }
        try { await targetRef.current.begin(captureId.current) } catch (reason) { report('begin-failed', reason); throw reason }
        if (finished.current) return
        let input: MediaStream
        try {
          input = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1 }, video: { width: { ideal: 640 }, height: { ideal: 640 }, facingMode: 'user' } })
        } catch (reason) { report('mic-open-failed', reason); throw reason }
        if (finished.current) { input.getTracks().forEach(track => track.stop()); return }
        stream.current = input
        if (input.getVideoTracks().length !== 1 || input.getAudioTracks().length !== 1) throw new Error(tr('카메라와 마이크를 하나씩 확인해 주세요.'))
        try { await targetRef.current.activate(captureId.current) } catch (reason) { report('activate-failed', reason); throw reason }
        if (finished.current) return
        const camera = preview.current
        if (!camera) throw new Error(tr('녹화 화면을 준비하지 못했습니다.'))
        camera.srcObject = input
        await camera.play().catch(() => {})
        // The recorded square: the middle of the camera picture, scaled to 400px.
        const canvas = document.createElement('canvas'); canvas.width = canvas.height = roundVideoSide
        const context = canvas.getContext('2d')
        if (!context) throw new Error(tr('녹화 화면을 준비하지 못했습니다.'))
        const paint = (): void => {
          const width = camera.videoWidth, height = camera.videoHeight
          if (!width || !height) return
          const side = Math.min(width, height)
          context.drawImage(camera, (width - side) / 2, (height - side) / 2, side, side, 0, 0, roundVideoSide, roundVideoSide)
        }
        paint(); draw = setInterval(paint, 1000 / 30)
        const next = new MediaRecorder(new MediaStream([...canvas.captureStream(30).getVideoTracks(), ...input.getAudioTracks()]), { mimeType, videoBitsPerSecond: 2_000_000 })
        next.ondataavailable = event => {
          if (!event.data.size) return
          size.current += event.data.size
          if (size.current >= maxRoundVideoBytes || chunks.current.length >= 512) { report('size-limit'); actions.current.cancel(tr('영상 메시지 크기 한도를 넘었습니다.')); return }
          chunks.current.push(event.data)
        }
        next.onerror = () => { report('recorder-error'); actions.current.cancel(tr('녹화 중 오류가 발생했습니다.')) }
        recorder.current = next
        started.current = performance.now()
        next.start(1000); setPhase('recording'); report('recording-started')
        // Telegram's kThumbnailSize 320 at kThumbnailQuality 87, from a frame just after the start.
        setTimeout(() => {
          try {
            const small = document.createElement('canvas'); small.width = small.height = 320
            small.getContext('2d')?.drawImage(canvas, 0, 0, 320, 320)
            const data = small.toDataURL('image/jpeg', .87), prefix = 'data:image/jpeg;base64,'
            if (data.startsWith(prefix)) thumb.current = data.slice(prefix.length)
          } catch { /* A video message without a thumbnail still plays; the circle shows its first frame. */ }
        }, 400)
        tick = setInterval(() => setElapsed((performance.now() - started.current) / 1000), 100)
        ticking.current = tick
        limit = setTimeout(() => actions.current.send(), maxRoundVideoSeconds * 1000)
      } catch (reason) { actions.current.cancel(errorText(reason, tr('녹화를 시작하지 못했습니다.'))) }
    })()
    return () => {
      alive.current = false
      window.removeEventListener('keydown', escape)
      unsubscribe()
      clearInterval(draw); clearInterval(tick); clearTimeout(limit)
      actions.current.cancel()
    }
  }, [])

  const seconds = Math.min(maxRoundVideoSeconds, elapsed)
  const ring = 2 * Math.PI * 48
  return <div className="round-record" role="status" aria-label={tr('영상 메시지 녹화')}>
    <div className="round-record-circle">
      <video ref={preview} muted playsInline />
      <svg className="round-video-ring" viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="50" r="48" style={{ strokeDasharray: ring, strokeDashoffset: ring * (1 - seconds / maxRoundVideoSeconds) }} /></svg>
      {phase !== 'recording' && <span className="round-video-icon"><Spinner size={24} /></span>}
    </div>
    <div className={`voice-record-bar${locked ? '' : ' held'}`}>
      <span className="voice-record-dot" />
      <span className="voice-record-time">{Math.floor(seconds / 60)}:{String(Math.floor(seconds % 60)).padStart(2, '0')},{Math.floor((seconds % 1) * 10)}</span>
      <span className="voice-record-hint">{phase === 'starting' ? tr('카메라를 준비하고 있습니다…') : phase === 'sending' ? tr('보내는 중…') : locked ? tr('Esc를 누르면 취소됩니다') : recordTips.held}</span>
      {locked ? <>
        <button className="icon-button" aria-label={tr('녹화 취소')} disabled={phase === 'sending'} onClick={() => cancel()}><X size={22} /></button>
        <button className="compose-send" aria-label={tr('영상 메시지 보내기')} disabled={phase !== 'recording'} onClick={send}>{phase === 'sending' ? <Spinner size={18} /> : <Send size={20} />}</button>
      </> : <span className="voice-record-lock" aria-hidden="true"><Lock size={18} /></span>}
    </div>
  </div>
}
