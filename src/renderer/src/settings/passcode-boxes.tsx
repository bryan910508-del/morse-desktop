import { useEffect, useState } from 'react'
import { KeyRound, Timer, Trash2 } from 'lucide-react'
import { autoLockChoices, autoLockLabel } from '../../../shared/app-lock'
import { useDesktop } from '../app/store'
import { controller } from '../app/ui'
import { errorText } from '../app/format'
import { ListButton, Switch, TextField } from '../ui/controls'
import { Box, confirmBox } from '../ui/layers'
import { tr } from '../../../shared/i18n'

const floodText = tr('시도 횟수가 너무 많습니다. 잠시 후 다시 시도해 주세요.')
const aboutText = tr('로컬 암호를 설정하면 대화 목록 위에 자물쇠 아이콘이 나타납니다. 아이콘을 누르면 Morse Desktop이 잠깁니다.')

// Settings::LocalPasscode create / check / change steps.
function PasscodeFormBox({ mode, close, onDone }: { mode: 'create' | 'check' | 'change'; close(): void; onDone?(): void }) {
  const [first, setFirst] = useState(''), [second, setSecond] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false)
  async function submit(): Promise<void> {
    if (busy || !first || (mode !== 'check' && !second)) return
    if (mode !== 'check' && first !== second) { setError(tr('암호가 서로 다릅니다')); return }
    setBusy(true)
    try {
      if (mode === 'check') {
        const result = await window.morse.appLock.check(first)
        if (result === 'flood') { setError(floodText); return }
        if (result !== 'correct') { setError(tr('암호가 올바르지 않습니다')); return }
      } else if (mode === 'create') await window.morse.appLock.create(first)
      else if (await window.morse.appLock.change(first) === 'same') { setError(tr('암호가 바뀌지 않았습니다')); return }
      close(); onDone?.()
    } catch (reason) { setError(errorText(reason, tr('로컬 암호를 저장하지 못했습니다.'))) }
    finally { setBusy(false) }
  }
  return <Box title={mode === 'create' ? tr('로컬 암호 만들기') : tr('암호 입력')} width={360} onClose={close} buttons={<>
    <button className="button flat" onClick={close}>{tr('취소')}</button>
    <button className="button flat" disabled={busy} onClick={() => { void submit() }}>{mode === 'check' ? tr('확인') : tr('암호 저장')}</button>
  </>}>
    {mode === 'create' && <p className="box-note">{aboutText}</p>}
    <TextField type="password" label={mode === 'check' ? tr('로컬 암호를 입력하세요') : mode === 'create' ? tr('암호 입력') : tr('새 암호 입력')} value={first} maxLength={256} autoFocus
      invalid={Boolean(error)} onChange={value => { setFirst(value); setError('') }} onSubmit={() => { void submit() }} />
    {mode !== 'check' && <TextField type="password" label={tr('새 암호 다시 입력')} value={second} maxLength={256} invalid={Boolean(error)}
      onChange={value => { setSecond(value); setError('') }} onSubmit={() => { void submit() }} />}
    {error && <p className="box-error" role="alert">{error}</p>}
  </Box>
}

function AutoLockBox({ close }: { close(): void }) {
  const current = useDesktop(snapshot => snapshot?.appLock?.autoLock ?? 3600)
  return <Box title={tr('자동 잠금')} width={320} onClose={close} buttons={<button className="button flat" onClick={close}>{tr('확인')}</button>}>
    {autoLockChoices.map(seconds => <label key={seconds} className="settings-radio">
      <input type="radio" name="auto-lock" checked={current === seconds}
        onChange={() => { void window.morse.appLock.setAutoLock(seconds).catch(reason => controller.toast(errorText(reason, tr('자동 잠금 시간을 저장하지 못했습니다.')), 'error')) }} />
      <span>{autoLockLabel(seconds)}</span>
    </label>)}
  </Box>
}

// Settings::LocalPasscodeManage: change, auto-lock, Touch ID and turning the passcode off.
function PasscodeManageBox({ close }: { close(): void }) {
  const state = useDesktop(snapshot => snapshot?.appLock ?? null)
  useEffect(() => { if (state && !state.enabled) close() }, [state?.enabled])
  if (!state?.enabled) return null
  async function remove(): Promise<void> {
    if (!await confirmBox({ title: tr('로컬 암호 끄기'), text: tr('로컬 암호를 끄면 자물쇠 아이콘과 자동 잠금도 꺼집니다.'), confirm: tr('끄기'), danger: true })) return
    try { await window.morse.appLock.remove() }
    catch (reason) { controller.toast(errorText(reason, tr('로컬 암호를 끄지 못했습니다.')), 'error') }
  }
  return <Box title={tr('로컬 암호')} width={400} onClose={close} buttons={<button className="button flat" onClick={close}>{tr('닫기')}</button>}>
    <ListButton icon={<KeyRound size={20} />} label={tr('암호 변경')} onClick={() => { controller.showLayer(closeForm => <PasscodeFormBox mode="change" close={closeForm} />) }} />
    <ListButton icon={<Timer size={20} />} label={tr('자리를 비우면 자동 잠금')} detail={autoLockLabel(state.autoLock)} onClick={() => { controller.showLayer(closeBox => <AutoLockBox close={closeBox} />) }} />
    {state.systemUnlock === 'touch-id' && <label className="settings-toggle">
      <span className="settings-toggle-text"><span>{tr('Touch ID로 잠금 해제')}</span></span>
      <Switch label={tr('Touch ID로 잠금 해제')} checked={state.systemUnlockEnabled}
        onChange={value => { void window.morse.appLock.setSystemUnlock(value).catch(reason => controller.toast(errorText(reason, tr('설정을 저장하지 못했습니다.')), 'error')) }} />
    </label>}
    <ListButton icon={<Trash2 size={20} />} label={tr('로컬 암호 끄기')} danger onClick={() => { void remove() }} />
    <p className="box-note">{tr('{0}\n\n참고: 로컬 암호를 잊으면 Morse Desktop에서 로그아웃한 뒤 다시 로그인해야 합니다.', [aboutText])}</p>
  </Box>
}

export function showPasscodeSettings(enabled: boolean): void {
  const manage = (): void => { controller.showLayer(close => <PasscodeManageBox close={close} />) }
  controller.showLayer(close => <PasscodeFormBox mode={enabled ? 'check' : 'create'} close={close} onDone={manage} />)
}
