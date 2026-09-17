import { useEffect, useRef, useState } from 'react'
import { Fingerprint } from 'lucide-react'
import { useDesktop } from '../app/store'
import { controller } from '../app/ui'
import { errorText } from '../app/format'
import { confirmBox } from '../ui/layers'
import { tr } from '../../../shared/i18n'

const floodText = tr('시도 횟수가 너무 많습니다. 잠시 후 다시 시도해 주세요.')

// Window::PasscodeLockWidget: passcode, submit and log out. Touch ID is suggested once the
// passcode was entered in this run; a failed prompt waits a second (kSystemUnlockDelay).
export function LockScreen() {
  const state = useDesktop(snapshot => snapshot?.appLock ?? null)
  const [passcode, setPasscode] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false)
  const input = useRef<HTMLInputElement>(null), prompting = useRef(false), cooldown = useRef(0)
  const touch = state?.systemUnlock === 'touch-id' && state.systemUnlockEnabled
  const allowed = Boolean(touch && state?.systemUnlockAllowed)
  async function systemUnlock(): Promise<void> {
    if (!allowed || prompting.current || Date.now() < cooldown.current) return
    prompting.current = true
    try { if (!await window.morse.appLock.systemUnlock()) cooldown.current = Date.now() + 1000 }
    catch { cooldown.current = Date.now() + 1000 }
    finally { prompting.current = false; input.current?.focus() }
  }
  useEffect(() => { input.current?.focus() }, [])
  useEffect(() => {
    if (!allowed) return
    if (document.hasFocus()) void systemUnlock()
    const focus = (): void => { void systemUnlock() }
    window.addEventListener('focus', focus)
    return () => window.removeEventListener('focus', focus)
  }, [allowed])
  async function submit(): Promise<void> {
    if (busy) return
    if (!passcode) { input.current?.focus(); return }
    setBusy(true)
    try {
      const result = await window.morse.appLock.unlock(passcode)
      if (result === 'flood') setError(floodText)
      else if (result === 'wrong') { setError(tr('암호가 올바르지 않습니다')); input.current?.select() }
    } catch (reason) { setError(errorText(reason, tr('잠금을 해제하지 못했습니다.'))) }
    finally { setBusy(false) }
  }
  async function signOut(): Promise<void> {
    if (!await confirmBox({ title: tr('로그아웃'), text: tr('이 기기의 로그인, 로컬 초안과 미완료 전송 기록을 지우고 로컬 암호를 끕니다. 계정과 서버에 저장된 대화는 삭제하지 않습니다.'), confirm: tr('로그아웃'), danger: true })) return
    try { await window.morse.appLock.signOut() }
    catch (reason) { controller.toast(errorText(reason, tr('로그아웃하지 못했습니다.')), 'error') }
  }
  return <div className="lock-screen" role="dialog" aria-modal="true" aria-label={tr('Morse 잠금')}>
    <form className="lock-screen-form" onSubmit={event => { event.preventDefault(); void submit() }}>
      <img src="/morse.png" alt="" className="lock-screen-logo" />
      <h1>{tr('로컬 암호를 입력하세요')}</h1>
      <div className="lock-screen-field">
        <input ref={input} type="password" value={passcode} placeholder={tr('암호')} maxLength={256} aria-label={tr('암호')} autoComplete="off" aria-invalid={Boolean(error)}
          onChange={event => { setPasscode(event.target.value); if (error) setError('') }} />
        {allowed && <button type="button" className="icon-button" aria-label={tr('Touch ID로 잠금 해제')} onClick={() => { void systemUnlock() }}><Fingerprint size={20} /></button>}
      </div>
      <p className="lock-screen-error" role="alert">{error}</p>
      <button type="submit" className="button primary lock-screen-submit" disabled={busy}>{tr('확인')}</button>
      <button type="button" className="button flat" onClick={() => { void signOut() }}>{tr('로그아웃')}</button>
      {touch && !state?.systemUnlockAllowed && <p className="lock-screen-note">{tr('Touch ID를 사용하려면 먼저 암호를 입력해야 합니다.')}</p>}
    </form>
  </div>
}
