import { useEffect, useState, type ReactNode } from 'react'
import { Check, Shield, ShieldOff, SlidersHorizontal, X } from 'lucide-react'
import type { ChannelSummary } from '../../../shared/channels'
import { channelAdminPermissionLabels, type ChannelAdminPermissionKey, type ChannelAdminRow } from '../../../shared/channel-admins'
import { emptyChannelAdminPermissions, type ChannelAdminPermissionValues } from '../../../shared/channel-admin-appointment'
import type { MessagePosition } from '../../../shared/model'
import { desktop, useDesktop } from '../app/store'
import type { ContactSummary } from '../../../shared/contacts'
import { controller } from '../app/ui'
import { errorText, positionTime, serviceDate } from '../app/format'
import { trackWrite } from '../app/drafts'
import { runJournal } from '../app/channel-publish'
import { Spinner, Switch } from '../ui/controls'
import { Box, confirmBox } from '../ui/layers'
import { popupMenu, pointFor } from '../ui/popup-menu'
import { UserAvatar } from '../ui/user-avatar'
import type { GroupPhotoImage } from '../../../shared/group-photo'
import { locale, tr } from '../../../shared/i18n'

export type ChannelMembersKind = 'subscribers' | 'admins' | 'requests'
const titles: Record<ChannelMembersKind, string> = { subscribers: tr('구독자'), admins: tr('관리자'), requests: tr('가입 요청') }
const permissionKeys = Object.keys(channelAdminPermissionLabels) as ChannelAdminPermissionKey[]
type Result = { outcome: 'saved' | 'rejected' | 'uncertain'; message: string }

interface MemberRow { uid: string; name: string; detail: string; photo?: GroupPhotoImage | null; trailing?: ReactNode; onClick?(point: { x: number; y: number }): void }

function since(position: MessagePosition | null, label: string): string {
  const time = positionTime(position)
  return time === null ? '' : `${serviceDate(time)} ${label}`
}

function adminDetail(row: ChannelAdminRow): string {
  const granted = permissionKeys.filter(key => row.permissions[key].value === true).length
  return [since(row.appointed, tr('지정')), tr('권한 {0}개', [granted])].filter(Boolean).join(' · ')
}

// Channel editors keep one selected edit: open → save → close (ChannelNameEditor pattern).
async function runEdit<T extends { requestId: string }>(request: T, open: (value: T) => Promise<void>, save: (value: T) => Promise<Result>, close: (requestId: string) => Promise<void>): Promise<Result> {
  await open(request)
  try { return await trackWrite(save(request)) }
  finally { void close(request.requestId).catch(() => {}) }
}

function report(result: Result, success: string): void {
  if (result.outcome === 'saved') controller.toast(success)
  else controller.toast(result.message, result.outcome === 'rejected' ? 'error' : 'default')
}

function PermissionsBox({ title, label, initial, submitLabel, close, submit }: {
  title: string; label: string; initial: ChannelAdminPermissionValues; submitLabel: string; close(): void; submit(values: ChannelAdminPermissionValues): Promise<void>
}) {
  const [values, setValues] = useState(initial), [busy, setBusy] = useState(false), [error, setError] = useState('')
  const changed = permissionKeys.some(key => values[key] !== initial[key])
  async function save(): Promise<void> {
    if (busy) return
    setBusy(true); setError('')
    try { await submit(values); close() }
    catch (reason) { setError(errorText(reason, tr('관리자 권한을 저장하지 못했습니다.'))); setBusy(false) }
  }
  return <Box title={title} width={400} buttons={<>
    <button className="button flat" disabled={busy} onClick={close}>{tr('취소')}</button>
    <button className="button flat" disabled={busy || (submitLabel !== tr('지정') && !changed)} onClick={() => { void save() }}>{busy && <Spinner size={14} />}{submitLabel}</button>
  </>}>
    <p className="box-note">{tr('{0}에게 줄 권한을 고르세요.', [label])}</p>
    <div className="admin-permissions">
      {permissionKeys.map(key => <label key={key} className="settings-toggle">
        <span className="settings-toggle-text"><span>{channelAdminPermissionLabels[key]}</span></span>
        <Switch label={channelAdminPermissionLabels[key]} checked={values[key]} disabled={busy} onChange={value => setValues(current => ({ ...current, [key]: value }))} />
      </label>)}
    </div>
    {error && <p className="box-error" role="alert">{error}</p>}
  </Box>
}

const noContacts: ContactSummary[] = []

function MemberList({ status, message, rows, empty }: { status: string; message: string; rows: MemberRow[]; empty: string }) {
  if (status === 'loading') return <div className="empty-state"><Spinner size={22} /></div>
  if (status !== 'ready') return <div className="empty-state">{message || tr('목록을 불러오지 못했습니다.')}</div>
  if (!rows.length) return <div className="empty-state">{empty}</div>
  return <div className="peer-list tall">{rows.map(row => {
    const content = <>
      <UserAvatar uid={row.uid} name={row.name} size={42} image={row.photo} />
      <span className="peer-row-text"><strong className="ellipsis">{row.name}</strong>{row.detail && <small className="ellipsis">{row.detail}</small>}</span>
      {row.trailing}
    </>
    return row.onClick ? <button key={row.uid} type="button" className="peer-row" onClick={event => row.onClick!(pointFor(event, event.currentTarget))}>{content}</button>
      : <div key={row.uid} className="peer-row">{content}</div>
  })}</div>
}

function ChannelMembersBox({ accountUid, channel, kind, close }: { accountUid: string; channel: ChannelSummary; kind: ChannelMembersKind; close(): void }) {
  const [requestId] = useState(() => crypto.randomUUID())
  const [adminsRequestId] = useState(() => crypto.randomUUID())
  const [deciding, setDeciding] = useState<string | null>(null)
  const version = channel.version
  const owner = channel.owned && Boolean(version)
  const listAdmins = kind === 'admins' || (kind === 'subscribers' && owner)
  const openAdmins = (): Promise<void> => window.morse.openChannelAdmins(accountUid, { requestId: kind === 'admins' ? requestId : adminsRequestId, channelId: channel.id })
  useEffect(() => {
    const selection = { requestId, channelId: channel.id }
    const open = kind === 'subscribers' ? window.morse.openChannelSubscribers(accountUid, selection)
      : kind === 'admins' ? window.morse.openChannelAdmins(accountUid, selection) : window.morse.openChannelJoinRequests(accountUid, selection)
    void open.catch(reason => controller.toast(errorText(reason, tr('목록을 불러오지 못했습니다.')), 'error'))
    if (kind === 'subscribers' && listAdmins) void openAdmins().catch(() => {})
    return () => {
      const closing = kind === 'subscribers' ? window.morse.closeChannelSubscribers(accountUid, requestId)
        : kind === 'admins' ? window.morse.closeChannelAdmins(accountUid, requestId) : window.morse.closeChannelJoinRequests(accountUid, requestId)
      void closing.catch(() => {})
      if (kind === 'subscribers' && listAdmins) void window.morse.closeChannelAdmins(accountUid, adminsRequestId).catch(() => {})
    }
  }, [accountUid, channel.id, kind, requestId])
  const subscribers = useDesktop(state => { const value = state?.channels?.subscribers; return kind === 'subscribers' && value?.requestId === requestId ? value : null })
  const admins = useDesktop(state => { const value = state?.channels?.admins; const id = kind === 'admins' ? requestId : adminsRequestId; return listAdmins && value?.requestId === id ? value : null })
  const requests = useDesktop(state => { const value = state?.channels?.joinRequests; return kind === 'requests' && value?.requestId === requestId ? value : null })
  const contacts = useDesktop(state => state?.contacts?.items ?? noContacts)

  async function decide(userId: string, requestVersion: string, approved: boolean): Promise<void> {
    if (!version || deciding) return
    setDeciding(userId)
    try {
      const result = await runJournal({
        current: () => desktop.value?.channelJoinDecisions ?? null,
        refresh: () => window.morse.refreshChannelJoinDecisions(accountUid),
        action: action => window.morse.channelJoinDecisionAction(accountUid, action),
        prepare: id => window.morse.prepareChannelJoinDecision(accountUid, { id, channelId: channel.id, version, title: channel.name, userId, requestVersion, approved })
      }, {
        waiting: tr('이전 가입 처리 결과를 확인하고 있습니다. 잠시 후 다시 시도해 주세요.'),
        denied: tr('가입 요청 정보가 바뀌었습니다. 목록을 다시 열어 주세요.'),
        rejected: tr('가입 요청을 처리하지 못했습니다.')
      })
      controller.toast(result === 'unconfirmed' ? tr('가입 처리 결과를 확인하고 있습니다.') : approved ? tr('가입 요청을 승인했습니다.') : tr('가입 요청을 거절했습니다.'))
    } catch (reason) { controller.toast(errorText(reason, tr('가입 요청을 처리하지 못했습니다.')), 'error') }
    finally { setDeciding(null) }
  }

  const appoint = (uid: string, name: string, subscriberVersion: string): void => {
    if (!version || !admins) return
    const adminsList = admins.requestId
    controller.showLayer(closeBox => <PermissionsBox title={tr('관리자 지정')} label={name} initial={emptyChannelAdminPermissions()} submitLabel={tr('지정')} close={closeBox} submit={async permissions => {
      const request = { id: crypto.randomUUID(), requestId: crypto.randomUUID(), subscribersRequestId: requestId, adminsRequestId: adminsList, channelId: channel.id, version, title: channel.name, userId: uid, subscriberVersion, label: name, permissions }
      const result = await runEdit(request, value => window.morse.openChannelAdminAppointment(accountUid, value), value => window.morse.appointChannelAdmin(accountUid, value), id => window.morse.closeChannelAdminAppointment(accountUid, id))
      if (result.outcome === 'rejected') throw new Error(result.message)
      report(result, tr('{0}님을 관리자로 지정했습니다.', [name]))
      void openAdmins().catch(() => {})
    }} />)
  }
  const editAdmin = (row: ChannelAdminRow, point: { x: number; y: number }): void => {
    const adminVersion = row.version
    if (!owner || !version || !adminVersion || !admins) return
    const name = row.name || tr('관리자'), listRequestId = admins.requestId
    const base = { listRequestId, channelId: channel.id, version, title: channel.name, userId: row.uid, adminVersion, label: name }
    const current = Object.fromEntries(permissionKeys.map(key => [key, row.permissions[key].value === true])) as ChannelAdminPermissionValues
    popupMenu.open(point, [
      { label: tr('권한 변경'), icon: <SlidersHorizontal size={18} />, onSelect: () => controller.showLayer(closeBox => <PermissionsBox title={tr('관리자 권한')} label={name} initial={current} submitLabel={tr('저장')} close={closeBox} submit={async values => {
        const changes = Object.fromEntries(permissionKeys.filter(key => values[key] !== current[key] || row.permissions[key].value === null).map(key => [key, values[key]]))
        const request = { ...base, id: crypto.randomUUID(), requestId: crypto.randomUUID(), changes }
        const result = await runEdit(request, value => window.morse.openChannelAdminPermissions(accountUid, value), value => window.morse.saveChannelAdminPermissions(accountUid, value), id => window.morse.closeChannelAdminPermissions(accountUid, id))
        if (result.outcome === 'rejected') throw new Error(result.message)
        report(result, tr('관리자 권한을 바꿨습니다.'))
        void openAdmins().catch(() => {})
      }} />) },
      { label: tr('관리자 해제'), icon: <ShieldOff size={18} />, danger: true, onSelect: () => {
        void confirmBox({ title: tr('관리자 해제'), text: tr('{0}님의 관리자 권한을 모두 해제할까요?', [name]), confirm: tr('해제', [], 'admin'), danger: true }).then(async ok => {
          if (!ok) return
          try {
            const request = { ...base, id: crypto.randomUUID(), requestId: crypto.randomUUID() }
            report(await runEdit(request, value => window.morse.openChannelAdminRemoval(accountUid, value), value => window.morse.removeChannelAdmin(accountUid, value), id => window.morse.closeChannelAdminRemoval(accountUid, id)), tr('{0}님을 관리자에서 해제했습니다.', [name]))
            void openAdmins().catch(() => {})
          } catch (reason) { controller.toast(errorText(reason, tr('관리자를 해제하지 못했습니다.')), 'error') }
        })
      } }
    ])
  }

  const loading = { status: 'loading', message: '', rows: [] as MemberRow[] }
  const adminIds = admins?.status === 'ready' && admins.indexOrigin !== 'unknown' ? new Set(admins.rows.map(row => row.uid)) : null
  const list = kind === 'subscribers' ? subscribers ? { status: subscribers.status, message: subscribers.message, rows: subscribers.rows.map((row): MemberRow => {
    const name = row.name || tr('이름 없음'), canAppoint = owner && Boolean(row.version && row.name) && adminIds !== null && !adminIds.has(row.uid)
    return { uid: row.uid, name, photo: row.photo, detail: [adminIds?.has(row.uid) ? tr('관리자') : '', row.handle ? `@${row.handle}` : '', since(row.subscribed, tr('구독'))].filter(Boolean).join(' · '),
      trailing: canAppoint ? <button type="button" className="icon-button small" aria-label={tr('{0}님을 관리자로 지정', [name])} onClick={() => appoint(row.uid, row.name!, row.version!)}><Shield size={18} /></button> : undefined }
  }) } : loading
    : kind === 'admins' ? admins ? { status: admins.status, message: admins.message, rows: admins.rows.map((row): MemberRow => ({ uid: row.uid, name: row.name || tr('이름 없음'), photo: row.photo, detail: adminDetail(row),
      onClick: owner && row.version ? point => editAdmin(row, point) : undefined })) } : loading
      // The request carries a copy of the requester's profile, because a channel's owner may not read their users
      // document; a request made before the server wrote copies falls back to this account's contacts, and a uid is
      // never shown as a name.
      : requests ? { status: requests.status, message: requests.message, rows: requests.rows.map((row): MemberRow => ({ uid: row.uid,
        name: row.name || contacts.find(item => item.uid === row.uid)?.displayName || tr('알 수 없음'), photo: row.photo,
        detail: [row.handle ? `@${row.handle}` : '', since(row.requested, tr('요청'))].filter(Boolean).join(' · '),
        trailing: <span className="channel-request-actions">
          {deciding === row.uid ? <Spinner size={18} /> : <>
            <button className="icon-button small" aria-label={tr('거절')} disabled={!row.version || Boolean(deciding)} onClick={() => { void decide(row.uid, row.version!, false) }}><X size={18} /></button>
            <button className="icon-button small accent" aria-label={tr('승인')} disabled={!row.version || Boolean(deciding)} onClick={() => { void decide(row.uid, row.version!, true) }}><Check size={18} /></button>
          </>}
        </span> })) } : loading
  const count = list.status === 'ready' ? list.rows.length : null
  return <Box title={<>{titles[kind]}{count !== null && <small className="box-title-count">{count.toLocaleString(locale())}</small>}</>} width={400} onClose={close}>
    {kind === 'admins' && owner && <p className="box-note">{tr('관리자를 눌러 권한을 바꾸거나 해제할 수 있습니다. 새 관리자는 구독자 목록에서 지정합니다.')}</p>}
    <MemberList status={list.status} message={list.message} rows={list.rows} empty={kind === 'subscribers' ? tr('아직 구독자가 없습니다.') : kind === 'admins' ? tr('지정된 관리자가 없습니다.') : tr('대기 중인 가입 요청이 없습니다.')} />
  </Box>
}

export function showChannelMembersBox(accountUid: string, channel: ChannelSummary, kind: ChannelMembersKind): void {
  controller.showLayer(close => <ChannelMembersBox accountUid={accountUid} channel={channel} kind={kind} close={close} />)
}
