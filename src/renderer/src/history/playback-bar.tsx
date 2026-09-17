import { useSyncExternalStore } from 'react'
import { Pause, Play, X } from 'lucide-react'
import { duration as formatDuration } from '../app/format'
import { tr } from '../../../shared/i18n'

// One player for voice messages and round videos (Telegram's Media::Player, iOS MorseChatPlaybackCoordinator):
// starting one pauses the other, and the chat shows a bar with play/pause, the position, the speed and close.
export interface Playback { chatId: string; messageId: string; kind: 'voice' | 'round'; element: HTMLMediaElement }

const rates = [1, 1.5, 2]
let current: Playback | null = null
let rate = 1
let version = 0
const listeners = new Set<() => void>()
const notify = (): void => { version++; for (const listener of [...listeners]) listener() }
const events = ['play', 'pause', 'timeupdate', 'durationchange', 'ratechange'] as const
// A finished message closes the bar, as MorseChatPlaybackCoordinator stops at the end of the item.
const finished = (event: Event): void => { endPlayback(event.currentTarget as HTMLMediaElement) }

export function startPlayback(next: Playback): void {
  if (current && current.element !== next.element) {
    current.element.pause()
    for (const name of events) current.element.removeEventListener(name, notify)
    current.element.removeEventListener('ended', finished)
  }
  if (current?.element !== next.element) { for (const name of events) next.element.addEventListener(name, notify); next.element.addEventListener('ended', finished) }
  current = next
  next.element.defaultPlaybackRate = rate; next.element.playbackRate = rate
  notify()
}
export function endPlayback(element: HTMLMediaElement | null): void {
  if (!element || current?.element !== element) return
  element.pause()
  for (const name of events) element.removeEventListener(name, notify)
  element.removeEventListener('ended', finished)
  current = null
  notify()
}

function usePlaybackVersion(): number {
  return useSyncExternalStore(listener => { listeners.add(listener); return () => { listeners.delete(listener) } }, () => version)
}

export function PlaybackBar({ chatId }: { chatId: string }) {
  usePlaybackVersion()
  const playback = current
  if (!playback || playback.chatId !== chatId) return null
  const element = playback.element
  const length = Number.isFinite(element.duration) ? element.duration : 0
  const playingNow = !element.paused && !element.ended
  const focus = (): void => {
    document.querySelector(`[data-message-id="${CSS.escape(playback.messageId)}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }
  return <div className="playback-bar" role="region" aria-label={tr('재생 중')}>
    <button type="button" className="icon-button small" aria-label={playingNow ? tr('일시 정지') : tr('재생')} onClick={() => { if (playingNow) element.pause(); else void element.play().catch(() => {}) }}>
      {playingNow ? <Pause size={16} /> : <Play size={16} />}
    </button>
    <div className="playback-bar-body">
      <button type="button" className="playback-bar-title ellipsis" onClick={focus}>{playback.kind === 'voice' ? tr('음성 메시지') : tr('📹 영상 메시지')}</button>
      <div className="playback-bar-track">
        <input type="range" min={0} max={length || 1} step={0.1} value={Math.min(element.currentTime, length || 1)} aria-label={tr('재생 위치')}
          onChange={event => { element.currentTime = Number(event.target.value) }} />
        <small>{formatDuration(Math.floor(element.currentTime))} / {formatDuration(Math.round(length))}</small>
      </div>
    </div>
    <button type="button" className="playback-bar-rate" aria-label={tr('재생 속도')} onClick={() => {
      rate = rates[(rates.indexOf(rate) + 1) % rates.length]!
      element.defaultPlaybackRate = rate; element.playbackRate = rate
      notify()
    }}>{rate === 1.5 ? '1.5×' : rate === 2 ? '2×' : '1×'}</button>
    <button type="button" className="icon-button small" aria-label={tr('닫기')} onClick={() => endPlayback(element)}><X size={16} /></button>
  </div>
}
