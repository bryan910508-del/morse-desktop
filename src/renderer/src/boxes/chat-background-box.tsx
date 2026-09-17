import { useEffect, useRef, useState } from 'react'
import { Check, Image as ImageIcon, Sparkles } from 'lucide-react'
import { backgroundPresets, defaultChatBackground, sameBackground, type BackgroundPhotoScope, type ChatBackground } from '../../../shared/chat-background'
import { desktop, useDesktop } from '../app/store'
import { controller } from '../app/ui'
import { errorText } from '../app/format'
import { trackWrite } from '../app/drafts'
import { BackgroundSurface } from '../history/background'
import { Spinner } from '../ui/controls'
import { Box } from '../ui/layers'
import { prepareBackgroundPhoto } from '../photos/prepare-background-photo'
import { tr } from '../../../shared/i18n'

const deviceScope: BackgroundPhotoScope = { kind: 'device' }

// Morse chat background: presets, a device photo or the built-in pattern, with brightness.
// chatId null edits the device default used by chats without their own background.
function ChatBackgroundBox({ accountUid, chatId, close }: { accountUid: string; chatId: string | null; close(): void }) {
  const device = useDesktop(state => state?.preferences.chatBackground ?? defaultChatBackground)
  const scope: BackgroundPhotoScope = chatId ? { kind: 'chat', accountUid, chatId } : deviceScope
  const [record, setRecord] = useState<{ value: ChatBackground | null; version: string } | null>(chatId ? null : { value: device, version: '' })
  const [value, setValue] = useState<ChatBackground | null>(chatId ? null : device)
  const [busy, setBusy] = useState<'photo' | 'save' | null>(null), [error, setError] = useState('')
  const staged = useRef<string | null>(null)
  useEffect(() => {
    if (!chatId) return
    let alive = true
    void window.morse.chatBackground(accountUid, chatId).then(next => { if (alive) { setRecord(next); setValue(next.value) } })
      .catch(reason => { if (alive) setError(errorText(reason, tr('배경을 불러오지 못했습니다.'))) })
    return () => { alive = false }
  }, [accountUid, chatId])
  useEffect(() => () => { if (staged.current) void window.morse.releaseBackgroundPhoto(staged.current).catch(() => {}) }, [])
  const preview = value ?? device
  const photo = value?.preset === 'photo' ? value : null

  async function pick(builtin: boolean): Promise<void> {
    if (busy) return
    setBusy('photo'); setError('')
    let id: string | null = null, raw: Uint8Array | null = null, bytes: Uint8Array | null = null
    try {
      const picked = await (builtin ? window.morse.pickBuiltinBackgroundPhoto(scope) : window.morse.pickBackgroundPhoto(scope))
      if (!picked) return
      id = picked.id; raw = picked.bytes
      bytes = await prepareBackgroundPhoto(raw, new AbortController().signal)
      await window.morse.prepareBackgroundPhoto(id, bytes)
      const previous = staged.current
      staged.current = id
      setValue({ preset: 'photo', photoId: id, brightness: preview.brightness, positionX: 50, positionY: 50 })
      id = null
      if (previous) void window.morse.releaseBackgroundPhoto(previous).catch(() => {})
    } catch (reason) { setError(errorText(reason, tr('사진을 준비하지 못했습니다.'))) }
    finally {
      raw?.fill(0); bytes?.fill(0)
      if (id) void window.morse.releaseBackgroundPhoto(id).catch(() => {})
      setBusy(null)
    }
  }
  async function save(): Promise<void> {
    if (busy || !record) return
    setBusy('save'); setError('')
    try {
      if (chatId) await trackWrite(window.morse.saveChatBackground(accountUid, chatId, { operationId: crypto.randomUUID(), expectedVersion: record.version, value }))
      else desktop.replace(await trackWrite(window.morse.updatePreferences({ chatBackground: value ?? defaultChatBackground })))
      close()
      controller.toast(tr('배경을 저장했습니다.'))
    } catch (reason) { setError(errorText(reason, tr('배경을 저장하지 못했습니다.'))); setBusy(null) }
  }
  return <Box title={chatId ? tr('대화 배경') : tr('기본 채팅 배경')} width={440} buttons={<>
    <button className="button flat" disabled={busy === 'save'} onClick={close}>{tr('취소')}</button>
    <button className="button flat" disabled={Boolean(busy) || !record || sameBackground(value, record.value)} onClick={() => { void save() }}>{busy === 'save' && <Spinner size={14} />}{tr('저장')}</button>
  </>}>
    <div className="background-preview">
      <BackgroundSurface value={preview} scope={value === null ? deviceScope : scope} />
      <span className="background-preview-bubble in">{tr('안녕하세요!')}</span>
      <span className="background-preview-bubble out">{tr('배경을 미리 보고 있어요')}</span>
    </div>
    <p className="box-note">{chatId ? tr('이 기기에서 이 대화에만 적용됩니다. 상대방 화면은 바뀌지 않습니다.') : tr('따로 배경을 정하지 않은 모든 대화에 적용됩니다.')}</p>
    {chatId && <button type="button" className={`background-inherit${value === null ? ' active' : ''}`} aria-pressed={value === null} disabled={Boolean(busy)} onClick={() => setValue(null)}>
      {value === null && <Check size={16} />}{tr('기기 기본 배경 사용')}</button>}
    <div className="background-photo-actions">
      <button className="button secondary" disabled={Boolean(busy)} onClick={() => { void pick(false) }}>{busy === 'photo' ? <Spinner size={14} /> : <ImageIcon size={16} />}{tr('내 사진')}</button>
      <button className="button secondary" disabled={Boolean(busy)} onClick={() => { void pick(true) }}><Sparkles size={16} />{tr('Morse 패턴')}</button>
    </div>
    {photo && (['positionX', 'positionY'] as const).map(axis => <label key={axis} className="background-slider">
      <span>{axis === 'positionX' ? tr('가로 위치') : tr('세로 위치')}</span>
      <input type="range" min={0} max={100} step={1} value={photo[axis]} onChange={event => setValue({ ...photo, [axis]: Number(event.target.value) })} />
    </label>)}
    {([tr('기본'), tr('단색'), tr('그라데이션')] as const).map(group => <div key={group} className="background-group">
      <div className="section-label">{group}</div>
      <div className="background-grid">{backgroundPresets.filter(preset => preset.group === group).map(preset => <button key={preset.id} type="button" className={`background-swatch${value?.preset === preset.id ? ' active' : ''}`}
        aria-pressed={value?.preset === preset.id} disabled={Boolean(busy)} onClick={() => setValue({ preset: preset.id, brightness: preview.brightness })}>
        <span className="background-swatch-paint"><BackgroundSurface value={{ preset: preset.id, brightness: 0 }} scope={deviceScope} />{value?.preset === preset.id && <Check size={16} />}</span>
        <span className="ellipsis">{preset.label}</span>
      </button>)}</div>
    </div>)}
    <label className="background-slider">
      <span>{tr('밝기 {0}{1}', [preview.brightness > 0 ? '+' : '', preview.brightness])}</span>
      <input type="range" min={-100} max={100} step={5} value={preview.brightness} disabled={value === null || Boolean(busy)} onChange={event => { if (value) setValue({ ...value, brightness: Number(event.target.value) }) }} />
    </label>
    {error && <p className="box-error" role="alert">{error}</p>}
  </Box>
}

export function showChatBackgroundBox(accountUid: string, chatId: string | null): void {
  controller.showLayer(close => <ChatBackgroundBox accountUid={accountUid} chatId={chatId} close={close} />)
}
