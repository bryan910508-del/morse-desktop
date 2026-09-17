import { useEffect, useState, type CSSProperties } from 'react'
import type { BackgroundPhotoScope, ChatBackground } from '../../../shared/chat-background'
import { useDesktopEvent } from '../app/store'

// Morse chat backgrounds (shared/chat-background presets) painted behind history.
const paints: Record<Exclude<ChatBackground['preset'], 'photo'>, { color: string; image?: string }> = {
  theme: { color: 'var(--window-bg)' },
  morse: { color: 'var(--window-bg)', image: 'radial-gradient(ellipse 400px 400px at 50% 10%, #007aff14, transparent), radial-gradient(ellipse 350px 350px at 50% 95%, #8b5cf60d, transparent)' },
  'deep-blue': { color: '#0A0F1E' }, cipher: { color: '#0D1117' }, midnight: { color: '#1A1A2E' },
  'dark-teal': { color: '#0D2137' }, 'purple-night': { color: '#1A0A2E' }, slate: { color: '#1C1C2E' },
  'deep-dive': { color: 'var(--window-bg)', image: 'radial-gradient(ellipse 400px 400px at 50% 15%, #007aff26, transparent), linear-gradient(#0F172A, #1E3A8A99, #0A0F1E)' },
  'night-sky': { color: 'var(--window-bg)', image: 'radial-gradient(ellipse 400px 400px at 50% 15%, #8b5cf61f, transparent), linear-gradient(#0A0612, #2E106580, #0F0820)' },
  ocean: { color: 'var(--window-bg)', image: 'radial-gradient(ellipse 400px 400px at 50% 15%, #06b6d41f, transparent), linear-gradient(#041E2E, #164E6399, #021118)' },
  sunset: { color: 'var(--window-bg)', image: 'radial-gradient(ellipse 400px 400px at 50% 15%, #ec489914, transparent), linear-gradient(#1A0A12, #88133773, #0F0508)' },
  mocha: { color: 'var(--window-bg)', image: 'radial-gradient(ellipse 400px 400px at 50% 15%, #f59e0b14, transparent), linear-gradient(#1C1410, #78350F66, #0F0805)' },
  emerald: { color: 'var(--window-bg)', image: 'radial-gradient(ellipse 400px 400px at 50% 15%, #10b9811a, transparent), linear-gradient(#0A1A14, #065F4680, #020F0A)' }
}
export const darkBackgrounds = new Set(['deep-blue', 'cipher', 'midnight', 'dark-teal', 'purple-night', 'slate', 'deep-dive', 'night-sky', 'ocean', 'sunset', 'mocha', 'emerald', 'photo'])

function PhotoLayer({ value, scope }: { value: Extract<ChatBackground, { preset: 'photo' }>; scope: BackgroundPhotoScope }) {
  const [url, setURL] = useState(''), [failed, setFailed] = useState(false), [available, setAvailable] = useState(true), [attempt, setAttempt] = useState(0)
  const scopeKey = JSON.stringify(scope)
  useDesktopEvent(event => { if (event.type === 'background-photo-availability') { setAvailable(event.available); setAttempt(current => current + 1) } })
  useEffect(() => {
    let alive = true, current = ''
    const release = (next: string): void => { const token = next.split('/').pop(); if (token) void window.morse.releaseBackgroundPhotoURL(token).catch(() => {}) }
    setURL(''); setFailed(false)
    if (available) void window.morse.backgroundPhotoURL(JSON.parse(scopeKey) as BackgroundPhotoScope, value.photoId).then(next => {
      if (alive) { current = next; setURL(next) } else release(next)
    }).catch(() => { if (alive) setFailed(true) })
    return () => { alive = false; if (current) release(current) }
  }, [scopeKey, value.photoId, available, attempt])
  return url && !failed ? <img className="history-background-photo" src={url} alt="" aria-hidden="true" draggable={false} style={{ objectPosition: `${value.positionX}% ${value.positionY}%` }} onError={() => setFailed(true)} /> : null
}

export function BackgroundSurface({ value, scope }: { value: ChatBackground; scope: BackgroundPhotoScope }) {
  const paint = value.preset === 'photo' ? { color: 'var(--window-bg)' } : paints[value.preset]
  const shade = value.brightness < 0 ? `rgb(0 0 0 / ${-value.brightness * .006})` : `rgb(255 255 255 / ${value.brightness * .004})`
  const style: CSSProperties = { backgroundColor: paint.color, backgroundImage: paint.image ?? 'none' }
  return <div className="history-background" style={style} aria-hidden="true">
    {value.preset === 'photo' && <PhotoLayer value={value} scope={scope} />}
    {value.brightness !== 0 && <div className="history-background-shade" style={{ background: shade }} />}
  </div>
}
