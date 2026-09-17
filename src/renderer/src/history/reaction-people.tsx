import { controller } from '../app/ui'
import { Box } from '../ui/layers'
import { UserAvatar } from '../ui/user-avatar'
import { tr } from '../../../shared/i18n'

// iOS MorseReactionParticipantsView ("❤️ · N"): who chose this reaction, opened from its chip's menu.
export function showReactionPeople(emoji: string, count: number, users: { uid: string; name: string }[]): void {
  controller.showLayer(close => <Box title={`${emoji} · ${count}`} width={340} onClose={close} buttons={<button className="button flat" onClick={close}>{tr('닫기')}</button>}>
    <div className="reaction-people">
      {users.map(user => <div key={user.uid} className="reaction-people-row">
        <UserAvatar uid={user.uid} name={user.name} size={36} /><span className="ellipsis">{user.name}</span><span className="reaction-people-emoji">{emoji}</span>
      </div>)}
      {count > users.length && <p className="box-note">{tr('외 {0}명', [count - users.length])}</p>}
    </div>
  </Box>)
}
