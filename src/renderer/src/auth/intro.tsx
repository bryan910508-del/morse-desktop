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

const noStates: AccountAuthState[] = []

// The Apple logo glyph of the «Sign in with Apple» buttons (iOS SF Symbol apple.logo).
function AppleLogo() {
  return <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" fill="currentColor"><path d="M12.15 6.9c-.95 0-2.42-1.08-3.96-1.04-2.04.03-3.91 1.18-4.96 3.01-2.12 3.68-.55 9.1 1.52 12.09 1.01 1.45 2.21 3.09 3.79 3.04 1.52-.07 2.09-.99 3.94-.99 1.83 0 2.35.99 3.96.95 1.64-.03 2.68-1.48 3.68-2.95 1.16-1.69 1.64-3.33 1.66-3.42-.04-.01-3.18-1.22-3.22-4.86-.03-3.04 2.48-4.49 2.6-4.56-1.43-2.09-3.62-2.32-4.39-2.38-2-.16-3.68 1.09-4.61 1.09zM15.53 3.83c.84-1.01 1.4-2.43 1.25-3.83-1.21.05-2.66.8-3.53 1.82-.78.9-1.45 2.34-1.27 3.71 1.34.1 2.72-.69 3.56-1.7" /></svg>
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
  const [apple, setApple] = useState(false)
  if (!auth) return null
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
  // iOS OnboardingView.handleAppleSignIn: an Apple account with a Morse profile connects, a new one gets its profile.
  async function signInWithApple(): Promise<void> {
    if (busy) return
    setError(''); setSubmitting(true); setApple(true)
    try { await window.morse.authentication.signInWithApple() }
    catch (reason) { setError(errorText(reason, tr('Apple 로그인에 실패했어요. 다시 시도해 주세요.'))) }
    finally { setSubmitting(false); setApple(false) }
  }
  const appleButton = (label: string) => <button className="button block intro-apple" type="button" disabled={busy} onClick={() => { void signInWithApple() }}>
    {apple ? <><Spinner size={16} />{tr('Apple 로그인 중…')}</> : <><AppleLogo />{label}</>}
  </button>
  const failed = auth.phase === 'error' || Boolean(error)
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
      <p className="intro-note">{tr('가입 후엔 변경할 수 없어요. (이름은 언제든 가능) 만들 때 보안 확인 창이 잠시 열립니다.')}</p>
      <button className="button primary block" type="button" disabled={busy || !userId} onClick={() => { void create() }}>{busy && !apple ? <><Spinner size={16} />{tr('계정 만드는 중…')}</> : tr('계정 만들기')}</button>
      {appleButton(tr('Apple로 계정 만들기'))}
      {busy
        ? <button className="button flat block" type="button" onClick={() => { void run(() => window.morse.authentication.cancelSignIn(), false) }}>{tr('취소')}</button>
        : <button className="intro-link" type="button" onClick={() => { setMode('connect'); setError('') }}>{tr('이미 계정이 있어요 · 복구 코드로 연결')}</button>}
      {status && <p className={`intro-status${failed ? ' error' : ''}`} role={failed ? 'alert' : 'status'}>{status}</p>}
    </div>
      : <form className="intro-step" onSubmit={event => { event.preventDefault(); if (!busy && code.trim()) void run(() => window.morse.authentication.signInWithBackupCode(code)) }}>
        <img className="intro-logo" src="/morse.png" alt="" />
        <h1>{adding && hasActive ? tr('계정 추가') : tr('Morse에 연결하기')}</h1>
        {!auth.available ? <>
          <p className="intro-description">{tr('현재 버전에서는 계정을 연결할 수 없습니다. 연결이 준비되면 복구 코드로 로그인할 수 있어요.')}</p>
        </> : <>
          <p className="intro-description">{adding && hasActive ? tr('다른 Morse 계정을 이 데스크탑에 함께 연결합니다.') : tr('기존 Morse 계정을 이 데스크탑에 연결합니다.')}</p>
          <label className="intro-code">
            <KeyRound size={18} />
            <input type="password" value={code} maxLength={256} placeholder={tr('복구 코드')} autoComplete="off" autoCapitalize="characters" spellCheck={false} autoFocus disabled={busy} onChange={event => setCode(event.target.value)} />
          </label>
          <p className="intro-note">{tr('복구 코드는 로그인 확인에만 사용합니다. 연결할 때 보안 확인 창이 잠시 열립니다.')}</p>
          <button className="button primary block" type="submit" disabled={busy || !code.trim()}>{busy && !apple ? <><Spinner size={16} />{tr('연결 확인 중…')}</> : tr('계정 연결')}</button>
          {appleButton(tr('Apple로 로그인'))}
          {busy
            ? <button className="button flat block" type="button" onClick={() => { void run(() => window.morse.authentication.cancelSignIn(), false) }}>{tr('연결 취소')}</button>
            : <button className="button flat block" type="button" onClick={() => { setMode('create'); setError('') }}><UserPlus size={18} />{tr('새 계정 만들기')}</button>}
          {status && <p className={`intro-status${failed ? ' error' : ''}`} role={failed ? 'alert' : 'status'}>{status}</p>}
          {savedList}
        </>}
      </form>}
  </div>
}
