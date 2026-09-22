import { useEffect, useState } from 'react'
import { Camera, Copy, FileText, Hash, Image as ImageIcon, Link, LogOut, MessageCircle, Pencil, Shield, SlidersHorizontal, Trash2, User, UserPlus, Users, X, Inbox, MessageSquare, Flag } from 'lucide-react'
import type { RightPanel } from '../app/ui'
import { channelIntroductionLimit } from '../../../shared/channel-introduction'
import { channelShareURL } from '../../../shared/channel-share'
import { normalizeChannelTag } from '../../../shared/channel-tags'
import { desktop, useDesktop } from '../app/store'
import { controller } from '../app/ui'
import { errorText } from '../app/format'
import { trackWrite } from '../app/drafts'
import { waitFor } from '../app/contacts'
import { runJournal } from '../app/channel-publish'
import { changeChannelPhoto } from '../app/photos'
import { showTextEditBox } from '../boxes/text-edit-box'
import { ActionRow, InfoRow } from '../info/info-panel'
import { showReportBox } from '../boxes/report-box'
import { Avatar } from '../ui/avatar'
import { showPhotoViewer } from '../ui/photo-viewer'
import { Spinner } from '../ui/controls'
import { confirmBox } from '../ui/layers'
import { showChannelAccessBox } from './channel-access-box'
import { ChannelCommentsPanel } from './channel-comments-panel'
import { showChannelMembersBox } from './channel-members-box'
import { channelSubtitle } from './channel-section'
import { openInquiries, useCommentsPost, useInquiryTarget } from './channel-ui'
import { ChannelInquiryPanel } from './channel-inquiry-panel'
import { leaveDiscussionRoom } from './discussion-leave'
import { locale, tr } from '../../../shared/i18n'

function ChannelInfoPanel({ accountUid, channelId }: { accountUid: string; channelId: string }) {
  const channel = useDesktop(state => state?.channels?.items.find(item => item.id === channelId) ?? null)
  const discussionId = channel?.discussion?.status === 'known' ? channel.discussion.chatId : null
  const discussionListed = useDesktop(state => discussionId ? Boolean(state?.dialogs.some(dialog => dialog.id === discussionId)) : false)
  const [shareRequestId] = useState(() => crypto.randomUUID())
  const [photoBusy, setPhotoBusy] = useState<'avatar' | 'cover' | null>(null)
  const [leaving, setLeaving] = useState(false), [joining, setJoining] = useState(false), [departing, setDeparting] = useState(false)
  const [inquiring, setInquiring] = useState(false)
  const ready = channel?.status === 'ready' ? channel : null
  const version = ready?.version ?? null
  const editable = Boolean(ready?.owned && version)
  let link: string | null = null
  if (ready?.publicSharing) { try { link = channelShareURL(channelId) } catch { link = null } }
  // The cover is loaded only while the info column shows it.
  const [coverRequestId] = useState(() => crypto.randomUUID())
  const hasCover = Boolean(ready?.hasCover)
  useEffect(() => {
    if (!hasCover) return
    void window.morse.showChannelCover(accountUid, { requestId: coverRequestId, channelId }).catch(() => {})
    return () => { void window.morse.hideChannelCover(accountUid, coverRequestId).catch(() => {}) }
  }, [accountUid, channelId, coverRequestId, hasCover])
  const coverUrl = ready?.cover?.status === 'ready' ? ready.cover.url : null

  const editName = (): void => {
    if (!ready || !version) return
    showTextEditBox({ title: tr('채널 이름'), label: tr('이름'), initial: ready.name, maxLength: 50, save: async name => {
      const request = { id: crypto.randomUUID(), requestId: crypto.randomUUID(), channelId, version, name: ready.name }
      await window.morse.openChannelName(accountUid, request)
      try { return await window.morse.saveChannelName(accountUid, { ...request, name }) }
      finally { void window.morse.closeChannelName(accountUid, request.requestId).catch(() => {}) }
    } })
  }
  const editIntroduction = (): void => {
    if (!ready || !version) return
    showTextEditBox({ title: tr('채널 소개'), label: tr('소개'), initial: ready.description, maxLength: channelIntroductionLimit, multiline: true, save: async text => {
      const request = { id: crypto.randomUUID(), requestId: crypto.randomUUID(), channelId, version, text: ready.description }
      await window.morse.openChannelIntroduction(accountUid, request)
      try { return await window.morse.saveChannelIntroduction(accountUid, { ...request, text }) }
      finally { void window.morse.closeChannelIntroduction(accountUid, request.requestId).catch(() => {}) }
    } })
  }
  const editTags = (): void => {
    if (!ready || !version || ready.tags === null) return
    const current = ready.tags
    showTextEditBox({ title: tr('채널 태그'), label: tr('태그'), initial: current.map(tag => `#${tag}`).join(' '), maxLength: 512, allowEmpty: true,
      note: tr('공백으로 구분해 입력합니다. 태그로 공개 채널을 찾을 수 있습니다.'), save: async value => {
        const tags = [...new Set(value.split(/[\s,]+/).map(part => part.trim()).filter(Boolean).map(normalizeChannelTag))]
        const request = { id: crypto.randomUUID(), requestId: crypto.randomUUID(), channelId, version, tags: [...current] }
        await window.morse.openChannelTags(accountUid, request)
        try { return await window.morse.saveChannelTags(accountUid, { ...request, tags }) }
        finally { void window.morse.closeChannelTags(accountUid, request.requestId).catch(() => {}) }
      } })
  }
  const changePhoto = async (kind: 'avatar' | 'cover'): Promise<void> => {
    if (!ready || !version || photoBusy) return
    setPhotoBusy(kind)
    try { await changeChannelPhoto(accountUid, { kind, channelId, version, title: ready.name }) }
    catch (reason) { controller.toast(errorText(reason, kind === 'cover' ? tr('커버를 바꾸지 못했습니다.') : tr('채널 사진을 바꾸지 못했습니다.')), 'error') }
    finally { setPhotoBusy(null) }
  }
  const clearPhoto = async (kind: 'avatar' | 'cover'): Promise<void> => {
    if (!version) return
    const label = kind === 'cover' ? tr('커버') : tr('채널 사진')
    if (!await confirmBox({ title: tr('{0} 삭제', [label]), text: tr('모든 구독자에게서 {0}을 삭제합니다.', [label]), confirm: tr('삭제'), danger: true })) return
    const request = { id: crypto.randomUUID(), requestId: crypto.randomUUID(), channelId, version, kind }
    try {
      await window.morse.openChannelPhotoClear(accountUid, request)
      const result = await trackWrite(window.morse.clearChannelPhoto(accountUid, request))
      if (result.outcome !== 'saved') controller.toast(result.message, result.outcome === 'rejected' ? 'error' : 'default')
    } catch (reason) { controller.toast(errorText(reason, tr('{0}을 삭제하지 못했습니다.', [label])), 'error') }
    finally { void window.morse.closeChannelPhotoClear(accountUid, request.requestId).catch(() => {}) }
  }
  const copyLink = (): void => {
    if (!ready?.publicSharing) return
    void window.morse.copyListedChannelLink(accountUid, { requestId: shareRequestId, channelId, channelVersion: ready.publicSharing.version })
      .then(() => controller.toast(tr('채널 링크를 복사했습니다.'))).catch(reason => controller.toast(errorText(reason, tr('링크를 복사하지 못했습니다.')), 'error'))
  }
  const copyShareText = (): void => {
    if (!ready?.publicSharing) return
    void window.morse.copyListedChannelShareText(accountUid, { requestId: shareRequestId, channelId, channelVersion: ready.publicSharing.version })
      .then(() => controller.toast(tr('공유 문구를 복사했습니다.'))).catch(reason => controller.toast(errorText(reason, tr('공유 문구를 복사하지 못했습니다.')), 'error'))
  }
  const openDiscussion = async (): Promise<void> => {
    if (!version || !discussionId) return
    try { controller.openChat((await window.morse.resolveChannelDiscussion(accountUid, { channelId, version, chatId: discussionId })).chatId) }
    catch (reason) { controller.toast(errorText(reason, tr('토론방을 열지 못했습니다.')), 'error') }
  }
  // ChannelDiscussionJoin journal; the discussion appears in the dialog list once joined.
  const joinDiscussion = async (): Promise<void> => {
    if (!ready || !version || !discussionId || joining) return
    setJoining(true)
    try {
      const result = await runJournal({
        current: () => desktop.value?.discussionJoin ?? null,
        refresh: () => window.morse.refreshDiscussionJoin(accountUid),
        action: action => window.morse.discussionJoinAction(accountUid, action),
        prepare: id => window.morse.prepareDiscussionJoin(accountUid, { id, channelId, chatId: discussionId, version, title: ready.name })
      }, {
        waiting: tr('이전 토론방 참여 결과를 확인하고 있습니다. 잠시 후 다시 시도해 주세요.'),
        denied: tr('지금은 이 토론방에 참여할 수 없습니다.'),
        rejected: tr('토론방에 참여하지 못했습니다.')
      })
      if (result !== 'done') { controller.toast(tr('참여 결과를 확인하고 있습니다. 잠시 후 대화 목록을 확인해 주세요.')); return }
      controller.toast(tr('토론방에 참여했습니다.'))
      await waitFor(() => desktop.value?.dialogs.some(dialog => dialog.id === discussionId) ? true : null, 15000).then(() => openDiscussion()).catch(() => {})
    } catch (reason) { controller.toast(errorText(reason, tr('토론방에 참여하지 못했습니다.')), 'error') }
    finally { setJoining(false) }
  }
  // Leaves only the discussion group; the channel subscription and ownership stay.
  const leaveDiscussion = async (): Promise<void> => {
    if (!ready || !version || !discussionId || departing) return
    setDeparting(true)
    try { await leaveDiscussionRoom(accountUid, { channelId, version, chatId: discussionId }) }
    finally { setDeparting(false) }
  }
  // ChannelDetailView.openSubscriberOneOnOneInquiry
  const openInquiry = async (): Promise<void> => {
    if (inquiring) return
    setInquiring(true)
    try { openInquiries(channelId, await window.morse.openSubscriberInquiry(accountUid, channelId)) }
    catch (reason) { controller.toast(errorText(reason, tr('문의를 열지 못했습니다.')), 'error') }
    finally { setInquiring(false) }
  }
  const leave = async (): Promise<void> => {
    if (!ready || leaving) return
    if (!await confirmBox({ title: tr('채널 나가기'), text: tr('{0} 채널 구독을 취소할까요?', [ready.name]), confirm: tr('나가기'), danger: true })) return
    setLeaving(true)
    try {
      const result = await trackWrite(window.morse.leaveChannel(accountUid, channelId))
      if (result === 'done') { controller.toast(tr('채널에서 나갔습니다.')); controller.closeChat() }
      else controller.toast(tr('나가기 결과를 확인하고 있습니다. 잠시 후 채널 목록을 확인해 주세요.'))
    } catch (reason) { controller.toast(errorText(reason, tr('채널에서 나가지 못했습니다.')), 'error') }
    finally { setLeaving(false) }
  }

  return <section className="side-panel" aria-label={tr('채널 정보')}>
    <header className="top-bar">
      <strong className="side-title">{tr('채널 정보')}</strong>
      <button className="icon-button" aria-label={tr('정보 닫기')} onClick={() => controller.setRight(null)}><X size={20} /></button>
    </header>
    <div className="side-panel-body">
      {!ready ? <div className="empty-state">{channel?.status === 'loading' || !channel ? tr('채널 정보를 불러오는 중…') : tr('채널 정보를 확인할 수 없습니다.')}</div> : <>
        {coverUrl && <div className="channel-info-cover"><img src={coverUrl} alt="" draggable={false} /></div>}
        <div className="info-cover">
          <Avatar name={ready.name} url={ready.avatar?.status === 'ready' ? ready.avatar.url : null} size={88} kind="channel"
            onOpen={() => { if (ready.avatar?.status === 'ready' && ready.avatar.url) showPhotoViewer(ready.avatar.url, ready.name) }} />
          <h2 className="selectable">{ready.name}</h2>
          <span>{channelSubtitle(ready)}</span>
        </div>
        <div className="info-section">
          {ready.description && <InfoRow icon={<FileText size={20} />} value={ready.description} label={tr('소개')} />}
          {link && <InfoRow icon={<Link size={20} />} value={link} label={tr('링크 · 눌러서 복사')} onClick={copyLink} />}
          {link && <ActionRow icon={<Copy size={20} />} label={tr('공유 문구 복사')} onClick={copyShareText} />}
          {ready.tags && ready.tags.length > 0 && <InfoRow icon={<Hash size={20} />} value={ready.tags.map(tag => `#${tag}`).join(' ')} label={tr('태그')} />}
          {ready.ownerName && <InfoRow icon={<User size={20} />} value={ready.ownerName} label={tr('소유자')} />}
          {ready.postCount !== null && <InfoRow icon={<MessageCircle size={20} />} value={tr('{0}개', [ready.postCount.toLocaleString(locale())])} label={tr('게시물')} />}
        </div>
        {discussionId && <div className="info-section">
          {discussionListed ? <>
            <ActionRow icon={<MessageCircle size={20} />} label={tr('토론방 열기')} disabled={!version} onClick={() => { void openDiscussion() }} />
            <ActionRow icon={departing ? <Spinner size={20} /> : <LogOut size={20} />} label={tr('토론방 나가기')} danger disabled={!version || departing} onClick={() => { void leaveDiscussion() }} />
          </> : <ActionRow icon={joining ? <Spinner size={20} /> : <MessageCircle size={20} />} label={tr('토론방 참여')} disabled={!version || joining} onClick={() => { void joinDiscussion() }} />}
        </div>}
        {ready.owned && <div className="info-section">
          <ActionRow icon={<Users size={20} />} label={ready.subscriberCount !== null ? tr('구독자 {0}명', [ready.subscriberCount.toLocaleString(locale())]) : tr('구독자')} onClick={() => showChannelMembersBox(accountUid, ready, 'subscribers')} />
          <ActionRow icon={<Shield size={20} />} label={tr('관리자')} onClick={() => showChannelMembersBox(accountUid, ready, 'admins')} />
          <ActionRow icon={<UserPlus size={20} />} label={tr('가입 요청')} disabled={!version} onClick={() => showChannelMembersBox(accountUid, ready, 'requests')} />
          <ActionRow icon={<Inbox size={20} />} label={tr('1:1 문의')} onClick={() => openInquiries(channelId, null)} />
        </div>}
        {editable && <div className="info-section">
          <ActionRow icon={<Pencil size={20} />} label={tr('채널 이름 변경')} onClick={editName} />
          <ActionRow icon={<FileText size={20} />} label={tr('채널 소개 편집')} onClick={editIntroduction} />
          {ready.tags !== null && <ActionRow icon={<Hash size={20} />} label={tr('태그 편집')} onClick={editTags} />}
          {ready.editableAccess && <ActionRow icon={<SlidersHorizontal size={20} />} label={tr('접근 설정')} onClick={() => showChannelAccessBox(accountUid, ready)} />}
          <ActionRow icon={photoBusy === 'avatar' ? <Spinner size={20} /> : <Camera size={20} />} label={tr('채널 사진 변경')} disabled={Boolean(photoBusy)} onClick={() => { void changePhoto('avatar') }} />
          <ActionRow icon={photoBusy === 'cover' ? <Spinner size={20} /> : <ImageIcon size={20} />} label={tr('커버 변경')} disabled={Boolean(photoBusy)} onClick={() => { void changePhoto('cover') }} />
          {ready.hasAvatar && <ActionRow icon={<Trash2 size={20} />} label={tr('채널 사진 삭제')} danger onClick={() => { void clearPhoto('avatar') }} />}
          {ready.hasCover && <ActionRow icon={<Trash2 size={20} />} label={tr('커버 삭제')} danger onClick={() => { void clearPhoto('cover') }} />}
        </div>}
        {!ready.owned && ready.subscriptionListed && <div className="info-section">
          <ActionRow icon={inquiring ? <Spinner size={20} /> : <MessageSquare size={20} />} label={tr('운영자에게 1:1 문의')} disabled={inquiring} onClick={() => { void openInquiry() }} />
          <ActionRow icon={leaving ? <Spinner size={20} /> : <LogOut size={20} />} label={tr('채널 나가기')} danger disabled={leaving} onClick={() => { void leave() }} />
        </div>}
        {/* iOS ChannelDetailView «신고» (ChannelReportView .channel). */}
        {!ready.owned && <div className="info-section">
          <ActionRow icon={<Flag size={20} />} label={tr('채널 신고')} danger onClick={() => showReportBox(accountUid, { type: 'channel', targetId: channelId }, tr('신고'))} />
        </div>}
      </>}
    </div>
  </section>
}

// Third column for an open channel: the comments of a post or channel info.
export function ChannelSidePanel({ accountUid, channelId, right }: { accountUid: string; channelId: string; right: RightPanel }) {
  const postId = useCommentsPost(channelId), inquiry = useInquiryTarget(channelId)
  return right === 'comments' && postId ? <ChannelCommentsPanel key={postId} accountUid={accountUid} channelId={channelId} postId={postId} />
    : right === 'inquiry' && inquiry ? <ChannelInquiryPanel accountUid={accountUid} channelId={channelId} thread={inquiry.thread} fromList={inquiry.fromList} />
    : <ChannelInfoPanel accountUid={accountUid} channelId={channelId} />
}
