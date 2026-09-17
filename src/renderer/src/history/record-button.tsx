import { useEffect, useRef } from 'react'
import { Mic, Video } from 'lucide-react'
import { controller } from '../app/ui'
import { desktop } from '../app/store'
import { errorText } from '../app/format'
import { tr } from '../../../shared/i18n'

// Telegram Desktop's record button (history_widget.cpp, history_view_voice_record_bar.cpp): a click switches
// between a voice and a video message and the choice is kept (Core::Settings::recordVideoMessages), a press
// held down records, releasing inside the compose area sends, releasing outside cancels, and dragging up locks
// the recording so the button can be let go. Telegram starts recording at the press and treats a very short
// one as the click; here the microphone opens only once the press has lasted a quarter of a second, so a
// click never lights the system's recording indicator. The result on screen is the same.
export interface HeldRecording { release(send: boolean): void; lock(): void }
// The recording bar fills in `api` when it mounts; a release that comes before that waits in `pending`.
export interface HeldRef { api: HeldRecording | null; pending: boolean | null }
export type RecordMode = 'voice' | 'video'

const holdMs = 250, lockDistance = 70

// lng_record_voice_tip, lng_record_video_tip, lng_record_hold_tip, lng_record_cancel, in Korean.
export const recordTips = {
  voice: tr('길게 눌러 음성을 녹음하세요. 한 번 누르면 영상 메시지로 바뀝니다.'),
  video: tr('길게 눌러 영상을 녹화하세요. 한 번 누르면 음성 메시지로 바뀝니다.'),
  hold: tr('음성 메시지를 녹음하려면 마우스 버튼을 누르고 있으세요.'),
  held: tr('놓으면 보내기 · 위로 밀면 잠금 · 이 영역 밖에서 놓으면 취소')
}

// Webrtc::RecordAvailability: without a camera the button stays on voice. The kinds of devices are
// listed without any permission (ids and names stay hidden).
async function cameraAvailable(): Promise<boolean> {
  try { return (await navigator.mediaDevices.enumerateDevices()).some(device => device.kind === 'videoinput') } catch { return false }
}

export async function switchRecordMode(current: RecordMode): Promise<void> {
  if (current === 'voice' && !(await cameraAvailable())) { controller.toast(recordTips.hold); return }
  const next = current === 'voice'
  try {
    desktop.replace(await window.morse.updatePreferences({ recordVideoMessages: next }))
    controller.toast(next ? recordTips.video : recordTips.voice)
  } catch (reason) { controller.toast(errorText(reason, tr('설정을 저장하지 못했습니다.')), 'error') }
}

export function RecordButton({ mode, disabled, area, onHold }: { mode: RecordMode; disabled: boolean; area(): Element | null; onHold(held: HeldRef): void }) {
  const press = useRef<{ finish(): void; holding(): boolean } | null>(null)
  const latest = useRef({ mode, area, onHold }); latest.current = { mode, area, onHold }
  // The button gives way to the recording bar as soon as a hold starts, so a press being held keeps listening
  // for its release after the button is gone; only a press that has not become a hold ends with the button.
  useEffect(() => () => { if (press.current && !press.current.holding()) press.current.finish() }, [])
  const down = (event: React.PointerEvent<HTMLButtonElement>): void => {
    if (disabled || event.button !== 0 || press.current) return
    event.preventDefault()
    const held: HeldRef = { api: null, pending: null }
    const start = { x: event.clientX, y: event.clientY }
    let holding = false, locked = false
    const timer = setTimeout(() => { holding = true; latest.current.onHold(held) }, holdMs)
    const inside = (x: number, y: number): boolean => {
      const rect = latest.current.area()?.getBoundingClientRect()
      return Boolean(rect && x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom)
    }
    const release = (send: boolean): void => { if (held.api) held.api.release(send); else held.pending = send }
    const move = (next: PointerEvent): void => {
      if (!holding || locked || start.y - next.clientY < lockDistance) return
      locked = true; held.api?.lock()
    }
    const up = (next: PointerEvent): void => {
      finish()
      if (!holding) { void switchRecordMode(latest.current.mode); return }
      if (!locked) release(inside(next.clientX, next.clientY))
    }
    const interrupted = (): void => { finish(); if (holding && !locked) release(false) }
    const finish = (): void => {
      clearTimeout(timer)
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', interrupted); window.removeEventListener('blur', interrupted)
      press.current = null
    }
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', interrupted); window.addEventListener('blur', interrupted)
    press.current = { finish, holding: () => holding }
  }
  const label = mode === 'video' ? tr('영상 메시지') : tr('음성 메시지')
  return <button type="button" className="icon-button compose-mic" aria-label={tr('{0} 녹음', [label])} title={mode === 'video' ? recordTips.video : recordTips.voice} disabled={disabled}
    onPointerDown={down} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); void switchRecordMode(mode) } }}>
    {mode === 'video' ? <Video size={22} /> : <Mic size={22} />}
  </button>
}
