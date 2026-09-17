import type { VideoFacts } from '../../../shared/uploads'
import { maxThumbDataChars } from '../../../shared/media-metadata'

// A picked video, read before sending: its display size, its length, and a thumbnail. The frame is
// taken where iOS takes it (MorseVideoMetadata.generateThumbnailJPEG: 10% of the length, then 25%,
// 0.5s, 0.08s, the start); the thumbnail is the one Telegram Desktop sends with a video
// (localimageloader.cpp: kThumbnailSize 320 on the longer side, kThumbnailQuality 87), which it then
// shows sharp rather than blurred. A thumbnail the server would refuse (strings up to 100,000
// characters) is made again at a lower quality. The staged bytes come from this app's own origin,
// so the frame can be drawn. A video Chromium cannot open answers nothing and is sent as before.
const candidates = (duration: number): number[] => [duration * 0.1, duration * 0.25, 0.5, 0.08, 0]
const encodings: { side: number; quality: number }[] = [{ side: 320, quality: 0.87 }, { side: 320, quality: 0.6 }, { side: 240, quality: 0.5 }]

export function readVideoFacts(url: string, timeout = 10000): Promise<VideoFacts | null> {
  return new Promise(resolve => {
    const video = document.createElement('video')
    let settled = false, width = 0, height = 0, duration = 0, times: number[] = []
    const finish = (facts: VideoFacts | null): void => {
      if (settled) return
      settled = true; clearTimeout(timer)
      video.onloadedmetadata = video.onseeked = video.onerror = null
      video.removeAttribute('src'); video.load()
      resolve(facts)
    }
    const timer = setTimeout(() => finish(width && height && duration ? { duration, width, height, thumb: '' } : null), timeout)
    const next = (): void => {
      const at = times.shift()
      if (at === undefined) { finish({ duration, width, height, thumb: '' }); return }
      video.currentTime = Math.min(Math.max(0, at), Math.max(0, duration - 0.05))
    }
    const draw = (): void => {
      try {
        const prefix = 'data:image/jpeg;base64,'
        for (const { side, quality } of encodings) {
          const scale = Math.min(1, side / Math.max(width, height))
          const canvas = document.createElement('canvas')
          canvas.width = Math.max(1, Math.round(width * scale)); canvas.height = Math.max(1, Math.round(height * scale))
          const context = canvas.getContext('2d')
          if (!context) break
          context.drawImage(video, 0, 0, canvas.width, canvas.height)
          const data = canvas.toDataURL('image/jpeg', quality)
          if (!data.startsWith(prefix) || data.length === prefix.length) break
          if (data.length - prefix.length <= maxThumbDataChars) { finish({ duration, width, height, thumb: data.slice(prefix.length) }); return }
        }
        next()
      } catch { next() }
    }
    video.muted = true; video.preload = 'auto'; video.playsInline = true
    video.onloadedmetadata = () => {
      duration = video.duration; width = video.videoWidth; height = video.videoHeight
      if (!Number.isFinite(duration) || duration <= 0 || !width || !height) { finish(null); return }
      times = candidates(duration); next()
    }
    video.onseeked = () => {
      if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) draw()
      else video.addEventListener('loadeddata', draw, { once: true })
    }
    video.onerror = () => finish(null)
    video.src = url
  })
}
