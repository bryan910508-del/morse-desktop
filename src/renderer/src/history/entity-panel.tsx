import { useEffect, useRef, useState } from 'react'
import { Plus, Star, Trash2 } from 'lucide-react'
import emojis from './emoji-data.json'
import type { StickerItem } from '../../../shared/stickers'
import type { StickerPack } from '../../../shared/sticker-packs'
import { StickerPackItemView } from './sticker-pack-sheet'
import { useDesktop } from '../app/store'
import { controller } from '../app/ui'
import { errorText } from '../app/format'
import { popupMenu, pointFor } from '../ui/popup-menu'
import { showStickerEditor } from './sticker-editor'
import { tr } from '../../../shared/i18n'

// Telegram's TabbedSelector and iOS MorseEntityKeyboard: emoji to insert, this device's stickers (★) and the
// account's installed sticker sets to send, chosen from a pack strip, with «스티커 만들기» for a new one.
export function EntityPanel({ accountUid, onEmoji, onSticker, onPackSticker, onClose }: { accountUid: string; onEmoji(emoji: string): void; onSticker(sticker: StickerItem): void; onPackSticker(setId: string, itemId: string): void; onClose(): void }) {
  const [tab, setTab] = useState<'emoji' | 'stickers'>('emoji')
  const [packId, setPackId] = useState<string | null>(null)
  const stickers = useDesktop(snapshot => snapshot?.stickers ?? null)
  const packs = useDesktop(snapshot => snapshot?.stickerPacks ?? null)
  const pack: StickerPack | null = packId ? packs?.find(known => known.id === packId) ?? null : null
  const root = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const away = (event: PointerEvent): void => {
      const target = event.target as HTMLElement
      if (root.current?.contains(target) || target.closest('[data-entity-toggle]') || target.closest('.layer, .popup-menu')) return
      onClose()
    }
    const escape = (event: KeyboardEvent): void => { if (event.key === 'Escape') onClose() }
    window.addEventListener('pointerdown', away); window.addEventListener('keydown', escape)
    return () => { window.removeEventListener('pointerdown', away); window.removeEventListener('keydown', escape) }
  }, [onClose])
  const menu = (item: StickerItem, point: { x: number; y: number }): void => popupMenu.open(point, [
    { label: tr('스티커 삭제'), icon: <Trash2 size={18} />, danger: true, onSelect: () => { void window.morse.removeSticker(accountUid, item.id).catch(reason => controller.toast(errorText(reason, tr('처리하지 못했습니다. 다시 시도해 주세요.')), 'error')) } }
  ])
  return <div ref={root} className="entity-panel" role="dialog" aria-label={tr('이모지와 스티커')}>
    <div className="entity-tabs" role="tablist">
      <button type="button" role="tab" aria-selected={tab === 'emoji'} className={tab === 'emoji' ? 'active' : undefined} onClick={() => setTab('emoji')}>{tr('이모지')}</button>
      <button type="button" role="tab" aria-selected={tab === 'stickers'} className={tab === 'stickers' ? 'active' : undefined} onClick={() => setTab('stickers')}>{tr('스티커')}</button>
    </div>
    {tab === 'emoji' ? <div className="entity-emoji">{(emojis as string[]).map(emoji => <button key={emoji} type="button" onClick={() => onEmoji(emoji)}>{emoji}</button>)}</div>
      : <>
        <div className="entity-pack-strip" role="tablist" aria-label={tr('스티커팩')}>
          <button type="button" role="tab" aria-selected={packId === null} className={packId === null ? 'active' : undefined} title={tr('즐겨찾기')} onClick={() => setPackId(null)}><Star size={18} /></button>
          {(packs ?? []).map(known => <button key={known.id} type="button" role="tab" aria-selected={packId === known.id} className={packId === known.id ? 'active' : undefined} title={known.title} onClick={() => setPackId(known.id)}>
            {known.items[0] ? <StickerPackItemView pack={known} item={known.items[0]} /> : <span>{known.title.slice(0, 1)}</span>}
          </button>)}
        </div>
        {pack ? <div className="entity-stickers">
          {pack.items.map(item => <button key={item.id} type="button" className="entity-sticker" title={item.emoji || undefined} onClick={() => onPackSticker(pack.id, item.id)}>
            <StickerPackItemView pack={pack} item={item} />
          </button>)}
          {!pack.items.length && <p className="entity-empty">{tr('이 스티커팩에는 스티커가 없어요.')}</p>}
        </div> : <div className="entity-stickers">
          <button type="button" className="entity-create" onClick={() => showStickerEditor(accountUid, sticker => { if (sticker) onSticker(sticker) })}><Plus size={22} /><span>{tr('스티커 만들기')}</span></button>
          {stickers === null ? null : stickers.map(item => <button key={item.id} type="button" className="entity-sticker" onClick={() => onSticker(item)}
            onContextMenu={event => { event.preventDefault(); menu(item, pointFor(event, event.currentTarget)) }}>
            {item.kind === 'mp4' ? <video src={item.url} autoPlay loop muted playsInline /> : <img src={item.url} alt={tr('스티커')} draggable={false} loading="lazy" />}
          </button>)}
          {stickers !== null && !stickers.length && <p className="entity-empty">{packs?.length ? tr('채팅에서 스티커를 눌러 스티커팩을 추가해 보세요.') : tr('사진으로 첫 스티커를 만들어 보세요.')}</p>}
        </div>}
      </>}
  </div>
}
