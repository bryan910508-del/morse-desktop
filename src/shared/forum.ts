import type { ChatMessage, DialogSummary } from './model'

// iOS MorseGroupCategory / MorseChatForumFirestore: a group with isForumEnabled keeps its topics in
// chats.forumCategories ({id, name, sortOrder, icon?, isGeneral?}) and a message names its topic in categoryId.
export interface ForumCategory { id: string; name: string; sortOrder: number; isGeneral: boolean; icon?: string }
export interface ForumState { categories: ForumCategory[]; generalId: string }
export const generalCategoryId = 'general'
export const maxForumCategoryName = 50

// MorseGroupCategorySelection.outgoingCategoryId: the chosen topic, or the general one while «모두» is chosen.
export function outgoingCategory(summary: DialogSummary | undefined): string | undefined {
  const forum = summary?.forum
  if (!forum) return undefined
  const selected = summary.forumSelected
  return selected && forum.categories.some(category => category.id === selected) ? selected : forum.generalId
}
// messageMatchesFilter: a message without a topic belongs to the general one.
export function inCategory(message: Pick<ChatMessage, 'categoryId'>, forum: ForumState, selected: string | null | undefined): boolean {
  if (!selected) return true
  return (message.categoryId ?? forum.generalId) === selected
}
