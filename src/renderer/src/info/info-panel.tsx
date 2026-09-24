import { loadBlockedUsers, setBlocked, useBlockedUsers } from '../app/blocked-users'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { ArrowLeft, AtSign, Bell, Flag, Images, LayoutGrid, Camera, FileText, ImageOff, LogOut, MessageCircle, Pencil, Radio, Star, Trash2, UserMinus, UserPlus, Users, X, ShieldOff, Timer } from 'lucide-react'
import { cropPhoto } from '../boxes/photo-crop-box'
import type { DialogSummary } from '../../../shared/model'
import type { ContactProfileSnapshot } from '../../../shared/contacts'
import type { ParticipantSummary } from '../../../shared/participants'
import { contactDetailsEdit } from '../../../shared/contact-details'
import { groupAnnouncementLimit } from '../../../shared/group-announcement'
import { desktop, dialogById, useDesktop } from '../app/store'
import { controller } from '../app/ui'
import { errorText } from '../app/format'
import { trackWrite } from '../app/drafts'
import { deleteContact, onContactProfileReleased } from '../app/contacts'
import { changeGroupPhoto } from '../app/photos'
import { showAddMembersBox } from '../boxes/group-boxes'
import { showTextEditBox } from '../boxes/text-edit-box'
import { Avatar, PeerAvatar } from '../ui/avatar'
import { showPhotoViewer } from '../ui/photo-viewer'
import { Spinner, Switch, TextField } from '../ui/controls'
import { SharedMedia } from './shared-media'
import { showForumBox } from './forum-box'
import { showReportBox } from '../boxes/report-box'
import { Box, confirmBox } from '../ui/layers'
import { showChatAutoDeleteBox } from '../boxes/auto-delete-box'
import { autoDeleteSummary, canChangeAutoDelete } from '../../../shared/chat-auto-delete'
import { popupMenu, pointFor } from '../ui/popup-menu'
import { UserAvatar } from '../ui/user-avatar'
import { usePresence } from '../app/presence'
import { tr } from '../../../shared/i18n'

export function InfoRow({ icon, value, label, onClick }: { icon: ReactNode; value: string; label: string; onClick?(): void }) {
  const content = <><span className="info-row-icon">{icon}</span><span className="info-row-text"><span className="selectable">{value}</span><small>{label}</small></span></>
  return onClick ? <button type="button" className="info-row" onClick={onClick}>{content}</button> : <div className="info-row">{content}</div>
}

export function ActionRow({ icon, label, onClick, danger, disabled }: { icon: ReactNode; label: string; onClick(): void; danger?: boolean; disabled?: boolean }) {
  return <button type="button" className={`list-button${danger ? ' danger' : ''}`} disabled={disabled} onClick={onClick}>
    <span className="list-button-icon">{icon}</span><span className="list-button-text">{label}</span>
  </button>
}

// EditContactBox: nickname and note are stored for this account on this device only.
function ContactDetailsBox({ accountUid, requestId, profile, close }: { accountUid: string; requestId: string; profile: ContactProfileSnapshot; close(): void }) {
  const [nickname, setNickname] = useState(profile.local.nickname), [note, setNote] = useState(profile.local.note)
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  const operation = useRef<{ key: string; id: string } | null>(null)
  async function save(): Promise<void> {
    if (busy) return
    const key = JSON.stringify([nickname.trim(), note.trim()])
    if (operation.current?.key !== key) operation.current = { key, id: crypto.randomUUID() }
    let edit
    try { edit = contactDetailsEdit({ operationId: operation.current.id, expectedVersion: profile.local.version, nickname, note }) }
    catch (reason) { setError(errorText(reason, tr('입력한 내용을 확인해 주세요.'))); return }
    setBusy(true); setError('')
    try { await trackWrite(window.morse.saveContactDetails(accountUid, requestId, edit)); close() }
    catch { setError(tr('저장 결과를 확인하지 못했습니다. 연락처 정보를 다시 열어 확인해 주세요.')); setBusy(false) }
  }
  return <Box title={tr('연락처 편집')} width={400} buttons={<>
    <button className="button flat" disabled={busy} onClick={close}>{tr('취소')}</button>
    <button className="button flat" disabled={busy} onClick={() => { void save() }}>{busy && <Spinner size={14} />}{tr('저장')}</button>
  </>}>
    <TextField label={tr('이름')} value={nickname} onChange={setNickname} maxLength={100} placeholder={profile.originalName} autoFocus disabled={busy} onSubmit={() => { void save() }} />
    <TextField label={tr('메모')} value={note} onChange={setNote} maxLength={2000} multiline rows={5} counter disabled={busy} />
    <p className="box-note">{tr('이름과 메모는 이 기기의 현재 계정에만 저장되고 상대에게 보이지 않습니다. 이름을 비우면 상대가 설정한 이름을 표시합니다.')}</p>
    {error && <p className="box-error" role="alert">{error}</p>}
  </Box>
}

function ContactProfile({ accountUid, uid, fromChat }: { accountUid: string; uid: string; fromChat: boolean }) {
  const [requestId, setRequestId] = useState(() => crypto.randomUUID())
  const snapshot = useDesktop(state => state?.contacts?.profile ?? null)
  const inContacts = useDesktop(state => Boolean(state?.contacts?.items.some(item => item.uid === uid)))
  const presence = usePresence(uid)
  const personalUrl = useDesktop(state => state?.contacts?.items.find(item => item.uid === uid)?.personalPhotoURL ?? null)
  // The list row's picture of this person (the same address) while the profile's own read finishes.
  const listUrl = useDesktop(state => { const avatar = state?.contacts?.items.find(item => item.uid === uid)?.avatar; return avatar?.status === 'ready' ? avatar.url : null })
  const [photoBusy, setPhotoBusy] = useState(false)
  const blockedUsers = useBlockedUsers(accountUid)
  useEffect(() => { void loadBlockedUsers(accountUid).catch(() => []) }, [accountUid])
  const last = useRef<ContactProfileSnapshot | null>(null)
  const own = snapshot?.requestId === requestId ? snapshot : null
  if (own?.status === 'ready') last.current = own
  useEffect(() => {
    void window.morse.openContactProfile(accountUid, uid, requestId).catch(reason => controller.toast(errorText(reason, tr('프로필을 열지 못했습니다.')), 'error'))
    return () => { void window.morse.closeContactProfile(accountUid, requestId).catch(() => {}) }
  }, [accountUid, uid, requestId])
  // Another action borrowed main's single profile selection; select this peer again.
  useEffect(() => onContactProfileReleased(() => { if (desktop.value?.contacts?.profile?.requestId !== requestId) setRequestId(crypto.randomUUID()) }), [requestId])
  const profile = own && own.status !== 'loading' ? own : last.current?.uid === uid ? last.current : null
  if (!profile) return <div className="empty-state"><Spinner size={22} /></div>
  if (profile.status !== 'ready') return <div className="empty-state">{profile.message || tr('프로필을 확인할 수 없습니다.')}</div>
  const live = own?.status === 'ready' ? own : null
  async function startChat(): Promise<void> {
    try { controller.openChat(await window.morse.startContactChat(accountUid, requestId)) }
    catch (reason) { controller.toast(errorText(reason, tr('대화를 열지 못했습니다.')), 'error') }
  }
  async function copyId(): Promise<void> {
    try { await window.morse.copyContactId(accountUid, requestId); controller.toast(tr('Morse ID를 복사했습니다.')) }
    catch (reason) { controller.toast(errorText(reason, tr('Morse ID를 복사하지 못했습니다.')), 'error') }
  }
  async function remove(target: ContactProfileSnapshot): Promise<void> {
    if (!await confirmBox({ title: tr('연락처 삭제'), text: tr('{0}님을 연락처에서 삭제할까요? 서로 연락처에만 공개되는 프로필 정보를 볼 수 없게 됩니다. 대화와 이 기기의 이름·메모는 유지됩니다.', [target.displayName]), confirm: tr('삭제'), danger: true })) return
    await deleteContact(accountUid, requestId, target.contactVersion, target.displayName)
  }
  // Contacts::PersonalPhoto: a photo shown only on this device for this contact.
  async function setPersonalPhoto(target: ContactProfileSnapshot): Promise<void> {
    if (photoBusy || target.personalPhoto.status !== 'ready') return
    setPhotoBusy(true)
    const binding = { requestId, contactVersion: target.contactVersion, expectedVersion: target.personalPhoto.version }
    let picked: { id: string; bytes: Uint8Array } | null = null, bytes: Uint8Array | null = null
    try {
      picked = await window.morse.pickContactPhoto(accountUid, binding)
      if (!picked) return
      bytes = await cropPhoto(picked.bytes, 'square', tr('개인 사진'))
      if (!bytes) return
      await trackWrite(window.morse.saveContactPhoto(accountUid, { ...binding, operationId: crypto.randomUUID(), photoId: picked.id }, bytes))
      controller.toast(tr('이 기기에서만 보이는 사진으로 바꿨습니다.'))
    } catch (reason) { controller.toast(errorText(reason, tr('개인 사진을 저장하지 못했습니다.')), 'error') }
    finally {
      bytes?.fill(0); picked?.bytes.fill(0)
      if (picked) void window.morse.releaseBackgroundPhoto(picked.id).catch(() => {})
      setPhotoBusy(false)
    }
  }
  async function clearPersonalPhoto(target: ContactProfileSnapshot): Promise<void> {
    if (photoBusy || target.personalPhoto.status !== 'ready') return
    if (!await confirmBox({ title: tr('개인 사진 삭제'), text: tr('이 기기에서 설정한 사진을 지우고 상대가 올린 사진을 표시할까요?'), confirm: tr('삭제'), danger: true })) return
    setPhotoBusy(true)
    try {
      await trackWrite(window.morse.saveContactPhoto(accountUid, { requestId, contactVersion: target.contactVersion, expectedVersion: target.personalPhoto.version, operationId: crypto.randomUUID(), photoId: null }))
      controller.toast(tr('개인 사진을 지웠습니다.'))
    } catch (reason) { controller.toast(errorText(reason, tr('개인 사진을 지우지 못했습니다.')), 'error') }
    finally { setPhotoBusy(false) }
  }
  const blocked = blockedUsers?.some(user => user.uid === uid) ?? false
  async function toggleBlock(target: ContactProfileSnapshot): Promise<void> {
    if (!blocked && !await confirmBox({ title: tr('사용자 차단'), text: tr('{0}님을 차단할까요? 설정 → 개인정보에서 언제든 해제할 수 있어요.', [target.displayName]), confirm: tr('차단'), danger: true })) return
    try { await setBlocked(accountUid, { uid, userId: target.userId, displayName: target.displayName }, !blocked); controller.toast(blocked ? tr('차단을 해제했습니다.') : tr('차단했습니다.')) }
    catch (reason) { controller.toast(errorText(reason, tr('차단 상태를 바꾸지 못했습니다.')), 'error') }
  }
  const personal = live?.personalPhoto.status === 'ready' ? live.personalPhoto : null
  // The picture this profile shows, and the one its cover opens.
  const coverUrl = personalUrl ?? (profile.photo.status === 'ready' ? profile.photo.url : profile.visibility === 'visible' && profile.photo.status !== 'none' ? listUrl : null)
  return <>
    <div className="info-cover">
      <Avatar name={profile.displayName} url={coverUrl} size={88} onOpen={() => { if (coverUrl) showPhotoViewer(coverUrl, profile.displayName, { accountUid, peerUid: uid }) }} />
      <h2 className="selectable">{profile.displayName}</h2>
      {presence && <span className={presence.online ? 'online' : undefined}>{presence.text}</span>}
      {profile.originalName && profile.originalName !== profile.displayName && <span>{tr('원래 이름 {0}', [profile.originalName])}</span>}
    </div>
    {!fromChat && <div className="info-actions"><button className="button secondary" disabled={!live} onClick={() => { void startChat() }}><MessageCircle size={18} />{tr('메시지 보내기')}</button></div>}
    <div className="info-section">
      {profile.visibility === 'visible' && profile.userId && <InfoRow icon={<AtSign size={20} />} value={`@${profile.userId}`} label={tr('Morse ID · 눌러서 복사')} onClick={() => { void copyId() }} />}
      {profile.visibility === 'visible' && profile.bio && <InfoRow icon={<FileText size={20} />} value={profile.bio} label={tr('소개')} />}
      {profile.local.status === 'ready' && profile.local.note && <InfoRow icon={<Pencil size={20} />} value={profile.local.note} label={tr('이 기기의 메모')} />}
      {profile.visibility === 'hidden' && <p className="info-note">{tr('서로 연락처에 추가하면 Morse ID, 소개와 사진이 표시됩니다.')}</p>}
    </div>
    {inContacts && <div className="info-section">
      <ActionRow icon={<Pencil size={20} />} label={tr('연락처 편집')} disabled={!live || live.local.status !== 'ready'} onClick={() => {
        if (live) controller.showLayer(close => <ContactDetailsBox accountUid={accountUid} requestId={requestId} profile={live} close={close} />)
      }} />
      <ActionRow icon={photoBusy ? <Spinner size={20} /> : <Camera size={20} />} label={personal?.photoId ? tr('개인 사진 바꾸기') : tr('개인 사진 설정')} disabled={!live || !personal || photoBusy} onClick={() => { if (live) void setPersonalPhoto(live) }} />
      {personal?.photoId && <ActionRow icon={<ImageOff size={20} />} label={tr('개인 사진 삭제')} disabled={photoBusy} onClick={() => { if (live) void clearPersonalPhoto(live) }} />}
      <ActionRow icon={<Trash2 size={20} />} label={tr('연락처 삭제')} danger disabled={!live} onClick={() => { if (live) void remove(live) }} />
    </div>}
    <div className="info-section">
      <ActionRow icon={<ShieldOff size={20} />} label={blocked ? tr('차단 해제') : tr('사용자 차단')} danger={!blocked} disabled={blockedUsers === null} onClick={() => { void toggleBlock(profile) }} />
      {/* iOS ProfileView «사용자 신고» (UserReportView). */}
      <ActionRow icon={<Flag size={20} />} label={tr('사용자 신고')} danger onClick={() => showReportBox(accountUid, { type: 'user', targetId: uid }, profile.userId ? tr('@{0} 신고', [profile.userId]) : tr('사용자 신고'), blocked ? null : { uid, userId: profile.userId, displayName: profile.displayName })} />
    </div>
  </>
}

function GroupInfo({ accountUid, dialog, onProfile }: { accountUid: string; dialog: DialogSummary; onProfile(uid: string): void }) {
  const [requestId] = useState(() => crypto.randomUUID())
  const snapshot = useDesktop(state => state?.participants ?? null)
  const current = snapshot?.requestId === requestId && snapshot.chatId === dialog.id ? snapshot : null
  const ready = current?.status === 'ready'
  const [photoBusy, setPhotoBusy] = useState(false)
  useEffect(() => {
    void window.morse.openParticipants(accountUid, dialog.id, requestId).catch(reason => controller.toast(errorText(reason, tr('참여자를 불러오지 못했습니다.')), 'error'))
    return () => { void window.morse.closeParticipants(accountUid, requestId).catch(() => {}) }
  }, [accountUid, dialog.id, requestId])
  const photo = ready ? current.groupPhoto : null
  useEffect(() => {
    if (!ready || !photo?.hasPhoto || photo.status !== 'idle') return
    void window.morse.loadGroupPhoto(accountUid, { requestId, chatId: dialog.id, version: current.version }).catch(() => {})
  }, [ready, photo?.hasPhoto, photo?.status, current?.version])
  if (!current || current.status === 'loading') return <div className="empty-state"><Spinner size={22} /></div>
  if (current.status !== 'ready') return <div className="empty-state">{current.message || tr('그룹 정보를 확인할 수 없습니다.')}</div>
  const members = current.members, version = current.version
  const roomPhoto = dialog.avatar?.status === 'ready' ? dialog.avatar.url : null
  const cover = photo?.status === 'ready' ? photo.url : current.discussion ? roomPhoto : null
  const self = members.find(member => member.self && !member.withdrawn)
  const owner = Boolean(self?.owner), plain = !current.discussion
  const capacity = Math.max(0, 100 - dialog.participantUids.length)
  const editName = (): void => showTextEditBox({ title: tr('그룹 이름'), label: tr('이름'), initial: current.groupName ?? dialog.title, maxLength: 50,
    save: name => window.morse.saveGroupName(accountUid, { id: crypto.randomUUID(), requestId, chatId: dialog.id, version, name }) })
  const editAnnouncement = (): void => showTextEditBox({ title: tr('그룹 소개'), label: tr('소개'), initial: current.groupAnnouncement ?? '', maxLength: groupAnnouncementLimit, multiline: true,
    save: text => window.morse.saveGroupAnnouncement(accountUid, { id: crypto.randomUUID(), requestId, chatId: dialog.id, version, text }) })
  const changePhoto = async (): Promise<void> => {
    setPhotoBusy(true)
    try { await changeGroupPhoto(accountUid, { chatId: dialog.id, version: dialog.version, title: dialog.title }) }
    catch (reason) { controller.toast(errorText(reason, tr('그룹 사진을 바꾸지 못했습니다.')), 'error') }
    finally { setPhotoBusy(false) }
  }
  const clearPhoto = async (): Promise<void> => {
    if (!await confirmBox({ title: tr('그룹 사진 삭제'), text: tr('모든 참여자에게서 그룹 사진을 삭제합니다.'), confirm: tr('삭제'), danger: true })) return
    try {
      const result = await trackWrite(window.morse.clearGroupPhoto(accountUid, { id: crypto.randomUUID(), requestId, chatId: dialog.id, version }))
      if (result.outcome !== 'saved') controller.toast(result.message, result.outcome === 'rejected' ? 'error' : 'default')
    } catch (reason) { controller.toast(errorText(reason, tr('그룹 사진을 삭제하지 못했습니다.')), 'error') }
  }
  const leave = async (): Promise<void> => {
    const participantCount = dialog.participantUids.length
    const text = participantCount === 1 ? tr('혼자 참여 중입니다. 나가면 아무도 남지 않아 참여자 추가로 다시 들어올 수 없습니다. 그룹과 메시지는 삭제되지 않습니다.')
      : owner ? tr('방장으로 참여 중입니다. 다른 참여자가 남아 있으면 서버의 참여자 순서에 따라 방장이 자동으로 넘어갑니다.') : tr('그룹에서 나가면 새 메시지를 받을 수 없습니다.')
    if (!await confirmBox({ title: tr('{0}에서 나가기', [dialog.title]), text, confirm: tr('나가기'), danger: true })) return
    try {
      const result = await trackWrite(window.morse.leaveGroup(accountUid, { id: crypto.randomUUID(), chatId: dialog.id, version: dialog.version, title: dialog.title, owner, participantCount }))
      if (result === 'done') controller.closeChat()
      else controller.toast(tr('나가기 결과를 아직 확인하지 못했습니다. 잠시 후 대화 목록을 확인해 주세요.'))
    } catch (reason) { controller.toast(errorText(reason, tr('그룹에서 나가지 못했습니다.')), 'error') }
  }
  const removeMember = async (member: ParticipantSummary): Promise<void> => {
    if (!await confirmBox({ title: tr('참여자 내보내기'), text: tr('{0}님을 그룹에서 내보낼까요?', [member.displayName]), confirm: tr('내보내기'), danger: true })) return
    try {
      const result = await trackWrite(window.morse.removeGroupMember(accountUid, { id: crypto.randomUUID(), chatId: dialog.id, version: dialog.version, title: dialog.title, removeUid: member.uid, displayName: member.displayName }))
      controller.toast(result === 'done' ? tr('{0}님을 내보냈습니다.', [member.displayName]) : tr('내보내기 결과를 아직 확인하지 못했습니다. 잠시 후 참여자 목록을 확인해 주세요.'))
    } catch (reason) { controller.toast(errorText(reason, tr('참여자를 내보내지 못했습니다.')), 'error') }
  }
  const removable = (member: ParticipantSummary): boolean => owner && plain && !member.self
  const openMember = (member: ParticipantSummary, point: { x: number; y: number }): void => {
    if (member.self) return
    popupMenu.open(point, [
      !member.withdrawn && member.canOpenContact ? { label: tr('프로필 보기'), icon: <Users size={18} />, onSelect: () => {
        void window.morse.participantContact(accountUid, { requestId, chatId: dialog.id, uid: member.uid, version }).then(onProfile)
          .catch(reason => controller.toast(errorText(reason, tr('프로필을 열지 못했습니다.')), 'error'))
      } } : null,
      !member.withdrawn && member.canAddContact ? { label: tr('연락처에 추가'), icon: <UserPlus size={18} />, onSelect: () => {
        void trackWrite(window.morse.addParticipantContact(accountUid, { id: crypto.randomUUID(), requestId, chatId: dialog.id, uid: member.uid, version }))
          .then(result => controller.toast(result.outcome === 'added' ? tr('{0}님을 연락처에 추가했습니다.', [member.displayName]) : result.outcome === 'exists' ? tr('이미 연락처에 있습니다.') : result.message, result.outcome === 'rejected' ? 'error' : 'default'))
          .catch(reason => controller.toast(errorText(reason, tr('연락처에 추가하지 못했습니다.')), 'error'))
      } } : null,
      removable(member) ? 'separator' : null,
      removable(member) ? { label: tr('그룹에서 내보내기'), icon: <UserMinus size={18} />, danger: true, onSelect: () => { void removeMember(member) } } : null
    ])
  }
  return <>
    <div className="info-cover">
      {/* A channel's discussion room has no picture of its own to load — the room only keeps the address
          the server copied into it when it was made. The chat list row already falls back to the channel's
          own picture (DiscussionAvatars), so this shows the same one rather than nothing. */}
      <Avatar name={current.groupName ?? dialog.title} url={cover} size={88}
        onOpen={() => { if (cover) showPhotoViewer(cover, current.groupName ?? dialog.title) }} />
      <h2 className="selectable">{current.groupName ?? dialog.title}</h2>
      <span>{tr('{0} · 참여자 {1}명', [current.discussion ? tr('채널 토론방') : tr('그룹', [], 'kind'), members.length])}</span>
    </div>
    {/* iOS GroupProfileView's channel menu «보기» (openChannelDetail): a discussion room leads back to its channel. */}
    {!plain && dialog.channelId && <div className="info-section">
      <ActionRow icon={<Radio size={20} />} label={tr('채널 보기')} onClick={() => controller.openChannel(dialog.channelId!)} />
    </div>}
    {plain && (current.groupAnnouncement !== null || current.canEditGroupAnnouncement) && <div className="info-section">
      {current.groupAnnouncement?.trim() ? <InfoRow icon={<FileText size={20} />} value={current.groupAnnouncement} label={tr('소개')} /> : <p className="info-note">{tr('등록된 소개가 없습니다.')}</p>}
    </div>}
    <div className="info-section">
      {current.groupName !== null && <ActionRow icon={<Pencil size={20} />} label={tr('그룹 이름 변경')} onClick={editName} />}
      {current.canEditGroupAnnouncement && <ActionRow icon={<FileText size={20} />} label={tr('그룹 소개 편집')} onClick={editAnnouncement} />}
      {owner && plain && <ActionRow icon={photoBusy ? <Spinner size={20} /> : <Camera size={20} />} label={tr('그룹 사진 변경')} disabled={photoBusy} onClick={() => { void changePhoto() }} />}
      {photo?.canClear && <ActionRow icon={<Trash2 size={20} />} label={tr('그룹 사진 삭제')} danger onClick={() => { void clearPhoto() }} />}
      {/* iOS GroupProfileView «카테고리»: everyone sees the topics; only the creator changes them. */}
      {plain && (owner || dialog.forum) && <ActionRow icon={<LayoutGrid size={20} />} label={tr('카테고리')} onClick={() => showForumBox(accountUid, dialog.id, owner)} />}
    </div>
    <div className="section-label">{tr('참여자 {0}명', [members.length])}</div>
    {plain && self && capacity > 0 && <ActionRow icon={<UserPlus size={20} />} label={tr('참여자 추가')} onClick={() => showAddMembersBox(accountUid, dialog)} />}
    <div className="info-members">{members.map(member => <button key={member.uid} type="button" className="member-row"
      disabled={member.self || (!removable(member) && (member.withdrawn || (!member.canOpenContact && !member.canAddContact)))}
      onClick={event => openMember(member, pointFor(event, event.currentTarget))}>
      <UserAvatar uid={member.uid} name={member.displayName} size={40} kind={member.withdrawn ? 'deleted' : undefined} roomOnly={current.discussion} />
      <span className="member-row-text"><strong className="ellipsis">{member.displayName}</strong><small>{member.withdrawn ? tr('탈퇴한 계정') : member.self ? tr('나') : ''}</small></span>
      {member.owner && <span className="member-badge">{tr('방장')}</span>}
    </button>)}</div>
    {plain && self && <div className="info-section">
      {/* iOS GroupProfileView report (ChannelReportView .group). */}
      <ActionRow icon={<Flag size={20} />} label={tr('그룹 신고')} danger onClick={() => showReportBox(accountUid, { type: 'group', targetId: dialog.id }, tr('신고'))} />
      <ActionRow icon={<LogOut size={20} />} label={tr('그룹 나가기')} danger onClick={() => { void leave() }} />
    </div>}
  </>
}

export function InfoPanel({ accountUid, chatId }: { accountUid: string; chatId: string }) {
  const dialog = useDesktop(state => dialogById(state, chatId))
  const pending = useDesktop(state => state?.pendingDirects.find(item => item.chatId === chatId) ?? null)
  const [profile, setProfile] = useState<string | null>(null)
  const [media, setMedia] = useState(false)
  const [adding, setAdding] = useState(false)
  const peerUid = dialog?.kind === 'direct' ? dialog.participantUids.find(uid => uid !== accountUid) ?? null : !dialog ? pending?.peerUid ?? null : null
  const inContacts = useDesktop(state => peerUid ? Boolean(state?.contacts?.items.some(item => item.uid === peerUid)) : false)
  const heading = media ? tr('공유된 미디어') : profile ? tr('연락처 정보') : dialog?.kind === 'group' ? tr('그룹 정보') : tr('정보')
  useEffect(() => { setProfile(null); setMedia(false) }, [chatId])
  async function addPeer(): Promise<void> {
    if (!dialog || !peerUid || adding) return
    setAdding(true)
    try {
      const result = await trackWrite(window.morse.addChatContact(accountUid, { id: crypto.randomUUID(), chatId: dialog.id, uid: peerUid }))
      controller.toast(result.outcome === 'added' ? tr('{0}님을 연락처에 추가했습니다.', [dialog.title]) : result.outcome === 'exists' ? tr('이미 연락처에 있습니다.') : result.message, result.outcome === 'rejected' ? 'error' : 'default')
    } catch (reason) { controller.toast(errorText(reason, tr('연락처에 추가하지 못했습니다.')), 'error') }
    finally { setAdding(false) }
  }
  return <section className="side-panel" aria-label={heading}>
    <header className="top-bar">
      {(profile || media) && <button className="icon-button" aria-label={tr('뒤로')} onClick={() => { if (media) setMedia(false); else setProfile(null) }}><ArrowLeft size={20} /></button>}
      <strong className="side-title">{heading}</strong>
      <button className="icon-button" aria-label={tr('정보 닫기')} onClick={() => controller.setRight(null)}><X size={20} /></button>
    </header>
    <div className="side-panel-body">
      {media && dialog ? <SharedMedia accountUid={accountUid} chatId={dialog.id} /> : <>
      {profile ? <ContactProfile key={profile} accountUid={accountUid} uid={profile} fromChat={false} />
        : dialog?.kind === 'group' ? <GroupInfo key={dialog.id} accountUid={accountUid} dialog={dialog} onProfile={setProfile} />
          : peerUid && inContacts ? <ContactProfile key={peerUid} accountUid={accountUid} uid={peerUid} fromChat />
            : <div className="info-cover">
              {!dialog && pending ? <PeerAvatar id={pending.chatId} name={pending.displayName} image={pending.avatar ?? null} surface="dialogs" size={88} />
                : <Avatar name={dialog?.title ?? pending?.displayName ?? '?'} size={88} kind={dialog?.kind === 'secret' ? 'secret' : undefined} />}
              <h2 className="selectable">{dialog?.title ?? pending?.displayName ?? ''}</h2>
              <span>{dialog?.kind === 'secret' ? tr('비밀 대화') : tr('연락처에 없는 사용자')}</span>
            </div>}
      {/* Telegram's profile of a non-contact offers "Add to contacts"; iOS UnknownProfileView the same. */}
      {!profile && dialog?.kind === 'direct' && peerUid && !inContacts && <div className="info-section">
        <ActionRow icon={adding ? <Spinner size={20} /> : <UserPlus size={20} />} label={tr('연락처에 추가')} disabled={adding} onClick={() => { void addPeer() }} />
      </div>}
      {/* Telegram's Shared Media entry; a secret room keeps nothing to list here. */}
      {!profile && dialog && dialog.kind !== 'secret' && <div className="info-section">
        <ActionRow icon={<Images size={20} />} label={tr('공유된 미디어 · 파일 · 링크')} onClick={() => setMedia(true)} />
      </div>}
      {/* Telegram's info panel «Notifications» switch, kept on this device. */}
      {!profile && dialog && dialog.kind !== 'secret' && <div className="info-section">
        <div className="info-row info-switch-row"><span className="info-row-icon"><Bell size={20} /></span><span className="info-row-text"><span>{tr('알림')}</span><small>{dialog.muted ? tr('꺼짐') : tr('켜짐')}</small></span>
          <Switch label={tr('알림')} checked={!dialog.muted} onChange={value => { void window.morse.setChatFlags(accountUid, dialog.id, { muted: !value }).catch(reason => controller.toast(errorText(reason, tr('변경하지 못했습니다.')), 'error')) }} /></div>
      </div>}
      {!profile && dialog && <div className="info-section">
        <InfoRow icon={<MessageCircle size={20} />} value={dialog.kind === 'group' ? tr('그룹 대화') : dialog.kind === 'secret' ? tr('비밀 대화') : tr('개인 대화')} label={tr('대화 종류')} />
        {dialog.kind !== 'secret' && <InfoRow icon={<Timer size={20} />} value={autoDeleteSummary(dialog.autoDeleteSeconds ?? 0)}
          label={canChangeAutoDelete(dialog, accountUid) ? tr('자동 삭제 · 눌러서 변경') : tr('자동 삭제')} onClick={canChangeAutoDelete(dialog, accountUid) ? () => showChatAutoDeleteBox(accountUid, dialog) : undefined} />}
      </div>}
      </>}
    </div>
  </section>
}
