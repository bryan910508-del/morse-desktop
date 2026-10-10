import { useEffect, useState } from 'react'
import type { LocalOutgoing } from '../../../shared/delivery'
import type { StickerDraw } from '../../../shared/stickers'
import { tr } from '../../../shared/i18n'

// B264: a sticker on its way is drawn as the sticker — no bubble, the same size as the server's copy it becomes — with
// only the clock or the failure mark, as tdesktop draws the local message with its document (api_sending.cpp:182, :284).
// A forward or a story reply keeps its labelled bubble.
export function localSticker(item: Pick<LocalOutgoing, 'sticker' | 'forwarded' | 'storyReply'>): StickerDraw | null {
  return item.sticker && !item.forwarded && !item.storyReply ? item.sticker : null
}
// The picture a sticker on its way is drawn from; one that cannot be read shows the word, never a file name.
export function LocalStickerView({ draw }: { draw: StickerDraw }) {
  const [failed, setFailed] = useState(false)
  useEffect(() => setFailed(false), [draw.url])
  return <div className="sticker-view">
    {failed ? <span className="sticker-missing">{tr('스티커')}</span>
      : draw.video ? <video src={draw.url} autoPlay loop muted playsInline onError={() => setFailed(true)} />
        : <img src={draw.url} alt={tr('스티커')} draggable={false} onError={() => setFailed(true)} />}
  </div>
}
