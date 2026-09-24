import { tr } from './i18n'
import type { ChatMessage } from './model'

// One line's name for a message of each kind: what a reply quote, the composer's reply bar, a search
// result and a bubble with no picture in it all put where the words would be. Three copies of this map
// had drifted apart — one had no name for a poll at all, and each said something different about a
// message this version cannot read — so it is written once here, as iOS keeps its own in one place
// (Message.unsupportedPreviewLabel), which is what made the pinned bar and the forward header come
// right along with the rest.
const labels: Readonly<Record<string, () => string>> = {
  text: () => '', image: () => tr('사진'), video: () => tr('동영상'), voice: () => tr('음성 메시지'),
  file: () => tr('파일'), sticker: () => tr('스티커'), channelPost: () => tr('채널 게시물'),
  location: () => tr('위치'), event: () => tr('일정'), poll: () => tr('투표'),
  // Telegram names it in one line the same way where one line is all there is (Watch.Message.Unsupported).
  unsupported: () => tr('지원하지 않는 메시지')
}
export function messageKindLabel(kind: ChatMessage['kind'] | string): string { return (labels[kind] ?? (() => ''))() }

// The whole of what a message this version cannot read says, which belongs in the bubble and nowhere
// else. Telegram puts the notice in the message's own text and draws all of it italic
// (history_item_helpers.cpp UnsupportedMessageText: lng_message_unsupported with a link to the site,
// then EntityType::Italic over its length); Morse says it in its own words and sends people to the
// update rather than to a download page.
export function unsupportedMessageNotice(): string {
  return tr('이 메시지는 현재 버전의 Morse에서 지원하지 않습니다. 최신 버전으로 업데이트해 주세요.')
}
