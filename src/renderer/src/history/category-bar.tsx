import { Pencil, Trash2 } from 'lucide-react'
import type { ForumState } from '../../../shared/forum'
import { controller } from '../app/ui'
import { errorText } from '../app/format'
import { popupMenu, pointFor } from '../ui/popup-menu'
import { deleteForumCategory, showForumCategoryEditBox } from '../info/forum-box'
import { tr } from '../../../shared/i18n'

// iOS MorseGroupCategoryBar: «모두» and the group's topics above the history; the choice is kept on this device and
// decides the topic of what is sent next. The group's creator also edits and deletes a topic from its context menu,
// as Telegram's topic menu offers (Window::Filler addManageTopic / addDeleteTopic).
export function CategoryBar({ accountUid, chatId, forum, selected, owner }: { accountUid: string; chatId: string; forum: ForumState; selected: string | null; owner: boolean }) {
  const choose = (category: string | null): void => {
    if (category === selected) return
    void window.morse.setChatFlags(accountUid, chatId, { category }).catch(reason => controller.toast(errorText(reason, tr('카테고리를 바꾸지 못했습니다.')), 'error'))
  }
  const menu = (category: ForumState['categories'][number], point: { x: number; y: number }): void => {
    const general = category.isGeneral || category.id === forum.generalId
    popupMenu.open(point, [
      { label: tr('카테고리 수정'), icon: <Pencil size={18} />, onSelect: () => showForumCategoryEditBox(accountUid, chatId, category) },
      !general && { label: tr('카테고리 삭제'), icon: <Trash2 size={18} />, danger: true, onSelect: () => { void deleteForumCategory(accountUid, chatId, category) } },
    ])
  }
  return <div className="category-bar" role="tablist" aria-label={tr('카테고리')}>
    <button type="button" role="tab" aria-selected={!selected} className={!selected ? 'active' : undefined} onClick={() => choose(null)}>{tr('모두')}</button>
    {forum.categories.map(category => <button key={category.id} type="button" role="tab" aria-selected={selected === category.id}
      className={selected === category.id ? 'active' : undefined} onClick={() => choose(category.id)}
      onContextMenu={owner ? event => { event.preventDefault(); menu(category, pointFor(event, event.currentTarget)) } : undefined}># {category.name}</button>)}
  </div>
}
