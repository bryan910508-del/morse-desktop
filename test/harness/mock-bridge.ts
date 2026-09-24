import { defaultPreferences, type ChatMessage, type DesktopEvent, type HistorySnapshot, type MessagePosition } from '../../src/shared/model'

// A small in-memory Morse account: one 1:1 chat with numbered messages and three pinned ones.
const me = 'harness-me', peer = 'harness-peer', chatId = 'harness-chat'
const pageSize = 50, total = 150
// ?short shows a room holding only its last few messages, so the list can be checked for Telegram's
// bottom-aligned layout (ListWidget::countItemsTop) instead of floating at the top of an empty window.
const shortRoom = new URLSearchParams(location.search).has('short')
// m-148 is on the first screen, so its menu can be checked without scrolling.
const pinnedIds = ['m-010', 'm-060', 'm-120', 'm-148']
const position = (index: number): MessagePosition => ({ seconds: 1_750_000_000 + index * 60, nanoseconds: 0, id: `m-${String(index).padStart(3, '0')}` })
const messages: ChatMessage[] = Array.from({ length: total }, (_, index) => ({
  id: position(index).id, chatId, senderId: index % 3 === 0 ? me : peer, senderName: index % 3 === 0 ? '나' : '상대',
  kind: 'text', text: `메시지 ${index}${pinnedIds.includes(position(index).id) ? ' (고정)' : ''}`, position: position(index),
  serverConfirmed: true, encrypted: false, readEligible: true, state: 'sent', version: `${1_750_000_000 + index * 60}:0`,
  edited: false, system: false, reactions: []
} as unknown as ChatMessage))

// One photo message in the chat, so the bubble's automatic picture can be looked at as well.
messages[total - 4] = { ...messages[total - 4]!, kind: 'image', text: '', caption: '사진 설명',
  // A tall picture, so the bubble can be checked for the photo's own shape rather than a crop.
  // A tiny placeholder like the one a photo now travels with, so the blurred bubble can be seen.
  mediaMetadata: { mediaWidthPx: 900, mediaHeightPx: 1600, thumbData: '/9j/4AAQSkZJRgABAQAASABIAAD/4QBMRXhpZgAATU0AKgAAAAgAAYdpAAQAAAABAAAAGgAAAAAAA6ABAAMAAAABAAEAAKACAAQAAAABAAAAIKADAAQAAAABAAAAIAAAAAD/7QA4UGhvdG9zaG9wIDMuMAA4QklNBAQAAAAAAAA4QklNBCUAAAAAABDUHYzZjwCyBOmACZjs+EJ+/8AAEQgAIAAgAwEiAAIRAQMRAf/EAB8AAAEFAQEBAQEBAAAAAAAAAAABAgMEBQYHCAkKC//EALUQAAIBAwMCBAMFBQQEAAABfQECAwAEEQUSITFBBhNRYQcicRQygZGhCCNCscEVUtHwJDNicoIJChYXGBkaJSYnKCkqNDU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6g4SFhoeIiYqSk5SVlpeYmZqio6Slpqeoqaqys7S1tre4ubrCw8TFxsfIycrS09TV1tfY2drh4uPk5ebn6Onq8fLz9PX29/j5+v/EAB8BAAMBAQEBAQEBAQEAAAAAAAABAgMEBQYHCAkKC//EALURAAIBAgQEAwQHBQQEAAECdwABAgMRBAUhMQYSQVEHYXETIjKBCBRCkaGxwQkjM1LwFWJy0QoWJDThJfEXGBkaJicoKSo1Njc4OTpDREVGR0hJSlNUVVZXWFlaY2RlZmdoaWpzdHV2d3h5eoKDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uLj5OXm5+jp6vLz9PX29/j5+v/bAEMABgYGBgYGCgYGCg4KCgoOEg4ODg4SFxISEhISFxwXFxcXFxccHBwcHBwcHCIiIiIiIicnJycnLCwsLCwsLCwsLP/bAEMBBwcHCwoLEwoKEy4fGh8uLi4uLi4uLi4uLi4uLi4uLi4uLi4uLi4uLi4uLi4uLi4uLi4uLi4uLi4uLi4uLi4uLv/dAAQAAv/aAAwDAQACEQMRAD8A+ppJEiRpZWCqoySTgAD1rxrX/jl4Q0a4a1tRLfuhwxiACZ/3j1qH4y6lfNHpHhSylNuNYufLllHO2MEA/gM5I9q+a9a+H2o6d9ljhnimluDdEqWWNVSAB0bcxwfNjIdR6EVcUuomfSGi/HvwfqdwttfRz2JY4DyAMg+pXkflXtUU8VxEs8DrJG4DKynIIPQgjqK/Pe3+H2t3m1bWS3kkP2fcgdtyfaEEiFvlwAFIJOcZOBk8V9O/BKbU7TTdQ8M6nKkx02WNonjbevlzpvAB/oQCM4oaXQEf/9D2D4meDJvGWhrHp0nkajZsZbV9xXkjDIWHTcO/rXw3r9jrulXQ0rWzKJVx+6kYsVKjyxxkjgKAMdgMcV+lGa8r1H4TaHq3iuXxVqNzcSvIVPkZUINoAxuxuwe+MH3q0xNHx7o2meONZul0/SReOzsjEKzhQYwAjMc4G0AYPbAxX2z8P/B7+ENHeG8na6v7txLdTMSxZ8YAyeSFHFdyiJEoSNQigYAAwMCjk0NjSP/Z' },
  attachments: [{ index: 0, kind: 'image', name: '사진', available: true, blind: false }] } as unknown as ChatMessage

// A video the way iOS sends one: its size in videoWidthPx/videoHeightPx, its length, and a placeholder.
messages[total - 8] = { ...messages[total - 8]!, kind: 'video', text: '', caption: '아이폰에서 온 동영상',
  mediaMetadata: { videoWidthPx: 1080, videoHeightPx: 1920, videoDuration: 75,
    thumbData: (messages[total - 4]!.mediaMetadata as { thumbData: string }).thumbData },
  attachments: [{ index: 0, kind: 'video', name: '동영상', available: true, blind: false }] } as unknown as ChatMessage

// A video the way this desktop now sends one, with Telegram's 320px thumbnail, drawn sharp.
messages[total - 10] = { ...messages[total - 10]!, kind: 'video', text: '', caption: '데스크탑에서 보낸 동영상',
  mediaMetadata: { videoWidthPx: 1920, videoHeightPx: 1080, videoDuration: 9 },
  attachments: [{ index: 0, kind: 'video', name: '동영상', available: true, blind: false }] } as unknown as ChatMessage
void Promise.resolve().then(async () => {
  const url = await jpegDataURL(320, 180)
  ;(messages[total - 10]!.mediaMetadata as { thumbData?: string }).thumbData = url.slice('data:image/jpeg;base64,'.length)
})

// A round video message (원형 영상), drawn as a circle that plays in the bubble.
messages[total - 12] = { ...messages[total - 12]!, kind: 'video', text: '', caption: ' \u200B ', circular: true,
  mediaMetadata: { videoWidthPx: 480, videoHeightPx: 480, videoDuration: 2, isCircleVideo: true,
    thumbData: (messages[total - 4]!.mediaMetadata as { thumbData: string }).thumbData },
  attachments: [{ index: 0, kind: 'video', name: '동영상', available: true, blind: false }] } as unknown as ChatMessage

// A photo the way iOS sends one: no placeholder travels with it, which is the case Telegram answers
// by fetching a small size whatever the automatic download preference says.
messages[total - 6] = { ...messages[total - 6]!, kind: 'image', text: '', caption: '아이폰에서 온 사진',
  mediaMetadata: { mediaWidthPx: 1200, mediaHeightPx: 800 },
  attachments: [{ index: 0, kind: 'image', name: '사진', available: true, blind: false }] } as unknown as ChatMessage

// A channel post mirrored into a discussion room (chpost_{postId}): a system message that carries the
// post's own picture, drawn as a card (MorseChatUIKitNativeChannelPostRow).
messages[total - 14] = { ...messages[total - 14]!, kind: 'channelPost', system: true, text: '채널에 새 게시물이 올라왔습니다',
  channelPost: { channelId: 'ch-mine', postId: 'cpost-1', channelName: '내 채널', ratio: 4 / 5 },
  mediaMetadata: { mediaWidthPx: 1200, mediaHeightPx: 1500 },
  attachments: [{ index: 0, kind: 'image', name: '사진', available: true, blind: false }] } as unknown as ChatMessage

// Text with addresses, emoji on their own and a shared channel, for links, link cards and large emoji.
const text = (index: number, value: string): void => { messages[index] = { ...messages[index]!, text: value } as ChatMessage }
text(total - 2, '자료는 https://example.com/docs?page=2, 메일은 help@morse.com 으로 주세요')
text(total - 3, '😀👍')
text(total - 5, '📢 [모스 소식] 채널을 공유했어요\nhttps://talky-a38c3.web.app/channel/abc123')
text(total - 7, '😂')
text(total - 9, 'naver.com 에서 찾아봐요')
// A poll as iOS sends one, so the card and its vote buttons can be looked at: several answers allowed,
// nothing chosen yet. total-17 is a second one, a quiz that this account has already answered.
messages[total - 16] = { ...messages[total - 16]!, kind: 'poll', text: '', senderId: peer, senderName: '상대',
  poll: { question: '이번 주 회식 언제가 좋아요?', options: ['수요일', '목요일', '금요일'], anonymous: false,
    multipleAnswers: true, quiz: false, correctOption: null, canRevote: true, shuffleOptions: false,
    voteCounts: [2, 5, 1], totalVoters: 7, mine: null, closed: false } } as unknown as ChatMessage
messages[total - 17] = { ...messages[total - 17]!, kind: 'poll', text: '', senderId: peer, senderName: '상대',
  poll: { question: '모스는 어느 나라 말로 처음 나왔을까요?', options: ['한국어', '영어'], anonymous: true,
    multipleAnswers: false, quiz: true, correctOption: 0, canRevote: false, shuffleOptions: false,
    voteCounts: [3, 1], totalVoters: 4, mine: [0], closed: false } } as unknown as ChatMessage
// A reply to a photo, as ReplyContext.originalPreview builds one: the kind's name, then the caption.
messages[total - 13] = { ...messages[total - 13]!, text: '그 사진 좋네요',
  reply: { state: 'ready', senderName: '상대', kind: 'image', text: '사진 · 사진 설명' } } as unknown as ChatMessage
// A reply to a message this version cannot read, which has no content of its own to quote.
messages[total - 15] = { ...messages[total - 15]!, text: '이건 안 보여요',
  reply: { state: 'ready', senderName: '상대', kind: 'unsupported', text: '지원하지 않는 메시지' } } as unknown as ChatMessage
// A note iOS kept in the memo room's own messages: read as the note it is, never as its wire.
text(total - 11, "__TALKY_MEMO__:{\"t\": \"장보기\", \"b\": \"우유\\n달걀\\n식빵\"}")
messages[total - 3] = { ...messages[total - 3]!, categoryId: 'notice' } as ChatMessage
// Reactions with the people behind them, and one new reaction to my message for the chat list.
messages[total - 2] = { ...messages[total - 2]!, reactions: [{ emoji: '❤️', count: 2, selected: true, users: [{ uid: me, name: '나' }, { uid: peer, name: '상대' }] },
  { emoji: '👍', count: 5, selected: false, users: [{ uid: peer, name: '상대' }] }] } as ChatMessage

// Settings are kept here so a switch, such as Telegram's automatic media download, really takes
// effect in the harness instead of being recorded and forgotten.
// ?manual sets every automatic photo download limit to zero, the way a person can, so the download
// button a held back picture carries (Telegram historyFileThumbDownload) can be pressed here.
const preferences = { ...defaultPreferences, ...(new URLSearchParams(location.search).has('manual') ? { autoDownloadPhotos: { user: 0, group: 0, channel: 0 } } : {}) }

let revision = 10, historyRevision = 1
const listeners = new Set<(event: DesktopEvent) => void>()
// The account's chat folders as the main process follows them live; set from a test to act as another device.
let liveFolders: unknown[] | null = null
let typingUntil = 0
let listTyping: Record<string, { until: number; names: string[] }> = {}
let forumSelected: string | null = null
// chat_id -> the unsent text of that room, as local_drafts holds it.
const localDrafts = new Map<string, string>()
let selfPhoto: string | null = null
let pickVideo: string | null = null
export const harness = {
  calls: [] as { method: string; args: unknown[] }[],
  emit(event: DesktopEvent): void { for (const listener of [...listeners]) listener(event) },
  setFolders(folders: unknown[] | null): void { liveFolders = folders; refresh() },
  // The other person typing, as the main process publishes it from their watcher document.
  setTyping(until: number): void { typingUntil = until; refresh() },
  // Someone typing in chat list rows, as the main process publishes listTyping.
  setListTyping(value: Record<string, { until: number; names: string[] }>): void { listTyping = value; refresh() },
  // The account's own profile photo, as SelfProfile publishes it once the picture is read.
  setSelfPhoto(url: string | null): void { selfPhoto = url; refresh() },
  // The next «사진 또는 동영상» picks this video (an address the harness page can play) instead of a photo.
  setPickVideo(url: string | null): void { pickVideo = url }
}
;(window as unknown as { __harness: typeof harness }).__harness = harness

function page(endIndex: number, focusMessageId?: string): HistorySnapshot {
  const start = shortRoom ? Math.max(0, endIndex - 2) : Math.max(0, endIndex - pageSize + 1)
  return { revision: ++historyRevision, messages: messages.slice(start, endIndex + 1), before: shortRoom || start === 0 ? null : messages[start]!.position,
    hasMore: !shortRoom && start > 0, status: 'ready', message: '', newerAvailable: endIndex < total - 1, focusMessageId } as HistorySnapshot
}
function loading(): HistorySnapshot {
  return { revision: ++historyRevision, messages: [], before: null, hasMore: false, status: 'loading', message: '', newerAvailable: true } as HistorySnapshot
}

// The channel tab (iOS ChannelFeedView) with my channel, subscriptions, posts and the discover rail.
const photo = (hue: number): string => `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600"><defs><linearGradient id="g"><stop offset="0" stop-color="hsl(${hue},70%,55%)"/><stop offset="1" stop-color="hsl(${hue + 60},70%,45%)"/></linearGradient></defs><rect width="800" height="600" fill="url(#g)"/></svg>`)}`
// Channel stories as ChannelStories publishes them: my channel's own story and a subscribed channel with one unseen.
const channelStory = (id: string, minutes: number, viewed: boolean, authorId = 'harness-owner') =>
  ({ id, authorId, mediaType: 'image', hasThumbnail: true, audio: false, caption: `${id} 설명`, createdAt: Date.now() - minutes * 60000, expiresAt: Date.now() + 3600000, viewed, reaction: null as string | null, viewCount: 7 })
const channelStories: Record<string, { channelId: string; stories: ReturnType<typeof channelStory>[]; unread: boolean }> = {
  'ch-mine': { channelId: 'ch-mine', stories: [channelStory('mine-1', 30, true, me)], unread: false },
  'ch-a': { channelId: 'ch-a', stories: [channelStory('a-1', 120, true), channelStory('a-2', 10, false)], unread: true }
}
function harnessChannelHome(): unknown {
  const channel = (id: string, name: string, subscriberCount: number, listed = true, owned = false) => ({ id, name, description: `${name} 채널 소개`, subscriberCount, avatar: null, listed, owned })
  const mine = channel('ch-mine', '내 채널', 1234, true, true)
  const subscribed = [channel('ch-a', '구독 중인 채널', 58), channel('ch-b', '개발 이야기', 12500), channel('ch-c', '맛집 지도', 830)]
  const promotedChannel = channel('ch-p', '홍보 채널', 4200, false)
  const at = (minutes: number) => { const ms = Date.now() - minutes * 60000; return { seconds: Math.floor(ms / 1000), nanoseconds: 0, id: `p${minutes}` } }
  const post = (id: string, channelId: string, minutes: number, text: string, image: unknown, mediaCount: number, promoted = false) =>
    ({ channelId, id, text, position: at(minutes), mediaCount, image, likeCount: 12, commentCount: 3, liked: false, visibility: 'public', promoted })
  return {
    status: 'ready', message: '', mine, subscribed,
    posts: [
      post('post-p', 'ch-p', 300, '홍보 게시물입니다.', { status: 'ready', url: photo(200), width: 800, height: 600, video: false }, 1, true),
      post('post-1', 'ch-a', 5, '새 소식을 전합니다. 이번 주 모임은 토요일 오후 3시에 열립니다.\n많은 참여 부탁드려요!', { status: 'ready', url: photo(20), width: 800, height: 600, video: false }, 3),
      post('post-2', 'ch-b', 90, '텍스트만 있는 게시물', null, 0),
      post('post-3', 'ch-c', 60 * 30, '영상 게시물', { status: 'loading', url: null, width: 0, height: 0, video: true }, 1)
    ],
    channels: [mine, ...subscribed, promotedChannel],
    discover: { status: 'ready', trending: [channel('ch-t1', '인기 채널 하나', 98000, false), channel('ch-t2', '음악 모음', 23000, false)], newest: [channel('ch-n1', '새 채널', 12, false)], promoted: [promotedChannel] },
    category: new URLSearchParams(location.search).has('category') ? { id: 'music', status: 'ready', channels: [channel('ch-m1', '음악 모음', 23000, false)] } : null
  }
}

// The channel screen (iOS ChannelDetailView): one channel with picture posts for the grid, text-only
// posts for the cards, a pinned post and a cover, so the whole screen can be looked at.
let channelPostsRequest: { requestId: string; channelId: string } | null = null
function harnessChannels(): unknown {
  const at = (minutes: number) => { const ms = Date.now() - minutes * 60000; return { seconds: Math.floor(ms / 1000), nanoseconds: 0, id: `cp-${minutes}` } }
  const revision = (index: number) => String(index).padStart(2, '0').repeat(32).slice(0, 64)
  const picture = (index: number, hue: number, video = false) => ({ index, kind: video ? 'video' : 'image', available: true, videoAvailable: video,
    blur: '', width: 800, height: 600, picture: { status: 'ready', url: photo(hue), width: 800, height: 600, video, blur: '' } })
  const post = (index: number, minutes: number, text: string, media: unknown[], pinFlag = 'unpinned') => ({
    removalEligible: true, pinFlag, own: true, editableText: text, visibility: 'public', id: `cpost-${index}`, revision: revision(index),
    likes: { status: 'ready', selected: index % 3 === 0, count: 4 + index, storedCount: 4 + index, message: '' },
    mediaCount: media.length, media, position: at(minutes), text, hasMedia: media.length > 0, pinned: pinFlag === 'pinned',
    likeCount: 4 + index, commentCount: index % 4
  })
  const items = [{
    id: 'ch-mine', version: '4:0', publicSharing: { name: 'mine', version: '4:0' }, hasAvatar: true, hasCover: true,
    avatar: { status: 'ready', url: photo(280), message: '' }, cover: { status: 'ready', url: photo(200), message: '' },
    status: 'ready', access: null, editableAccess: null, discussion: { status: 'known', chatId: 'harness-discussion' },
    tags: ['모스', '소식'], name: '내 채널', description: '사진과 글을 올리는 채널입니다.', ownerName: '테스트', owned: true,
    subscriptionListed: true, type: 'public', subscriberCount: 1234, postCount: 9, updated: at(5)
  }]
  const posts = [
    post(1, 5, '고정된 게시물입니다.', [picture(0, 10)], 'pinned'),
    post(2, 20, '사진 여러 장을 올린 게시물', [picture(0, 40), picture(1, 70), picture(2, 110)]),
    post(3, 60, '영상 게시물', [picture(0, 150, true)]),
    post(4, 120, '', [picture(0, 190)]),
    post(5, 300, '글만 있는 게시물입니다. 이 탭에서는 카드로 보입니다.', []),
    post(6, 600, '짧은 글', []),
    post(7, 900, '사진 한 장', [picture(0, 230)]),
    post(8, 1500, '사진 한 장 더', [picture(0, 320)])
  ]
  return {
    status: 'ready', message: '', items, admins: null, subscribers: null, joinRequests: null, membership: null,
    posts: channelPostsRequest ? {
      ...channelPostsRequest, status: 'ready', message: '', posts, media: null, scope: 'member',
      authoring: { channelId: 'ch-mine', channelVersion: '4:0', role: 'owner', permission: 'allowed', permissionSource: 'owner', adminVersion: null, discussion: { status: 'known', chatId: 'harness-discussion' }, publicChannel: true },
      pins: { owned: true, channelVersion: '4:0', reference: { status: 'known', postId: 'cpost-1', source: 'value' }, targetFlag: 'pinned', flaggedCount: 1, missingCount: 0, unknownCount: 0, comparison: 'compatible', message: '' },
      comments: null
    } : null
  }
}

// The notes page as SpaceNotesReader publishes it: a few notes, one of them pinned, one selected.
const noteAt = (seconds: number, id: string) => ({ seconds, nanoseconds: 0, id })
const noteRows = [
  { id: 'note-1', version: '3:0', title: '장보기', preview: '우유, 달걀, 빵', updated: noteAt(1_750_003_000, 'note-1'), created: noteAt(1_750_000_000, 'note-1'), pinned: true },
  { id: 'note-2', version: '2:0', title: '회의 메모', preview: '금요일 회의: 배포 일정 확인', updated: noteAt(1_750_002_000, 'note-2'), created: noteAt(1_750_001_000, 'note-2'), pinned: false },
  { id: 'note-3', version: '1:0', title: '', preview: '제목 없는 노트', updated: noteAt(1_750_001_500, 'note-3'), created: noteAt(1_750_001_400, 'note-3'), pinned: false },
]
let notesRequestId: string | null = null
let notesSelected: string | null = null
function notesSnapshot(): unknown {
  const row = noteRows.find(item => item.id === notesSelected) ?? null
  return { revision: '1', page: { number: 1, canPrevious: false, older: null }, requestId: notesRequestId,
    status: notesRequestId ? 'ready' : 'idle', message: '', limited: false, rows: notesRequestId ? noteRows : [],
    selected: row ? { ...row, body: `${row.title}\n\n${row.preview}` } : null }
}
function snapshot(): unknown {
  return {
    revision: ++revision, appVersion: 'harness', platform: 'macOS', preferences: { ...preferences }, systemDark: false,
    accounts: [{ uid: me, userId: 'harness1', displayName: '테스트' }], activeAccountUid: me, connection: 'ready',
    dialogs: [{ id: chatId, version: '1:0', kind: 'direct', title: '상대', participantUids: [me, peer], preview: messages.at(-1)!.text, unreadCount: 0,
      markedUnread: false, readPositions: {}, readSync: { status: 'ready' }, pinned: false, pinVersion: '', muted: false, archived: false,
      top: messages.at(-1)!.position, avatar: null, draft: localDrafts.get(chatId) ?? '', pinnedForAll: ['m-060'], unseenReaction: { messageId: 'm-147', emoji: '🔥', reactionVersion: 2 },
      forum: { generalId: 'general', categories: [{ id: 'general', name: '일반', sortOrder: 0, isGeneral: true }, { id: 'notice', name: '공지', sortOrder: 1, isGeneral: false }] }, forumSelected: forumSelected },
      // Saved Messages (chats/memo_{uid}): it belongs in the notes screen, never in this list.
      { id: `memo_${me}`, version: '1:0', kind: 'direct', title: '내 메모', participantUids: [me], preview: '📝 장보기', unreadCount: 0,
        markedUnread: false, readPositions: {}, readSync: { status: 'ready' }, pinned: false, pinVersion: '', muted: false, archived: false,
        top: messages.at(-3)!.position, avatar: null, pinnedForAll: [] },
      // A channel discussion room: deleting it from the list leaves it, as iOS does.
      { id: 'harness-discussion', version: '3:0', kind: 'group', title: '구독 채널 토론방', participantUids: [me, peer], preview: '댓글이 달렸어요', unreadCount: 0,
        markedUnread: false, readPositions: {}, readSync: { status: 'ready' }, pinned: false, pinVersion: '', muted: false, archived: false,
        top: messages.at(-2)!.position, avatar: null, draft: localDrafts.get('harness-discussion') ?? '', pinnedForAll: [], discussion: true, channelId: 'harness-channel2', createdBy: peer }],
    spaceNotes: notesSnapshot(),
    dialogStatus: 'ready', dialogMessage: '', dialogPin: null, manualUnread: null, dialogActionsAvailable: true, signInAvailable: true,
    authentication: { available: true, phase: 'signed-in', account: null, message: '' },
    // ?intro previews the sign-in screens as «Add Account» shows them.
    ...(new URLSearchParams(location.search).has('intro') ? { authentication: { available: true, phase: 'signed-out', account: null, message: '' } } : {}),
    appLock: { enabled: false, locked: false, autoLock: 0, systemUnlock: 'none', systemUnlockEnabled: false, systemUnlockAllowed: false },
    accountStates: [], addingAccount: new URLSearchParams(location.search).has('intro'), maxAccounts: 2, presence: {}, chatFolders: liveFolders,
    // Premium limit, so pinning one more message opens the "나에게만 고정 / 모두에게 고정" choice.
    pinnedMessages: { chatId, limit: 10, items: pinnedIds.map(id => {
      const message = messages.find(item => item.id === id)!
      return { id, forMe: id !== 'm-060', forAll: id === 'm-060', status: 'ready', preview: message.text, position: message.position }
    }) },
    stickers: [{ id: 'a'.repeat(64), kind: 'png', size: 100, url: 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><circle cx="32" cy="32" r="28" fill="%23f5a"/></svg>' }],
    deferredMessages: { chatId, items: [] }, typing: typingUntil ? { chatId, until: typingUntil } : null, listTyping, channelInquiries: inquiryThread(),
    // Chat list rows for 1:1 channel inquiries: an owner folder and a subscriber room.
    inquiryRows: [
      { id: 'own_inq_harness-channel', kind: 'ownerFolder', channelId: 'harness-channel', inquiryId: null, title: '내 채널',
        preview: '문의 드립니다', lastMessageAt: 1_750_000_300_000, unread: 4, rooms: 2, photo: null },
      { id: 'sub_inq_harness-channel2_harness-me', kind: 'subscriber', channelId: 'harness-channel2', inquiryId: 'harness-channel2_harness-me',
        title: '구독 중인 채널', preview: '사진', lastMessageAt: 1_750_000_100_000, unread: 0, rooms: 1, photo: null }
    ],
    notifications: { supported: true, message: '' }, platformIntegration: { trayAvailable: false, message: '' },
    selfProfile: selfPhoto ? { status: 'ready', profile: { uid: me, userId: 'harness1', displayName: '테스트', bio: '', premium: false, hasPhoto: true }, message: '',
      photo: { url: selfPhoto, status: 'ready', message: '' } } : null, contacts: { status: 'ready', items: [], message: '' }, channels: harnessChannels(), participants: null, contactSearch: null, pendingDirects: [],
    channelHome: harnessChannelHome(), channelStories
  }
}

// One inquiry room with a text message and a photo, so the panel's photo bubble and its 사진
// button can be pressed. The store re-reads the whole snapshot when a batch does not follow its
// revision, so the harness only has to say "something changed".
// A real picture, drawn here rather than pasted as base64, so the renderer's photo worker has
// something it can actually decode.
async function pngBytes(width = 64, height = 48): Promise<Uint8Array> {
  const canvas = new OffscreenCanvas(width, height), context = canvas.getContext('2d')
  if (!context) throw new Error('캔버스를 만들지 못했습니다.')
  context.fillStyle = '#2f6fed'; context.fillRect(0, 0, width, height)
  context.fillStyle = '#ffffff'; context.fillRect(Math.round(width / 8), Math.round(height / 8), Math.round(width * .75), Math.round(height * .75))
  return new Uint8Array(await (await canvas.convertToBlob({ type: 'image/png' })).arrayBuffer())
}
async function pngDataURL(width = 64, height = 48): Promise<string> {
  const bytes = await pngBytes(width, height)
  let text = ''
  for (const value of bytes) text += String.fromCharCode(value)
  return `data:image/png;base64,${btoa(text)}`
}
async function jpegDataURL(width: number, height: number): Promise<string> {
  const canvas = new OffscreenCanvas(width, height), context = canvas.getContext('2d')
  if (!context) throw new Error('캔버스를 만들지 못했습니다.')
  context.fillStyle = '#c2410c'; context.fillRect(0, 0, width, height)
  context.fillStyle = '#fde68a'; context.fillRect(0, 0, Math.round(width / 2), height)
  const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: .5 })
  const bytes = new Uint8Array(await blob.arrayBuffer())
  let text = ''
  for (const value of bytes) text += String.fromCharCode(value)
  return `data:image/jpeg;base64,${btoa(text)}`
}
// A short video recorded from a canvas, so a round video can really play in the harness.
async function recordedVideo(seconds: number): Promise<string> {
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 240
  const context = canvas.getContext('2d')!
  const recorder = new MediaRecorder(canvas.captureStream(15), { mimeType: 'video/webm' })
  const chunks: Blob[] = []
  recorder.ondataavailable = event => chunks.push(event.data)
  let frame = 0
  const paint = (): void => { context.fillStyle = `hsl(${frame++ * 24} 70% 50%)`; context.fillRect(0, 0, 240, 240) }
  paint(); const timer = setInterval(paint, 66)
  const stopped = new Promise(resolve => { recorder.onstop = resolve })
  recorder.start(100); await new Promise(resolve => setTimeout(resolve, seconds * 1000)); recorder.stop(); clearInterval(timer)
  await stopped
  return URL.createObjectURL(new Blob(chunks, { type: 'video/webm' }))
}
let inquiryThreadRequest = ''
function inquiryThread(): unknown {
  return inquiryThreadRequest ? { list: null, thread: {
    requestId: inquiryThreadRequest, inquiryId: 'harness-channel2_harness-me', channelId: 'harness-channel2', role: 'subscriber',
    title: '구독 중인 채널', channelName: '구독 중인 채널', status: 'ready', message: '', items: [
      { id: 'IM-1', own: false, senderType: 'owner', kind: 'text', text: '무엇을 도와드릴까요?', label: '', createdAt: 1_750_000_000_000, edited: false, version: '1:0' },
      { id: 'IM-2', own: true, senderType: 'subscriber', kind: 'image', text: '', label: '사진', createdAt: 1_750_000_100_000, edited: false, version: '2:0',
        attachments: [{ index: 0, kind: 'image', name: '사진', available: true, blind: false }] },
      // What iOS also sends in an inquiry (ChannelInquiryChatView): a video, a voice message and a file.
      { id: 'IM-3', own: false, senderType: 'owner', kind: 'video', text: '영상 설명', label: '동영상', createdAt: 1_750_000_200_000, edited: false, version: '3:0',
        attachments: [{ index: 0, kind: 'video', name: '동영상', available: true, blind: false }],
        mediaMetadata: { videoWidthPx: 1280, videoHeightPx: 720, videoDuration: 42, thumbData: (messages[total - 4]!.mediaMetadata as { thumbData: string }).thumbData } },
      { id: 'IM-4', own: true, senderType: 'subscriber', kind: 'voice', text: '', label: '음성 메시지', createdAt: 1_750_000_300_000, edited: false, version: '4:0',
        attachments: [{ index: 0, kind: 'voice', name: '음성', available: true, blind: false }],
        mediaMetadata: { voiceDuration: 7, voiceWaveform: [0.1, 0.5, 0.9, 0.4, 0.2, 0.7, 0.3] } },
      { id: 'IM-5', own: false, senderType: 'owner', kind: 'file', text: '', label: '안내서.pdf', createdAt: 1_750_000_400_000, edited: false, version: '5:0',
        attachments: [{ index: 0, kind: 'file', name: '안내서.pdf', available: true, blind: false }] },
      // A video message sent from here, drawn as a circle as in a chat.
      { id: 'IM-6', own: true, senderType: 'subscriber', kind: 'video', text: '', label: '동영상', createdAt: 1_750_000_500_000, edited: false, version: '6:0', circular: true,
        attachments: [{ index: 0, kind: 'video', name: '동영상', available: true, blind: false }],
        mediaMetadata: { videoWidthPx: 400, videoHeightPx: 400, videoDuration: 3, isCircleVideo: true, thumbData: (messages[total - 4]!.mediaMetadata as { thumbData: string }).thumbData } }
    ] } } : null
}
// A batch that does not follow the current revision makes the store resync, which is all we need.
const fetchedPhotos = new Set<string>()
const refresh = (): void => { harness.emit({ type: 'data', batch: { base: -1, revision: revision + 1000, fields: {} } } as unknown as DesktopEvent) }

// Every bridge method answers; the ones the chat screen reads return realistic shapes.
const implemented: Record<string, (...args: unknown[]) => unknown> = {
  snapshot: async () => snapshot(),
  // The forward box: chats to forward into and the 1:1 inquiry rooms beside them. Saved Messages is
  // deliberately not first here — the box hoists it, as Telegram's peerListPartitionRows(isSelf) does.
  forwardTargets: async () => [
    { chatId, title: '상대', kind: 'direct', preview: '메시지 149' },
    { chatId: `memo_${me}`, title: '저장한 메시지', kind: 'direct', preview: '메모해 둔 링크' },
    { chatId: 'harness-discussion', title: '구독 채널 토론방', kind: 'group', preview: '댓글이 달렸어요' }
  ],
  inquiryForwardRooms: async () => [
    { inquiryId: 'harness-channel2_harness-me', channelId: 'harness-channel2', title: '구독 중인 채널', role: 'subscriber' }
  ],
  openChannelPosts: async (_uid: unknown, request: unknown) => { channelPostsRequest = request as { requestId: string; channelId: string }; refresh() },
  closeChannelPosts: async () => { channelPostsRequest = null; refresh() },
  openSpaceNotes: async (_uid: unknown, requestId: unknown) => { notesRequestId = String(requestId); notesSelected = null; refresh() },
  closeSpaceNotes: async () => { notesRequestId = null; notesSelected = null; refresh() },
  selectSpaceNote: async (_uid: unknown, request: unknown) => { notesSelected = (request as { noteId: string | null }).noteId; refresh() },
  pageSpaceNotes: async () => { refresh() },
  searchNotePage: async (_uid: unknown, request: unknown) => {
    const text = String((request as { text?: unknown }).text ?? '')
    const row = noteRows.find(item => item.title.includes(text) || item.preview.includes(text)) ?? null
    return { requestId: notesRequestId, outcome: row ? 'found' : 'absent', noteId: row?.id ?? null, version: row?.version ?? null, page: { number: 1, canPrevious: false, older: null }, message: '' }
  },
  // The draft a new note is written into: read first, as the outbox requires, then saved.
  readNoteDraft: async (_uid: unknown, target: unknown) => ({ ...(target as object), title: '', body: '', pinned: false, revision: null }),
  saveNoteDraft: async (_uid: unknown, request: unknown) => ({ ...(request as object), revision: (request as { revision: string }).revision }),
  refreshNoteCreation: async () => {},
  prepareNoteCreation: async () => {},
  noteCreationAction: async () => {},
  onEvent: (listener: unknown) => { listeners.add(listener as (event: DesktopEvent) => void); return () => listeners.delete(listener as (event: DesktopEvent) => void) },
  // Like HistoryReader.older: a `before` cursor returns the page just older than that message.
  history: async (_uid: unknown, _chat: unknown, before: unknown) => {
    const cursor = before as MessagePosition | undefined
    if (!cursor) return page(total - 1)
    const index = messages.findIndex(message => message.id === cursor.id)
    return index > 0 ? page(index - 1) : page(total - 1)
  },
  latestHistory: async () => page(total - 1),
  setChatFlags: async (_uid: unknown, _chat: unknown, patch: unknown) => { const value = patch as { category?: string | null }; if (value.category !== undefined) forumSelected = value.category; refresh(); return 'done' },
  // Session.sharedMedia: the room's photos and videos, files or links, whole messages in search hits.
  sharedMedia: async (_uid: unknown, _chat: unknown, id: unknown, filter: unknown) => ({ id, query: filter, revision: 1, status: 'ready', scanned: total, hasMore: false, limited: false, message: '',
    hits: messages.filter(message => filter === 'media' ? (message.kind === 'image' || message.kind === 'video') && !message.circular
      : filter === 'links' ? /https?:\/\/|\.com/.test(message.text) : message.kind === 'file').reverse()
      .map(message => ({ id: message.id, position: message.position, kind: message.kind, sender: message.senderName, snippet: filter === 'links' ? 'https://example.com/docs?page=2' : message.caption ?? '', message })) }),
  // ChannelInquiries.openThread, then the panel's photo: MediaSession.open serves the bytes locally.
  openInquiryThread: async (_uid: unknown, request: unknown) => {
    inquiryThreadRequest = (request as { requestId: string }).requestId
    refresh()
  },
  closeInquiryThread: async () => { inquiryThreadRequest = ''; refresh() },
  // A very tall picture, so the full-size view can be checked for letterboxing rather than cropping.
  openMedia: async (_uid: unknown, _chat: unknown, request: unknown) => (request as { messageId: string }).messageId === messages[total - 12]!.id
    ? { requestId: (request as { requestId: string }).requestId, url: await recordedVideo(2), presentation: 'video', name: '원형 영상.webm', size: 1 } : ({
    requestId: (request as { requestId: string }).requestId, url: await pngDataURL(120, 1600), presentation: 'image', name: '사진.png', size: (await pngBytes(120, 1600)).byteLength
  }),
  // Telegram's automatic media download: the picture arrives without the bubble being pressed.
  // Main answers with nothing when this room's limit holds the picture back; a press asks without one.
  photoPreview: async (_uid: unknown, _chatId: unknown, request: unknown, asked: unknown) => {
    if (asked !== true && !Object.values(preferences.autoDownloadPhotos).some(limit => limit > 0)) return null
    fetchedPhotos.add((request as { messageId: string }).messageId)
    return pngDataURL()
  },
  // The placeholder the main process makes for a message that carried none: base64 JPEG, no prefix.
  // A placeholder is kept only from a picture that was fetched to be shown; nothing is fetched for one.
  photoThumb: async (_uid: unknown, _chatId: unknown, request: unknown) =>
    fetchedPhotos.has((request as { messageId: string }).messageId) ? (await jpegDataURL(32, 21)).slice('data:image/jpeg;base64,'.length) : null,
  // The app calls updatePreferences(patch) and gets the new snapshot; older harness scripts pass (uid, patch).
  relaunchApp: async () => { location.reload() },
  updatePreferences: async (first: unknown, second: unknown) => { Object.assign(preferences, (second ?? first) as Record<string, unknown>); refresh(); return snapshot() },
  pickInquiryPhoto: async () => pngBytes(),
  // The sets this account made, for the sticker editor's destination step.
  ownedStickerPacks: async () => [{ id: 'SET-MINE', ownerUid: me, ownerName: '테스트', title: '내 첫 팩', items: [] }],
  createStickerPack: async (_uid: unknown, title: unknown) => ({ id: 'SET-NEW', ownerUid: me, ownerName: '테스트', title: String(title), items: [] }),
  addStickerToPack: async (_uid: unknown, setId: unknown) => ({ id: setId, ownerUid: me, ownerName: '테스트', title: '팩', items: [] }),
  addSticker: async () => 'b'.repeat(64),
  channelStoryMedia: async (_uid: unknown, _channelId: unknown, storyId: unknown) => ({ url: photo(String(storyId).length * 40), audioUrl: null }),
  markChannelStoryViewed: async (_uid: unknown, channelId: unknown, storyId: unknown) => {
    const list = channelStories[String(channelId)]
    if (!list) return
    list.stories = list.stories.map(story => story.id === storyId ? { ...story, viewed: true } : story); list.unread = list.stories.some(story => !story.viewed); refresh()
  },
  reactToChannelStory: async (_uid: unknown, channelId: unknown, storyId: unknown, emoji: unknown) => {
    const list = channelStories[String(channelId)]!
    let next: string | null = null
    list.stories = list.stories.map(story => story.id === storyId ? { ...story, reaction: next = story.reaction === emoji ? null : String(emoji) } : story); refresh()
    return next
  },
  // A photo picked for a chat, staged in the main process; here its preview is a data address, and an edit
  // from Editor::PhotoEditor comes back as the replaced JPEG.
  pickAttachment: async (_uid: unknown, chatId: unknown, mode: unknown) => mode === 'file' ? null : pickVideo ? { id: 'chat-draft-video', chatId: String(chatId), name: 'clip.mp4', kind: 'video', size: 19119,
    items: [{ id: 'chat-item-video', name: 'clip.mp4', kind: 'video', size: 19119, previewUrl: pickVideo, originalUrl: pickVideo }] } : { id: 'chat-draft-photo', chatId: String(chatId), name: '사진.png', kind: 'image', size: 2048,
    items: [{ id: 'chat-item-photo', name: '사진.png', kind: 'image', size: 2048, previewUrl: await pngDataURL(640, 400) }] },
  editAttachmentVideo: async (_uid: unknown, chatId: unknown, id: unknown, itemId: unknown) => ({ id, chatId, name: 'clip.mp4', kind: 'video', size: 7655,
    items: [{ id: itemId, name: 'clip.mp4', kind: 'video', size: 7655, previewUrl: pickVideo, originalUrl: pickVideo }] }),
  replaceAttachmentImage: async (_uid: unknown, chatId: unknown, id: unknown, itemId: unknown, bytes: unknown) => ({ id, chatId, name: '사진.jpg', kind: 'image',
    size: (bytes as Uint8Array).byteLength, items: [{ id: itemId, name: '사진.jpg', kind: 'image', size: (bytes as Uint8Array).byteLength }] }),
  chatFolders: async () => liveFolders ?? [],
  // A video or file picked for an inquiry: staged in the main process, previewed over its own route.
  pickInquiryAttachment: async (_uid: unknown, _request: unknown, mode: unknown) => mode === 'file'
    ? { id: 'inq-draft-file', chatId: 'harness-channel2_harness-me', name: '견적서.pdf', kind: 'file', size: 48213, items: [{ id: 'inq-item-file', name: '견적서.pdf', kind: 'file', size: 48213 }] }
    : { id: 'inq-draft-video', chatId: 'harness-channel2_harness-me', name: 'clip.mp4', kind: 'video', size: 812345, items: [{ id: 'inq-item-video', name: 'clip.mp4', kind: 'video', size: 812345, previewUrl: 'morse://app/__inquiry-draft/inq-draft-video/inq-item-video' }] },
  sendInquiryAttachment: async () => 'sent',
  // As VoiceCaptures.finish: the recording kept in the main process and a preview address for it.
  finishInquiryVoice: async (_uid: unknown, target: unknown, bytes: unknown) => ({ id: (target as { captureId: string }).captureId, chatId: (target as { inquiryId: string }).inquiryId,
    expiresAt: Date.now() + 600000, url: '', bytes: (bytes as Uint8Array).byteLength, sha256: 'a'.repeat(64) }),
  sendInquiryVoice: async () => 'sent',
  // Leaving a discussion room from the chat list goes through the same departure as the channel panel.
  discussionRowDeparture: async (_uid: unknown, chatId: unknown) => ({ channelId: 'harness-channel2', version: '5:0', chatId }),
  resolveDiscussionDeparture: async (_uid: unknown, request: unknown) => ({ chatId: (request as { chatId: string }).chatId, version: '3:0', title: '구독 채널 토론방',
    owner: false, participantCount: 2, discussion: { channelId: 'harness-channel2', version: '5:0', title: '구독 중인 채널' } }),
  discussionLeaveWork: async () => ({ outgoingItems: [], actionItems: [], chatId: 'harness-discussion', draft: '', reply: null, outgoing: 0, actions: 0, selectedAttachment: false, voiceDraft: false }),
  leaveGroup: async () => 'done',
  sendInquiryPhoto: async () => 'sent',
  outgoing: async () => ({ revision: 1, items: [], canCompose: true, message: '' }),
  replyDraft: async () => ({ revision: 1, selection: null, status: 'none', preview: null }),
  messageActions: async () => ({ revision: 1, ready: true, message: '', items: [] }),
  // Local drafts, as the delivery store keeps them: the composer reads one back, and the chat list
  // shows «작성 중: …» on every room that has one (Telegram RowPainter::Paint lng_from_draft).
  // 「저장한 메시지」 opens chats/memo_{uid}, which Session.prepareMemoChat names.
  prepareMemoChat: async () => `memo_${me}`,
  loadDraft: async () => '', draft: async (_uid: unknown, chat: unknown) => localDrafts.get(String(chat)) ?? '',
  saveDraft: async (_uid: unknown, chat: unknown, text: unknown) => {
    const value = String(text)
    if (value) localDrafts.set(String(chat), value.slice(0, 160)); else localDrafts.delete(String(chat))
    refresh()
  },
  chatBackground: async () => null,
  // Session.jumpPinned -> HistoryReader.jump: a loading frame, then the page ending at the pin.
  jumpPinned: async (_uid: unknown, chat: unknown, messageId: unknown) => {
    const index = messages.findIndex(message => message.id === messageId)
    harness.emit({ type: 'history-changed', accountUid: me, chatId: String(chat), history: loading() })
    await new Promise(resolve => setTimeout(resolve, 120))
    const next = page(index, String(messageId))
    harness.emit({ type: 'history-changed', accountUid: me, chatId: String(chat), history: next })
    return next
  }
}
function method(name: string): (...args: unknown[]) => unknown {
  return (...args: unknown[]) => {
    harness.calls.push({ method: name, args })
    return implemented[name] ? implemented[name]!(...args) : Promise.resolve(undefined)
  }
}
function bridge(prefix = ''): unknown {
  return new Proxy({}, { get: (_target, key) => {
    if (typeof key !== 'string' || key === 'then') return undefined
    if (!prefix && (key === 'appLock' || key === 'authentication')) return bridge(`${key}.`)
    // ?lang=en or ?lang=ru previews the other languages, as main's --morse-language argument does.
    if (!prefix && key === 'language') return new URLSearchParams(location.search).get('lang') ?? 'ko'
    return method(`${prefix}${key}`)
  } })
}
export function installMockBridge(): void {
  ;(window as unknown as { morse: unknown }).morse = bridge()
}
