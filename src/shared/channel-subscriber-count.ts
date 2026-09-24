import { language, locale, tr } from './i18n'

// iOS MorseChannelSubscriberCountText. The unit a count folds into differs by language: Korean uses 만 (ten
// thousand), English and Russian use K (a thousand) and M (a million). One helper, because the same count was
// written three ways here — the feed card folded it, while the channel subtitle and the discovery box printed
// the whole number.
//
// The decimal place is truncated, and dropped when it is zero, as official Telegram's compactNumericCountString
// does (submodules/TelegramPresentationData/Sources/NumericFormat.swift, commit
// 6ad963e5b62d354da79040f388ae2b9132fb17b8): 12,000 is «12K», not «12.0K». Intl's compact notation rounds, which
// turns 12,999 into «13K» and 999,999 into «1000K», and in Russian it writes «12 тыс.» where iOS writes «12K».
//
// Telegram itself does not fold a subscriber count at all: ChatTitleView.swift:709,
// PeerInfoRecommendedPeersPane.swift:73 and JoinLinkPreviewPeerContentNode.swift:186 all put the whole number in
// a plural string, and the plural formatter groups its digits (build-system/GenerateStrings/GenerateStrings.py:504
// formatNumberWithGroupingSeparator). Folding is a difference we take for the Korean 만 unit; iOS and Android
// (channelSubscriberLabel) fold the same way.
export function subscriberCountText(count: number): string {
  if (count < 1000) return subscriberCountFull(count)
  // The Korean key of the large-unit string reads 만명; English and Russian give it M and млн.
  if (language() === 'ko') {
    if (count >= 10000) return tr('{0}만명', [compact(count, 10000)])
  } else if (count >= 1000000) {
    return tr('{0}만명', [compact(count, 1000000)])
  }
  return tr('{0}k명', [compact(count, 1000)])
}

// The unfolded count, for the row that opens the subscriber list and other places that owe an exact number. iOS
// spells those out too (ChannelSubscribersView, ChannelShareSheet, the channel row in ProfileView).
export function subscriberCountFull(count: number): string {
  return tr('구독자 {0}명', [count.toLocaleString(locale())])
}

// The quotient and one decimal digit, truncated; no decimal point when that digit is zero.
function compact(count: number, unit: number): string {
  const whole = Math.floor(count / unit)
  const digit = Math.floor((count % unit) / (unit / 10))
  return digit === 0 ? `${whole}` : `${whole}${decimalSeparator()}${digit}`
}

function decimalSeparator(): string {
  return (1.1).toLocaleString(locale()).replace(/\d/g, '')
}
