import { useEffect, useState, type ReactNode } from 'react'
import { KeyRound, ShieldOff } from 'lucide-react'
import { controller } from '../app/ui'
import { errorText } from '../app/format'
import { ListButton, Spinner, TextField } from '../ui/controls'
import { Box, confirmBox } from '../ui/layers'
import { hintMaximum, hintProblem, newPasswordProblem, resetDateText, type TwoStepRequest, type TwoStepSettings } from '../../../shared/two-step'
import { tr } from '../../../shared/i18n'

// A13-2 ③: Settings › Privacy › Two-Step Verification, as tdesktop's cloud password sections (settings/cloud_password/*):
//   off — Start → Input (new + confirm) → Hint (may be skipped) → on; there is no recovery email.
//   on  — the current password first (with the hint, and «Forgot?» or a waiting reset — input.cpp:527-660), then
//         Manage: Change Password (new + confirm → hint; the hint changes only here) and Turn Password Off
//         (manage.cpp:91-245). Ten idle minutes close it, and the password typed goes with it.
// The current password is checked when it is entered (verifyMorsePassword); change and turn-off prove it again.
type Step =
  | { kind: 'loading' }
  | { kind: 'start' }
  | { kind: 'current' }
  | { kind: 'manage' }
  | { kind: 'new'; purpose: 'enable' | 'change' }
  | { kind: 'hint'; purpose: 'enable' | 'change'; password: string }

const idleMs = 10 * 60 * 1000

function TwoStepBox({ accountUid, close, changed }: { accountUid: string; close(): void; changed?(settings: TwoStepSettings): void }) {
  const [settings, setSettings] = useState<TwoStepSettings | null>(null)
  const [step, setStep] = useState<Step>({ kind: 'loading' })
  const [current, setCurrent] = useState(''), [first, setFirst] = useState(''), [second, setSecond] = useState(''), [hint, setHint] = useState('')
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  const [now, setNow] = useState(() => Date.now())
  // The settings row beside it shows on / off from the same state.
  useEffect(() => { if (settings) changed?.(settings) }, [settings])

  useEffect(() => {
    let alive = true
    void window.morse.twoStepSettings(accountUid).then(next => { if (alive) { setSettings(next); setStep({ kind: next.enabled ? 'current' : 'start' }) } })
      .catch(reason => { if (alive) setError(errorText(reason, tr('2단계 인증을 처리하지 못했어요. 잠시 뒤에 다시 해 주세요.'))) })
    return () => { alive = false }
  }, [accountUid])
  // manage.cpp: the section closes after ten idle minutes, so a password typed does not stay on screen.
  useEffect(() => {
    const timer = setTimeout(close, idleMs)
    return () => clearTimeout(timer)
  }, [step, current, first, second, hint, busy])
  // A waiting reset turns into «you can reset now» when its day comes.
  useEffect(() => {
    const at = settings?.resetAt
    if (!at || at <= now) return
    const timer = setTimeout(() => setNow(Date.now()), Math.min(at - now + 1000, 3600000))
    return () => clearTimeout(timer)
  }, [settings?.resetAt, now])

  const go = (next: Step): void => { setError(''); setStep(next) }
  // One request; the answer is the state after it, or the server's refusal with its words.
  async function send(request: TwoStepRequest): Promise<TwoStepSettings | null> {
    setBusy(true); setError('')
    try {
      const outcome = await window.morse.updateTwoStep(accountUid, request)
      if (outcome.ok) { setSettings(outcome.settings); return outcome.settings }
      // A wrong current password goes back to asking for it (input.cpp PASSWORD_HASH_INVALID).
      if (outcome.reason === 'password-wrong' && (request.action === 'verify' || request.action === 'change' || request.action === 'disable')) { setCurrent(''); setStep({ kind: 'current' }) }
      if (outcome.reason === 'password-off') { setCurrent(''); setStep({ kind: 'start' }); setSettings(state => state && { ...state, enabled: false, hint: '', resetAt: null }) }
      setError(outcome.message)
      return null
    } catch (reason) { setError(errorText(reason, tr('2단계 인증을 처리하지 못했어요. 잠시 뒤에 다시 해 주세요.'))); return null }
    finally { setBusy(false) }
  }
  // input.cpp → account.getPasswordSettings: the current password is checked before Manage opens; a wrong one stays
  // here with its words (and the lock's time, when there is one).
  async function enterCurrent(): Promise<void> {
    if (busy) return
    if (!current) { setError(tr('현재 비밀번호를 입력해 주세요.')); return }
    if (await send({ action: 'verify', current })) go({ kind: 'manage' })
  }
  function enterNew(purpose: 'enable' | 'change'): void {
    if (busy) return
    const problem = newPasswordProblem(first, second)
    if (problem) { setError(problem); return }
    setHint(''); go({ kind: 'hint', purpose, password: first })
  }
  async function finish(purpose: 'enable' | 'change', password: string, words: string): Promise<void> {
    if (busy) return
    const problem = hintProblem(words, password)
    if (problem) { setError(problem); return }
    const done = await send(purpose === 'enable' ? { action: 'enable', password, hint: words } : { action: 'change', current, password, hint: words })
    if (!done) return
    controller.toast(purpose === 'enable' ? tr('2단계 인증을 켰어요.') : tr('비밀번호를 바꿨어요.'))
    setCurrent(password); setFirst(''); setSecond(''); setHint('')
    go({ kind: 'manage' })
  }
  async function turnOff(): Promise<void> {
    if (busy || !await confirmBox({ title: tr('2단계 인증 끄기'), text: tr('2단계 인증을 끌까요? 새 기기에서 로그인할 때 비밀번호를 묻지 않아요.'), confirm: tr('끄기'), danger: true })) return
    const done = await send({ action: 'disable', current })
    if (!done) return
    controller.toast(tr('2단계 인증을 껐어요.'))
    setCurrent(''); go({ kind: 'start' })
  }
  async function forgot(): Promise<void> {
    if (busy) return
    const due = settings?.resetAt != null && settings.resetAt <= now
    if (!due && !await confirmBox({ title: tr('비밀번호를 잊으셨나요?'), confirm: tr('재설정 요청'), danger: true,
      text: tr('이메일 복구가 없어 7일 뒤에 비밀번호가 꺼져요. 그동안 비밀번호를 알면 재설정을 취소할 수 있어요. 요청할까요?') })) return
    const done = await send({ action: 'reset' })
    if (done && !done.enabled) { controller.toast(tr('2단계 인증을 껐어요.')); setCurrent(''); go({ kind: 'start' }) }
  }
  async function cancelReset(): Promise<void> {
    if (busy || !await confirmBox({ text: tr('비밀번호 재설정을 취소할까요?'), confirm: tr('재설정 취소') })) return
    await send({ action: 'cancel-reset' })
  }

  // The reset, where the password is asked for and on Manage: waiting — its day and «Cancel Reset»; due — «you can
  // reset now»; none — «Forgot password?».
  const resetAt = settings?.enabled ? settings.resetAt : null
  const resetLine = resetAt && resetAt > now
    ? <>
      <p className="box-note" role="status">{tr('{0}에 비밀번호가 꺼져요.', [resetDateText(resetAt)])}</p>
      <ListButton label={tr('재설정 취소')} disabled={busy} onClick={() => { void cancelReset() }} />
    </>
    : <button className="intro-link" type="button" disabled={busy} onClick={() => { void forgot() }}>{resetAt ? tr('이제 비밀번호를 재설정할 수 있어요.') : tr('비밀번호를 잊으셨나요?')}</button>

  const cancel = <button className="button flat" disabled={busy} onClick={close}>{tr('취소')}</button>
  const working = busy && <Spinner size={14} />
  let body: ReactNode = null, buttons: ReactNode = null
  switch (step.kind) {
    case 'loading':
      body = !error && <div className="empty-state"><Spinner size={22} /></div>
      buttons = cancel
      break
    case 'start':
      body = <>
        <p className="box-note">{tr('새 기기에서 로그인할 때, 로그인 수단에 더해 이 비밀번호를 물어요.')}</p>
        {settings && !settings.available && <p className="box-note">{tr('지금은 2단계 인증을 켤 수 없어요.')}</p>}
      </>
      buttons = <>{cancel}<button className="button flat" disabled={busy || !settings?.available} onClick={() => { setFirst(''); setSecond(''); go({ kind: 'new', purpose: 'enable' }) }}>{tr('비밀번호 설정')}</button></>
      break
    case 'current':
      body = <>
        <TextField type="password" label={tr('현재 비밀번호를 입력해 주세요.')} value={current} maxLength={1024} autoFocus disabled={busy} invalid={Boolean(error)}
          onChange={value => { setCurrent(value); setError('') }} onSubmit={() => { void enterCurrent() }} />
        {settings?.hint && <p className="box-note">{tr('힌트: {0}', [settings.hint])}</p>}
        {resetLine}
      </>
      buttons = <>{cancel}<button className="button flat" disabled={busy || !current} onClick={() => { void enterCurrent() }}>{working}{tr('확인')}</button></>
      break
    case 'manage':
      body = <>
        <ListButton icon={<KeyRound size={20} />} label={tr('비밀번호 바꾸기')} disabled={busy} onClick={() => { setFirst(''); setSecond(''); go({ kind: 'new', purpose: 'change' }) }} />
        <ListButton icon={<ShieldOff size={20} />} label={tr('2단계 인증 끄기')} danger disabled={busy} onClick={() => { void turnOff() }} />
        {resetAt && resetAt > now && resetLine}
      </>
      buttons = <button className="button flat" disabled={busy} onClick={close}>{working}{tr('닫기')}</button>
      break
    case 'new':
      body = <>
        <TextField type="password" label={tr('새 비밀번호')} value={first} maxLength={1024} autoFocus disabled={busy} invalid={Boolean(error)}
          onChange={value => { setFirst(value); setError('') }} onSubmit={() => enterNew(step.purpose)} />
        <TextField type="password" label={tr('새 비밀번호 다시 입력')} value={second} maxLength={1024} disabled={busy} invalid={Boolean(error)}
          onChange={value => { setSecond(value); setError('') }} onSubmit={() => enterNew(step.purpose)} />
        <p className="box-note">{tr('6자 이상. 이 비밀번호를 잊으면 7일을 기다려야 재설정할 수 있어요.')}</p>
      </>
      buttons = <>{cancel}<button className="button flat" disabled={busy || !first || !second} onClick={() => enterNew(step.purpose)}>{tr('확인')}</button></>
      break
    case 'hint':
      body = <TextField label={tr('비밀번호 힌트')} value={hint} maxLength={hintMaximum} counter autoFocus disabled={busy} invalid={Boolean(error)}
        onChange={value => { setHint(value); setError('') }} onSubmit={() => { void finish(step.purpose, step.password, hint) }} />
      buttons = <>
        <button className="button flat" disabled={busy} onClick={() => { void finish(step.purpose, step.password, '') }}>{tr('건너뛰기')}</button>
        <button className="button flat" disabled={busy || !hint.trim()} onClick={() => { void finish(step.purpose, step.password, hint) }}>{working}{tr('확인')}</button>
      </>
      break
  }
  return <Box title={tr('2단계 인증')} width={400} className="settings-list-box" onClose={close} buttons={buttons}>
    {body}
    {error && <p className="box-error" role="alert">{error}</p>}
  </Box>
}

export function showTwoStepBox(accountUid: string, changed?: (settings: TwoStepSettings) => void): void {
  controller.showLayer(close => <TwoStepBox accountUid={accountUid} close={close} changed={changed} />)
}

// The settings row: shown while the account has a password, or once turning one on is open (contract §3-1 — until
// every app has the sign-in password step, no app offers to turn it on).
export function TwoStepEntry({ accountUid, render }: { accountUid: string; render(detail: string, open: () => void): ReactNode }) {
  const [settings, setSettings] = useState<TwoStepSettings | null>(null)
  useEffect(() => {
    let alive = true
    void window.morse.twoStepSettings(accountUid).then(next => { if (alive) setSettings(next) }).catch(() => {})
    return () => { alive = false }
  }, [accountUid])
  if (!settings || (!settings.enabled && !settings.available)) return null
  return <>{render(settings.enabled ? tr('켜짐') : tr('꺼짐'), () => showTwoStepBox(accountUid, setSettings))}</>
}
