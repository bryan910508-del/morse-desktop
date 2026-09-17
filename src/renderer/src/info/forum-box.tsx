import { useState } from 'react'
import { Plus } from 'lucide-react'
import { maxForumCategoryName } from '../../../shared/forum'
import { dialogById, useDesktop } from '../app/store'
import { controller } from '../app/ui'
import { errorText } from '../app/format'
import { Spinner, Switch } from '../ui/controls'
import { Box } from '../ui/layers'
import { tr } from '../../../shared/i18n'

// iOS MorseGroupCategoryManagementSheet: «카테고리 사용» and the topic list; only the group's creator changes them.
function ForumBox({ accountUid, chatId, owner, close }: { accountUid: string; chatId: string; owner: boolean; close(): void }) {
  const forum = useDesktop(state => dialogById(state, chatId)?.forum ?? null)
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
      <div className="forum-list">{forum.categories.map(category => <div key={category.id} className="forum-row">
        <span># {category.name}</span>{category.isGeneral && <span className="member-badge">{tr('일반', [], 'category')}</span>}
      </div>)}</div>
      {owner && <form className="forum-add" onSubmit={event => { event.preventDefault(); const value = name.trim(); if (value) void run(async () => { await window.morse.addForumCategory(accountUid, chatId, value); setName('') }, tr('카테고리를 추가하지 못했습니다.')) }}>
        <input value={name} maxLength={maxForumCategoryName} placeholder={tr('카테고리 이름')} onChange={event => setName(event.target.value)} />
        <button type="submit" className="button secondary" disabled={busy || !name.trim()}>{busy ? <Spinner size={14} /> : <Plus size={16} />}{tr('카테고리 추가')}</button>
      </form>}
    </>}
  </Box>
}

export function showForumBox(accountUid: string, chatId: string, owner: boolean): void {
  controller.showLayer(close => <ForumBox accountUid={accountUid} chatId={chatId} owner={owner} close={close} />)
}
