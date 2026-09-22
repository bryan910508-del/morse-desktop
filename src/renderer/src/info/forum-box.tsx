import { useState } from 'react'
import { Pencil, Plus, RotateCw, Trash2 } from 'lucide-react'
import { maxForumCategoryName, type ForumCategory } from '../../../shared/forum'
import { dialogById, useDesktop } from '../app/store'
import { controller } from '../app/ui'
import { errorText } from '../app/format'
import { Spinner, Switch, TextField } from '../ui/controls'
import { Box, confirmBox } from '../ui/layers'
import { tr } from '../../../shared/i18n'

// iOS MorseGroupCategoryManagementSheet: «카테고리 사용» and the topic list; only the group's creator changes them.
// A topic is edited and deleted as Telegram does (Window::Filler addManageTopic / addDeleteTopic): its title only —
// Morse has no custom-emoji icons — for every topic including the general one, and a delete for every other topic.
function ForumBox({ accountUid, chatId, owner, close }: { accountUid: string; chatId: string; owner: boolean; close(): void }) {
  const forum = useDesktop(state => dialogById(state, chatId)?.forum ?? null)
  const deleting = useDesktop(state => dialogById(state, chatId)?.forumDeleting ?? [])
  const [busy, setBusy] = useState(false), [name, setName] = useState('')
  async function run(action: () => Promise<unknown>, failure: string): Promise<void> {
    if (busy) return
    setBusy(true)
    try { await action() } catch (reason) { controller.toast(errorText(reason, failure), 'error') } finally { setBusy(false) }
  }
  return <Box title={tr('카테고리')} width={380} onClose={close} buttons={<button className="button flat" onClick={close}>{tr('닫기')}</button>}>
    <div className="section-label">{tr('주제')}</div>
    <label className="settings-toggle">
      <span className="settings-toggle-text"><span>{tr('카테고리 사용')}</span><small>{tr('그룹 대화를 주제별로 나눕니다.')}</small></span>
      <Switch label={tr('카테고리 사용')} checked={Boolean(forum)} disabled={!owner || busy} onChange={value => { void run(() => window.morse.setGroupForum(accountUid, chatId, value), tr('카테고리 설정을 바꾸지 못했습니다.')) }} />
    </label>
    {forum && <>
      <div className="section-label">{tr('카테고리 목록')}</div>
      <div className="forum-list">{forum.categories.map(category => {
        const state = deleting.find(value => value.id === category.id)
        const general = category.isGeneral || category.id === forum.generalId
        return <div key={category.id} className="forum-row">
          <span className="forum-row-name"># {category.name}</span>{category.isGeneral && <span className="member-badge">{tr('일반', [], 'category')}</span>}
          {state && !state.failed && <span className="forum-row-state" role="status"><Spinner size={14} />{tr('삭제 중')}</span>}
          {state?.failed && <button type="button" className="button flat small forum-row-retry" onClick={() => startDeletion(accountUid, chatId, category.id)}>
            <RotateCw size={14} />{tr('다시 시도')}</button>}
          {owner && !state && <button type="button" className="icon-button small" aria-label={tr('카테고리 수정')}
            onClick={() => showForumCategoryEditBox(accountUid, chatId, category)}><Pencil size={16} /></button>}
          {owner && !general && !state && <button type="button" className="icon-button small forum-row-delete" aria-label={tr('카테고리 삭제')}
            onClick={() => { void deleteForumCategory(accountUid, chatId, category) }}><Trash2 size={16} /></button>}
        </div>
      })}</div>
      {owner && <form className="forum-add" onSubmit={event => { event.preventDefault(); const value = name.trim(); if (value) void run(async () => { await window.morse.addForumCategory(accountUid, chatId, value); setName('') }, tr('카테고리를 추가하지 못했습니다.')) }}>
        <input value={name} maxLength={maxForumCategoryName} placeholder={tr('카테고리 이름')} onChange={event => setName(event.target.value)} />
        <button type="submit" className="button secondary" disabled={busy || !name.trim()}>{busy ? <Spinner size={14} /> : <Plus size={16} />}{tr('카테고리 추가')}</button>
      </form>}
    </>}
  </Box>
}

// EditForumTopicBox for a topic that exists: the title, saved with «저장»; an empty one is not accepted and an unchanged
// one just closes (TOPIC_NOT_MODIFIED).
function CategoryEditBox({ accountUid, chatId, category, close }: { accountUid: string; chatId: string; category: ForumCategory; close(): void }) {
  const [title, setTitle] = useState(category.name), [busy, setBusy] = useState(false), [invalid, setInvalid] = useState(false)
  async function save(): Promise<void> {
    if (busy) return
    const value = title.trim()
    if (!value) { setInvalid(true); return }
    if (value === category.name) { close(); return }
    setBusy(true)
    try { await window.morse.renameForumCategory(accountUid, chatId, category.id, value); close() }
    catch (reason) { controller.toast(errorText(reason, tr('카테고리를 수정하지 못했습니다.')), 'error') }
    finally { setBusy(false) }
  }
  return <Box title={tr('카테고리 수정')} width={360} onClose={close} buttons={<>
    <button className="button flat" onClick={close}>{tr('취소')}</button>
    <button className="button flat" disabled={busy} onClick={() => { void save() }}>{busy ? <Spinner size={14} /> : tr('저장')}</button>
  </>}>
    <TextField label={tr('카테고리 이름')} value={title} maxLength={maxForumCategoryName} autoFocus invalid={invalid}
      onChange={value => { setTitle(value); setInvalid(false) }} onSubmit={() => { void save() }} />
  </Box>
}

function startDeletion(accountUid: string, chatId: string, id: string): void {
  void window.morse.deleteForumCategory(accountUid, chatId, id).catch(reason => controller.toast(errorText(reason, tr('카테고리를 삭제하지 못했습니다.')), 'error'))
}

// PeerMenuDeleteTopicWithConfirmation: the box closes when it is confirmed and the deletion goes on by itself.
export async function deleteForumCategory(accountUid: string, chatId: string, category: ForumCategory): Promise<void> {
  const sure = await confirmBox({ title: tr('카테고리 삭제'), text: tr('「{0}」 카테고리를 삭제할까요? 이 카테고리의 모든 메시지가 모든 사람에게서 삭제됩니다.', [category.name]), confirm: tr('삭제'), danger: true })
  if (sure) startDeletion(accountUid, chatId, category.id)
}
export function showForumCategoryEditBox(accountUid: string, chatId: string, category: ForumCategory): void {
  controller.showLayer(close => <CategoryEditBox accountUid={accountUid} chatId={chatId} category={category} close={close} />)
}
export function showForumBox(accountUid: string, chatId: string, owner: boolean): void {
  controller.showLayer(close => <ForumBox accountUid={accountUid} chatId={chatId} owner={owner} close={close} />)
}
