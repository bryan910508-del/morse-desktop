import { useEffect, useState } from 'react'
import { EyeOff, Megaphone } from 'lucide-react'
import { personalChannelPreview, type OwnedChannelList, type PersonalChannelCard } from '../../../shared/personal-channel'
import { subscriberCountFull } from '../../../shared/channel-subscriber-count'
import { desktop, useDesktop } from '../app/store'
import { controller } from '../app/ui'
import { dialogTime } from '../app/format'
import { retainChannels } from '../app/channel-visibility'
import { waitFor } from '../app/contacts'
import { openChannelOrPreview } from '../channels/channel-discovery-box'
import { AvatarScope, PeerAvatar } from '../ui/avatar'
import { Box } from '../ui/layers'
import { tr } from '../../../shared/i18n'

// The channel a person linked to their profile, read for as long as the profile showing it is on screen (tdesktop's
// DetailsFiller::makePersonalChannel follows Info::Profile::PersonalChannelValue). Nothing is shown until it has been
// read, nor when the channel is gone or no longer the person's.
export function usePersonalChannelCard(accountUid: string, profileUid: string | null, channelId: string | null): PersonalChannelCard | null {
  const [requestId, setRequestId] = useState<string | null>(null)
  useEffect(() => {
    if (!profileUid || !channelId) return
    const id = crypto.randomUUID()
    setRequestId(id)
    void window.morse.openPersonalChannel(accountUid, { requestId: id, profileUid, channelId }).catch(() => {})
    return () => { void window.morse.closePersonalChannel(accountUid, id).catch(() => {}) }
  }, [accountUid, profileUid, channelId])
  return useDesktop(state => state?.personalChannels?.cards.find(card => card.requestId === requestId && card.profileUid === profileUid &&
    card.channelId === channelId && card.status === 'ready' && card.channel !== null) ?? null)
}

// The chooser's list of this account's channels, read while the page offering it is on screen (iOS reads it when
// Edit Profile appears; tdesktop's PersonalChannelController asks for it each time its box opens).
export function useOwnedChannels(accountUid: string): OwnedChannelList | null {
  const [requestId] = useState(() => crypto.randomUUID())
  useEffect(() => {
    void window.morse.openOwnedChannels(accountUid, requestId).catch(() => {})
    return () => { void window.morse.closeOwnedChannels(accountUid, requestId).catch(() => {}) }
  }, [accountUid, requestId])
  return useDesktop(state => { const owned = state?.personalChannels?.owned; return owned?.requestId === requestId ? owned : null })
}

// A linked channel opens the way its plain share link opens here. One of this account's own channels, or one it
// subscribes to, opens as the channel screen, which asks for everything it shows itself; any other opens in the link's
// preview (ChannelDiscoveryBox), where it can be joined — a closed one by request. The channel screen shows only
// channels of the account's list, so the list is read first to tell the two apart.
export async function openPersonalChannel(accountUid: string, channelId: string): Promise<void> {
  const release = retainChannels(accountUid)
  let listed = false
  try {
    listed = await waitFor(() => {
      const channels = desktop.value?.channels
      if (channels?.status === 'error') return false
      return channels?.status === 'ready' ? channels.items.some(item => item.id === channelId && (item.owned || item.subscriptionListed)) : null
    }, 10000)
  } catch { /* A list that cannot be read leaves the link's own way. */ }
  finally { release() }
  openChannelOrPreview(accountUid, channelId, listed)
}

// A profile's «채널» section. tdesktop's DetailsFiller::makePersonalChannel draws the channel's userpic, its name with
// the newest post's date on the right and that post below, over «Channel · N subscribers»; iOS
// (ProfileView.personalChannelSection) puts «채널» and «구독자 N명» on top, then the channel's picture, name and newest
// post time, then up to two lines of the post — its text, else «사진» or «동영상». Pressing it opens the channel.
export function PersonalChannelSection({ accountUid, card, onOpen }: { accountUid: string; card: PersonalChannelCard; onOpen(): void }) {
  const channel = card.channel
  if (!channel) return null
  const preview = card.post ? personalChannelPreview(card.post) : ''
  return <AvatarScope accountUid={accountUid} enabled surface="channels">
    <button type="button" className="personal-channel" onClick={onOpen}>
      <span className="personal-channel-head">
        <Megaphone size={14} /><span className="personal-channel-label">{tr('채널')}</span><span>{subscriberCountFull(channel.subscriberCount)}</span>
      </span>
      <span className="personal-channel-row">
        <PeerAvatar id={channel.id} name={channel.name} image={channel.avatar} size={42} kind="channel" surface="channels" />
        <span className="personal-channel-text">
          <span className="personal-channel-line">
            <strong className="ellipsis">{channel.name}</strong>
            {card.post && <time dateTime={new Date(card.post.time).toISOString()}>{dialogTime(card.post.time)}</time>}
          </span>
          {preview && <span className="personal-channel-preview">{preview}</span>}
        </span>
      </span>
    </button>
  </AvatarScope>
}

// The personal channel chooser. tdesktop's ShowEditPersonalChannel box lists the account's channels with their
// subscribers and offers «Remove» while one is set; iOS (MorsePersonalChannelPickerView) titles it «채널» over «내 채널을
// 고르세요», puts «채널 숨기기» first while a channel is linked, then the account's channels — «구독자 N명», or «채널» with
// nobody yet. No row is marked as chosen; choosing one closes the box.
function PersonalChannelBox({ accountUid, ownedRequestId, linkedId, close, pick }: {
  accountUid: string; ownedRequestId: string; linkedId: string | null; close(): void; pick(channelId: string | null): void
}) {
  const owned = useDesktop(state => { const value = state?.personalChannels?.owned; return value?.requestId === ownedRequestId ? value : null })
  const channels = owned?.status === 'ready' ? owned.channels : []
  const choose = (channelId: string | null): void => { close(); pick(channelId) }
  return <Box title={<span className="box-title-stack"><span>{tr('채널')}</span><small>{tr('내 채널을 고르세요')}</small></span>} width={380} onClose={close}>
    <AvatarScope accountUid={accountUid} enabled surface="channels"><div className="peer-list">
      {linkedId && <button type="button" className="peer-row personal-channel-hide" onClick={() => choose(null)}>
        <span className="personal-channel-hide-icon"><EyeOff size={20} /></span>
        <span className="peer-row-text"><strong>{tr('채널 숨기기')}</strong></span>
      </button>}
      {channels.map(channel => <button key={channel.id} type="button" className="peer-row" onClick={() => choose(channel.id)}>
        <PeerAvatar id={channel.id} name={channel.name} image={channel.avatar} size={40} kind="channel" surface="channels" />
        <span className="peer-row-text">
          <strong className="ellipsis">{channel.name}</strong>
          <small className="ellipsis">{channel.subscriberCount > 0 ? subscriberCountFull(channel.subscriberCount) : tr('채널', [], 'status')}</small>
        </span>
      </button>)}
    </div></AvatarScope>
  </Box>
}

export function showPersonalChannelBox(options: Omit<Parameters<typeof PersonalChannelBox>[0], 'close'>): void {
  controller.showLayer(close => <PersonalChannelBox {...options} close={close} />)
}
