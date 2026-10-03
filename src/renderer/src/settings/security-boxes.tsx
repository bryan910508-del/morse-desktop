import { useEffect, useState, type ReactNode } from 'react'
import { Hand, KeyRound, Laptop, Monitor, Smartphone, X } from 'lucide-react'
import { lastSeenModes, sessionPlace, sessionQrLine, sessionTtlDayOptions, type BlockedUser, type LastSeenMode, type LastSeenPrivacy, type SignInSession, type SignInSessions } from '../../../shared/account-tools'
import { controller } from '../app/ui'
import { errorText, fullTime, sessionActiveTime } from '../app/format'
import { trackWrite } from '../app/drafts'
import { loadBlockedUsers, setBlocked, useBlockedUsers } from '../app/blocked-users'
import { BackupCodeBox } from '../boxes/backup-code-box'
import { showTextEditBox } from '../boxes/text-edit-box'
import { Spinner } from '../ui/controls'
import { Box, confirmBox } from '../ui/layers'
import { UserAvatar } from '../ui/user-avatar'
import { locale, tr } from '../../../shared/i18n'

// PrivacyLastSeenSettingsView: who can see the last seen time. Exceptions set on iPhone are kept.
function LastSeenBox({ accountUid, close }: { accountUid: string; close(): void }) {
  const [value, setValue] = useState<LastSeenPrivacy | null>(null), [mode, setMode] = useState<LastSeenMode>('everybody')
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  useEffect(() => {
    let alive = true
    void window.morse.lastSeenPrivacy(accountUid).then(next => { if (alive) { setValue(next); setMode(next.mode) } })
      .catch(reason => { if (alive) setError(errorText(reason, tr('공개 범위를 불러오지 못했습니다.'))) })
    return () => { alive = false }
  }, [accountUid])
  async function save(): Promise<void> {
    if (!value || busy) return
    setBusy(true); setError('')
    try { await trackWrite(window.morse.setLastSeenPrivacy(accountUid, { ...value, mode })); controller.toast(tr('마지막 접속 공개 범위를 저장했습니다.')); close() }
    catch (reason) { setError(errorText(reason, tr('공개 범위를 저장하지 못했습니다.'))); setBusy(false) }
  }
  return <Box title={tr('마지막 접속')} width={400} className="settings-list-box" buttons={<>
    <button className="button flat" disabled={busy} onClick={close}>{tr('취소')}</button>
    <button className="button flat" disabled={!value || busy || mode === value.mode} onClick={() => { void save() }}>{busy && <Spinner size={14} />}{tr('저장')}</button>
  </>}>
    {!value ? !error && <div className="empty-state"><Spinner size={22} /></div> : <>
      <div className="section-label">{tr('내 마지막 접속 시간을 볼 수 있는 사람')}</div>
      {(Object.keys(lastSeenModes) as LastSeenMode[]).map(key => <label key={key} className="settings-radio">
        <input type="radio" name="last-seen" checked={mode === key} disabled={busy} onChange={() => setMode(key)} /><span>{lastSeenModes[key]}</span>
      </label>)}
      {(value.alwaysShareWith.length > 0 || value.neverShareWith.length > 0) && <p className="box-note">{tr('예외 설정(항상 공개 {0}명 · 항상 숨김 {1}명)은 그대로 유지됩니다.', [value.alwaysShareWith.length, value.neverShareWith.length])}</p>}
    </>}
    {error && <p className="box-error" role="alert">{error}</p>}
  </Box>
}

function BlockedUsersBox({ accountUid, close }: { accountUid: string; close(): void }) {
  const users = useBlockedUsers(accountUid)
  const [error, setError] = useState(''), [busy, setBusy] = useState<string | null>(null)
  useEffect(() => { void loadBlockedUsers(accountUid).catch(reason => setError(errorText(reason, tr('차단 목록을 불러오지 못했습니다.')))) }, [accountUid])
  async function unblock(user: BlockedUser): Promise<void> {
    setBusy(user.uid)
    try { await setBlocked(accountUid, { uid: user.uid, userId: user.userId, displayName: user.displayName }, false); controller.toast(tr('{0}님의 차단을 해제했습니다.', [user.displayName])) }
    catch (reason) { controller.toast(errorText(reason, tr('차단을 해제하지 못했습니다.')), 'error') }
    finally { setBusy(null) }
  }
  return <Box title={tr('차단한 사용자')} width={400} onClose={close}>
    {!users ? <div className="empty-state">{error || <Spinner size={22} />}</div>
      : !users.length ? <div className="empty-state">{tr('차단한 사용자가 없습니다.')}</div>
        : <div className="peer-list tall">{users.map(user => <div key={user.uid} className="peer-row">
          <UserAvatar uid={user.uid} name={user.displayName} size={42} />
          <span className="peer-row-text"><strong className="ellipsis">{user.displayName}</strong><small>{user.userId ? `@${user.userId}` : ''}</small></span>
          <button className="button flat" disabled={busy !== null} onClick={() => { void unblock(user) }}>{busy === user.uid ? <Spinner size={14} /> : tr('해제', [], 'unblock')}</button>
        </div>)}</div>}
  </Box>
}

// Telegram's active sessions (tdesktop settings_active_sessions.cpp SessionsContent::Inner::setupContent; A6 contract §4):
// this device; «terminate all other sessions» with its note, while there are others; the other sessions by last
// activity; «automatically terminate old sessions» with its period. A row is the device model, «app version» and the
// last activity (Row, api_authorizations.cpp); opening it shows the session (SessionInfoBox), where another device's
// session is ended, as its row's own close button also does. How a device signed in is not shown. An ended session leaves the list at once: the server deletes it
// and refuses its sign-in everywhere (A6 §3-1). Laid out in Morse's grouped settings style.
const platformIcon = (session: SignInSession): ReactNode => session.platform === 'macOS' ? <Laptop size={20} />
  : session.platform === 'Windows' ? <Monitor size={20} /> : session.platform === 'other' ? <KeyRound size={20} /> : <Smartphone size={20} />
const appLine = (session: SignInSession): string => session.appVersion ? `${session.appName} ${session.appVersion}` : session.appName
function ttlLabel(days: number): string {
  return days === 7 ? tr('1주') : days === 90 ? tr('3개월') : days === 183 ? tr('6개월') : tr('1년')
}
// Row: another device's row also has tdesktop's small close button at its right (element 2, sessionTerminate:
// smallCloseIcon in a 34px button, settings.style:353-359), which asks and ends that session; this device's has none.
function SessionRow({ session, onOpen, onTerminate }: { session: SignInSession; onOpen(): void; onTerminate?(): void }) {
  const last = session.lastSeenAt ?? session.createdAt
  return <div className="session-row-wrap">
    <button type="button" className="peer-row session-row" onClick={onOpen}>
      <span className="session-icon">{platformIcon(session)}</span>
      <span className="peer-row-text"><strong className="ellipsis">{session.deviceModel}</strong>
        <small className="ellipsis">{appLine(session)}</small>
        {session.qr && <small className="ellipsis">{sessionQrLine(session.qr)}</small>}
        {session.current ? <small className="online">{tr('온라인')}</small> : last !== null && <small>{sessionActiveTime(last)}</small>}</span>
    </button>
    {onTerminate && !session.current && <button type="button" className="icon-button small session-terminate" aria-label={tr('세션 종료')} title={tr('세션 종료')}
      onClick={onTerminate}><X size={16} /></button>}
  </div>
}
// SessionInfoBox: the device, its last activity, the app and system, when it signed in; «terminate» for another device.
function SessionInfoBox({ session, close, terminate }: { session: SignInSession; close(): void; terminate(): void }) {
  const last = session.lastSeenAt ?? session.createdAt
  return <Box width={380} className="settings-list-box session-info" buttons={<>
    {!session.current && <button className="button flat danger" onClick={() => { close(); terminate() }}>{tr('세션 종료')}</button>}
    <button className="button" onClick={close}>{tr('완료')}</button>
  </>}>
    <div className="session-info-head">
      <span className="session-icon large">{platformIcon(session)}</span>
      <strong>{session.deviceModel}</strong>
      <small>{session.current ? tr('온라인') : last !== null ? fullTime(last) : ''}</small>
    </div>
    <div className="section-label">{tr('세션 정보')}</div>
    <div className="session-info-row"><span>{tr('앱')}</span><strong>{appLine(session)}</strong></div>
    {session.systemVersion && <div className="session-info-row"><span>{tr('시스템')}</span><strong>{session.systemVersion}</strong></div>}
    {session.createdAt !== null && <div className="session-info-row"><span>{tr('로그인')}</span><strong>{fullTime(session.createdAt)}</strong></div>}
    {session.qr && <div className="session-info-row"><span>{tr('로그인 방식')}</span><strong>{sessionQrLine(session.qr)}</strong></div>}
    {session.ip && <div className="session-info-row"><span>{tr('IP 주소')}</span><strong className="selectable">{session.ip}</strong></div>}
    {session.origin && <div className="session-info-row"><span>{tr('위치')}</span><strong>{sessionPlace(session.origin, locale())}</strong></div>}
    {/* A13 §8: the place is the IP's, from DB-IP (CC BY 4.0, credited here and in the privacy policy). */}
    {session.origin && <p className="box-note">{tr('위치는 IP 로 추정한 것이라 정확하지 않을 수 있어요.')}<br />{tr('IP 위치: DB-IP')}</p>}
  </Box>
}
// SelfDestructionBox (Type::Sessions): 1 week, 3, 6 or 12 months.
function SessionTtlBox({ accountUid, days, close, saved }: { accountUid: string; days: number; close(): void; saved(days: number): void }) {
  const [choice, setChoice] = useState(days), [busy, setBusy] = useState(false), [error, setError] = useState('')
  async function save(): Promise<void> {
    if (busy) return
    if (choice === days) { close(); return }
    setBusy(true); setError('')
    try { await trackWrite(window.morse.setSessionTtl(accountUid, choice)); saved(choice); close() }
    catch (reason) { setError(errorText(reason, tr('기간을 바꾸지 못했습니다.'))); setBusy(false) }
  }
  return <Box title={tr('오래된 세션 자동 종료')} width={380} className="settings-list-box" buttons={<>
    <button className="button flat" disabled={busy} onClick={close}>{tr('취소')}</button>
    <button className="button" disabled={busy} onClick={() => { void save() }}>{busy ? <Spinner size={14} /> : tr('저장')}</button>
  </>}>
    <p className="box-note">{tr('이 기간 동안 쓰지 않은 세션은 자동으로 종료돼요.')}</p>
    {sessionTtlDayOptions.map(option => <label key={option} className="settings-radio">
      <input type="radio" name="session-ttl" checked={choice === option} disabled={busy} onChange={() => setChoice(option)} /><span>{ttlLabel(option)}</span>
    </label>)}
    {error && <p className="box-error">{error}</p>}
  </Box>
}
function SessionsBox({ accountUid, close }: { accountUid: string; close(): void }) {
  const [value, setValue] = useState<SignInSessions | null>(null), [error, setError] = useState('')
  const [busy, setBusy] = useState(false), [reload, setReload] = useState(0)
  useEffect(() => {
    let alive = true
    setError('')
    void window.morse.signInSessions(accountUid).then(next => { if (alive) setValue(next) })
      .catch(reason => { if (alive) setError(errorText(reason, tr('세션 목록을 불러오지 못했습니다.'))) })
    return () => { alive = false }
  }, [accountUid, reload])
  const current = value?.sessions.find(session => session.current) ?? null
  const others = value?.sessions.filter(session => !session.current) ?? []
  // SessionsContent::terminateOne / terminateAll: asked once, then gone from the list.
  async function terminate(target: SignInSession | null): Promise<void> {
    if (busy) return
    if (!await confirmBox(target ? { text: tr('이 세션을 종료할까요?'), confirm: tr('종료'), danger: true }
      : { text: tr('다른 모든 세션을 종료할까요?'), confirm: tr('종료'), danger: true })) return
    setBusy(true)
    try {
      await trackWrite(window.morse.revokeSignInSessions(accountUid, target?.id ?? null))
      setValue(state => state && { ...state, sessions: state.sessions.filter(session => session.current || (target !== null && session.id !== target.id)) })
      setReload(count => count + 1)
    } catch (reason) { controller.toast(errorText(reason, tr('세션을 종료하지 못했습니다.')), 'error') }
    finally { setBusy(false) }
  }
  const open = (session: SignInSession): void => { controller.showLayer(closeInfo => <SessionInfoBox session={session} close={closeInfo} terminate={() => { void terminate(session) }} />) }
  const chooseTtl = (): void => {
    if (!value) return
    controller.showLayer(closeTtl => <SessionTtlBox accountUid={accountUid} days={value.ttlDays} close={closeTtl} saved={days => setValue(state => state && { ...state, ttlDays: days })} />)
  }
  return <Box title={tr('활성 세션')} width={420} className="settings-list-box sessions-box" onClose={close}>
    {!value ? <div className="empty-state">{error || <Spinner size={22} />}</div> : <>
      <div className="section-label">{tr('이 기기')}</div>
      {current && <SessionRow session={current} onOpen={() => open(current)} />}
      {others.length > 0 ? <>
        <button type="button" className="list-button danger" disabled={busy} onClick={() => { void terminate(null) }}>
          <span className="list-button-icon"><Hand size={20} /></span><span className="list-button-text"><span>{tr('다른 모든 세션 종료')}</span></span>
        </button>
        <p className="settings-note">{tr('이 기기를 제외한 모든 기기에서 로그아웃합니다.')}</p>
        <div className="section-divider" />
        <div className="section-label">{tr('활성 세션')}</div>
        {others.map(session => <SessionRow key={session.id} session={session} onOpen={() => open(session)} onTerminate={busy ? undefined : () => { void terminate(session) }} />)}
        <div className="section-divider" />
        <div className="section-label">{tr('오래된 세션 자동 종료')}</div>
        <button type="button" className="list-button" onClick={chooseTtl}>
          <span className="list-button-text"><span>{tr('비활성 기간')}</span></span>
          <span className="list-button-value">{ttlLabel(value.ttlDays)}</span>
        </button>
      </> : <p className="settings-note">{tr('같은 계정으로 다른 휴대폰, 태블릿, 컴퓨터에서 로그인할 수 있어요. 모든 데이터가 곧바로 동기화돼요.')}</p>}
    </>}
  </Box>
}

export function showLastSeenBox(accountUid: string): void { controller.showLayer(close => <LastSeenBox accountUid={accountUid} close={close} />) }
export function showBlockedUsersBox(accountUid: string): void { controller.showLayer(close => <BlockedUsersBox accountUid={accountUid} close={close} />) }
export function showSessionsBox(accountUid: string): void { controller.showLayer(close => <SessionsBox accountUid={accountUid} close={close} />) }

// AuthService.updateBackupCode: the current code is required; the new one is shown once.
export async function changeBackupCode(accountUid: string): Promise<void> {
  // iOS BackupCodeViewerSheet.generateNewCode: a code kept on this device (an Apple sign-up) is used without typing it.
  if (await window.morse.hasStoredBackupCode(accountUid).catch(() => false)) {
    if (!await confirmBox({ title: tr('복구 코드 바꾸기'), text: tr('새 복구 코드를 만들면 이후에는 새 코드로 로그인해요.'), confirm: tr('새 코드 만들기') })) return
    try {
      const result = await trackWrite(window.morse.changeBackupCode(accountUid, null))
      controller.showLayer(close => <BackupCodeBox code={result.backupCode} notice={result.confirmed ? null : tr('변경 결과를 확인하지 못했어요. 이 새 코드와 이전 코드를 모두 보관해 두세요.')} close={close} />, { dismissible: false })
    } catch (reason) { controller.toast(errorText(reason, tr('복구 코드를 바꾸지 못했습니다. 다시 시도해 주세요.')), 'error') }
    return
  }
  showTextEditBox({ title: tr('복구 코드 바꾸기'), label: tr('현재 복구 코드'), initial: '', maxLength: 64, note: tr('새 복구 코드를 만들면 이후에는 새 코드로 로그인해요.'), save: async current => {
    const result = await window.morse.changeBackupCode(accountUid, current)
    controller.showLayer(close => <BackupCodeBox code={result.backupCode} notice={result.confirmed ? null : tr('변경 결과를 확인하지 못했어요. 이 새 코드와 이전 코드를 모두 보관해 두세요.')} close={close} />, { dismissible: false })
    return { outcome: 'saved', message: '' }
  } })
}

export async function deleteAccount(accountUid: string, userId: string, closeSettings: () => void): Promise<void> {
  if (!await confirmBox({ title: tr('회원 탈퇴'), text: tr('@{0} 계정의 모든 데이터가 서버에서 영구 삭제됩니다. 내가 만든 채널도 함께 삭제되며 되돌릴 수 없어요.', [userId]), confirm: tr('다음'), danger: true })) return
  if (!await confirmBox({ title: tr('이 계정을 영구 삭제할까요?'), text: tr('삭제하면 이 기기에서도 로그아웃됩니다.'), confirm: tr('영구 삭제'), danger: true })) return
  closeSettings()
  try { await trackWrite(window.morse.deleteAccount(accountUid)); controller.toast(tr('계정을 삭제했습니다.')) }
  catch (reason) { controller.toast(errorText(reason, tr('계정을 삭제하지 못했습니다.')), 'error') }
}
