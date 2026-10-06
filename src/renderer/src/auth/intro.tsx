// Portions of this file follow Telegram Desktop (https://github.com/telegramdesktop/tdesktop, 7.2.8, 272f6f5c),
// Copyright (c) 2014-2026 The Telegram Desktop Authors. Licensed under GPL-3.0-or-later; see LEGAL.
import { useState } from 'react'
import { ArrowLeft, KeyRound, RotateCw, Trash2, UserPlus } from 'lucide-react'
import type { AccountAuthState } from '../../../shared/auth'
import { morseUserIdAlphabet } from '../../../shared/auth'
import { useDesktop } from '../app/store'
import { controller } from '../app/ui'
import { errorText } from '../app/format'
import { Avatar } from '../ui/avatar'
import { Spinner } from '../ui/controls'
import { confirmBox } from '../ui/layers'
import { BackupCodeBox } from '../boxes/backup-code-box'
import { tr } from '../../../shared/i18n'
import { QrSignInPanel } from './qr-sign-in'
import { PasswordStepPanel } from './password-step'

const noStates: AccountAuthState[] = []

// The Apple logo glyph of the «Sign in with Apple» buttons (iOS SF Symbol apple.logo).
// The security check runs without a window now, so reCAPTCHA's notice is shown where the person signs in — Google asks
// for it to be visible in the flow whenever its badge is not (reCAPTCHA FAQ: hiding the badge).
function RecaptchaNotice() {
  return <p className="intro-legal">{tr('이 앱은 reCAPTCHA의 보호를 받으며 Google의')}{' '}
    <button type="button" className="intro-legal-link" onClick={() => { void window.morse.openRecaptchaTerms('privacy').catch(() => {}) }}>{tr('개인정보처리방침')}</button>{tr('과')}{' '}
    <button type="button" className="intro-legal-link" onClick={() => { void window.morse.openRecaptchaTerms('terms').catch(() => {}) }}>{tr('서비스 약관')}</button>{tr('이 적용됩니다.')}</p>
}

function AppleLogo() {
  return <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" fill="currentColor"><path d="M12.15 6.9c-.95 0-2.42-1.08-3.96-1.04-2.04.03-3.91 1.18-4.96 3.01-2.12 3.68-.55 9.1 1.52 12.09 1.01 1.45 2.21 3.09 3.79 3.04 1.52-.07 2.09-.99 3.94-.99 1.83 0 2.35.99 3.96.95 1.64-.03 2.68-1.48 3.68-2.95 1.16-1.69 1.64-3.33 1.66-3.42-.04-.01-3.18-1.22-3.22-4.86-.03-3.04 2.48-4.49 2.6-4.56-1.43-2.09-3.62-2.32-4.39-2.38-2-.16-3.68 1.09-4.61 1.09zM15.53 3.83c.84-1.01 1.4-2.43 1.25-3.83-1.21.05-2.66.8-3.53 1.82-.78.9-1.45 2.34-1.27 3.71 1.34.1 2.72-.69 3.56-1.7" /></svg>
}

// Google's «G» mark in its four colours, as Google's sign-in branding asks.
function GoogleLogo() {
  return <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
    <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
    <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
    <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
    <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
  </svg>
}

// Eight characters from the server alphabet (31 letters), without modulo bias.
function newUserId(): string {
  let id = ''
  while (id.length < 8) for (const byte of crypto.getRandomValues(new Uint8Array(16))) if (byte < 248 && id.length < 8) id += morseUserIdAlphabet[byte % 31]
  return id
}

// A saved account that is not connected. Telegram reconnects saved accounts on start;
// this row retries one or forgets it on this device.
function SavedAccountRow({ state }: { state: AccountAuthState }) {
  const [busy, setBusy] = useState(false)
  const working = busy || state.phase === 'restoring' || state.phase === 'connecting' || state.phase === 'verifying'
  const name = state.displayName || state.userId || tr('이름 없음')
  async function reconnect(): Promise<void> {
    setBusy(true)
    try { await window.morse.authentication.restoreSignIn(state.uid) }
    catch (reason) { controller.toast(errorText(reason, tr('계정을 다시 연결하지 못했습니다.')), 'error') }
    finally { setBusy(false) }
  }
  async function forget(): Promise<void> {
    if (!await confirmBox({ title: tr('저장된 로그인 지우기'), text: tr('{0} 계정의 이 기기 로그인, 로컬 초안과 미완료 전송 기록을 지웁니다. 계정과 서버에 저장된 대화는 삭제하지 않습니다.', [name]), confirm: tr('지우기'), danger: true })) return
    try { await window.morse.authentication.signOut(state.uid) }
    catch (reason) { controller.toast(errorText(reason, tr('저장된 로그인을 지우지 못했습니다.')), 'error') }
  }
  return <div className="intro-account">
    <Avatar name={name} url={state.photo} size={40} />
    <span className="intro-account-text">
      <strong className="ellipsis">{name}</strong>
      <small className={state.phase === 'error' && !working ? 'error' : ''}>{working ? tr('연결하는 중…') : state.message || (state.userId ? `@${state.userId}` : '')}</small>
    </span>
    <button className="icon-button small" type="button" aria-label={tr('다시 연결')} title={tr('다시 연결')} disabled={working} onClick={() => { void reconnect() }}>{working ? <Spinner size={16} /> : <RotateCw size={18} />}</button>
    <button className="icon-button small" type="button" aria-label={tr('저장된 로그인 지우기')} title={tr('지우기')} disabled={working} onClick={() => { void forget() }}><Trash2 size={18} /></button>
  </div>
}

// Intro::Widget: connect with a recovery code or create an account; with an account already
// signed in it is "Add Account" and can go back.
export function Intro() {
  const auth = useDesktop(snapshot => snapshot?.authentication ?? null)
  const states = useDesktop(snapshot => snapshot?.accountStates ?? noStates)
  const adding = useDesktop(snapshot => snapshot?.addingAccount ?? false)
  const hasActive = useDesktop(snapshot => Boolean(snapshot?.activeAccountUid))
  const maxAccounts = useDesktop(snapshot => snapshot?.maxAccounts ?? 2)
  const [mode, setMode] = useState<'connect' | 'create'>('connect')
  const [code, setCode] = useState(''), [userId, setUserId] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [manual, setManual] = useState(false)
  // Which provider's sign-in is under way (its button shows the spinner).
  const [provider, setProvider] = useState<'apple' | 'google' | null>(null)
  if (!auth) return null
  // A13-2 ②: a sign-in held for the two-step password — from a recovery code, QR or Apple alike — asks for it here.
  if (auth.phase === 'password' && auth.password) return <div className="intro">
    <div className="intro-drag" />
    <PasswordStepPanel step={auth.password} />
  </div>
  const busy = submitting || auth.phase === 'verifying' || auth.phase === 'restoring' || auth.phase === 'connecting'
  const saved = states.filter(state => !state.connected)
  const full = states.length >= maxAccounts
  async function run(action: () => Promise<void>, clear = true): Promise<void> {
    setError(''); setSubmitting(true)
    try { await action() } catch (reason) { setError(errorText(reason, tr('계정 연결 요청을 처리하지 못했습니다. 다시 시도해 주세요.'))) }
    finally { if (clear) setCode(''); setSubmitting(false) }
  }
  async function create(): Promise<void> {
    if (!userId || busy) return
    setError(''); setSubmitting(true)
    try {
      const result = await window.morse.authentication.createAccount(userId)
      if (result) controller.showLayer(close => <BackupCodeBox code={result.backupCode} userId={result.userId} notice={result.connected ? null : tr('계정은 만들어졌지만 이 기기 연결을 마치지 못했어요. 창을 닫은 뒤 이 복구 코드로 연결해 주세요.')} close={close} />, { dismissible: false })
    } catch (reason) { setError(errorText(reason, tr('계정을 만들지 못했습니다. 다시 시도해 주세요.'))) }
    finally { setSubmitting(false) }
  }
  // iOS OnboardingView.handleAppleSignIn (and 3-1c Google the same way): an account with a Morse profile connects,
  // a new one gets its profile.
  async function signInWith(which: 'apple' | 'google'): Promise<void> {
    if (busy) return
    setError(''); setSubmitting(true); setProvider(which)
    try { await (which === 'apple' ? window.morse.authentication.signInWithApple() : window.morse.authentication.signInWithGoogle()) }
    catch (reason) { setError(errorText(reason, which === 'apple' ? tr('Apple 로그인에 실패했어요. 다시 시도해 주세요.') : tr('Google 로그인에 실패했어요. 다시 시도해 주세요.'))) }
    finally { setSubmitting(false); setProvider(null) }
  }
  const appleButton = (label: string) => <button className="button block intro-apple" type="button" disabled={busy} onClick={() => { void signInWith('apple') }}>
    {provider === 'apple' ? <><Spinner size={16} />{tr('Apple 로그인 중…')}</> : <><AppleLogo />{label}</>}
  </button>
  // Shown only when this build has its OAuth client (google-answer.ts); the same look as Apple's, Google's «G» as it is.
  const googleButton = (label: string) => auth.google && <button className="button block intro-apple" type="button" disabled={busy} onClick={() => { void signInWith('google') }}>
    {provider === 'google' ? <><Spinner size={16} />{tr('브라우저에서 Google 로그인 중…')}</> : <><GoogleLogo />{label}</>}
  </button>
  const failed = auth.phase === 'error' || Boolean(error)
  // «지금 다시 시도» under a failed security check (tdesktop window_connecting_widget lng_reconnecting_try_now): the check
  // again at once; passed, the line goes and the QR code is asked for again — the person signs in their own way.
  async function retrySecurityCheck(): Promise<void> {
    setError('')
    const passed = await window.morse.authentication.retrySecurityCheck().catch(() => false)
    // Failed, its line stays: asking for the QR code now would only meet the wait and put «N초 뒤» in its place.
    if (passed && document.visibilityState === 'visible') void window.morse.authentication.startQrSignIn().catch(() => {})
  }
  const tryNow = auth.securityCheck && !submitting && <button className="intro-link" type="button" disabled={auth.securityCheck === 'checking'}
    onClick={() => { void retrySecurityCheck() }}>{auth.securityCheck === 'checking' ? <><Spinner size={14} />{tr('보안 확인 중…')}</> : tr('지금 다시 시도')}</button>
  const status = error || (mode === 'create' && !busy && !failed ? '' : auth.phase === 'signed-out' && !adding ? '' : auth.message)
  const savedList = saved.length > 0 && <div className="intro-accounts">
    <span className="intro-accounts-title">{tr('이 기기에 저장된 계정')}</span>
    {saved.map(state => <SavedAccountRow key={state.uid} state={state} />)}
  </div>
  const back = adding && hasActive && !busy && <button className="intro-back" type="button" onClick={() => { void window.morse.authentication.cancelAddAccount().catch(() => {}) }}><ArrowLeft size={18} />{tr('돌아가기')}</button>
  // At start every saved account reconnects by itself; the code form stays one click away.
  if (!hasActive && !adding && !busy && !manual && saved.some(state => state.phase === 'restoring' || state.phase === 'connecting')) return <div className="intro">
    <div className="intro-drag" />
    <div className="intro-step">
      <img className="intro-logo" src="/morse.png" alt="" />
      <h1>{tr('Morse에 연결하는 중')}</h1>
      <p className="intro-description">{tr('이 기기에 저장된 계정을 연결하고 있어요.')}</p>
      <Spinner size={22} />
      {savedList}
      {!full && <button className="intro-link" type="button" onClick={() => setManual(true)}>{tr('복구 코드로 연결하기')}</button>}
    </div>
  </div>
  if (full && !busy) return <div className="intro">
    <div className="intro-drag" />{back}
    <div className="intro-step">
      <img className="intro-logo" src="/morse.png" alt="" />
      <h1>{tr('계정 한도에 도달했어요')}</h1>
      {maxAccounts < 4 && <p className="intro-description">{tr('프리미엄에서 계정 4개까지 사용할 수 있어요')}</p>}
      {savedList}
    </div>
  </div>
  return <div className="intro">
    <div className="intro-drag" />{back}
    {mode === 'create' && auth.available ? <div className="intro-step">
      <img className="intro-logo" src="/morse.png" alt="" />
      <h1>{tr('새 Morse 계정')}</h1>
      <p className="intro-description">{tr('익명 ID로 새 계정을 만들고 이 데스크탑에 연결합니다.')}</p>
      <div className={`intro-id${userId ? '' : ' empty'}`}>{userId ? <strong className="selectable">@{userId}</strong> : tr('아이디를 생성해 주세요')}</div>
      <button className="button secondary block" type="button" disabled={busy} onClick={() => setUserId(newUserId())}>{userId ? tr('다른 ID 생성') : tr('익명 ID로 시작하기')}</button>
      <p className="intro-note">{tr('가입 후엔 변경할 수 없어요. (이름은 언제든 가능)')}</p>
      <button className="button primary block" type="button" disabled={busy || !userId} onClick={() => { void create() }}>{busy && !provider ? <><Spinner size={16} />{tr('계정 만드는 중…')}</> : tr('계정 만들기')}</button>
      {appleButton(tr('Apple로 계정 만들기'))}
      {googleButton(tr('Google로 계정 만들기'))}
      {busy
        ? <button className="button flat block" type="button" onClick={() => { void run(() => window.morse.authentication.cancelSignIn(), false) }}>{tr('취소')}</button>
        : <button className="intro-link" type="button" onClick={() => { setMode('connect'); setError('') }}>{tr('이미 계정이 있어요 · 복구 코드로 연결')}</button>}
      {status && <p className={`intro-status${failed ? ' error' : ''}`} role={failed ? 'alert' : 'status'}>{status}</p>}
      {tryNow}
      {auth.banned && !error && <button className="intro-link" type="button" onClick={() => { void window.morse.operatorMail(auth.account?.uid ?? '', 'banned').catch(() => {}) }}>{tr('도움')}</button>}
      {auth.updateRequired && !error && <button className="intro-link" type="button" onClick={() => { void window.morse.updateApplication().catch(() => {}) }}>{tr('업데이트')}</button>}
      <RecaptchaNotice />
    </div>
      : <form className="intro-step" onSubmit={event => { event.preventDefault(); if (!busy && code.trim()) void run(() => window.morse.authentication.signInWithBackupCode(code)) }}>
        <img className="intro-logo" src="/morse.png" alt="" />
        <h1>{adding && hasActive ? tr('계정 추가') : tr('Morse에 연결하기')}</h1>
        {!auth.available ? <>
          <p className="intro-description">{tr('현재 버전에서는 계정을 연결할 수 없습니다. 연결이 준비되면 복구 코드로 로그인할 수 있어요.')}</p>
        </> : <>
          <p className="intro-description">{adding && hasActive ? tr('다른 Morse 계정을 이 데스크탑에 함께 연결합니다.') : tr('기존 Morse 계정을 이 데스크탑에 연결합니다.')}</p>
          <QrSignInPanel auth={auth} />
          {!auth.qrOff && <p className="intro-or">{tr('또는 복구 코드로 연결')}</p>}
          <label className="intro-code">
            <KeyRound size={18} />
            <input type="password" value={code} maxLength={256} placeholder={tr('복구 코드')} autoComplete="off" autoCapitalize="characters" spellCheck={false} autoFocus disabled={busy} onChange={event => setCode(event.target.value)} />
          </label>
          <p className="intro-note">{tr('복구 코드는 로그인 확인에만 사용합니다.')}</p>
          <button className="button primary block" type="submit" disabled={busy || !code.trim()}>{busy && !provider ? <><Spinner size={16} />{tr('연결 확인 중…')}</> : tr('계정 연결')}</button>
          {appleButton(tr('Apple로 로그인'))}
          {googleButton(tr('Google로 로그인'))}
          {busy
            ? <button className="button flat block" type="button" onClick={() => { void run(() => window.morse.authentication.cancelSignIn(), false) }}>{tr('연결 취소')}</button>
            : <button className="button flat block" type="button" onClick={() => { setMode('create'); setError('') }}><UserPlus size={18} />{tr('새 계정 만들기')}</button>}
          {status && <p className={`intro-status${failed ? ' error' : ''}`} role={failed ? 'alert' : 'status'}>{status}</p>}
          {tryNow}
      {auth.banned && !error && <button className="intro-link" type="button" onClick={() => { void window.morse.operatorMail(auth.account?.uid ?? '', 'banned').catch(() => {}) }}>{tr('도움')}</button>}
      {auth.updateRequired && !error && <button className="intro-link" type="button" onClick={() => { void window.morse.updateApplication().catch(() => {}) }}>{tr('업데이트')}</button>}
          {savedList}
          <RecaptchaNotice />
        </>}
      </form>}
  </div>
}
