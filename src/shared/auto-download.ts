import { tr } from './i18n'
import type { DialogSummary, Preferences } from './model'

// Data::AutoDownload (data_auto_download.h/.cpp): automatic media download is a limit in bytes, not a
// switch, and Telegram keeps one for each kind of peer a message can come from — Source::User,
// Source::Group, Source::Channel — so a person can leave photos coming from people and hold back the
// ones from busy groups. A limit of zero is off (SetDisabledForSource sets every type to zero).
export type AutoDownloadSource = 'user' | 'group' | 'channel'
// kDefaultMaxSize: SetDefaultsForSource gives Type::Photo this limit for every source.
export const autoDownloadDefaultBytes = 8 * 1024 * 1024
// The sizes this window offers. Telegram's setting is a slider; the steps here are off, a small
// picture, Telegram's own default, and everything a preview can hold (photo-previews maxPreviewBytes).
export const autoDownloadChoices = [0, 1024 * 1024, autoDownloadDefaultBytes, 16 * 1024 * 1024] as const
export type AutoDownloadLimits = Record<AutoDownloadSource, number>
export const autoDownloadDefaults: AutoDownloadLimits = { user: autoDownloadDefaultBytes, group: autoDownloadDefaultBytes, channel: autoDownloadDefaultBytes }

export function autoDownloadSourceLabel(source: AutoDownloadSource): string {
  return source === 'user' ? tr('개인') : source === 'group' ? tr('그룹', [], 'kind') : tr('채널')
}
export function autoDownloadChoiceLabel(bytes: number): string {
  return bytes === 0 ? tr('받지 않음') : tr('{0} MB까지', [Math.round(bytes / (1024 * 1024))])
}
// SourceFromPeer: a person is User, a chat or a megagroup is Group, anything else is Channel. A
// channel's discussion room is a megagroup, so it counts as a group; a channel's 1:1 inquiry belongs
// to the channel itself.
export function autoDownloadSource(dialog: Pick<DialogSummary, 'kind'> | null, inquiry = false): AutoDownloadSource {
  if (inquiry) return 'channel'
  return dialog?.kind === 'group' ? 'group' : 'user'
}
export function autoDownloadLimit(preferences: Pick<Preferences, 'autoDownloadPhotos'>, source: AutoDownloadSource): number {
  const value = preferences.autoDownloadPhotos[source]
  return Number.isSafeInteger(value) && value > 0 ? value : 0
}
// A stored setting from before the limits: the switch becomes Telegram's defaults, or off everywhere.
export function autoDownloadLimits(raw: unknown): AutoDownloadLimits {
  if (raw === true || raw === undefined) return { ...autoDownloadDefaults }
  if (raw === false) return { user: 0, group: 0, channel: 0 }
  if (!raw || typeof raw !== 'object') throw new Error(tr('사진 자동 내려받기 설정을 다시 선택해 주세요.'))
  const record = raw as Record<string, unknown>
  const limits = {} as AutoDownloadLimits
  for (const source of ['user', 'group', 'channel'] as const) {
    const value = record[source]
    if (!autoDownloadChoices.includes(value as (typeof autoDownloadChoices)[number])) throw new Error(tr('사진 자동 내려받기 설정을 다시 선택해 주세요.'))
    limits[source] = value as number
  }
  return limits
}
