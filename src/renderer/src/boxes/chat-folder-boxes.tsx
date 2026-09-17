import { useEffect, useMemo, useState } from 'react'
import { ArrowDown, ArrowUp, FolderPlus, ListChecks, ListX, Search, Trash2 } from 'lucide-react'
import type { DialogSummary } from '../../../shared/model'
import { folderEditName, folderPlainName, folderTitle, splitFolderName, type ChatFolder } from '../../../shared/chat-folders'
import { searchFold } from '../../../shared/search'
import { useDesktop } from '../app/store'
import { controller } from '../app/ui'
import { errorText } from '../app/format'
import { deleteChatFolder, loadChatFolders, reorderChatFolders, saveChatFolder, toggleChatInFolder, useChatFolders } from '../app/chat-folders'
import { PeerAvatar } from '../ui/avatar'
import { RoundCheck, Spinner, Switch, TextField } from '../ui/controls'
import { Box, confirmBox } from '../ui/layers'
import { tr } from '../../../shared/i18n'

const noDialogs: DialogSummary[] = []

// Models.ChatFolder ids are uppercase UUID strings.
function newFolderId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  bytes[6] = (bytes[6]! & 0x0f) | 0x40; bytes[8] = (bytes[8]! & 0x3f) | 0x80
  const hex = [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('').toUpperCase()
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

function FolderToggle({ label, checked, onChange }: { label: string; checked: boolean; onChange(value: boolean): void }) {
  return <label className="settings-toggle">
    <span className="settings-toggle-text"><span>{label}</span></span>
    <Switch label={label} checked={checked} onChange={onChange} />
  </label>
}

export async function removeChatFolder(accountUid: string, folder: ChatFolder): Promise<boolean> {
  if (!await confirmBox({ title: tr('폴더 삭제'), text: tr('이 폴더를 삭제할까요? 채팅은 사라지지 않아요.'), confirm: tr('폴더 삭제'), danger: true })) return false
  void deleteChatFolder(accountUid, folder.id)
  return true
}

function ChatPickerBox({ title, initial, close, onDone }: { title: string; initial: string[]; close(): void; onDone(ids: string[]): void }) {
  const dialogs = useDesktop(state => state?.dialogs ?? noDialogs)
  const [selected, setSelected] = useState(() => new Set(initial)), [query, setQuery] = useState('')
  const rows = useMemo(() => { const needle = searchFold(query); return dialogs.filter(dialog => !needle || searchFold(dialog.title).includes(needle)) }, [dialogs, query])
  const toggle = (id: string): void => setSelected(value => { const next = new Set(value); if (next.has(id)) next.delete(id); else next.add(id); return next })
  return <Box title={title} width={400} onClose={close} buttons={<>
    <button className="button flat" onClick={close}>{tr('취소')}</button>
    <button className="button flat" onClick={() => { onDone([...selected]); close() }}>{tr('완료')}</button>
  </>}>
    <div className="peer-picker">
      <label className="search-field"><Search size={16} /><input value={query} maxLength={200} placeholder={tr('대화 찾기')} data-autofocus onChange={event => setQuery(event.target.value)} /></label>
      <div className="peer-list">
        {!rows.length ? <div className="empty-state">{query ? tr('검색 결과가 없습니다.') : tr('추가할 채팅이 없어요')}</div> : rows.map(dialog => {
          const checked = selected.has(dialog.id), secret = dialog.kind === 'secret'
          return <button key={dialog.id} type="button" className="peer-row" aria-pressed={checked} onClick={() => toggle(dialog.id)}>
            <PeerAvatar id={dialog.id} name={dialog.title} image={secret ? null : dialog.avatar} surface="dialogs" kind={secret ? 'secret' : undefined} size={42} />
            <span className="peer-row-text"><strong className="ellipsis">{dialog.title}</strong></span>
            <RoundCheck checked={checked} />
          </button>
        })}
      </div>
    </div>
  </Box>
}

// FolderEditView: name with emoji, included types, filters, included and excluded chats.
function FolderEditBox({ accountUid, folder, close }: { accountUid: string; folder: ChatFolder | null; close(): void }) {
  const folders = useChatFolders(accountUid)
  const [name, setName] = useState(() => folder ? folderEditName(folder) : ''), [error, setError] = useState('')
  const [chatIds, setChatIds] = useState(() => folder?.chatIds ?? []), [excludeChatIds, setExcludeChatIds] = useState(() => folder?.excludeChatIds ?? [])
  const [includeContacts, setIncludeContacts] = useState(folder?.includeContacts ?? false), [includeNonContacts, setIncludeNonContacts] = useState(folder?.includeNonContacts ?? false)
  const [includeGroups, setIncludeGroups] = useState(folder?.includeGroups ?? false), [includeChannels, setIncludeChannels] = useState(folder?.includeChannels ?? false)
  const [excludeMuted, setExcludeMuted] = useState(folder?.excludeMuted ?? false), [excludeRead, setExcludeRead] = useState(folder?.excludeRead ?? false)
  const [includeArchived, setIncludeArchived] = useState(folder ? !folder.excludeArchived : false)
  function save(): void {
    if (!name.trim()) { setError(tr('폴더 이름을 입력해 주세요.')); return }
    const parts = splitFolderName(name)
    const next: ChatFolder = { id: folder?.id ?? newFolderId(), name: parts.name, emoji: parts.emoji, chatIds, excludeChatIds, pinnedChatIds: folder?.pinnedChatIds ?? [],
      includeContacts, includeNonContacts, includeGroups, includeChannels, excludeMuted, excludeRead, excludeArchived: !includeArchived,
      order: folder?.order ?? folders.length }
    close()
    void saveChatFolder(accountUid, next, !folder)
  }
  async function remove(): Promise<void> { if (folder && await removeChatFolder(accountUid, folder)) close() }
  const pick = (title: string, initial: string[], done: (ids: string[]) => void): void => {
    controller.showLayer(closePicker => <ChatPickerBox title={title} initial={initial} close={closePicker} onDone={done} />)
  }
  return <Box title={folder ? tr('폴더 편집') : tr('새 폴더')} width={420} onClose={close} className="folder-box" buttons={<>
    {folder && <button className="button flat danger" onClick={() => { void remove() }}>{tr('폴더 삭제')}</button>}
    <span className="box-buttons-gap" />
    <button className="button flat" onClick={close}>{tr('취소')}</button>
    <button className="button flat" onClick={save}>{tr('저장')}</button>
  </>}>
    <TextField label={tr('폴더 이름')} value={name} maxLength={512} placeholder={tr('예: 💼 직장, 🎉 친구')} autoFocus invalid={Boolean(error)} onChange={value => { setName(value); setError('') }} onSubmit={save} />
    <p className="box-note">{tr('이모지를 함께 입력할 수 있어요')}</p>
    {error && <p className="box-error" role="alert">{error}</p>}
    <div className="section-label">{tr('포함할 유형')}</div>
    <FolderToggle label={tr('연락처')} checked={includeContacts} onChange={setIncludeContacts} />
    <FolderToggle label={tr('연락처 아님')} checked={includeNonContacts} onChange={setIncludeNonContacts} />
    <FolderToggle label={tr('그룹')} checked={includeGroups} onChange={setIncludeGroups} />
    <FolderToggle label={tr('채널 토론')} checked={includeChannels} onChange={setIncludeChannels} />
    <div className="section-label">{tr('필터')}</div>
    <FolderToggle label={tr('무음 채팅 제외')} checked={excludeMuted} onChange={setExcludeMuted} />
    <FolderToggle label={tr('읽은 채팅 제외')} checked={excludeRead} onChange={setExcludeRead} />
    <FolderToggle label={tr('보관함 포함')} checked={includeArchived} onChange={setIncludeArchived} />
    <div className="section-label">{tr('채팅')}</div>
    <button type="button" className="list-button" onClick={() => pick(tr('포함할 채팅'), chatIds, setChatIds)}>
      <span className="list-button-icon"><ListChecks size={20} /></span><span className="list-button-text"><span>{tr('포함할 채팅')}</span><small>{tr('{0}개', [chatIds.length])}</small></span>
    </button>
    <button type="button" className="list-button" onClick={() => pick(tr('제외할 채팅'), excludeChatIds, setExcludeChatIds)}>
      <span className="list-button-icon"><ListX size={20} /></span><span className="list-button-text"><span>{tr('제외할 채팅')}</span><small>{tr('{0}개', [excludeChatIds.length])}</small></span>
    </button>
  </Box>
}

// Settings::Folders: the folder list with order, edit and delete.
function FoldersBox({ accountUid, close }: { accountUid: string; close(): void }) {
  const folders = useChatFolders(accountUid)
  const [loading, setLoading] = useState(true), [error, setError] = useState('')
  useEffect(() => {
    let live = true
    loadChatFolders(accountUid).then(() => { if (live) setError('') }, reason => { if (live) setError(errorText(reason, tr('폴더를 불러오지 못했습니다.'))) })
      .finally(() => { if (live) setLoading(false) })
    return () => { live = false }
  }, [accountUid])
  const move = (index: number, delta: number): void => {
    const ids = folders.map(item => item.id), target = index + delta
    if (target < 0 || target >= ids.length) return
    ;[ids[index], ids[target]] = [ids[target]!, ids[index]!]
    void reorderChatFolders(accountUid, ids)
  }
  return <Box title={tr('채팅 폴더')} width={420} onClose={close} className="folder-box" buttons={<button className="button flat" onClick={close}>{tr('닫기')}</button>}>
    {loading && !folders.length ? <div className="empty-state"><Spinner size={20} /></div> : folders.map((item, index) => <div key={item.id} className="folder-row">
      <button type="button" className="folder-row-main" onClick={() => showFolderEditBox(accountUid, item)}>
        <span className="ellipsis">{folderTitle(item)}</span><small>{tr('포함할 채팅 {0}개', [item.chatIds.length])}</small>
      </button>
      <button className="icon-button small" aria-label={tr('위로')} disabled={index === 0} onClick={() => move(index, -1)}><ArrowUp size={16} /></button>
      <button className="icon-button small" aria-label={tr('아래로')} disabled={index === folders.length - 1} onClick={() => move(index, 1)}><ArrowDown size={16} /></button>
      <button className="icon-button small" aria-label={tr('폴더 삭제')} onClick={() => { void removeChatFolder(accountUid, item) }}><Trash2 size={16} /></button>
    </div>)}
    <button type="button" className="list-button" onClick={() => showFolderEditBox(accountUid, null)}>
      <span className="list-button-icon"><FolderPlus size={20} /></span><span className="list-button-text"><span>{tr('폴더 추가')}</span></span>
    </button>
    {error && <p className="box-error" role="alert">{error}</p>}
  </Box>
}

// MorseChatFolderPickerSheet: tap a folder to add or remove this chat.
function FolderPickerBox({ accountUid, chatId, close }: { accountUid: string; chatId: string; close(): void }) {
  const folders = useChatFolders(accountUid)
  useEffect(() => { void loadChatFolders(accountUid).catch(() => {}) }, [accountUid])
  return <Box title={tr('폴더에 추가')} width={360} onClose={close} className="folder-box" buttons={<button className="button flat" onClick={close}>{tr('닫기')}</button>}>
    {folders.map(item => {
      const checked = item.chatIds.includes(chatId)
      return <button key={item.id} type="button" className="peer-row folder-pick-row" aria-pressed={checked} onClick={() => { void toggleChatInFolder(accountUid, item, chatId) }}>
        <span className="folder-pick-emoji" aria-hidden="true">{item.emoji || '📁'}</span>
        <span className="peer-row-text"><strong className="ellipsis">{folderPlainName(item) || item.emoji}</strong></span>
        <RoundCheck checked={checked} />
      </button>
    })}
    <button type="button" className="list-button" onClick={() => showFolderEditBox(accountUid, null)}>
      <span className="list-button-icon"><FolderPlus size={20} /></span><span className="list-button-text"><span>{tr('폴더 추가')}</span></span>
    </button>
  </Box>
}

export function showFolderEditBox(accountUid: string, folder: ChatFolder | null): void {
  controller.showLayer(close => <FolderEditBox accountUid={accountUid} folder={folder} close={close} />)
}
export function showFoldersBox(accountUid: string): void {
  controller.showLayer(close => <FoldersBox accountUid={accountUid} close={close} />)
}
export function showFolderPickerBox(accountUid: string, chatId: string): void {
  controller.showLayer(close => <FolderPickerBox accountUid={accountUid} chatId={chatId} close={close} />)
}
