import { tr } from './i18n'
export const channelJoinPolicies = { open: tr('바로 가입'), approval: tr('승인 후 가입'), subscribers: tr('구독자만') } as const
export const channelChatModes = { broadcast: tr('공지형'), discussion: tr('토론형') } as const
export const channelCategories = {
  work: tr('직장'), student: tr('학생'), dating: tr('연애·만남'), game: tr('게임'), music: tr('음악'), food: tr('요리·맛집'), fitness: tr('운동·헬스'), book: tr('책·독서'), movie: tr('영화·드라마'),
  it: tr('IT·개발'), art: tr('예술·디자인'), travel: tr('여행'), health: tr('건강·의료'), finance: tr('재테크'), pet: tr('반려동물'), advice: tr('고민·상담'), free: tr('익명 자유')
} as const
export interface ChannelSetting<T> { value: T | null; origin: 'stored' | 'default' | 'unknown' }
export interface ChannelAccessInfo {
  joinPolicy: ChannelSetting<keyof typeof channelJoinPolicies>
  chatMode: ChannelSetting<keyof typeof channelChatModes>
  historyVisible: ChannelSetting<boolean>
  category: keyof typeof channelCategories | 'none' | 'unknown'
  publicFlag: boolean | null
  visibilityConflict: boolean
}
