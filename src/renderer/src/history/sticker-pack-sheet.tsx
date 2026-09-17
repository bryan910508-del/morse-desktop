import { useState } from 'react'
import { stickerPackItemURL, type StickerPack, type StickerPackItem } from '../../../shared/sticker-packs'
import { useDesktop } from '../app/store'
import { controller } from '../app/ui'
import { errorText } from '../app/format'
import { Spinner } from '../ui/controls'
import { Box } from '../ui/layers'
import { tr } from '../../../shared/i18n'

// One sticker of a set, drawn as the bubble draws it (iOS MorseStickerSetItemView).
export function StickerPackItemView({ pack, item }: { pack: StickerPack; item: StickerPackItem }) {
  const url = stickerPackItemURL(pack.id, item.id)
  return item.kind === 'mp4' ? <video src={url} autoPlay loop muted playsInline /> : <img src={url} alt={item.emoji || tr('스티커')} draggable={false} loading="lazy" />
}

// Telegram StickerPackScreen, as iOS MorseStickerPackSheet: the set's title and count, its stickers, and one
// action - «스티커 N개 추가» while the set is not installed, «스티커 N개 제거» while it is. A sticker tapped here
// goes to the chat the sheet was opened from.
function StickerPackSheet({ accountUid, close }: { accountUid: string; close(): void }) {
  const state = useDesktop(snapshot => snapshot?.stickerPack ?? null)
  const [sending, setSending] = useState(false)
  const pack = state?.pack ?? null
  const busy = Boolean(state?.busy) || sending
  const toggle = (): void => {
    if (!pack) return
    const action = state?.installed ? window.morse.uninstallStickerPack(accountUid, pack.id) : window.morse.installStickerPack(accountUid, pack.id)
    void action.then(() => controller.toast(state?.installed ? tr('스티커팩을 제거했습니다.') : tr('스티커팩을 추가했습니다.')))
      .catch(reason => controller.toast(errorText(reason, tr('처리하지 못했습니다. 다시 시도해 주세요.')), 'error'))
  }
  const send = (item: StickerPackItem): void => {
    if (!pack || !state?.chatId || busy) return
    setSending(true)
    void window.morse.sendPackSticker(accountUid, state.chatId, crypto.randomUUID(), pack.id, item.id, null)
      .then(() => close())
      .catch(reason => { setSending(false); controller.toast(errorText(reason, tr('처리하지 못했습니다. 다시 시도해 주세요.')), 'error') })
  }
  const subtitle = pack ? [tr('스티커 {0}개', [String(pack.items.length)]), pack.ownerUid !== accountUid && pack.ownerName ? tr('{0} 님이 만든 스티커팩', [pack.ownerName]) : ''].filter(Boolean).join(' · ') : ''
  const owner = Boolean(pack && pack.ownerUid === accountUid)
  return <Box title={pack ? pack.title : tr('스티커')} width={420} onClose={busy ? undefined : close} className="sticker-pack-box" buttons={pack && !owner ? <>
    <button className={`button ${state?.installed ? 'flat danger' : 'primary'} block`} disabled={busy} onClick={toggle}>
      {state?.busy && <Spinner size={14} />}
      {state?.installed ? tr('스티커 {0}개 제거', [String(pack.items.length)]) : tr('스티커 {0}개 추가', [String(pack.items.length)])}
    </button>
  </> : undefined}>
    {!state || state.status === 'loading' ? <div className="sticker-pack-loading"><Spinner size={20} /></div>
      : state.status !== 'ready' || !pack ? <p className="sticker-pack-empty">{state.message || tr('스티커팩을 찾을 수 없습니다.')}</p>
      : <>
        <p className="sticker-pack-sub">{subtitle}{owner ? ` · ${tr('내 스티커팩')}` : ''}</p>
        <div className="sticker-pack-grid" role="list">
          {pack.items.map(item => <button key={item.id} type="button" role="listitem" className={`sticker-pack-item${item.id === state.highlighted ? ' highlighted' : ''}`}
            disabled={busy || !state.chatId} title={state.chatId ? tr('이 대화에 보내기') : undefined} onClick={() => send(item)}>
            <StickerPackItemView pack={pack} item={item} />
          </button>)}
        </div>
        {state.message && <p className="box-error" role="alert">{state.message}</p>}
      </>}
  </Box>
}

// Opened from a sticker bubble: the main process hashes the sticker and looks its set up while the sheet shows.
export function showStickerPackSheet(accountUid: string, chatId: string, messageId: string, version: string): void {
  void window.morse.openStickerPack(accountUid, chatId, messageId, version).catch(() => {})
  controller.showLayer(close => <StickerPackSheet accountUid={accountUid} close={close} />, { onClose: () => { void window.morse.closeStickerPack(accountUid).catch(() => {}) } })
}
