import { useEffect, useState } from 'react'
import { controller } from '../app/ui'
import { errorText } from '../app/format'
import { loadCloseFriends, setCloseFriend, useCloseFriends } from '../app/close-friends'
import { Spinner } from '../ui/controls'
import { Box } from '../ui/layers'
import { PeerPicker } from './peer-picker'
import { tr } from '../../../shared/i18n'

function CloseFriendsBox({ accountUid, close }: { accountUid: string; close(): void }) {
  const members = useCloseFriends(accountUid)
  const [error, setError] = useState('')
  useEffect(() => { void loadCloseFriends(accountUid, true).catch(reason => setError(errorText(reason, tr('친한 친구 목록을 불러오지 못했습니다.')))) }, [accountUid])
  return <Box title={<>{tr('친한 친구')}{members && <small className="box-title-count">{tr('{0}명', [members.size])}</small>}</>} width={400} buttons={<button className="button flat" data-autofocus onClick={close}>{tr('완료')}</button>}>
    <p className="box-note">{tr('친한 친구 공개 범위로 올린 스토리를 볼 수 있는 사람입니다. 선택하면 바로 반영됩니다.')}</p>
    {error ? <p className="box-error" role="alert">{error}</p> : members === null ? <div className="empty-state"><Spinner size={22} /></div>
      : <PeerPicker accountUid={accountUid} selected={[...members]} chips={false} onToggle={uid => { void setCloseFriend(accountUid, uid, !members.has(uid)) }} />}
  </Box>
}

export function showCloseFriendsBox(accountUid: string): void {
  controller.showLayer(close => <CloseFriendsBox accountUid={accountUid} close={close} />)
}
