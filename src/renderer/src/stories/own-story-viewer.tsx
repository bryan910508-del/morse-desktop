import { useEffect, useRef, useState, type ReactNode } from 'react'
import { ChevronLeft, ChevronRight, EllipsisVertical, Eye, EyeOff, Globe, Link, Pause, Pencil, Play, Star, Trash2, Users, Volume2, VolumeX, X } from 'lucide-react'
import { storyPrivacyNames, type OwnStoryRow, type StoryPrivacy } from '../../../shared/own-stories'
import { firstStoryCaptionLink } from '../../../shared/story-caption-link'
import type { ContactSummary } from '../../../shared/contacts'
import type { StoryViewRecordsResult } from '../../../shared/story-view-records'
import { positionMilliseconds } from '../../../shared/model'
import { desktop, useDesktop } from '../app/store'
import { controller } from '../app/ui'
import { errorText } from '../app/format'
import { trackWrite } from '../app/drafts'
import { waitFor } from '../app/contacts'
import { runJournal } from '../app/channel-publish'
import { useShortcut } from '../app/shortcuts'
import { showTextEditBox } from '../boxes/text-edit-box'
import { PeerPicker } from '../boxes/peer-picker'
import { Avatar } from '../ui/avatar'
import { Spinner } from '../ui/controls'
import { Box, confirmBox } from '../ui/layers'
import { popupMenu, pointFor } from '../ui/popup-menu'
import { storyAgo, storyKind, StoryMediaView, usePageHidden, useStoryProgress, type StoryKind, type StoryMediaSource } from './story-viewer'
import { UserAvatar } from '../ui/user-avatar'
import { locale, tr } from '../../../shared/i18n'

const privacies: StoryPrivacy[] = ['everyone', 'contacts']
const privacyIcons: Record<StoryPrivacy, ReactNode> = { everyone: <Globe size={16} />, contacts: <Users size={16} />, closeFriends: <Star size={16} /> }
const moveLabels: Record<StoryPrivacy, string> = { everyone: tr('전체 공개로 변경'), contacts: tr('연락처만 보기로 변경'), closeFriends: tr('친한 친구만 보기로 변경') }
const noContacts: ContactSummary[] = []

interface Selected { requestId: string; row: OwnStoryRow }

// OwnStories lists one privacy collection at a time; media requires the story
// to be the selected item of the currently open list.
interface OwnPage { requestId: string; rows: OwnStoryRow[]; number: number; next: { storyId: string; version: string } | null }
const maxOwnPages = 20
async function ownPage(requestId: string): Promise<OwnPage> {
  const state = await waitFor(() => { const value = desktop.value?.ownStories; return value?.requestId === requestId && value.status !== 'loading' && value.status !== 'idle' ? value : null }, 15000, tr('내 스토리를 불러오지 못했습니다.'))
  if (state.status !== 'ready') throw new Error(state.message || tr('내 스토리를 불러오지 못했습니다.'))
  return { requestId, rows: state.rows, number: state.page.number, next: state.limited ? state.page.next : null }
}
async function openPrivacy(accountUid: string, privacy: StoryPrivacy): Promise<OwnPage> {
  const requestId = crypto.randomUUID()
  await window.morse.openOwnStories(accountUid, { requestId, privacy })
  return ownPage(requestId)
}
// One page (50 stories) is open at a time; turning replaces it.
async function turnOwnPage(accountUid: string, current: { requestId: string; next: OwnPage['next'] }, direction: 'next' | 'previous'): Promise<OwnPage> {
  const nextRequestId = crypto.randomUUID(), boundary = direction === 'next' ? current.next : null
  await window.morse.pageOwnStories(accountUid, { requestId: current.requestId, nextRequestId, direction, storyId: boundary?.storyId ?? null, version: boundary?.version ?? null })
  return ownPage(nextRequestId)
}

function ownSource(accountUid: string, requestId: string, row: OwnStoryRow, kind: StoryKind): StoryMediaSource {
  const selectionId = crypto.randomUUID(), audioId = crypto.randomUUID()
  const base = { requestId, storyId: row.id, version: row.version }
  const quiet = (task: Promise<void>): void => { void task.catch(() => {}) }
  if (kind === 'video') {
    const mode = row.audio === 'attached' ? 'with-audio' as const : 'original' as const
    return {
      open: () => window.morse.openOwnStoryVideo(accountUid, { ...base, selectionId, mode }),
      close: () => quiet(window.morse.closeOwnStoryVideo(accountUid, selectionId)),
      select: state => {
        const value = state?.ownStories?.video
        return value?.selectionId === selectionId ? { status: value.status, url: value.url, audioUrl: value.audioUrl, loaded: value.loaded, total: value.total, message: value.message } : null
      }
    }
  }
  return {
    open: async () => {
      await window.morse.openOwnStoryPhoto(accountUid, { ...base, selectionId, presentation: kind === 'poster' ? 'video-poster' : 'image' })
      if (kind === 'photo-audio') await window.morse.openOwnStoryAudio(accountUid, { ...base, selectionId: audioId })
    },
    close: () => { quiet(window.morse.closeOwnStoryPhoto(accountUid, selectionId)); if (kind === 'photo-audio') quiet(window.morse.closeOwnStoryAudio(accountUid, audioId)) },
    select: state => {
      const photo = state?.ownStories?.photo, audio = state?.ownStories?.audio
      if (photo?.selectionId !== selectionId) return null
      const sound = kind === 'photo-audio' && audio?.selectionId === audioId && audio.status === 'ready' ? audio.url : null
      return { status: photo.status, url: photo.url, audioUrl: sound, loaded: photo.loaded, total: photo.total, message: photo.message }
    }
  }
}

function OwnStoryMedia({ accountUid, requestId, row, ...props }: { accountUid: string; requestId: string; row: OwnStoryRow; paused: boolean; muted: boolean; onDuration(milliseconds: number): void; onTime(fraction: number): void; onEnded(): void; onShown(): void }) {
  const kind = storyKind(row)
  const [source] = useState(() => ownSource(accountUid, requestId, row, kind))
  return <StoryMediaView kind={kind} source={source} {...props} />
}

function ViewersBox({ result, contacts, close }: { result: StoryViewRecordsResult; contacts: ContactSummary[]; close(): void }) {
  const names = new Map(contacts.map(contact => [contact.uid, contact.displayName]))
  const rows = result.current?.rows ?? []
  return <Box title={<>{tr('조회한 사람')}<small className="box-title-count">{(result.current?.counts.viewers ?? 0).toLocaleString(locale())}</small></>} width={380} onClose={close}>
    {result.outcome !== 'ready' ? <div className="empty-state">{result.message || tr('조회 기록을 확인하지 못했습니다.')}</div>
      : !rows.length ? <div className="empty-state">{tr('아직 조회한 사람이 없습니다.')}</div>
        : <div className="peer-list tall">{rows.map(row => {
          const name = names.get(row.uid) ?? tr('연락처에 없는 사용자')
          return <div key={row.uid} className="peer-row">
            <UserAvatar uid={row.uid} name={name} size={42} />
            <span className="peer-row-text"><strong className="ellipsis">{name}</strong><small>{[row.viewed ? tr('조회함') : '', row.latestAt ? storyAgo(row.latestAt) : ''].filter(Boolean).join(' · ')}</small></span>
            {row.reaction && <span className="story-viewer-reaction" aria-label={tr('반응 {0}', [row.reaction])}>{row.reaction}</span>}
          </div>
        })}</div>}
  </Box>
}

// Stories::HiddenAudience: one contact is added or removed per change; the story
// version changes each time, so the selection is refreshed before the next one.
function HiddenAudienceBox({ accountUid, initial, refresh, close }: { accountUid: string; initial: Selected; refresh(target: Selected): Promise<Selected>; close(): void }) {
  const [target, setTarget] = useState(initial)
  const [hidden, setHidden] = useState<Set<string> | null>(null)
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  useEffect(() => {
    const id = crypto.randomUUID()
    let alive = true
    setHidden(null)
    void window.morse.readStoryHiddenAudience(accountUid, { id, requestId: target.requestId, storyId: target.row.id, privacy: target.row.privacy, version: target.row.version }).then(result => {
      if (!alive) return
      if (result.current) setHidden(new Set(result.current.hiddenFrom))
      else setError(result.message || tr('숨김 설정을 확인하지 못했습니다.'))
    }).catch(reason => { if (alive) setError(errorText(reason, tr('숨김 설정을 확인하지 못했습니다.'))) })
    return () => { alive = false; void window.morse.closeStoryHiddenAudience(accountUid, id).catch(() => {}) }
  }, [accountUid, target.requestId, target.row.version])
  async function toggle(uid: string): Promise<void> {
    if (!hidden || busy) return
    const mode = hidden.has(uid) ? 'remove' as const : 'add' as const
    setBusy(true); setError('')
    try {
      const result = await runJournal({
        current: () => desktop.value?.storyHiddenChange ?? null,
        refresh: () => window.morse.refreshStoryHiddenChange(accountUid),
        action: action => window.morse.storyHiddenChangeAction(accountUid, action),
        prepare: id => window.morse.prepareStoryHiddenChange(accountUid, { id, requestId: target.requestId, storyId: target.row.id, privacy: target.row.privacy, version: target.row.version, mode, peerUid: uid })
      }, {
        waiting: tr('이전 숨김 변경 결과를 확인하고 있습니다. 잠시 후 다시 시도해 주세요.'),
        denied: tr('지금은 숨김 설정을 바꿀 수 없습니다.'),
        rejected: tr('숨김 설정을 바꾸지 못했습니다.')
      })
      if (result !== 'done') controller.toast(tr('숨김 변경 결과를 확인하고 있습니다.'))
      setTarget(await refresh(target))
    } catch (reason) { setError(errorText(reason, tr('숨김 설정을 바꾸지 못했습니다.'))) }
    finally { setBusy(false) }
  }
  return <Box title={<>{tr('숨길 사람')}{hidden && <small className="box-title-count">{tr('{0}명', [hidden.size])}</small>}</>} width={400} buttons={<button className="button flat" data-autofocus onClick={close}>{tr('완료')}</button>}>
    <p className="box-note">{tr('선택한 연락처에게는 이 스토리가 보이지 않습니다. 바로 반영됩니다.')}</p>
    {error && <p className="box-error" role="alert">{error}</p>}
    {!hidden ? !error && <div className="empty-state"><Spinner size={22} /></div>
      : <PeerPicker accountUid={accountUid} selected={[...hidden]} chips={false} disabled={busy} onToggle={uid => { void toggle(uid) }} />}
  </Box>
}

// Media::Stories::View for the account's own stories: views, audience and deletion.
function OwnStoryViewer({ accountUid, close }: { accountUid: string; close(): void }) {
  const profile = useDesktop(state => state?.selfProfile ?? null)
  const contacts = useDesktop(state => state?.contacts?.status === 'ready' ? state.contacts.items : noContacts)
  const [rows, setRows] = useState<OwnStoryRow[] | null>(null)
  const [index, setIndex] = useState(0)
  const [selected, setSelected] = useState<Selected | null>(null)
  const [error, setError] = useState('')
  const [duration, setDuration] = useState<number | null>(null)
  const [paused, setPaused] = useState(false), [muted, setMuted] = useState(false), [busy, setBusy] = useState(false)
  const [views, setViews] = useState<StoryViewRecordsResult | null>(null)
  const [reload, setReload] = useState(0)
  const detail = useDesktop(state => state?.ownStories?.selected ?? null)
  const caption = selected && detail?.id === selected.row.id ? detail.caption : ''
  const captionLink = caption ? firstStoryCaptionLink(caption) : null
  const hidden = usePageHidden()
  const list = useRef<{ requestId: string; privacy: StoryPrivacy; page: number; next: OwnPage['next'] } | null>(null)
  const pages = useRef(new Map<string, number>()), moves = useRef<Promise<unknown>>(Promise.resolve())
  const pageKey = (row: OwnStoryRow): string => `${row.privacy}:${row.id}`
  const row = rows?.[index] ?? null
  const key = selected ? `${selected.requestId}:${selected.row.id}` : null
  const stopped = paused || hidden || busy

  const openList = async (privacy: StoryPrivacy): Promise<OwnPage> => {
    const previous = list.current
    list.current = null
    if (previous) void window.morse.closeOwnStories(accountUid, previous.requestId).catch(() => {})
    const opened = await openPrivacy(accountUid, privacy)
    list.current = { requestId: opened.requestId, privacy, page: opened.number, next: opened.next }
    return opened
  }
  // Every page of a collection is read so the rows stay in time order.
  const loadAll = async (privacy: StoryPrivacy): Promise<OwnStoryRow[]> => {
    let page = await openList(privacy)
    const rows = [...page.rows]
    for (const row of page.rows) pages.current.set(pageKey(row), page.number)
    while (page.next && page.number < maxOwnPages) {
      const turned = await turnOwnPage(accountUid, page, 'next').catch(() => null)
      if (!turned) {
        // Later pages stay unread; the first page is opened again for the rows already read.
        await openList(privacy).catch(() => null)
        break
      }
      page = turned
      list.current = { requestId: page.requestId, privacy, page: page.number, next: page.next }
      for (const row of page.rows) pages.current.set(pageKey(row), page.number)
      rows.push(...page.rows)
    }
    return rows
  }
  // Selection and changes need the story's own page to be the open one.
  const ensurePage = (privacy: StoryPrivacy, target: number): Promise<{ requestId: string }> => {
    const task = moves.current.then(async () => {
      if (list.current?.privacy !== privacy) await openList(privacy)
      let current = list.current!
      while (current.page !== target) {
        const page = await turnOwnPage(accountUid, current, current.page < target ? 'next' : 'previous')
        if (page.number === current.page) throw new Error(tr('스토리 페이지를 이동하지 못했습니다.'))
        current = { requestId: page.requestId, privacy, page: page.number, next: page.next }
        list.current = current
      }
      return { requestId: current.requestId }
    })
    moves.current = task.catch(() => {})
    return task
  }
  // Reads the story's current version after a change and selects it again.
  const refreshSelection = async (target: Selected): Promise<Selected> => {
    const latest = (await loadAll(target.row.privacy)).find(candidate => candidate.id === target.row.id)
    if (!latest) throw new Error(tr('스토리가 만료되었거나 삭제되었습니다.'))
    const current = await ensurePage(latest.privacy, pages.current.get(pageKey(latest)) ?? 1)
    await window.morse.selectOwnStory(accountUid, { requestId: current.requestId, storyId: latest.id, version: latest.version })
    return { requestId: current.requestId, row: latest }
  }
  const next = (): void => { if (rows && index + 1 < rows.length) setIndex(index + 1); else close() }
  const previous = (): void => { if (index > 0) setIndex(index - 1) }
  const { progress, setProgress } = useStoryProgress(key, duration, stopped, row ? storyKind(row) !== 'video' : false, next)

  useEffect(() => () => { const current = list.current; list.current = null; if (current) void window.morse.closeOwnStories(accountUid, current.requestId).catch(() => {}) }, [])
  useEffect(() => {
    let alive = true
    setSelected(null)
    void (async () => {
      const all: OwnStoryRow[] = []
      pages.current.clear()
      for (const privacy of privacies) {
        try { all.push(...await loadAll(privacy)) } catch { /* A collection that cannot be read is skipped. */ }
        if (!alive) return
      }
      all.sort((a, b) => positionMilliseconds(a.created) - positionMilliseconds(b.created))
      if (!alive) return
      if (!all.length) { controller.toast(tr('지금 올려 둔 스토리가 없습니다.')); close(); return }
      setRows(all); setIndex(value => Math.min(value, all.length - 1))
    })().catch(reason => { if (alive) setError(errorText(reason, tr('내 스토리를 불러오지 못했습니다.'))) })
    return () => { alive = false }
  }, [reload])

  useEffect(() => {
    if (!row) return
    let alive = true
    setSelected(null); setViews(null); setDuration(null)
    void (async () => {
      const current = await ensurePage(row.privacy, pages.current.get(pageKey(row)) ?? 1)
      if (!current || !alive) return
      await window.morse.selectOwnStory(accountUid, { requestId: current.requestId, storyId: row.id, version: row.version })
      if (alive) setSelected({ requestId: current.requestId, row })
    })().catch(reason => { if (alive) setError(errorText(reason, tr('스토리를 열지 못했습니다.'))) })
    return () => { alive = false }
  }, [rows, index])

  useEffect(() => {
    if (!selected) return
    const id = crypto.randomUUID()
    let alive = true
    void window.morse.readStoryViewRecords(accountUid, { id, requestId: selected.requestId, storyId: selected.row.id, privacy: selected.row.privacy, version: selected.row.version })
      .then(result => { if (alive) setViews(result) }).catch(() => {})
    return () => { alive = false; void window.morse.closeStoryViewRecords(accountUid, id).catch(() => {}) }
  }, [selected])

  useShortcut(120, command => {
    if (command === 'previous-dialog') { previous(); return true }
    if (command === 'next-dialog') { next(); return true }
    return false
  })

  async function remove(): Promise<void> {
    const target = selected
    if (!target || busy || !rows) return
    setBusy(true)
    try {
      if (!await confirmBox({ title: tr('스토리 삭제'), text: tr('이 스토리를 삭제할까요?'), confirm: tr('삭제'), danger: true })) return
      const result = await runJournal({
        current: () => desktop.value?.storyRemoval ?? null,
        refresh: () => window.morse.refreshStoryRemoval(accountUid),
        action: action => window.morse.storyRemovalAction(accountUid, action),
        prepare: id => window.morse.prepareStoryRemoval(accountUid, { id, requestId: target.requestId, storyId: target.row.id, privacy: target.row.privacy, version: target.row.version })
      }, {
        waiting: tr('이전 스토리 삭제 결과를 확인하고 있습니다. 잠시 후 다시 시도해 주세요.'),
        denied: tr('지금은 이 스토리를 삭제할 수 없습니다.'),
        rejected: tr('스토리를 삭제하지 못했습니다.')
      })
      controller.toast(result === 'done' ? tr('스토리를 삭제했습니다.') : tr('삭제 결과를 확인하고 있습니다.'))
      const remaining = rows.filter(candidate => !(candidate.id === target.row.id && candidate.privacy === target.row.privacy))
      if (!remaining.length) { close(); return }
      setRows(remaining); setIndex(value => Math.min(value, remaining.length - 1))
    } catch (reason) { controller.toast(errorText(reason, tr('스토리를 삭제하지 못했습니다.')), 'error') }
    finally { setBusy(false) }
  }
  async function move(desired: StoryPrivacy): Promise<void> {
    const target = selected
    if (!target || busy) return
    setBusy(true)
    try {
      const result = await runJournal({
        current: () => desktop.value?.storyPrivacyMove ?? null,
        refresh: () => window.morse.refreshStoryPrivacyMove(accountUid),
        action: action => window.morse.storyPrivacyMoveAction(accountUid, action),
        prepare: id => window.morse.prepareStoryPrivacyMove(accountUid, { id, requestId: target.requestId, storyId: target.row.id, privacy: target.row.privacy, desired, version: target.row.version })
      }, {
        waiting: tr('이전 공개 범위 변경 결과를 확인하고 있습니다. 잠시 후 다시 시도해 주세요.'),
        denied: tr('지금은 공개 범위를 바꿀 수 없습니다.'),
        rejected: tr('공개 범위를 바꾸지 못했습니다.')
      })
      controller.toast(result === 'done' ? tr('{0}(으)로 공개 범위를 바꿨습니다.', [storyPrivacyNames[desired]]) : tr('공개 범위 변경 결과를 확인하고 있습니다.'))
      setReload(value => value + 1)
    } catch (reason) { controller.toast(errorText(reason, tr('공개 범위를 바꾸지 못했습니다.')), 'error') }
    finally { setBusy(false) }
  }
  // Story caption edits use the device caption draft and the caption save record.
  function editCaption(): void {
    const target = selected, detail = desktop.value?.ownStories?.selected
    if (!target || busy || !detail || detail.id !== target.row.id) return
    setPaused(true)
    showTextEditBox({ title: tr('스토리 설명'), label: tr('설명'), initial: detail.caption, maxLength: 2000, multiline: true, save: async caption => {
      const draftTarget = { storyId: target.row.id, privacy: target.row.privacy }
      const existing = await window.morse.readStoryCaptionDraft(accountUid, draftTarget)
      if (existing.draft && existing.revision) await trackWrite(window.morse.saveStoryCaptionDraft(accountUid, { ...draftTarget, expected: existing.revision, revision: crypto.randomUUID(), draft: null }))
      const seeded = await trackWrite(window.morse.startStoryCaptionDraft(accountUid, { ...draftTarget, requestId: target.requestId, version: target.row.version }))
      if (!seeded.draft || !seeded.revision) throw new Error(tr('설명 편집을 시작하지 못했습니다.'))
      const revision = crypto.randomUUID()
      const saved = await trackWrite(window.morse.saveStoryCaptionDraft(accountUid, { ...draftTarget, expected: seeded.revision, revision, draft: { ...seeded.draft, caption } }))
      if (!saved.draft || saved.revision !== revision) throw new Error(tr('설명을 저장하지 못했습니다.'))
      const draft = saved.draft
      const result = await runJournal({
        current: () => desktop.value?.storyCaptionSave ?? null,
        refresh: () => window.morse.refreshStoryCaptionSave(accountUid),
        action: action => window.morse.storyCaptionSaveAction(accountUid, action),
        prepare: id => window.morse.prepareStoryCaptionSave(accountUid, { id, ...draftTarget, draftRevision: revision, draft })
      }, {
        waiting: tr('이전 설명 저장 결과를 확인하고 있습니다. 잠시 후 다시 시도해 주세요.'),
        denied: tr('지금은 설명을 바꿀 수 없습니다.'),
        rejected: tr('설명을 저장하지 못했습니다.')
      })
      setReload(value => value + 1)
      return result === 'done' ? { outcome: 'saved', message: '' } : { outcome: 'uncertain', message: tr('설명 저장 결과를 확인하고 있습니다.') }
    } })
  }
  function editHidden(): void {
    const target = selected
    if (!target || busy) return
    setPaused(true)
    controller.showLayer(closeBox => <HiddenAudienceBox accountUid={accountUid} initial={target} refresh={refreshSelection} close={closeBox} />, { onClose: () => setReload(value => value + 1) })
  }
  const openMenu = (point: { x: number; y: number }): void => {
    const target = selected
    if (!target) return
    popupMenu.open(point, [
      { label: tr('설명 수정'), icon: <Pencil size={18} />, onSelect: editCaption },
      { label: tr('숨길 사람'), icon: <EyeOff size={18} />, onSelect: editHidden },
      'separator',
      ...privacies.filter(privacy => privacy !== target.row.privacy).map(privacy => ({ label: moveLabels[privacy], icon: privacyIcons[privacy], disabled: target.row.mediaType === 'unknown', onSelect: () => { void move(privacy) } })),
      'separator',
      { label: tr('스토리 삭제'), icon: <Trash2 size={18} />, danger: true, onSelect: () => { void remove() } }
    ])
  }

  const name = profile?.profile?.displayName || tr('내 스토리')
  const avatarUrl = profile?.photo.status === 'ready' ? profile.photo.url : null
  return <div className="story-viewer" role="dialog" aria-modal="true" aria-label={tr('내 스토리')} tabIndex={-1}
    onKeyDown={event => {
      if (event.key === 'ArrowLeft') previous()
      else if (event.key === 'ArrowRight') next()
      else if (event.key === ' ') { event.preventDefault(); setPaused(value => !value) }
    }}
    onMouseDown={event => { if (event.target === event.currentTarget) close() }}>
    <button className="media-viewer-button story-close" aria-label={tr('닫기')} data-autofocus onClick={close}><X size={22} /></button>
    <button className={`story-nav${index > 0 ? '' : ' hidden'}`} aria-label={tr('이전 스토리')} onClick={previous}><ChevronLeft size={32} /></button>
    <div className="story-frame">
      {rows && <div className="story-progress">{rows.map((story, position) => <span key={`${story.privacy}:${story.id}`}><i style={{ width: `${position < index ? 100 : position === index ? progress * 100 : 0}%` }} /></span>)}</div>}
      <header className="story-header">
        <Avatar name={name} url={avatarUrl} size={32} />
        <span><strong className="ellipsis">{name}</strong>{row && <small>{storyAgo(positionMilliseconds(row.created))}</small>}</span>
        <button className="icon-button small" aria-label={paused ? tr('재생') : tr('일시 정지')} onClick={() => setPaused(value => !value)}>{paused ? <Play size={18} /> : <Pause size={18} />}</button>
        {row?.audio === 'attached' && <button className="icon-button small" aria-label={muted ? tr('소리 켜기') : tr('소리 끄기')} onClick={() => setMuted(value => !value)}>{muted ? <VolumeX size={18} /> : <Volume2 size={18} />}</button>}
      </header>
      <div className="story-stage">
        {error ? <div className="media-viewer-loading" role="alert"><p>{error}</p></div>
          : !selected ? <div className="media-viewer-loading" role="status"><Spinner size={30} /></div>
            : <OwnStoryMedia key={key!} accountUid={accountUid} requestId={selected.requestId} row={selected.row} paused={stopped} muted={muted}
              onDuration={setDuration} onTime={setProgress} onEnded={next} onShown={() => {}} />}
      </div>
      {caption && <p className="story-caption with-reply selectable">{caption}{captionLink && selected && <button type="button" className="story-caption-link" onClick={() => {
        void window.morse.openStoryCaptionLink(accountUid, { storyId: selected.row.id, privacy: selected.row.privacy, requestId: selected.requestId, version: selected.row.version, url: captionLink })
          .catch(reason => controller.toast(errorText(reason, tr('링크를 열지 못했습니다.')), 'error'))
      }}><Link size={14} />{tr('링크 열기')}</button>}</p>}
      <button type="button" className="story-tap previous" aria-label={tr('이전')} tabIndex={-1} onClick={previous} />
      <button type="button" className="story-tap next" aria-label={tr('다음')} tabIndex={-1} onClick={next} />
      {selected && <div className="story-owner-bar">
        <button type="button" className="story-owner-views" disabled={!views} onClick={() => { if (views) { setPaused(true); controller.showLayer(closeBox => <ViewersBox result={views} contacts={contacts} close={closeBox} />, { onClose: () => setPaused(false) }) } }}>
          <Eye size={18} />{views?.current ? tr('{0}명', [views.current.counts.viewers.toLocaleString(locale())]) : tr('조회')}
        </button>
        <span className="story-owner-privacy">{privacyIcons[selected.row.privacy]}{storyPrivacyNames[selected.row.privacy]}</span>
        <button type="button" className="icon-button" aria-label={tr('스토리 메뉴')} disabled={busy} onClick={event => openMenu(pointFor(event, event.currentTarget))}>{busy ? <Spinner size={18} /> : <EllipsisVertical size={20} />}</button>
      </div>}
    </div>
    <button className={`story-nav${rows && index + 1 < rows.length ? '' : ' hidden'}`} aria-label={tr('다음 스토리')} onClick={next}><ChevronRight size={32} /></button>
  </div>
}

export function showOwnStoryViewer(accountUid: string, onClose?: () => void): void {
  controller.showLayer(close => <OwnStoryViewer accountUid={accountUid} close={close} />, { onClose })
}
