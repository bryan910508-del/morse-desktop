import { useEffect, useState } from 'react'
import { KeyRound } from 'lucide-react'
import { lastSeenModes, type BlockedUser, type LastSeenMode, type LastSeenPrivacy, type SignInSession } from '../../../shared/account-tools'
import { controller } from '../app/ui'
import { errorText, fullTime } from '../app/format'
import { trackWrite } from '../app/drafts'
import { loadBlockedUsers, setBlocked, useBlockedUsers } from '../app/blocked-users'
import { BackupCodeBox } from '../boxes/backup-code-box'
import { showTextEditBox } from '../boxes/text-edit-box'
import { Spinner } from '../ui/controls'
import { Box, confirmBox } from '../ui/layers'
import { UserAvatar } from '../ui/user-avatar'
import { tr } from '../../../shared/i18n'

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

// ActiveSessionsView: users/{uid}/signInSessions, with sign-out requests for other devices.
function SessionsBox({ accountUid, close }: { accountUid: string; close(): void }) {
  const [rows, setRows] = useState<SignInSession[] | null>(null), [error, setError] = useState('')
  const [busy, setBusy] = useState(false), [reload, setReload] = useState(0)
  useEffect(() => {
    let alive = true
    setError('')
    void window.morse.signInSessions(accountUid).then(next => { if (alive) setRows(next) })
      .catch(reason => { if (alive) setError(errorText(reason, tr('기기 목록을 불러오지 못했습니다.'))) })
    return () => { alive = false }
  }, [accountUid, reload])
  const others = rows?.filter(row => !row.current && !row.revokeRequested) ?? []
  async function revoke(target: SignInSession | null): Promise<void> {
    if (busy) return
    if (!await confirmBox(target ? { title: tr('기기 로그아웃'), text: tr('{0}에서 로그아웃할까요?', [target.deviceLabel]), confirm: tr('로그아웃'), danger: true }
      : { title: tr('다른 기기 모두 로그아웃'), text: tr('이 기기를 제외한 {0}대에서 로그아웃할까요?', [others.length]), confirm: tr('모두 로그아웃'), danger: true })) return
    setBusy(true)
    try { await trackWrite(window.morse.revokeSignInSessions(accountUid, target?.id ?? null)); controller.toast(tr('로그아웃을 요청했습니다.')); setReload(value => value + 1) }
    catch (reason) { controller.toast(errorText(reason, tr('로그아웃을 요청하지 못했습니다.')), 'error') }
    finally { setBusy(false) }
  }
  return <Box title={tr('로그인한 기기')} width={420} onClose={close} buttons={others.length > 0 ? <button className="button flat danger" disabled={busy} onClick={() => { void revoke(null) }}>{tr('다른 기기 모두 로그아웃')}</button> : undefined}>
    {!rows ? <div className="empty-state">{error || <Spinner size={22} />}</div>
      : <div className="peer-list tall">{rows.map(row => <div key={row.id} className="peer-row">
        <span className="session-icon"><KeyRound size={20} /></span>
        <span className="peer-row-text"><strong className="ellipsis">{row.deviceLabel}{row.current ? tr(' · 이 기기') : ''}</strong>
          <small>{row.revokeRequested ? tr('로그아웃 요청됨') : row.lastSeenAt ? tr('최근 활동 {0}', [fullTime(row.lastSeenAt)]) : tr('최근 활동 정보 없음')}</small></span>
        {!row.current && !row.revokeRequested && <button className="button flat" disabled={busy} onClick={() => { void revoke(row) }}>{tr('로그아웃')}</button>}
      </div>)}</div>}
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
