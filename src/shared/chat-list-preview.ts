// Portions of this file follow Telegram Desktop (https://github.com/telegramdesktop/tdesktop, 7.2.8, 272f6f5c),
// Copyright (c) 2014-2026 The Telegram Desktop Authors. Licensed under GPL-3.0-or-later; see LEGAL.
import { tr } from './i18n'
import type { ChatMessage, DialogSummary } from './model'
import { memoNoteListLine } from './memo-note'

// A chat list line for a message that is not a text. Neither server keeps the kind of the newest
// message in the room document — `lastMessage` is a string and nothing beside it says what made it —
// so the label itself is the wire: talky-server morse-message-authority.js `preview()` and Firebase
// functions morse-message-preview.js `lastMessagePreview()` both write one English word, and the
// second says what the clients are to do with it: «The labels are English; the clients show them in
// their own language.» An older iOS client wrote its own language's label into the same field, so the
// line can arrive in any of the three.
//
// iOS reads it back by the picture it starts with (MorseAccountModels.swift chatListPreviewSubtitle:
// «발신자 기기 언어로 저장된 미디어 레이블을 수신자 현재 언어로 재로컬라이즈»), and this is the same
// rule, so the same room reads 사진 on both. Telegram names a kind in its own words too, from the
// message it holds rather than from a line the server wrote (lng_in_dlg_photo, lng_in_dlg_video,
// lng_in_dlg_audio in dialogs/ui/dialogs_message_view.cpp).
//
// Only a label that starts with one of these pictures is replaced. A line that reads «Sticker»,
// «Location», «Event» or «Contact» with nothing in front of it is as easily someone's own word, and
// the room document carries nothing that tells the two apart — so those stay as they came, and a
// picture is what makes a label a label here.
const labels: readonly (readonly [string, () => string])[] = [
  ['📷', () => tr('사진')],
  // 🎬 is what both servers write; 🎥 and 📹 are what iOS wrote for a video and for a round video.
  ['🎬', () => tr('동영상')],
  ['🎥', () => tr('동영상')],
  ['📹', () => tr('원형 영상')],
  ['🎤', () => tr('음성 메시지')],
  // A file is listed by its name («📄 …»), and 📎 is the label left when it has none.
  ['📎', () => tr('파일')],
  ['📍', () => tr('위치')]
]
// Before the pictures, a video was written between angle brackets in the sender's language.
const legacyVideo = /^<\s*(비디오|Видео|[Vv]ideo)\s*>?/u

// The kind of the newest message, which both servers now write beside the line: `lastMessageType`
// carries the message's own type, verbatim (talky-server e39203e, Firebase 6c932942, the contract of
// 2026-09-24). Knowing the kind ends the guessing — «Sticker», «Location» and «Event» had no picture in
// front of them to tell them from someone's own word, and a message that really began with 📷 was read
// as a label. A room whose newest message is older than the field carries none and falls back below.
// A text, a channel post and a poll are words of their own: the line is the text, or the question.
const kinds: Readonly<Record<string, () => string>> = {
  image: () => tr('사진'), video: () => tr('동영상'), voice: () => tr('음성 메시지'),
  sticker: () => tr('스티커'), location: () => tr('위치'), contact: () => tr('연락처')
}
export function chatListPreviewText(raw: string, kind = ''): string {
  // A note kept in the memo room's own messages is named by its title, as iOS names it.
  const note = memoNoteListLine(raw)
  if (note !== null) return note
  const named = kinds[kind]
  if (named) return named()
  // A file is listed by its name and an event by its title where the server had one to write
  // (morse-message-preview.js: `message.fileName || message.text || '📎 File'`, `📅 ${eventTitle}`);
  // only the bare label left when it had none is named here.
  if (kind === 'file') return raw && !raw.startsWith('📎') ? raw : tr('파일')
  if (kind === 'event') return raw.startsWith('📅') ? raw : tr('일정')
  if (kind === 'text' || kind === 'channelPost' || kind === 'poll') return raw
  for (const [mark, label] of labels) if (raw.startsWith(mark)) return label()
  return legacyVideo.test(raw) ? tr('동영상') : raw
}

// B165: the line for a message this device already holds, when the row's newest message is decided here before the
// room document is rewritten (tdesktop History::setLastMessage takes the item itself; dialogs_message_view.cpp names
// a kind in the window's own words). The same words as chatListPreviewText gives the server's line for that kind.
export function messageListPreview(message: Pick<ChatMessage, 'kind' | 'text' | 'encrypted' | 'system' | 'poll' | 'attachments'>): string {
  if (message.encrypted) return tr('비밀 메시지')
  if (message.system || message.kind === 'text' || message.kind === 'channelPost') return message.text
  if (message.kind === 'poll') return message.poll?.question ?? message.text
  if (message.kind === 'file') return chatListPreviewText(message.attachments?.[0]?.name ?? '', 'file')
  return chatListPreviewText(message.text, message.kind)
}

// Telegram's chat list keeps an unsent draft in view, in place of the last message: dialogs_layout.cpp
// paints `lng_dialogs_text_from_wrapped` with `lng_from_draft` as the «from» part, and only while the
// row has nothing unread — `(!item || !badgesState.unread)` — so a message waiting to be read is never
// hidden behind what this account was writing. iOS says the same in its own words («작성 중: %@»,
// MorseChatListRowDisplay.subtitle) and colours the line with the palette's primary.
// A row shows one line, so this is all of a draft that is ever carried to it.
export const draftPreviewChars = 160

// What a row shows in place of its last message, if anything: `(!item || !badgesState.unread)` is
// Telegram's whole condition, so a message waiting to be read is never hidden behind what this account
// was writing. A secret chat's row says nothing of its contents at all.
export function chatListDraft(dialog: Pick<DialogSummary, 'kind' | 'draft'>, unread: number, marked: boolean): string {
  if (dialog.kind === 'secret' || unread > 0 || marked) return ''
  return (dialog.draft ?? '').slice(0, draftPreviewChars)
}
