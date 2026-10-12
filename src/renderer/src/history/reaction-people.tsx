import { controller } from '../app/ui'
import { Box } from '../ui/layers'
import { UserAvatar } from '../ui/user-avatar'
import { tr } from '../../../shared/i18n'

// iOS MorseReactionParticipantsView ("❤️ · N"): who chose this reaction, opened from its chip's menu. B266: each one
// opens as a person (tdesktop's reactions list → showPeerInfo) — not this account, and not in a channel's discussion room
// (`people: false`), whose people are the room's own copies only.
export function showReactionPeople(emoji: string, count: number, users: { uid: string; name: string }[], self: string, people = true): void {
  controller.showLayer(close => <Box title={`${emoji} · ${count}`} width={340} onClose={close} buttons={<button className="button flat" onClick={close}>{tr('닫기')}</button>}>
    <div className="reaction-people">
      {users.map(user => {
        const row = <><UserAvatar uid={user.uid} name={user.name} size={36} /><span className="ellipsis">{user.name}</span><span className="reaction-people-emoji">{emoji}</span></>
        return people && user.uid !== self ? <button key={user.uid} type="button" className="reaction-people-row" onClick={() => { close(); controller.openPersonInfo(user.uid, user.name) }}>{row}</button>
          : <div key={user.uid} className="reaction-people-row">{row}</div>
      })}
      {count > users.length && <p className="box-note">{tr('외 {0}명', [count - users.length])}</p>}
    </div>
  </Box>)
}
