import { useEffect, useRef, useState, type MouseEvent } from 'react'
import { Plus, Star } from 'lucide-react'
import emojis from './emoji-data.json'
import type { StickerItem } from '../../../shared/stickers'
import type { StickerPack } from '../../../shared/sticker-packs'
import { StickerPackItemView } from './sticker-pack-sheet'
import { useDesktop } from '../app/store'
import { popupMenu, pointFor, type MenuEntry } from '../ui/popup-menu'
import { showStickerEditor } from './sticker-editor'
import { favouriteStickerMenu, packStickerMenu, stickerSetMenu } from './sticker-actions'
import { readRecentEmoji, recentEmojiShown, recordRecentEmoji } from './recent-emoji'
import { tr } from '../../../shared/i18n'

// Telegram's TabbedSelector and iOS MorseEntityKeyboard: emoji to insert, this device's stickers (★) and the
// account's installed sticker sets to send, chosen from a pack strip, with «스티커 만들기» for a new one.
export function EntityPanel({ accountUid, onEmoji, onSticker, onPackSticker, onClose }: { accountUid: string; onEmoji(emoji: string): void; onSticker(sticker: StickerItem): void; onPackSticker(setId: string, itemId: string): void; onClose(): void }) {
  const [tab, setTab] = useState<'emoji' | 'stickers'>('emoji')
  // B57: read when the panel opens, so the row does not move under the pointer while emoji are being picked.
  const [recent] = useState(() => recentEmojiShown(readRecentEmoji()))
  const pick = (emoji: string): void => { recordRecentEmoji(emoji); onEmoji(emoji) }
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
  // B208: every sticker of the panel has its menu, as tdesktop's StickersListWidget::fillContextMenu gives every sticker
  // of every section one (stickers_list_widget.cpp:2618-2705), and each set on the strip has the set's
  // (FillStickerSetContextMenu, :2723). Until 0.241.16 only this device's favourites had one, so a right click on a
  // set's sticker did nothing.
  const menuAt = (event: MouseEvent<HTMLElement>, entries: MenuEntry[]): void => { event.preventDefault(); popupMenu.open(pointFor(event, event.currentTarget), entries) }
  return <div ref={root} className="entity-panel" role="dialog" aria-label={tr('이모지와 스티커')}>
    <div className="entity-tabs" role="tablist">
      <button type="button" role="tab" aria-selected={tab === 'emoji'} className={tab === 'emoji' ? 'active' : undefined} onClick={() => setTab('emoji')}>{tr('이모지')}</button>
      <button type="button" role="tab" aria-selected={tab === 'stickers'} className={tab === 'stickers' ? 'active' : undefined} onClick={() => setTab('stickers')}>{tr('스티커')}</button>
    </div>
    {tab === 'emoji' ? <div className="entity-emoji">
      <div className="entity-emoji-label">{tr('최근 사용')}</div>
      {recent.map(emoji => <button key={`recent-${emoji}`} type="button" onClick={() => pick(emoji)}>{emoji}</button>)}
      <div className="entity-emoji-label">{tr('이모지')}</div>
      {(emojis as string[]).map(emoji => <button key={emoji} type="button" onClick={() => pick(emoji)}>{emoji}</button>)}
    </div>
      : <>
        <div className="entity-pack-strip" role="tablist" aria-label={tr('스티커팩')}>
          <button type="button" role="tab" aria-selected={packId === null} className={packId === null ? 'active' : undefined} title={tr('즐겨찾기')} onClick={() => setPackId(null)}><Star size={18} /></button>
          {(packs ?? []).map(known => <button key={known.id} type="button" role="tab" aria-selected={packId === known.id} className={packId === known.id ? 'active' : undefined} title={known.title} onClick={() => setPackId(known.id)}
            onContextMenu={event => menuAt(event, stickerSetMenu(accountUid, known))}>
            {known.items[0] ? <StickerPackItemView pack={known} item={known.items[0]} /> : <span>{known.title.slice(0, 1)}</span>}
          </button>)}
        </div>
        {pack ? <div className="entity-stickers">
          {pack.items.map(item => <button key={item.id} type="button" className="entity-sticker" title={item.emoji || undefined} onClick={() => onPackSticker(pack.id, item.id)}
            onContextMenu={event => menuAt(event, packStickerMenu(accountUid, pack, item, () => onPackSticker(pack.id, item.id), true))}>
            <StickerPackItemView pack={pack} item={item} />
          </button>)}
          {!pack.items.length && <p className="entity-empty">{tr('이 스티커팩에는 스티커가 없어요.')}</p>}
        </div> : <div className="entity-stickers">
          <button type="button" className="entity-create" onClick={() => showStickerEditor(accountUid, made => { if (made?.kind === 'favourite') onSticker(made.sticker); else if (made) onPackSticker(made.setId, made.itemId) })}><Plus size={22} /><span>{tr('스티커 만들기')}</span></button>
          {stickers === null ? null : stickers.map(item => <button key={item.id} type="button" className="entity-sticker" onClick={() => onSticker(item)}
            onContextMenu={event => menuAt(event, favouriteStickerMenu(accountUid, item, () => onSticker(item)))}>
            {item.kind === 'mp4' ? <video src={item.url} autoPlay loop muted playsInline /> : <img src={item.url} alt={tr('스티커')} draggable={false} loading="lazy" />}
          </button>)}
          {stickers !== null && !stickers.length && <p className="entity-empty">{packs?.length ? tr('채팅에서 스티커를 눌러 스티커팩을 추가해 보세요.') : tr('사진으로 첫 스티커를 만들어 보세요.')}</p>}
        </div>}
      </>}
  </div>
}
