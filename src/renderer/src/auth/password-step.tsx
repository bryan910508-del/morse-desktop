import { useEffect, useState } from 'react'
import { KeyRound } from 'lucide-react'
import { Spinner } from '../ui/controls'
import { confirmBox } from '../ui/layers'
import type { PasswordStep } from '../../../shared/auth'
import { resetDateText } from '../../../shared/two-step'
import { tr } from '../../../shared/i18n'

// A13-2 ② (tdesktop intro/intro_password_check.cpp): the sign-in's password step, whichever way the sign-in came — QR,
// recovery code, Apple. The password field, the hint, «Next», and «Forgot password?», which — there being no recovery
// email — asks for the 7-day reset (contract A13-2 §3-6, §5); a waiting reset shows the day it ends, and once it is due
// asking again turns the password off. Words: contract §5.
export function PasswordStepPanel({ step }: { step: PasswordStep }) {
  const [password, setPassword] = useState('')
  const [now, setNow] = useState(() => Date.now())
  // A waiting reset turns into «you can reset now» when its day comes, without the person doing anything.
  useEffect(() => {
    if (!step.resetAt || step.resetAt <= now) return
    const timer = setTimeout(() => setNow(Date.now()), Math.min(step.resetAt - now + 1000, 3600000))
    return () => clearTimeout(timer)
  }, [step.resetAt, now])
  const due = step.resetAt !== null && step.resetAt <= now
  const submit = (): void => { if (!step.busy && password) void window.morse.authentication.submitPassword(password).catch(() => {}) }
  async function forgot(): Promise<void> {
    if (step.busy) return
    if (!due && !await confirmBox({ title: tr('비밀번호를 잊으셨나요?'), confirm: tr('재설정 요청'), danger: true,
      text: tr('이메일 복구가 없어 7일 뒤에 비밀번호가 꺼져요. 그동안 비밀번호를 알면 재설정을 취소할 수 있어요. 요청할까요?') })) return
    void window.morse.authentication.requestPasswordReset().catch(() => {})
  }
  return <form className="intro-step" onSubmit={event => { event.preventDefault(); submit() }}>
    <img className="intro-logo" src="/morse.png" alt="" />
    <h1>{tr('2단계 인증')}</h1>
    <p className="intro-description">{tr('이 계정은 추가 비밀번호로 보호되고 있어요.')}</p>
    <label className="intro-code">
      <KeyRound size={18} />
      <input type="password" value={password} maxLength={1024} placeholder={tr('비밀번호')} autoComplete="current-password" spellCheck={false} autoFocus
        disabled={step.busy} onChange={event => setPassword(event.target.value)} />
    </label>
    {step.hint && <p className="intro-note">{tr('힌트: {0}', [step.hint])}</p>}
    <button className="button primary block" type="submit" disabled={step.busy || !password}>{step.busy ? <><Spinner size={16} />{tr('확인 중…')}</> : tr('다음')}</button>
    {step.resetAt && !due
      ? <p className="intro-note" role="status">{tr('{0}에 비밀번호가 꺼져요.', [resetDateText(step.resetAt)])}</p>
      : <button className="intro-link" type="button" disabled={step.busy} onClick={() => { void forgot() }}>{due ? tr('이제 비밀번호를 재설정할 수 있어요.') : tr('비밀번호를 잊으셨나요?')}</button>}
    <button className="button flat block" type="button" disabled={step.busy} onClick={() => { void window.morse.authentication.cancelSignIn().catch(() => {}) }}>{tr('연결 취소')}</button>
    {step.error && <p className="intro-status error" role="alert">{step.error}</p>}
  </form>
}
