import { stickerMoves } from '../../../shared/stickers'

// B472b: every MP4 sticker — a bubble, the sticker panel, a pack's sheet — is drawn by this one view. It starts paused
// on its first frame (as Telegram Desktop draws a sticker's still picture before its player has a frame,
// history_view_sticker.cpp:238-256) and repeats only once its length is known to move (stickerMoves): one of length 0
// stays that frame, still, instead of restarting without end.
export function StickerVideo({ src }: { src: string }) {
  return <video src={src} muted playsInline preload="auto"
    onDurationChange={event => {
      const video = event.currentTarget
      if (stickerMoves(video.duration)) { video.loop = true; void video.play().catch(() => {}) }
      else { video.loop = false; video.pause() }
    }} />
}
