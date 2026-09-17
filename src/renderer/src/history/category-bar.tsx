import type { ForumState } from '../../../shared/forum'
import { controller } from '../app/ui'
import { errorText } from '../app/format'
import { tr } from '../../../shared/i18n'

// iOS MorseGroupCategoryBar: «모두» and the group's topics above the history; the choice is kept on this device and
// decides the topic of what is sent next.
export function CategoryBar({ accountUid, chatId, forum, selected }: { accountUid: string; chatId: string; forum: ForumState; selected: string | null }) {
  const choose = (category: string | null): void => {
    if (category === selected) return
    void window.morse.setChatFlags(accountUid, chatId, { category }).catch(reason => controller.toast(errorText(reason, tr('카테고리를 바꾸지 못했습니다.')), 'error'))
  }
  return <div className="category-bar" role="tablist" aria-label={tr('카테고리')}>
    <button type="button" role="tab" aria-selected={!selected} className={!selected ? 'active' : undefined} onClick={() => choose(null)}>{tr('모두')}</button>
    {forum.categories.map(category => <button key={category.id} type="button" role="tab" aria-selected={selected === category.id}
      className={selected === category.id ? 'active' : undefined} onClick={() => choose(category.id)}># {category.name}</button>)}
  </div>
}
