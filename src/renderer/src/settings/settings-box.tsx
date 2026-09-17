import { changeBackupCode, deleteAccount, showBlockedUsersBox, showLastSeenBox, showSessionsBox } from './security-boxes'
import { useEffect, useState, type ReactNode } from 'react'
import { ArrowLeft, AtSign, Bell, Camera, ChevronRight, FileText, FolderOpen, HardDrive, Image as ImageIcon, Info, LogOut, MessageSquare, Palette, Shield, Star, Trash2, User, X, Clock3, KeyRound, ShieldOff, Timer, Lock, BatteryLow, Download, Lightbulb, CircleHelp, ShieldCheck, Users, QrCode as QrCodeIcon, Crown, CircleCheck, Globe, History, ImagePlus, Keyboard } from 'lucide-react'
import type { Preferences, ThemePreference } from '../../../shared/model'
import type { BackgroundStorageSnapshot } from '../../../shared/background-storage'
import type { ContactPhotoStorage } from '../../../shared/contact-photo'
import type { VoiceDraftStorageSnapshot } from '../../../shared/voice-draft-storage'
import { maxProfileNameLength } from '../../../shared/profile-name'
import { desktop, useDesktop } from '../app/store'
import { showShortcutsBox } from '../boxes/shortcuts-box'
import { releaseSourceURL } from '../../../shared/app-release'
import { showStoryComposer } from '../stories/story-composer'
import { showOwnStoryViewer } from '../stories/own-story-viewer'
import { controller } from '../app/ui'
import { bytes, errorText } from '../app/format'
import { trackWrite } from '../app/drafts'
import { changeProfilePhoto } from '../app/photos'
import { showChatBackgroundBox } from '../boxes/chat-background-box'
import { showCloseFriendsBox } from '../boxes/close-friends-box'
import { showFoldersBox } from '../boxes/chat-folder-boxes'
import { showPasscodeSettings } from './passcode-boxes'
import { AccountsList } from '../window/accounts-list'
import { showAutoDeleteDefaultsBox } from '../boxes/auto-delete-box'
import { autoDeleteOptions } from '../../../shared/chat-auto-delete'
import { showTextEditBox } from '../boxes/text-edit-box'
import { Avatar } from '../ui/avatar'
import { Spinner, Switch } from '../ui/controls'
import { Box, confirmBox } from '../ui/layers'
import { autoDeleteMonthOptions, type AccountPrivacy, type DataExport } from '../../../shared/account-tools'
import { usePowerSaving } from '../app/power-saving'
import { openPolicy, showGuideBox, showSupportBox } from './support-boxes'
import { showProfileShareBox } from '../boxes/profile-share-box'
import { languageNames, languages, locale, tr, type Language } from '../../../shared/i18n'

export type Page = 'main' | 'profile' | 'notifications' | 'chat' | 'privacy' | 'data' | 'storage' | 'power' | 'language' | 'about'
const titles: Record<Page, string> = { main: tr('설정'), language: tr('언어'), profile: tr('내 정보'), notifications: tr('알림'), chat: tr('채팅 설정'), privacy: tr('개인정보'), data: tr('데이터 및 저장공간'), storage: tr('이 기기에 보관한 파일'), power: tr('절전'), about: tr('Morse Desktop 정보') }
const parents: Partial<Record<Page, Page>> = { storage: 'data', power: 'data' }
const themes: { id: ThemePreference; label: string }[] = [
  { id: 'system', label: tr('시스템 설정 따르기') }, { id: 'light', label: tr('라이트') }, { id: 'dark', label: tr('다크') }, { id: 'black', label: tr('블랙') }
]

function update(patch: Partial<Preferences>): void {
  void window.morse.updatePreferences(patch).then(next => desktop.replace(next)).catch(reason => controller.toast(errorText(reason, tr('설정을 저장하지 못했습니다.')), 'error'))
}

function Toggle({ label, detail, checked, onChange, disabled }: { label: string; detail?: string; checked: boolean; onChange(value: boolean): void; disabled?: boolean }) {
  return <label className="settings-toggle">
    <span className="settings-toggle-text"><span>{label}</span>{detail && <small>{detail}</small>}</span>
    <Switch label={label} checked={checked} disabled={disabled} onChange={onChange} />
  </label>
}

function Entry({ icon, label, detail, onClick, danger, chevron = !danger }: { icon: ReactNode; label: string; detail?: string; onClick(): void; danger?: boolean; chevron?: boolean }) {
  return <button type="button" className={`list-button${danger ? ' danger' : ''}`} onClick={onClick}>
    <span className="list-button-icon">{icon}</span>
    <span className="list-button-text"><span className="ellipsis">{label}</span>{detail && <small>{detail}</small>}</span>
    {chevron && <ChevronRight size={18} className="list-button-chevron" />}
  </button>
}

// Settings::Advanced «Version and updates» (lng_settings_check_now, lng_settings_latest_installed,
// lng_settings_update_ready, lng_settings_update_fail).
function UpdateStatus() {
  const update = useDesktop(state => state?.appUpdate ?? null)
  if (!update?.available) return null
  const text = update.status === 'checking' ? tr('업데이트 확인 중…') : update.status === 'latest' ? tr('최신 버전입니다')
    : update.status === 'downloading' ? tr('업데이트 내려받는 중… {0}%', [Math.round(update.progress * 100)])
    : update.status === 'ready' ? tr('새 버전 {0} 준비됨', [update.version ?? '']) : update.status === 'error' ? tr('업데이트 확인에 실패했습니다') : ''
  return <div className="settings-update">
    {text && <span className={update.status === 'error' ? 'error' : ''}>{text}</span>}
    {update.status === 'ready'
      ? <button type="button" className="button primary" onClick={() => { void window.morse.installAppUpdate().catch(() => {}) }}>{tr('재시작해 업데이트')}</button>
      : <button type="button" className="button secondary" disabled={update.status === 'checking' || update.status === 'downloading'} onClick={() => { void window.morse.checkAppUpdate().catch(() => {}) }}>{tr('업데이트 확인')}</button>}
  </div>
}

// Settings::Information: photo, name, bio and Morse ID.
function ProfilePage({ accountUid }: { accountUid: string }) {
  const state = useDesktop(value => value?.selfProfile ?? null)
  const [photoBusy, setPhotoBusy] = useState(false)
  if (!state || state.status === 'loading') return <div className="empty-state"><Spinner size={22} /></div>
  const self = state.status === 'ready' ? state.profile : null
  if (!self) return <div className="empty-state">
    <span>{state.message || tr('프로필을 불러오지 못했습니다.')}</span>
    <button className="button secondary" onClick={() => { void window.morse.refreshProfile(accountUid).catch(reason => controller.toast(errorText(reason, tr('프로필을 다시 불러오지 못했습니다.')), 'error')) }}>{tr('다시 불러오기')}</button>
  </div>
  const upload = state.photoUpload
  const editName = (): void => showTextEditBox({ title: tr('이름'), label: tr('이름'), initial: self.displayName, maxLength: maxProfileNameLength,
    save: displayName => window.morse.saveProfileName(accountUid, { version: self.version, displayName }).then(result => ({ outcome: result.status, message: result.message })) })
  const editBio = (): void => showTextEditBox({ title: tr('소개'), label: tr('소개'), initial: self.bio, maxLength: 500, multiline: true, note: tr('서로 연락처인 사람에게 표시됩니다.'),
    save: bio => window.morse.saveBio(accountUid, { version: self.version, bio }).then(result => ({ outcome: result.status, message: result.message })) })
  async function changePhoto(): Promise<void> {
    setPhotoBusy(true)
    try { await changeProfilePhoto(accountUid) }
    catch (reason) { controller.toast(errorText(reason, tr('프로필 사진을 바꾸지 못했습니다.')), 'error') }
    finally { setPhotoBusy(false) }
  }
  async function clearPhoto(): Promise<void> {
    if (!self || !await confirmBox({ title: tr('프로필 사진 삭제'), text: tr('현재 프로필 사진을 삭제할까요?'), confirm: tr('삭제'), danger: true })) return
    try {
      const result = await trackWrite(window.morse.clearProfilePhoto(accountUid, { version: self.version }))
      if (result.status !== 'saved') controller.toast(result.message, result.status === 'rejected' ? 'error' : 'default')
    } catch (reason) { controller.toast(errorText(reason, tr('프로필 사진을 삭제하지 못했습니다.')), 'error') }
  }
  async function copyId(): Promise<void> {
    try { await window.morse.copyProfileId(accountUid); controller.toast(tr('Morse ID를 복사했습니다.')) }
    catch (reason) { controller.toast(errorText(reason, tr('Morse ID를 복사하지 못했습니다.')), 'error') }
  }
  // A restored history photo is already uploaded; it only needs to be applied.
  async function restorePhoto(id: string): Promise<void> {
    if (!self || photoBusy) return
    setPhotoBusy(true)
    const latestVersion = (): string => desktop.value?.selfProfile?.profile?.version ?? self.version
    try {
      await trackWrite(window.morse.profilePhotoHistoryAction(accountUid, { id, action: 'restore', version: self.version }))
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => { unsubscribe(); reject(new Error(tr('이전 사진을 준비하지 못했습니다.'))) }, 5000)
        const check = (): void => { const value = desktop.value?.selfProfile?.photoUpload; if (value && !value.busy && value.id === id && value.status === 'ready') { clearTimeout(timer); unsubscribe(); resolve() } }
        const unsubscribe = desktop.subscribe(check)
        check()
      })
      await trackWrite(window.morse.profilePhotoUploadAction(accountUid, { id, action: 'apply', version: latestVersion() }))
      controller.toast(tr('이전 사진으로 바꿨습니다.'))
    } catch (reason) {
      const value = desktop.value?.selfProfile?.photoUpload
      if (value?.id === id && value.status === 'ready' && !value.busy) await window.morse.profilePhotoUploadAction(accountUid, { id, action: 'discard', version: latestVersion() }).catch(() => {})
      controller.toast(errorText(reason, tr('이전 사진으로 바꾸지 못했습니다.')), 'error')
    } finally { setPhotoBusy(false) }
  }
  async function forgetPhoto(id: string): Promise<void> {
    if (!self || photoBusy) return
    if (!await confirmBox({ title: tr('사진 기록 지우기'), text: tr('이 기기에 남은 이전 사진 기록을 지울까요? 현재 프로필 사진은 바뀌지 않습니다.'), confirm: tr('지우기'), danger: true })) return
    try { await trackWrite(window.morse.profilePhotoHistoryAction(accountUid, { id, action: 'forget', version: self.version })) }
    catch (reason) { controller.toast(errorText(reason, tr('사진 기록을 지우지 못했습니다.')), 'error') }
  }
  const busy = photoBusy || upload.busy || state.saving
  return <>
    <div className="profile-edit-cover">
      <Avatar name={self.displayName || 'M'} url={state.photo.status === 'ready' ? state.photo.url : null} size={96} />
      <div className="profile-edit-actions">
        <button className="button secondary" disabled={busy} onClick={() => { void changePhoto() }}>{photoBusy ? <Spinner size={14} /> : <Camera size={16} />}{tr('사진 변경')}</button>
        {self.hasPhoto && <button className="button flat danger" disabled={busy} onClick={() => { void clearPhoto() }}><Trash2 size={16} />{tr('사진 삭제')}</button>}
      </div>
      {upload.busy && upload.status === 'upload' && <span className="box-note">{tr('사진을 올리는 중… {0}%', [Math.round(upload.progress * 100)])}</span>}
    </div>
    {upload.history.length > 0 && <div className="profile-history">
      <div className="section-label">{tr('이전 사진 · 눌러서 다시 사용')}</div>
      <div className="profile-history-grid">{upload.history.map(item => <div key={item.id} className="profile-history-item">
        <button type="button" className="profile-history-photo" disabled={busy} aria-label={tr('이 사진으로 바꾸기')} onClick={() => { void restorePhoto(item.id) }}><img src={item.preview} alt="" draggable={false} /></button>
        <button type="button" className="profile-history-remove" aria-label={tr('기록에서 지우기')} disabled={busy} onClick={() => { void forgetPhoto(item.id) }}><X size={12} /></button>
      </div>)}</div>
    </div>}
    <div className="section-divider" />
    <Entry icon={<User size={20} />} label={self.displayName} detail={tr('이름')} chevron={false} onClick={editName} />
    <Entry icon={<FileText size={20} />} label={self.bio || tr('소개 추가')} detail={tr('소개')} chevron={false} onClick={editBio} />
    {self.userId && <Entry icon={<AtSign size={20} />} label={`@${self.userId}`} detail={tr('Morse ID · 눌러서 복사')} chevron={false} onClick={() => { void copyId() }} />}
    {/* iOS shows the plan and keeps the purchase screen off (MorseFeatureFlags.premiumPurchaseUIEnabled = false). */}
    <Entry icon={<Crown size={20} />} label={tr('Morse 프리미엄')} detail={self.premium ? tr('프리미엄 사용 중 · 계정 4개, 메시지 고정 10개') : tr('무료 플랜 · 계정 2개, 메시지 고정 3개')} chevron={false}
      onClick={() => { if (!self.premium) controller.toast(tr('공개 예정')) }} />
    {/* tdesktop's My Profile shows the account's stories; Morse keeps adding and viewing them here. */}
    <div className="section-divider" />
    <Entry icon={<ImagePlus size={20} />} label={tr('스토리 올리기')} onClick={() => showStoryComposer(accountUid)} />
    <Entry icon={<History size={20} />} label={tr('내 스토리')} onClick={() => showOwnStoryViewer(accountUid)} />
    {self.userId && <Entry icon={<QrCodeIcon size={20} />} label={tr('내 프로필 공유')} detail={tr('QR 코드와 링크')} onClick={() => showProfileShareBox(self.displayName, self.userId, state.photo.status === 'ready' ? state.photo.url : null)} />}
  </>
}

interface StorageRow { key: string; title: string; detail: string; remove(): Promise<void>; open?(): void }

function StorageSection({ title, used, limit, rows, empty, onRemove }: { title: string; used: number; limit: number; rows: StorageRow[]; empty: string; onRemove(row: StorageRow): void }) {
  return <div className="storage-section">
    <div className="section-label">{title}</div>
    <p className="storage-usage">{tr('{0} / {1} 사용', [bytes(used), bytes(limit)])}</p>
    {!rows.length ? <p className="settings-note">{empty}</p> : rows.map(row => <div key={row.key} className="storage-row">
      <span className="storage-row-text"><strong className="ellipsis">{row.title}</strong><small>{row.detail}</small></span>
      {row.open && <button className="icon-button small" aria-label={tr('{0} 대화 열기', [row.title])} onClick={row.open}><MessageSquare size={18} /></button>}
      <button className="icon-button small" aria-label={tr('{0} 지우기', [row.title])} onClick={() => onRemove(row)}><Trash2 size={18} /></button>
    </div>)}
  </div>
}

// Device storage kept for this account: chat background photos, contact photos and voice drafts.
function StoragePage({ accountUid, onOpenChat }: { accountUid: string; onOpenChat(chatId: string): void }) {
  const [backgrounds, setBackgrounds] = useState<BackgroundStorageSnapshot | null>(null)
  const [photos, setPhotos] = useState<ContactPhotoStorage | null>(null)
  const [voices, setVoices] = useState<VoiceDraftStorageSnapshot | null>(null)
  const [loading, setLoading] = useState(true), [reload, setReload] = useState(0)
  useEffect(() => {
    let alive = true
    setLoading(true)
    void Promise.allSettled([window.morse.backgroundStorage(accountUid), window.morse.contactPhotoStorage(accountUid), window.morse.voiceDraftStorage(accountUid)]).then(([background, photo, voice]) => {
      if (!alive) return
      setBackgrounds(background.status === 'fulfilled' ? background.value : null)
      setPhotos(photo.status === 'fulfilled' ? photo.value : null)
      setVoices(voice.status === 'fulfilled' ? voice.value : null)
      setLoading(false)
    })
    return () => { alive = false }
  }, [accountUid, reload])
  async function remove(row: StorageRow): Promise<void> {
    if (!await confirmBox({ title: tr('보관 파일 지우기'), text: tr('‘{0}’을(를) 이 기기에서 지울까요?', [row.title]), confirm: tr('지우기'), danger: true })) return
    try { await trackWrite(row.remove()); controller.toast(tr('지웠습니다.')) }
    catch (reason) { controller.toast(errorText(reason, tr('지우지 못했습니다.')), 'error') }
    finally { setReload(value => value + 1) }
  }
  if (loading) return <div className="empty-state"><Spinner size={22} /></div>
  return <>
    <p className="settings-note">{tr('이 기기에만 보관된 파일입니다. 지워도 서버의 대화와 연락처는 바뀌지 않습니다.')}</p>
    {backgrounds ? <StorageSection title={tr('대화 배경 사진')} used={backgrounds.bytes} limit={backgrounds.limit} empty={tr('보관한 대화 배경 사진이 없습니다.')} onRemove={row => { void remove(row) }}
      rows={backgrounds.items.map(item => ({ key: `${item.chatId}:${item.photoId}`, title: item.title || tr('대화 목록에 없는 대화'), detail: bytes(item.bytes),
        remove: () => window.morse.removeStoredBackground(accountUid, { token: backgrounds.token, chatId: item.chatId, version: item.version, photoId: item.photoId, operationId: crypto.randomUUID() }) }))} />
      : <p className="settings-note">{tr('대화 배경 보관 정보를 불러오지 못했습니다.')}</p>}
    <div className="section-divider" />
    {photos ? <StorageSection title={tr('연락처 개인 사진')} used={photos.bytes} limit={photos.limit} empty={tr('보관한 연락처 사진이 없습니다.')} onRemove={row => { void remove(row) }}
      rows={photos.items.map(item => ({ key: `${item.uid}:${item.photoId}`, title: item.name || tr('연락처에 없는 사용자'), detail: bytes(item.bytes),
        remove: () => window.morse.removeStoredContactPhoto(accountUid, { token: photos.token, uid: item.uid, version: item.version, photoId: item.photoId, operationId: crypto.randomUUID() }) }))} />
      : <p className="settings-note">{tr('연락처 사진 보관 정보를 불러오지 못했습니다.')}</p>}
    <div className="section-divider" />
    {voices ? <StorageSection title={tr('보내지 않은 음성')} used={voices.bytes} limit={voices.limit} empty={tr('보관한 음성 초안이 없습니다.')} onRemove={row => { void remove(row) }}
      rows={voices.items.map(item => ({ key: `${item.chatId}:${item.voice.id}`, title: item.title || tr('대화 목록에 없는 대화'), detail: bytes(item.voice.bytes),
        remove: () => window.morse.removeStoredVoiceDraft(accountUid, { chatId: item.chatId, revision: item.revision, id: item.voice.id, token: voices.token, operationId: crypto.randomUUID() }),
        // The chat opens through main's check that this draft still belongs to it.
        open: item.listed ? () => { void window.morse.resolveVoiceDraftNavigation(accountUid, { chatId: item.chatId, revision: item.revision, id: item.voice.id, token: voices.token })
          .then(result => onOpenChat(result.chatId)).catch(reason => controller.toast(errorText(reason, tr('대화를 열지 못했습니다.')), 'error')) } : undefined }))} />
      : <p className="settings-note">{tr('음성 초안 보관 정보를 불러오지 못했습니다.')}</p>}
  </>
}

// iOS DataStorageView: what Morse keeps on this computer, the photo send quality, and power saving.
function DataPage({ preferences, onPage }: { preferences: Preferences; onPage(page: Page): void }) {
  const [cache, setCache] = useState<number | null>(null), [clearing, setClearing] = useState(false)
  useEffect(() => { void window.morse.cacheUsage().then(value => setCache(Number.isFinite(value) ? value : null)).catch(() => setCache(null)) }, [clearing])
  const { active } = usePowerSaving()
  async function clear(): Promise<void> {
    if (clearing || !await confirmBox({ title: tr('캐시 정리'), text: tr('{0}의 캐시를 정리해요.\n메시지는 삭제되지 않으며, 필요할 때 다시 다운로드돼요.', [bytes(cache ?? 0)]), confirm: tr('정리') })) return
    setClearing(true)
    try { await window.morse.clearCache(); controller.toast(tr('캐시가 정리됐어요')) }
    catch (reason) { controller.toast(errorText(reason, tr('캐시를 정리하지 못했습니다.')), 'error') }
    finally { setClearing(false) }
  }
  return <>
    <div className="section-label">{tr('Morse가 사용 중인 저장공간')}</div>
    <Entry icon={<Trash2 size={20} />} label={clearing ? tr('정리 중...') : tr('캐시 정리')} detail={cache === null ? '' : bytes(cache)} chevron={false} onClick={() => { void clear() }} />
    <Entry icon={<HardDrive size={20} />} label={tr('이 기기에 보관한 파일')} detail={tr('대화 배경, 연락처 사진, 보내지 않은 음성')} onClick={() => onPage('storage')} />
    <div className="section-divider" />
    <div className="section-label">{tr('전송 화질')}</div>
    {preferences.compressMediaUploads || active ? <p className="settings-note">{tr('절전 모드의 업로드 자동 압축이 켜져 있어 사진을 압축해서 보내요.')}</p> : null}
    {([['auto', tr('자동'), tr('긴 변 720px')], ['original', tr('원본'), tr('긴 변 2560px까지')], ['compressed', tr('압축'), tr('긴 변 512px')]] as const).map(([id, label, detail]) =>
      <label key={id} className="settings-radio"><input type="radio" name="photo-quality" checked={preferences.photoSendQuality === id} onChange={() => update({ photoSendQuality: id })} /><span>{tr('사진 화질 · {0}', [label])}<small>{detail}</small></span></label>)}
    {preferences.compressMediaUploads || active ? <p className="settings-note">{tr('절전 모드의 업로드 자동 압축이 켜져 있어 동영상을 360p로 압축해서 보내요.')}</p> : null}
    {([['auto', tr('자동'), '480p (960×540)'], ['original', tr('원본'), '720p (1280×720)'], ['compressed', tr('압축'), '360p']] as const).map(([id, label, detail]) =>
      <label key={id} className="settings-radio"><input type="radio" name="video-quality" checked={preferences.videoSendQuality === id} onChange={() => update({ videoSendQuality: id })} /><span>{tr('영상 화질 · {0}', [label])}<small>{detail}</small></span></label>)}
    <div className="section-divider" />
    <div className="section-label">{tr('절전 모드')}</div>
    <Entry icon={<BatteryLow size={20} />} label={tr('절전')} detail={active ? tr('켜짐') : tr('꺼짐')} onClick={() => onPage('power')} />
  </>
}

// iOS LanguagePickerView: 한국어, Русский and English, the current one checked. The window's words and main's labels
// are read when Morse starts, so a new choice is saved and Morse starts again (drafts are saved on the way out).
const languageFlags: Readonly<Record<Language, string>> = { ko: '🇰🇷', ru: '🇷🇺', en: '🇺🇸' }
function LanguagePage() {
  const current = window.morse.language
  const [busy, setBusy] = useState(false)
  async function choose(next: Language): Promise<void> {
    if (busy || next === current) return
    if (!await confirmBox({ title: languageNames[next], text: tr('언어를 바꾸려면 Morse를 다시 시작해야 해요. 작성 중인 내용은 저장돼요.'), confirm: tr('다시 시작') })) return
    setBusy(true)
    try { desktop.replace(await window.morse.updatePreferences({ language: next })); await window.morse.relaunchApp() }
    catch (reason) { controller.toast(errorText(reason, tr('설정을 저장하지 못했습니다.')), 'error'); setBusy(false) }
  }
  return <>
    <p className="settings-note">{tr('언어를 바꾸면 Morse가 다시 시작돼요')}</p>
    {languages.map(id => <button key={id} type="button" className="settings-language" lang={id} disabled={busy} aria-pressed={id === current} onClick={() => { void choose(id) }}>
      <span className="settings-language-flag" aria-hidden="true">{languageFlags[id]}</span>
      <span className="settings-language-text"><strong>{languageNames[id]}</strong><small>{id.toUpperCase()}</small></span>
      {id === current && <CircleCheck size={22} className="settings-language-check" />}
    </button>)}
  </>
}

// iOS PowerSavingView: turned on always or by a low battery, and then every option applies.
function PowerSavingPage({ preferences }: { preferences: Preferences }) {
  const { active, effective } = usePowerSaving()
  const option = (key: 'compressMediaUploads' | 'reduceMessageAnimations' | 'disableTypingIndicators', label: string, detail: string) =>
    <Toggle label={label} detail={detail} checked={effective(key)} disabled={active} onChange={value => update({ [key]: value })} />
  return <>
    <div className="settings-hero"><strong>{tr('배터리를 더 오래')}</strong><span>{tr('애니메이션, 업로드 크기와 입력 중 표시를 조정해 배터리 사용을 줄여요')}</span></div>
    {active && <p className="settings-note">{tr('절전 모드 활성화됨 · 절전 모드가 켜져 있는 동안 모든 옵션이 적용돼요. 바꾸려면 절전 모드를 끄거나 충전하세요.')}</p>}
    <div className="section-label">{tr('자동화')}</div>
    <Toggle label={tr('배터리 부족 시 자동')} detail={tr('20% 이하로 떨어지면 절전 모드 자동 켜짐')} checked={preferences.powerSavingAuto} onChange={value => update({ powerSavingAuto: value })} />
    <Toggle label={tr('항상 켜기')} detail={tr('배터리 상태와 무관하게 모든 절전 옵션 활성화')} checked={preferences.powerSavingAlwaysOn} onChange={value => update({ powerSavingAlwaysOn: value })} />
    <div className="section-label">{tr('미디어')}</div>
    {option('compressMediaUploads', tr('업로드 자동 압축'), tr('사진을 보낼 때 자동으로 압축'))}
    <div className="section-label">{tr('인터페이스')}</div>
    {option('reduceMessageAnimations', tr('메시지 애니메이션 줄이기'), tr('스크롤, 등장 효과 단순화'))}
    {option('disableTypingIndicators', tr('입력 중 표시 끄기'), tr('상대방의 입력 중 표시 안 받음'))}
  </>
}

// AccountSecurityView «프로필·Morse ID»: private mode keeps the Morse ID out of search.
function AccountPrivacySection({ accountUid }: { accountUid: string }) {
  const [value, setValue] = useState<AccountPrivacy | null>(null), [busy, setBusy] = useState(false)
  useEffect(() => { void window.morse.accountPrivacy(accountUid).then(setValue).catch(() => setValue(null)) }, [accountUid])
  async function change(next: boolean): Promise<void> {
    if (!value || busy) return
    setBusy(true); setValue({ ...value, isPrivate: next })
    try { await trackWrite(window.morse.setPrivateMode(accountUid, next)) }
    catch (reason) { setValue({ ...value, isPrivate: !next }); controller.toast(errorText(reason, tr('비공개 모드를 바꾸지 못했습니다.')), 'error') }
    finally { setBusy(false) }
  }
  return <>
    <div className="section-label">{tr('프로필·Morse ID')}</div>
    <Toggle label={tr('비공개 모드')} detail={tr('Morse ID 검색에 나오지 않아요')} checked={value?.isPrivate ?? false} disabled={!value || busy} onChange={next => { void change(next) }} />
    <div className="section-divider" />
  </>
}

// AccountSecurityView «자동 회원 탈퇴» (AutoDeleteAccountSheet): the account goes after this long without a visit.
const autoDeleteLabels: Record<number, [string, string]> = { 0: [tr('끔'), tr('자동 삭제 안 함')], 1: [tr('1개월'), tr('30일 미접속 시')], 3: [tr('3개월'), tr('90일 미접속 시')], 6: [tr('6개월'), tr('180일 미접속 시 (기본)')], 12: [tr('1년'), tr('365일 미접속 시')] }
function AutoDeleteEntry({ accountUid }: { accountUid: string }) {
  const [months, setMonths] = useState<number | null>(null)
  useEffect(() => { void window.morse.accountPrivacy(accountUid).then(value => setMonths(value.autoDeleteMonths)).catch(() => setMonths(null)) }, [accountUid])
  const open = (): void => { controller.showLayer(close => <Box title={tr('자동 회원 탈퇴')} width={380} onClose={close} buttons={<button className="button flat" onClick={close}>{tr('완료')}</button>}>
    <p className="box-text">{tr('미접속 기간이 지나면 계정 자동 삭제\nMorse의 "흔적 없는" 컨셉을 위한 마지막 보호 장치', [])}</p>
    {autoDeleteMonthOptions.map(value => <label key={value} className="settings-radio"><input type="radio" name="auto-delete-months" defaultChecked={months === value}
      onChange={() => { setMonths(value); void window.morse.setAutoDeleteMonths(accountUid, value).catch(reason => controller.toast(errorText(reason, tr('자동 회원 탈퇴 기간을 저장하지 못했습니다.')), 'error')) }} />
      <span>{autoDeleteLabels[value]![0]}<small>{autoDeleteLabels[value]![1]}</small></span></label>)}
  </Box>) }
  return <Entry icon={<Timer size={20} />} label={tr('자동 회원 탈퇴')} detail={months === null ? '' : autoDeleteLabels[months]?.[0] ?? tr('{0}개월', [months])} onClick={open} />
}

// AccountSecurityView DataExportSheet: the server prepares a JSON file and a download address that expires.
function DataExportBox({ accountUid, close }: { accountUid: string; close(): void }) {
  const [busy, setBusy] = useState(false), [result, setResult] = useState<DataExport | null>(null), [error, setError] = useState('')
  async function start(): Promise<void> {
    if (busy) return
    setBusy(true); setError('')
    try { setResult(await window.morse.requestDataExport(accountUid)) }
    catch (reason) { setError(tr('익스포트 실패: {0}', [errorText(reason, tr('다시 시도해 주세요.'))])) }
    finally { setBusy(false) }
  }
  return <Box title={tr('내 데이터 다운로드')} width={400} onClose={close} buttons={<button className="button flat" onClick={close}>{tr('닫기')}</button>}>
    <p className="box-text">{tr('Morse가 보유한 내 정보 전체를\nJSON 파일로 다운로드할 수 있어요', [])}</p>
    <div className="section-label">{tr('포함되는 정보')}</div>
    <ul className="export-list"><li>{tr('프로필 정보 (사용자 ID, 표시명)')}</li><li>{tr('연락처 목록')}</li><li>{tr('채널 구독 정보')}</li><li>{tr('차단된 사용자 목록')}</li><li>{tr('앱 설정 값')}</li></ul>
    {result ? <>
      <p className="box-note">{tr('{0} JSON 파일 준비됨 · {1}까지', [bytes(result.fileSizeBytes), new Date(result.expiresAt).toLocaleString(locale())])}</p>
      <button className="button primary block" onClick={() => { void window.morse.openDataExport(result.downloadURL).catch(reason => controller.toast(errorText(reason, tr('내려받지 못했습니다.')), 'error')) }}><Download size={16} />{tr('내려받기')}</button>
    </> : <button className="button primary block" disabled={busy} onClick={() => { void start() }}>{busy ? <><Spinner size={14} />{tr('요청 중...')}</> : tr('다운로드 요청')}</button>}
    <p className="box-note">{tr('처리에 최대 1분이 걸려요. 메시지 본문은 E2E 암호화되어 포함되지 않아요.')}</p>
    {error && <p className="box-error" role="alert">{error}</p>}
  </Box>
}
function showDataExportBox(accountUid: string): void { controller.showLayer(close => <DataExportBox accountUid={accountUid} close={close} />) }

// Settings::Main as a layer with its own back navigation.
function SettingsBox({ accountUid, initialPage, close }: { accountUid: string; initialPage: Page; close(): void }) {
  const [page, setPage] = useState<Page>(initialPage)
  const preferences = useDesktop(state => state?.preferences ?? null)
  const profile = useDesktop(state => state?.selfProfile ?? null)
  const account = useDesktop(state => state?.accounts.find(item => item.uid === state.activeAccountUid) ?? null)
  const notifications = useDesktop(state => state?.notifications ?? null)
  const integration = useDesktop(state => state?.platformIntegration ?? null)
  const appVersion = useDesktop(state => state?.appVersion ?? '')
  const [notices, setNotices] = useState<string | null>(null)
  useEffect(() => {
    if (page !== 'about' || notices !== null) return
    void window.morse.thirdPartyNotices().then(setNotices).catch(() => setNotices(''))
  }, [page, notices])
  const lockEnabled = useDesktop(value => value?.appLock?.enabled ?? false)
  const otherAccounts = useDesktop(value => (value?.accountStates.length ?? 0) > 1)
  if (!preferences) return null
  const name = profile?.profile?.displayName || account?.displayName || ''
  const userId = profile?.profile?.userId || account?.userId || ''
  async function signOut(): Promise<void> {
    if (!await confirmBox({ title: tr('로그아웃'), text: tr('이 계정의 이 기기 로그인, 로컬 초안과 미완료 전송 기록을 지웁니다. 계정과 서버에 저장된 대화는 삭제하지 않습니다.{0}', [otherAccounts ? tr(' 다른 계정은 계속 연결되어 있어요.') : '']), confirm: tr('로그아웃'), danger: true })) return
    try { close(); await window.morse.authentication.signOut() }
    catch (reason) { controller.toast(errorText(reason, tr('로그아웃하지 못했습니다.')), 'error') }
  }
  return <section className="box settings-box" role="dialog" aria-modal="true" aria-label={titles[page]}>
    <header className="box-title">
      {page !== 'main' && <button className="icon-button small" aria-label={tr('뒤로')} onClick={() => setPage(parents[page] ?? 'main')}><ArrowLeft size={18} /></button>}
      <h2>{titles[page]}</h2>
      <button className="icon-button small" aria-label={tr('닫기')} data-autofocus onClick={close}><X size={18} /></button>
    </header>
    <div className="settings-body">
      {page === 'main' && <>
        <button type="button" className="settings-profile editable" onClick={() => setPage('profile')}>
          <Avatar name={name || 'M'} url={profile?.photo.status === 'ready' ? profile.photo.url : null} size={64} />
          <span className="settings-profile-text"><strong className="ellipsis">{name}</strong>{userId && <span>@{userId}</span>}</span>
        </button>
        <div className="section-label">{tr('계정')}</div>
        <AccountsList variant="settings" onDone={close} />
        <Entry icon={<User size={20} />} label={tr('내 정보')} detail={tr('사진, 이름, 소개')} onClick={() => setPage('profile')} />
        <Entry icon={<Bell size={20} />} label={tr('알림')} onClick={() => setPage('notifications')} />
        <Entry icon={<MessageSquare size={20} />} label={tr('채팅 설정')} detail={tr('테마, 배경, 글자 크기, 보내기 키')} onClick={() => setPage('chat')} />
        <Entry icon={<Shield size={20} />} label={tr('개인정보')} onClick={() => setPage('privacy')} />
        <Entry icon={<Globe size={20} />} label={tr('언어')} detail={languageNames[window.morse.language]} onClick={() => setPage('language')} />
        <Entry icon={<HardDrive size={20} />} label={tr('데이터 및 저장공간')} detail={tr('사진 화질, 캐시, 절전')} onClick={() => setPage('data')} />
        <Entry icon={<Keyboard size={20} />} label={tr('키보드 단축키')} onClick={() => showShortcutsBox(desktop.value?.platform ?? 'unsupported')} />
        {/* SettingsView: 기능 소개 · 고객 센터 · 개인정보처리방침 · 커뮤니티 가이드라인. */}
        <div className="section-divider" />
        <Entry icon={<Lightbulb size={20} />} label={tr('기능 소개')} onClick={showGuideBox} />
        <Entry icon={<CircleHelp size={20} />} label={tr('고객 센터')} onClick={() => showSupportBox(accountUid, appVersion)} />
        <Entry icon={<ShieldCheck size={20} />} label={tr('개인정보처리방침')} onClick={() => openPolicy('privacy')} />
        <Entry icon={<Users size={20} />} label={tr('커뮤니티 가이드라인')} onClick={() => openPolicy('community')} />
        <Entry icon={<Info size={20} />} label={tr('Morse Desktop 정보')} onClick={() => setPage('about')} />
        <div className="section-divider" />
        <Entry icon={<LogOut size={20} />} label={tr('로그아웃')} danger onClick={() => { void signOut() }} />
      </>}
      {page === 'profile' && <ProfilePage accountUid={accountUid} />}
      {page === 'notifications' && <>
        {notifications && !notifications.supported && <p className="settings-note">{notifications.message}</p>}
        <Toggle label={tr('데스크톱 알림')} checked={preferences.notifications} disabled={notifications?.supported === false} onChange={value => update({ notifications: value })} />
        {/* iOS NotificationSettingsView: 알림 받기 · 알림 방식 · 앱 사용 중 · 앱 아이콘 배지. */}
        <div className="section-label">{tr('알림 받기')}</div>
        <Toggle label={tr('개인 채팅')} detail={tr('1:1 메시지 알림')} checked={preferences.notifyPersonal} disabled={!preferences.notifications} onChange={value => update({ notifyPersonal: value })} />
        <Toggle label={tr('그룹 채팅')} detail={tr('그룹 메시지 알림')} checked={preferences.notifyGroup} disabled={!preferences.notifications} onChange={value => update({ notifyGroup: value })} />
        <Toggle label={tr('채널')} detail={tr('구독한 채널의 새 게시물')} checked={preferences.notifyChannel} disabled={!preferences.notifications} onChange={value => update({ notifyChannel: value })} />
        <div className="section-label">{tr('알림 방식')}</div>
        <Toggle label={tr('소리')} checked={preferences.notificationSound} disabled={!preferences.notifications} onChange={value => update({ notificationSound: value })} />
        <Toggle label={tr('메시지 미리보기')} detail={tr('알림에 보낸 사람과 내용을 표시합니다')} checked={preferences.showNotificationPreview} disabled={!preferences.notifications} onChange={value => update({ showNotificationPreview: value })} />
        <div className="section-label">{tr('앱 사용 중')}</div>
        <Toggle label={tr('앱 사용 중 알림')} detail={tr('Morse를 사용하는 동안 다른 메시지 도착 시 표시')} checked={preferences.inAppNotifications} disabled={!preferences.notifications} onChange={value => update({ inAppNotifications: value })} />
        <div className="section-label">{tr('앱 아이콘 배지')}</div>
        <Toggle label={tr('배지 표시')} detail={tr('Dock 아이콘에 알림 카운트 표시')} checked={preferences.showUnreadBadge} onChange={value => update({ showUnreadBadge: value })} />
        {preferences.showUnreadBadge && <>
          <label className="settings-radio"><input type="radio" name="badge-mode" checked={preferences.badgeMode === 'messages'} onChange={() => update({ badgeMode: 'messages' })} /><span>{tr('메시지 수')}<small>{tr('안 읽은 메시지 총 개수')}</small></span></label>
          <label className="settings-radio"><input type="radio" name="badge-mode" checked={preferences.badgeMode === 'chats'} onChange={() => update({ badgeMode: 'chats' })} /><span>{tr('채팅 수')}<small>{tr('안 읽은 채팅방 개수')}</small></span></label>
        </>}
        {integration?.trayAvailable && <Toggle label={tr('창을 닫으면 트레이로 최소화')} checked={preferences.closeToTray} onChange={value => update({ closeToTray: value })} />}
      </>}
      {page === 'chat' && <>
        <div className="section-label"><Palette size={14} />{' '}{tr('테마')}</div>
        {themes.map(theme => <label key={theme.id} className="settings-radio">
          <input type="radio" name="theme" checked={preferences.theme === theme.id} onChange={() => update({ theme: theme.id })} /><span>{theme.label}</span>
        </label>)}
        <div className="section-divider" />
        <Entry icon={<FolderOpen size={20} />} label={tr('채팅 폴더')} detail={tr('폴더 추가, 편집, 순서 바꾸기')} onClick={() => showFoldersBox(accountUid)} />
        <Entry icon={<Timer size={20} />} label={tr('자동 삭제 메시지')} detail={tr('새 채팅 기본값 · {0}', [autoDeleteOptions.find(item => item.seconds === preferences.autoDeleteDefaultSeconds)?.label ?? tr('자동 삭제 꺼짐')])} onClick={showAutoDeleteDefaultsBox} />
        <Entry icon={<ImageIcon size={20} />} label={tr('기본 채팅 배경')} detail={tr('따로 정하지 않은 대화에 적용')} onClick={() => showChatBackgroundBox(accountUid, null)} />
        <div className="section-divider" />
        <div className="section-label">{tr('메시지 글자 크기 · {0}', [preferences.messageFontSize])}</div>
        <div className="settings-slider"><span>A</span><input type="range" min={13} max={20} step={1} value={preferences.messageFontSize} aria-label={tr('메시지 글자 크기')} onChange={event => update({ messageFontSize: Number(event.target.value) })} /><span className="large">A</span></div>
        <div className="section-divider" />
        <Toggle label={tr('Enter로 보내기')} detail={preferences.enterToSend ? tr('Shift + Enter로 줄을 바꿉니다') : tr('⌘/Ctrl + Enter로 보냅니다')} checked={preferences.enterToSend} onChange={value => update({ enterToSend: value })} />
        <Toggle label={tr('맞춤법 검사')} checked={preferences.spellCheck} onChange={value => update({ spellCheck: value })} />
        {/* Telegram Settings > Advanced > Automatic media download. */}
        <Toggle label={tr('사진 자동 내려받기')} detail={preferences.autoDownloadPhotos ? tr('받은 사진을 말풍선에 바로 보여 줍니다') : tr('사진을 누르면 내려받습니다')}
          checked={preferences.autoDownloadPhotos} onChange={value => update({ autoDownloadPhotos: value })} />
        <div className="section-divider" />
        <div className="section-label">{tr('프라이버시')}</div>
        <Toggle label={tr('입력 중 표시 보내기')} detail={tr('상대방에게 입력 중인 상태 알리기')} checked={preferences.sendTypingIndicator} onChange={value => update({ sendTypingIndicator: value })} />
      </>}
      {page === 'privacy' && <>
        <AccountPrivacySection accountUid={accountUid} />
        <Entry icon={<Star size={20} />} label={tr('친한 친구')} detail={tr('친한 친구 공개 스토리를 볼 수 있는 사람')} onClick={() => showCloseFriendsBox(accountUid)} />
        <div className="section-divider" />
        <Toggle label={tr('스토리 몰래 보기')} detail={tr('켜면 연락처의 스토리를 볼 때 열람 기록을 남기지 않습니다')} checked={preferences.storyStealth} onChange={value => update({ storyStealth: value })} />
        <div className="section-divider" />
        <Entry icon={<Clock3 size={20} />} label={tr('마지막 접속')} detail={tr('내 마지막 접속 시간을 볼 수 있는 사람')} onClick={() => showLastSeenBox(accountUid)} />
        <Entry icon={<ShieldOff size={20} />} label={tr('차단한 사용자')} detail={tr('차단 목록 보기와 해제')} onClick={() => showBlockedUsersBox(accountUid)} />
        <div className="section-divider" />
        <div className="section-label">{tr('보안')}</div>
        <Entry icon={<Lock size={20} />} label={tr('로컬 암호')} detail={lockEnabled ? tr('켜짐') : tr('꺼짐')} onClick={() => showPasscodeSettings(lockEnabled)} />
        <Entry icon={<KeyRound size={20} />} label={tr('로그인한 기기')} detail={tr('다른 기기에서 로그아웃')} onClick={() => showSessionsBox(accountUid)} />
        <Entry icon={<KeyRound size={20} />} label={tr('복구 코드 바꾸기')} detail={tr('새 복구 코드를 만들어요')} onClick={() => { void changeBackupCode(accountUid) }} />
        <div className="section-divider" />
        <div className="section-label">{tr('데이터 관리')}</div>
        <Entry icon={<Download size={20} />} label={tr('내 데이터 다운로드')} detail={tr('내 데이터를 가져가세요')} onClick={() => showDataExportBox(accountUid)} />
        <AutoDeleteEntry accountUid={accountUid} />
        <div className="section-divider" />
        <Entry icon={<Trash2 size={20} />} label={tr('회원 탈퇴')} detail={tr('계정과 모든 데이터를 영구 삭제')} onClick={() => { void deleteAccount(accountUid, profile?.profile?.userId ?? '', close) }} />
      </>}
      {page === 'data' && <DataPage preferences={preferences} onPage={setPage} />}
      {page === 'power' && <PowerSavingPage preferences={preferences} />}
      {page === 'language' && <LanguagePage />}
      {page === 'storage' && <StoragePage accountUid={accountUid} onOpenChat={chatId => { close(); controller.openChat(chatId) }} />}
      {page === 'about' && <div className="settings-about">
        <img src="/morse.png" alt="" /><strong>Morse Desktop</strong><span>{tr('버전 {0}', [appVersion])}</span>
        <UpdateStatus />
        <p className="settings-note">{tr('GNU GPL v3 이상으로 배포합니다. 일부 구조와 코드는 Telegram Desktop에서 가져왔습니다.')}</p>
        <button type="button" className="button flat" onClick={() => { void window.morse.openMessageLink(releaseSourceURL).catch(() => controller.toast(tr('페이지를 열지 못했습니다.'), 'error')) }}>{tr('소스 코드')}</button>
        {notices === null ? <Spinner size={18} /> : notices && <pre className="settings-notices selectable">{notices}</pre>}
      </div>}
    </div>
  </section>
}

// The main menu's «내 프로필» opens straight at the profile (tdesktop MainMenu My Profile).
export function showSettingsBox(accountUid: string, page: Page = 'main'): void {
  controller.showLayer(close => <SettingsBox accountUid={accountUid} initialPage={page} close={close} />)
}
