import assert from 'node:assert/strict'
import { test } from 'node:test'
import { chatListDraft, chatListPreviewText, draftPreviewChars } from '../../src/shared/chat-list-preview'
import { inquiryPreviewText } from '../../src/shared/channel-inquiries'
import { decodeMemoNote, memoNoteListLine, memoNoteWirePrefix } from '../../src/shared/memo-note'

// Neither server keeps the kind of a room's newest message: talky-server morse-message-authority.js
// `preview()` and Firebase functions morse-message-preview.js `lastMessagePreview()` write one English
// label into `lastMessage`, and the second says the clients show it in their own language. iOS reads it
// back by the picture it starts with (MorseAccountModels.swift chatListPreviewSubtitle); so does this.
test('the labels both servers write are read in this window’s own words', () => {
  assert.equal(chatListPreviewText('📷 Photo'), '사진')
  assert.equal(chatListPreviewText('🎬 Video'), '동영상')
  assert.equal(chatListPreviewText('🎤 Voice message'), '음성 메시지')
  assert.equal(chatListPreviewText('📎 File'), '파일')
})

test('a label another client wrote in its own language is read the same way', () => {
  // Older iOS wrote the label itself, in whatever language that device was set to.
  assert.equal(chatListPreviewText('📷 Фото'), '사진')
  assert.equal(chatListPreviewText('📷 사진'), '사진')
  assert.equal(chatListPreviewText('🎥 Видео'), '동영상')
  assert.equal(chatListPreviewText('📹 원형 영상'), '원형 영상')
  assert.equal(chatListPreviewText('📍 Геопозиция'), '위치')
  // Before the pictures, a video came between angle brackets.
  assert.equal(chatListPreviewText('<비디오>'), '동영상')
  assert.equal(chatListPreviewText('<Video>'), '동영상')
})

// The reason the whole line is not translated word by word: without a picture in front of it, a line
// that reads «Sticker» or «Event» is as easily what someone typed, and the room document says nothing.
test('a line with no picture in front of it is left as the person wrote it', () => {
  assert.equal(chatListPreviewText('Sticker'), 'Sticker')
  assert.equal(chatListPreviewText('Event'), 'Event')
  assert.equal(chatListPreviewText('Photo'), 'Photo')
  assert.equal(chatListPreviewText('오늘 사진 보낼게'), '오늘 사진 보낼게')
  assert.equal(chatListPreviewText(''), '')
})

// A file is listed by its name and an event by its title; neither is a label to replace.
test('a name or a title the server put in the line stays', () => {
  assert.equal(chatListPreviewText('📄 계약서.pdf'), '📄 계약서.pdf')
  assert.equal(chatListPreviewText('📅 수요일 회의'), '📅 수요일 회의')
})

// An inquiry room's line is only ever written by the server, so its own words are named exactly; a
// line another client wrote still comes back through the same picture rule.
test('an inquiry room’s line keeps its exact names and gains the picture rule', () => {
  assert.equal(inquiryPreviewText('📷 Photo'), '사진')
  assert.equal(inquiryPreviewText('Sticker'), '스티커')
  assert.equal(inquiryPreviewText('📷 Фото'), '사진')
  assert.equal(inquiryPreviewText('안녕하세요'), '안녕하세요')
})

// RowPainter::Paint keeps an unsent draft in the row in place of the last message, and only while the
// row has nothing unread: `(!item || !badgesState.unread)`.
const room = (draft: string, kind: 'direct' | 'group' | 'secret' = 'direct') => ({ kind, draft })
test('a row shows what was left unsent, until something arrives to be read', () => {
  assert.equal(chatListDraft(room('저녁에 보자'), 0, false), '저녁에 보자')
  assert.equal(chatListDraft(room('저녁에 보자'), 3, false), '', 'an unread message is not hidden behind my own writing')
  assert.equal(chatListDraft(room('저녁에 보자'), 0, true), '', 'a row marked unread counts the same way')
  assert.equal(chatListDraft(room(''), 0, false), '')
  assert.equal(chatListDraft({ kind: 'direct' }, 0, false), '', 'a room whose draft was never carried shows none')
  // A secret chat's row says nothing of what it holds.
  assert.equal(chatListDraft(room('비밀', 'secret'), 0, false), '')
  // One line is all a row has.
  assert.equal(chatListDraft(room('가'.repeat(400)), 0, false).length, draftPreviewChars)
})

// `lastMessageType` (talky-server e39203e, Firebase 6c932942) carries the newest message's own type, so
// the line no longer has to be guessed at by the picture in front of it.
test('the kind the server writes names the line, whatever language wrote it', () => {
  assert.equal(chatListPreviewText('📷 Photo', 'image'), '사진')
  assert.equal(chatListPreviewText('Sticker', 'sticker'), '스티커')
  assert.equal(chatListPreviewText('Location', 'location'), '위치')
  assert.equal(chatListPreviewText('Contact', 'contact'), '연락처')
  assert.equal(chatListPreviewText('🎤 Voice message', 'voice'), '음성 메시지')
})

test('a text, a channel post and a poll are read as the words they are', () => {
  // The guessing this replaces: a message that really begins with a picture is no longer a label.
  assert.equal(chatListPreviewText('📷 이거 봐', 'text'), '📷 이거 봐')
  assert.equal(chatListPreviewText('Sticker', 'text'), 'Sticker')
  assert.equal(chatListPreviewText('어느 쪽이 좋아요?', 'poll'), '어느 쪽이 좋아요?')
  assert.equal(chatListPreviewText('새 게시물', 'channelPost'), '새 게시물')
})

// A file is listed by its name and an event by its title where the server had one to write; only the
// bare label it leaves when there was none is named.
test('a file keeps its name and an event its title', () => {
  assert.equal(chatListPreviewText('계약서.pdf', 'file'), '계약서.pdf')
  assert.equal(chatListPreviewText('📄 계약서.pdf', 'file'), '📄 계약서.pdf')
  assert.equal(chatListPreviewText('📎 File', 'file'), '파일')
  assert.equal(chatListPreviewText('📅 수요일 회의', 'event'), '📅 수요일 회의')
  assert.equal(chatListPreviewText('Event', 'event'), '일정')
})

test('a room whose newest message is older than the field is read as before', () => {
  assert.equal(chatListPreviewText('📷 Photo', ''), '사진')
  assert.equal(chatListPreviewText('Sticker', ''), 'Sticker')
  // An unknown kind is no reason to rewrite someone's words either.
  assert.equal(chatListPreviewText('안녕', 'something-new'), '안녕')
})

// A note iOS kept in the memo room's own messages (Message.encodeMemoNoteWire). MorseNotesMigration
// copies such a note into spaceNotes without removing it, and only on the device that ran it, so this
// message can be the only copy — it is read, not hidden.
test('a note kept as a memo room message is read as the note it is', () => {
  const wire = `${memoNoteWirePrefix}${JSON.stringify({ t: '장보기', b: '우유\n달걀' })}`
  assert.deepEqual(decodeMemoNote(wire), { title: '장보기', body: '우유\n달걀' })
  assert.equal(memoNoteListLine(wire), '📝 장보기')
  assert.equal(chatListPreviewText(wire), '📝 장보기')
  assert.equal(memoNoteListLine(`${memoNoteWirePrefix}${JSON.stringify({ t: '  ', b: '내용' })}`), '📝')
})

test('anything that is not that exact shape stays the person’s own text', () => {
  assert.equal(decodeMemoNote('__TALKY_MEMO__:not json'), null)
  assert.equal(decodeMemoNote(`${memoNoteWirePrefix}{"t":"제목"}`), null, 'both fields must be there')
  assert.equal(decodeMemoNote(`${memoNoteWirePrefix}{"t":1,"b":"x"}`), null, 'and both must be strings')
  assert.equal(decodeMemoNote(`${memoNoteWirePrefix}["t","b"]`), null)
  assert.equal(decodeMemoNote('오늘 __TALKY_MEMO__: 라고 썼다'), null)
  assert.equal(memoNoteListLine('그냥 메시지'), null)
})

// A line written before the server described its media is a storage address, and the room's line shows
// a photo instead of the address. Matching the text meant a written default port («…com:443/…») was
// not recognised and the whole address went into the line; the address is read instead.
test('a storage address in an inquiry line is a photo, port written or not', () => {
  const path = '/v0/b/talky.appspot.com/o/chat_media%2Fx.jpg?alt=media&token=abc'
  assert.equal(inquiryPreviewText(`https://firebasestorage.googleapis.com${path}`), '사진')
  assert.equal(inquiryPreviewText(`https://firebasestorage.googleapis.com:443${path}`), '사진')
  // Another host, another scheme, or something that is not an address at all stays as it came.
  assert.equal(inquiryPreviewText(`https://example.com${path}`), `https://example.com${path}`)
  assert.equal(inquiryPreviewText(`http://firebasestorage.googleapis.com${path}`), `http://firebasestorage.googleapis.com${path}`)
  assert.equal(inquiryPreviewText('firebasestorage.googleapis.com 에서 받았어요'), 'firebasestorage.googleapis.com 에서 받았어요')
})
