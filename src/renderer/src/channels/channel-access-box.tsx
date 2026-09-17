import { useEffect, useState } from 'react'
import { channelCategories, channelChatModes, channelJoinPolicies } from '../../../shared/channel-access'
import type { ChannelAccessEditSnapshot, ChannelAccessSettings, ChannelAccessState, PendingChannelAccess } from '../../../shared/channel-access-edit'
import type { ChannelSummary } from '../../../shared/channels'
import { desktop, useDesktop } from '../app/store'
import { controller } from '../app/ui'
import { errorText } from '../app/format'
import { trackWrite } from '../app/drafts'
import { waitFor } from '../app/contacts'
import { Spinner, Switch } from '../ui/controls'
import { Box } from '../ui/layers'
import { tr } from '../../../shared/i18n'

const types: Record<ChannelAccessSettings['type'], string> = { public: tr('공개', [], 'type'), private: tr('비공개', [], 'type'), invite: tr('초대', [], 'type') }
const submittedStates: readonly ChannelAccessState[] = ['saving', 'joining', 'syncing']
const rejectedText: Partial<Record<ChannelAccessState, string>> = {
  'save-rejected': tr('설정을 저장하지 못했습니다.'),
  'join-rejected': tr('토론방을 준비하지 못했습니다. 앞서 끝난 단계는 유지됩니다.'),
  'sync-rejected': tr('토론방 참여자를 맞추지 못했습니다. 앞서 끝난 단계는 유지됩니다.')
}

function settingsText(value: ChannelAccessSettings): string {
  return [types[value.type], channelJoinPolicies[value.joinPolicy], channelChatModes[value.chatMode], tr('이전 기록 {0}', [value.historyVisible ? tr('공개', [], 'state') : tr('숨김', [], 'state')]), value.category ? channelCategories[value.category] : ''].filter(Boolean).join(' · ')
}

// The access record changes after the IPC call resolves; waits briefly for the
// published snapshot and falls back to the latest one.
async function settled(predicate: (value: ChannelAccessEditSnapshot) => boolean): Promise<ChannelAccessEditSnapshot | null> {
  try { return await waitFor(() => { const value = desktop.value?.channelAccess; return value && !value.busy && predicate(value) ? value : null }, 4000, '') }
  catch { return desktop.value?.channelAccess ?? null }
}

function Choices<T extends string>({ name, options, value, disabled, onChange }: { name: string; options: Record<T, string>; value: T; disabled?(key: T): boolean; onChange(value: T): void }) {
  return <>{(Object.keys(options) as T[]).map(key => <label key={key} className="settings-radio">
    <input type="radio" name={name} checked={value === key} disabled={disabled?.(key)} onChange={() => onChange(key)} /><span>{options[key]}</span>
  </label>)}</>
}

// EditPeerTypeBox / EditPeerPermissionsBox: one save runs the stored access
// record through settings, discussion and participant steps.
function ChannelAccessBox({ accountUid, channel, close }: { accountUid: string; channel: ChannelSummary; close(): void }) {
  const state = useDesktop(value => value?.channelAccess ?? null)
  const live = useDesktop(value => value?.channels?.items.find(item => item.id === channel.id) ?? null)
  const base = live?.status === 'ready' && live.owned && live.version && live.editableAccess ? live : null
  const current = base?.editableAccess ?? null
  const [next, setNext] = useState<ChannelAccessSettings>(() => ({ ...channel.editableAccess! }))
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  const pending = state?.status === 'ready' ? state.pending : null
  const loading = !state || state.status === 'loading' || (state.busy && !busy)
  const changed = Boolean(current && JSON.stringify(current) !== JSON.stringify(next))

  useEffect(() => {
    const value = desktop.value?.channelAccess
    if (value?.status !== 'ready' && !value?.busy) void window.morse.refreshChannelAccess(accountUid).catch(reason => setError(errorText(reason, tr('설정 기록을 확인하지 못했습니다.'))))
  }, [accountUid])
  // A completed record carries nothing left to do; it is closed quietly.
  useEffect(() => {
    if (busy || state?.status !== 'ready' || state.busy || pending?.state !== 'completed') return
    void window.morse.channelAccessAction(accountUid, { id: pending.id, state: pending.state, action: 'dismiss' }).catch(() => {})
  }, [busy, state?.status, state?.busy, pending?.id, pending?.state])

  async function proceed(record: PendingChannelAccess): Promise<void> {
    try { await trackWrite(window.morse.channelAccessAction(accountUid, { id: record.id, state: record.state, action: 'continue' })) }
    catch { await window.morse.refreshChannelAccess(accountUid).catch(() => {}) }
    const after = await settled(value => value.status !== 'loading' && (value.pending?.id !== record.id || value.pending.state !== record.state))
    const result = after?.pending?.id === record.id ? after.pending : null
    if (result?.state === 'completed') {
      await window.morse.channelAccessAction(accountUid, { id: result.id, state: result.state, action: 'dismiss' }).catch(() => {})
      controller.toast(record.mode === 'sync' ? tr('토론방을 다시 맞췄습니다.') : tr('채널 설정을 저장했습니다.'))
      close(); return
    }
    if (result && submittedStates.includes(result.state)) { controller.toast(tr('설정 변경 결과를 확인하고 있습니다. 이미 반영되었을 수 있어 다시 보내지 않습니다.')); close(); return }
    setError(result ? rejectedText[result.state] ?? after?.message ?? '' : after?.message || tr('설정 기록을 확인하지 못했습니다.'))
  }
  async function save(mode: 'edit' | 'sync'): Promise<void> {
    if (!base || !current || busy || pending || (mode === 'edit' && !changed) || (mode === 'sync' && changed)) return
    setBusy(true); setError('')
    try {
      const id = crypto.randomUUID()
      await trackWrite(window.morse.prepareChannelAccess(accountUid, { id, channelId: base.id, version: base.version!, title: base.name, settings: { ...current }, mode, next: mode === 'sync' ? { ...current } : next }))
      const prepared = await settled(value => value.pending?.id === id)
      if (prepared?.pending?.id !== id) throw new Error(tr('설정 변경을 준비하지 못했습니다.'))
      await proceed(prepared.pending)
    } catch (reason) { setError(errorText(reason, tr('설정을 저장하지 못했습니다.'))) }
    finally { setBusy(false) }
  }
  async function act(action: 'continue' | 'check' | 'dismiss'): Promise<void> {
    if (!pending || busy) return
    setBusy(true); setError('')
    try {
      if (action === 'continue') await proceed(pending)
      else await trackWrite(window.morse.channelAccessAction(accountUid, { id: pending.id, state: pending.state, action }))
    } catch (reason) { setError(errorText(reason, tr('설정 기록을 처리하지 못했습니다.'))) }
    finally { setBusy(false) }
  }

  const locked = busy || loading || Boolean(pending) || !base
  const record = pending && pending.state !== 'completed' ? pending : null
  return <Box title={tr('접근 설정')} width={420} className="channel-access-box" buttons={record ? <>
    <button className="button flat" disabled={busy} onClick={() => { void act('dismiss') }}>{tr('기록 닫기')}</button>
    {submittedStates.includes(record.state) ? <button className="button flat" disabled={busy} onClick={() => { void act('check') }}>{tr('현재 설정 확인')}</button>
      : <button className="button flat" disabled={busy || !state?.canContinue} onClick={() => { void act('continue') }}>{busy ? <Spinner size={14} /> : tr('이어서 진행')}</button>}
  </> : <>
    <button className="button flat" disabled={locked || changed} onClick={() => { void save('sync') }}>{tr('토론방 다시 맞추기')}</button>
    <span className="box-buttons-gap" />
    <button className="button flat" disabled={busy} onClick={close}>{tr('취소')}</button>
    <button className="button flat" data-autofocus disabled={locked || !changed} onClick={() => { void save('edit') }}>{busy ? <Spinner size={14} /> : tr('저장')}</button>
  </>}>
    {loading && !record ? <div className="empty-state"><Spinner size={22} /></div> : record ? <div className="channel-access-record">
      <p><strong>{record.channelId === channel.id ? tr('이전에 저장하던 설정이 끝나지 않았습니다.') : tr('‘{0}’ 채널의 설정 변경 기록이 남아 있습니다.', [record.title])}</strong></p>
      <p className="box-note">{settingsText(record.next)}</p>
      <p className="box-note">{submittedStates.includes(record.state) ? tr('이 단계의 응답을 확인하지 못했습니다. 이미 반영되었을 수 있어 다시 보내지 않습니다.')
        : rejectedText[record.state] ?? tr('설정 저장 → 토론방 준비 → 참여자 동기화 순서로 진행합니다.')}</p>
      {!submittedStates.includes(record.state) && !state?.canContinue && <p className="box-note">{tr('채널 정보가 바뀌어 이어서 진행할 수 없습니다. 기록을 닫고 다시 설정해 주세요.')}</p>}
      {state?.message && <p className="box-note">{state.message}</p>}
    </div> : !base ? <div className="empty-state">{tr('채널 정보를 확인할 수 없습니다.')}</div> : <>
      <div className="section-label">{tr('채널 유형')}</div>
      <Choices name="access-type" options={types} value={next.type} disabled={key => locked || (key === 'public' && current?.type !== 'public')}
        onChange={type => setNext(value => ({ ...value, type, category: type === 'public' ? value.category : null }))} />
      {current?.type !== 'public' && <p className="box-note channel-access-note">{tr('새로 공개 채널로 바꾸는 기능은 현재 잠겨 있습니다.')}</p>}
      <div className="section-label">{tr('가입 방식')}</div>
      <Choices name="access-join" options={channelJoinPolicies} value={next.joinPolicy} disabled={() => locked} onChange={joinPolicy => setNext(value => ({ ...value, joinPolicy }))} />
      <div className="section-label">{tr('대화 방식')}</div>
      <Choices name="access-mode" options={channelChatModes} value={next.chatMode} disabled={() => locked} onChange={chatMode => setNext(value => ({ ...value, chatMode }))} />
      <div className="section-label">{tr('토론방')}</div>
      <div className="settings-radio channel-access-switch"><span>{tr('새 참여자에게 이전 토론 기록 보이기')}</span>
        <Switch checked={next.historyVisible} disabled={locked} label={tr('새 참여자에게 이전 토론 기록 보이기')} onChange={historyVisible => setNext(value => ({ ...value, historyVisible }))} />
      </div>
      {next.type === 'public' && <>
        <div className="section-label">{tr('카테고리')}</div>
        <div className="channel-access-select"><select value={next.category ?? ''} disabled={locked} aria-label={tr('카테고리')} onChange={event => setNext(value => ({ ...value, category: event.target.value ? event.target.value as ChannelAccessSettings['category'] : null }))}>
          <option value="">{tr('설정 없음')}</option>
          {(Object.keys(channelCategories) as (keyof typeof channelCategories)[]).map(key => <option key={key} value={key}>{channelCategories[key]}</option>)}
        </select></div>
      </>}
      <p className="box-note channel-access-note">{tr('저장하면 설정 저장, 토론방 준비, 참여자 동기화를 차례로 진행합니다. 관리자 자격만 있는 참여자는 토론방에서 빠질 수 있습니다.')}</p>
    </>}
    {error && <p className="box-error channel-access-note" role="alert">{error}</p>}
  </Box>
}

export function showChannelAccessBox(accountUid: string, channel: ChannelSummary): void {
  if (!channel.editableAccess) return
  controller.showLayer(close => <ChannelAccessBox accountUid={accountUid} channel={channel} close={close} />)
}
