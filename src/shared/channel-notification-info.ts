import { tr } from './i18n'
export const channelNotificationModes = { on: tr('알림 받기'), silent: tr('조용히 받기'), off: tr('알림 끄기') } as const
export interface ChannelNotificationInfo {
  mode: keyof typeof channelNotificationModes | null
  origin: 'stored' | 'default' | 'unknown' | 'unavailable'
}
