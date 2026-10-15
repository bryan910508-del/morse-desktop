import { randomBytes, randomUUID } from 'node:crypto'
import { FirestoreReader, type ReadCredentials } from '../network/firestore-rpc'
import { documents, stringField, timestamp, type FirestoreDocument, type WireObject } from '../network/firestore-values'
import { callMorseFunction } from '../network/morse-callable'
import { serverNow } from '../network/server-clock'
import { storyRead, type FeedStory, type StoryReadMark } from '../network/story-feed-document'
import { callableStories, storyReactionWrite, storyReadMarkWrite, storyViewedWrite } from '../network/story-views'
import { positionMilliseconds } from '../../shared/model'
import { channelStoryObject, channelStoryPath, deleteChannelStoryFile, downloadChannelStoryFile, uploadChannelStoryFile } from '../network/channel-story-media'
import { channelStoriesQuery, channelStoryFields } from '../network/channel-story-write'
import { channelStoryReactions, maxChannelStoryCaption, type ChannelStoriesSnapshot, type ChannelStory, type ChannelStoryMedia, type ChannelStoryPublish } from '../../shared/channel-stories'
import { identifier } from '../../shared/validation'
import { tr } from '../../shared/i18n'

// iOS ChannelFeedView.loadChannelStories: the stories of «내 채널» and the channels in the «구독 중» strip, read
// again after a minute (channelStoriesTTL). StoryService.fetchCollection asks for the ones not yet expired,
// ordered by expiresAt then createdAt; a story hidden from this person is left out, as the media grant does.
const lifetime = 60000, maxChannels = 30, maxStories = 50
// storage.rules: pictures under 10 MB, videos under 50 MB, sounds under 15 MB.
const maxPhoto = 10 * 1024 * 1024, maxVideo = 50 * 1024 * 1024, maxAudio = 15 * 1024 * 1024, maxHeld = 4
interface Row { story: ChannelStory; mediaPath: string; thumbnailPath: string | null; audioPath: string | null; storyPath: string; reactionRead?: boolean }
interface Held { token: string; channelId: string; storyId: string; bytes: Buffer; contentType: string }

export function decodeChannelStory(doc: FirestoreDocument, channelId: string, uid: string, now = Date.now()): Row | null {
  const f = doc.fields, prefix = `${documents}/channels/${channelId}/stories/`
  if (!doc.name.startsWith(prefix)) return null
  const id = doc.name.slice(prefix.length)
  try {
    identifier(id)
    const authorId = identifier(stringField(f, 'authorId', 200)), mediaType = stringField(f, 'mediaType', 16)
    if (mediaType !== 'image' && mediaType !== 'video') return null
    const hidden = (f.hiddenFrom?.arrayValue as { values?: WireObject[] } | undefined)?.values ?? []
    if (hidden.some(value => value.stringValue === uid)) return null
    const mediaPath = channelStoryObject(stringField(f, 'mediaURL', 1000), channelId)
    if (!mediaPath || !f.createdAt?.timestampValue || !f.expiresAt?.timestampValue) return null
    const optional = (key: string): string | null => { const value = stringField(f, key, 1000); return value ? channelStoryObject(value, channelId) : null }
    const createdAt = positionMilliseconds(timestamp(f.createdAt.timestampValue, id)), expiresAt = positionMilliseconds(timestamp(f.expiresAt.timestampValue, id))
    if (expiresAt <= now) return null
    // B408 S2: the document's viewer fields are not read — seen is the read mark, a reaction this account's views record,
    // the count the server's storyStats (ChannelStories.read).
    return {
      mediaPath, thumbnailPath: optional('thumbnailURL'), audioPath: optional('audioURL'), storyPath: doc.name,
      story: { id, authorId, mediaType, hasThumbnail: Boolean(optional('thumbnailURL')), audio: Boolean(optional('audioURL')), caption: stringField(f, 'caption', maxChannelStoryCaption * 4),
        createdAt, expiresAt, viewed: authorId === uid, reaction: null, viewCount: null }
    }
  } catch { return null }
}

// B408 S2: a channel story from this account's feed, or from getMorseChannelStories.
function feedRow(story: FeedStory, channelId: string, uid: string, mark: StoryReadMark | undefined): Row | null {
  const mediaPath = channelStoryObject(story.mediaURL, channelId)
  if (!mediaPath || (story.mediaType !== 'image' && story.mediaType !== 'video')) return null
  const optional = (url: string | null): string | null => url ? channelStoryObject(url, channelId) : null
  return { mediaPath, thumbnailPath: optional(story.thumbnailURL), audioPath: optional(story.audioURL), storyPath: story.storyPath,
    story: { id: story.storyId, authorId: story.authorId, mediaType: story.mediaType, hasThumbnail: story.hasThumbnail, audio: story.audio === 'attached', caption: story.caption.slice(0, maxChannelStoryCaption * 4),
      createdAt: story.createdAt, expiresAt: story.expiresAt, viewed: story.authorId === uid || storyRead(story, mark), reaction: null, viewCount: null } }
}
// What ChannelStories reads the feed and read marks through (story-bar.ts StoryBarApi).
export interface ChannelStoryFeed {
  feedStories(ownerType: 'channel', ownerId: string): FeedStory[]
  mark(ownerType: 'channel', ownerId: string): StoryReadMark | undefined
  noteRead(story: Pick<FeedStory, 'ownerType' | 'ownerId' | 'createdAt' | 'storyId'>): boolean
  inFeed(storyPath: string): boolean
}
export type ChannelStoryRole = 'owner' | 'admin' | null

export class ChannelStories {
  private reader: FirestoreReader | null = null
  private readonly lists = new Map<string, { rows: Row[]; readAt: number }>()
  private readonly loading = new Set<string>()
  private wanted: string[] = []
  private held: Held[] = []
  private generation = 0
  private locked = false
  private closed = false

  // The channel a channel screen shows, which may be a public one this account does not follow.
  private screen: string | null = null
  constructor(private readonly uid: string, private readonly auth: ReadCredentials, private readonly allowed: () => boolean, private readonly changed: () => void,
    private readonly feed: ChannelStoryFeed | null = null, private readonly role: (channelId: string) => ChannelStoryRole = () => null,
    private readonly ask: (channelId: string, signal: AbortSignal) => Promise<unknown> = (channelId, signal) => callMorseFunction(this.auth, 'getMorseChannelStories', { channelId }, signal)) {}

  // Called where the channel tab or a channel screen shows these channels, never from a snapshot.
  setVisible(channelIds: string[]): void {
    if (this.closed || this.locked) return
    this.wanted = [...new Set(channelIds.map(id => identifier(id)))].slice(0, maxChannels)
    for (const id of this.wanted) void this.read(id, false)
  }
  // B408 S2: a channel screen opened (or closed: null).
  setScreen(channelId: string | null): void {
    if (this.closed || this.locked) return
    this.screen = channelId === null ? null : identifier(channelId)
    if (this.screen) void this.read(this.screen, false)
    else this.changed()
  }
  private shown(): string[] { return this.screen && !this.wanted.includes(this.screen) ? [...this.wanted, this.screen] : this.wanted }
  refresh(channelId: string): Promise<void> { return this.read(identifier(channelId), true) }
  private async read(channelId: string, force: boolean): Promise<void> {
    const known = this.lists.get(channelId)
    if (this.closed || this.locked || this.loading.has(channelId) || (!force && known && Date.now() - known.readAt < lifetime)) return
    if (!this.allowed()) return
    this.loading.add(channelId)
    const generation = this.generation
    try {
      const signal = AbortSignal.any([this.auth.signal, AbortSignal.timeout(35000)]), role = this.role(channelId)
      let decoded: Row[]
      if (role) {
        // B408 S2 (iOS ChannelFeedView :739·:862): its owner and admins read the channel's own stories, and the counts.
        this.reader ??= new FirestoreReader(this.auth)
        const rows = await this.reader.query(`${documents}/channels/${channelId}`, channelStoriesQuery(serverNow(), maxStories), signal)
        decoded = rows.flatMap(doc => { const row = decodeChannelStory(doc, channelId, this.uid, serverNow()); return row ? [row] : [] })
        for (const row of decoded) {
          const stats = await this.reader.getDocument(`${documents}/channels/${channelId}/storyStats/${row.story.id}`, signal).catch(() => null)
          const n = Number((stats?.fields.viewCount as { integerValue?: unknown } | undefined)?.integerValue ?? 0)
          row.story = { ...row.story, viewCount: Number.isSafeInteger(n) && n >= 0 ? n : 0 }
        }
      } else {
        // A followed channel's stories are in this account's feed; a public one it does not follow, opened on its screen,
        // asks the server (getMorseChannelStories — what it may see, put in the feed so views can be written).
        const mark = this.feed?.mark('channel', channelId)
        let stories = this.feed?.feedStories('channel', channelId) ?? []
        if (!stories.length && channelId === this.screen) stories = callableStories(await this.ask(channelId, signal), 'channel', channelId)
        decoded = stories.flatMap(story => { const row = feedRow(story, channelId, this.uid, mark); return row ? [row] : [] })
      }
      if (generation !== this.generation || this.closed || this.locked) return
      this.lists.set(channelId, { rows: decoded.sort((a, b) => a.story.createdAt - b.story.createdAt), readAt: Date.now() })
      this.changed()
    } catch { /* The ring stays as it was; the next showing asks again. */ }
    finally { this.loading.delete(channelId) }
  }

  // Reading only: the channels on screen that have stories right now.
  snapshot(): ChannelStoriesSnapshot | null {
    if (this.closed || this.locked) return null
    const now = serverNow(), result: ChannelStoriesSnapshot = {}
    for (const id of this.shown()) {
      const stories = (this.lists.get(id)?.rows ?? []).map(row => row.story).filter(story => story.expiresAt > now)
      if (stories.length) result[id] = { channelId: id, stories, unread: stories.some(story => !story.viewed) }
    }
    return result
  }
  private row(channelId: string, storyId: string): Row {
    const row = this.lists.get(identifier(channelId))?.rows.find(value => value.story.id === identifier(storyId))
    if (!row || row.story.expiresAt <= serverNow()) throw new Error(tr('스토리가 만료되었거나 삭제되었습니다.'))
    return row
  }

  // The story's picture or video (and its sound) for the viewer, kept for the few stories around the one shown.
  async media(channelId: string, storyId: string): Promise<ChannelStoryMedia> {
    if (this.closed || this.locked) throw new Error(tr('화면 잠금을 해제해 주세요.'))
    const row = this.row(channelId, storyId), generation = this.generation
    const fetchOne = async (path: string, types: string[], max: number): Promise<string> => {
      const existing = this.held.find(item => item.channelId === channelId && item.storyId === storyId && item.token.endsWith(`:${path}`))
      if (existing) return `morse://app/__channel-story/${existing.token.split(':')[0]}`
      const file = await downloadChannelStoryFile(this.auth, path, row.story.id, row.story.authorId, types, max, AbortSignal.any([this.auth.signal, AbortSignal.timeout(120000)]))
      if (generation !== this.generation || this.closed || this.locked) { file.bytes.fill(0); throw new Error(tr('스토리를 다시 열어 주세요.')) }
      const key = randomBytes(18).toString('base64url')
      this.held.push({ token: `${key}:${path}`, channelId, storyId, bytes: file.bytes, contentType: file.contentType })
      while (this.held.length > maxHeld * 2) this.held.shift()!.bytes.fill(0)
      return `morse://app/__channel-story/${key}`
    }
    void this.readReaction(row)
    const url = row.story.mediaType === 'video' ? await fetchOne(row.mediaPath, ['video/mp4', 'video/quicktime'], maxVideo) : await fetchOne(row.mediaPath, ['image/jpeg', 'image/png'], maxPhoto)
    const audioUrl = row.audioPath ? await fetchOne(row.audioPath, ['audio/mp4', 'audio/x-m4a', 'audio/m4a', 'audio/mpeg', 'audio/aac'], maxAudio).catch(() => null) : null
    return { url, audioUrl }
  }
  response(key: string, request: Request): Response {
    const item = this.closed || this.locked || !/^[A-Za-z0-9_-]{24}$/.test(key) ? undefined : this.held.find(value => value.token.startsWith(`${key}:`))
    if (!item || request.method !== 'GET') return new Response(null, { status: 404 })
    const range = request.headers.get('range'), size = item.bytes.length
    const match = range ? /^bytes=(\d+)-(\d*)$/.exec(range) : null
    if (match) {
      const start = Number(match[1]), end = match[2] ? Math.min(size - 1, Number(match[2])) : size - 1
      if (start >= size || start > end) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } })
      return new Response(new Uint8Array(item.bytes.subarray(start, end + 1)), { status: 206, headers: { 'Content-Type': item.contentType, 'Content-Length': String(end - start + 1),
        'Content-Range': `bytes ${start}-${end}/${size}`, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } })
    }
    return new Response(new Uint8Array(item.bytes), { headers: { 'Content-Type': item.contentType, 'Content-Length': String(size), 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } })
  }

  // B408 S2: this account's reaction is its own views record, read once when the story is first shown.
  private async readReaction(row: Row): Promise<void> {
    if (row.reactionRead || row.story.authorId === this.uid) return
    row.reactionRead = true
    try {
      this.reader ??= new FirestoreReader(this.auth)
      const doc = await this.reader.getDocument(`${row.storyPath}/views/${this.uid}`, AbortSignal.any([this.auth.signal, AbortSignal.timeout(30000)]))
      const value = (doc?.fields.reaction as { stringValue?: unknown } | undefined)?.stringValue
      const reaction = typeof value === 'string' && (channelStoryReactions as readonly string[]).includes(value) ? value : null
      if (reaction !== row.story.reaction) { row.story = { ...row.story, reaction }; this.changed() }
    } catch { row.reactionRead = false }
  }

  // B408 S2 (iOS StoryService.markViewed :220-237, tdesktop markAsRead → stories.readStories): the read mark moves to it
  // at once, and the server gets this account's view record — once, not for the author's own story.
  async markViewed(channelId: string, storyId: string): Promise<void> {
    const row = this.row(channelId, storyId), id = identifier(channelId)
    if (row.story.authorId === this.uid) return
    const story = { ownerType: 'channel' as const, ownerId: id, createdAt: row.story.createdAt, storyId: row.story.id }
    const moved = this.feed?.noteRead(story) ?? false
    const first = !row.story.viewed
    row.story = { ...row.story, viewed: true }
    this.changed()
    this.reader ??= new FirestoreReader(this.auth)
    if (moved) await this.reader.commitStoryWrite(storyReadMarkWrite(this.uid, { ownerType: 'channel', ownerId: id, maxReadCreatedAt: story.createdAt, maxReadStoryId: story.storyId }), this.auth.signal).catch(() => {})
    if (first && this.feed?.inFeed(row.storyPath) !== false) await this.reader.commitStoryWrite(storyViewedWrite(row.storyPath, this.uid), this.auth.signal).catch(() => {})
  }
  // StoryService.setReaction: choosing the same reaction again takes it back.
  async react(channelId: string, storyId: string, emoji: string): Promise<string | null> {
    if (!(channelStoryReactions as readonly string[]).includes(emoji)) throw new Error(tr('반응을 다시 선택해 주세요.'))
    const row = this.row(channelId, storyId)
    if (row.story.authorId === this.uid) throw new Error(tr('내 스토리에는 반응할 수 없습니다.'))
    const before = row.story.reaction, next = before === emoji ? null : emoji
    row.story = { ...row.story, reaction: next }
    this.changed()
    try {
      this.reader ??= new FirestoreReader(this.auth)
      await this.reader.commitStoryWrite(storyReactionWrite(row.storyPath, this.uid, next), this.auth.signal)
      return next
    } catch (error) {
      row.story = { ...row.story, reaction: before }
      this.changed()
      throw error
    }
  }

  // StoryService.commitUpload for ownerType .channel: files first, then the document everyone reads.
  async publish(input: ChannelStoryPublish, owner: () => boolean): Promise<void> {
    if (this.closed || this.locked) throw new Error(tr('화면 잠금을 해제해 주세요.'))
    const channelId = identifier(input.channelId)
    if (!owner()) throw new Error(tr('채널 소유자만 채널 스토리를 올릴 수 있습니다.'))
    const caption = input.caption.trim().slice(0, maxChannelStoryCaption), storyId = randomUUID().toUpperCase()
    const video = input.kind === 'video', signal = AbortSignal.any([this.auth.signal, AbortSignal.timeout(15 * 60000)])
    const mediaPath = channelStoryPath(channelId, storyId, video ? '.mp4' : '.jpg'), thumbnailPath = channelStoryPath(channelId, storyId, '_thumb.jpg')
    const custom = { ownerUid: this.uid, storyId }
    await uploadChannelStoryFile(this.auth, mediaPath, input.media, video ? 'video/mp4' : 'image/jpeg', custom, signal)
    await uploadChannelStoryFile(this.auth, thumbnailPath, input.thumbnail, 'image/jpeg', custom, signal)
    const fields = channelStoryFields({ channelId, storyId, uid: this.uid, video, caption, durationSeconds: input.durationSeconds, now: serverNow() })
    this.reader ??= new FirestoreReader(this.auth)
    try { await this.reader.createChannelStory(channelId, storyId, fields, signal) }
    catch (error) {
      for (const path of [mediaPath, thumbnailPath]) await deleteChannelStoryFile(this.auth, path, AbortSignal.timeout(30000)).catch(() => {})
      throw error
    }
    await this.refresh(channelId)
  }
  // StoryService.deleteStory: the document, then its files.
  async remove(channelId: string, storyId: string, owner: () => boolean): Promise<void> {
    const row = this.row(channelId, storyId)
    if (!owner()) throw new Error(tr('채널 소유자만 채널 스토리를 삭제할 수 있습니다.'))
    this.reader ??= new FirestoreReader(this.auth)
    await this.reader.deleteChannelStory(identifier(channelId), row.story.id, this.auth.signal)
    const list = this.lists.get(identifier(channelId))
    if (list) list.rows = list.rows.filter(value => value !== row)
    for (const item of this.held.filter(value => value.storyId === row.story.id)) item.bytes.fill(0)
    this.held = this.held.filter(value => value.storyId !== row.story.id)
    this.changed()
    for (const path of [row.mediaPath, row.thumbnailPath, row.audioPath]) if (path) await deleteChannelStoryFile(this.auth, path, AbortSignal.timeout(30000)).catch(() => {})
  }

  private forget(): void {
    this.generation++
    this.lists.clear(); this.loading.clear(); this.wanted = []; this.screen = null
    for (const item of this.held) item.bytes.fill(0)
    this.held = []
    this.reader?.close(); this.reader = null
  }
  setLocked(locked: boolean): void {
    if (this.locked === locked) return
    this.locked = locked
    if (locked) { this.forget(); this.changed() }
  }
  pause(): void { this.forget() }
  close(): void { this.closed = true; this.forget() }
}
