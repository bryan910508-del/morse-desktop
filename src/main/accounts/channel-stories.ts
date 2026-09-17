import { randomBytes, randomUUID } from 'node:crypto'
import { FirestoreReader, type ReadCredentials } from '../network/firestore-rpc'
import { documents, mapField, stringField, timestamp, type FirestoreDocument, type WireObject } from '../network/firestore-values'
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
interface Row { story: ChannelStory; mediaPath: string; thumbnailPath: string | null; audioPath: string | null }
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
    const viewers = ((f.viewerIds?.arrayValue as { values?: WireObject[] } | undefined)?.values ?? []).map(value => value.stringValue).filter(value => typeof value === 'string')
    const viewedAt = mapField(f, 'viewedAtByUid'), reactions = mapField(f, 'reactionByUid')
    const reaction = reactions[uid]?.stringValue
    const viewCount = new Set([...viewers, ...Object.keys(viewedAt)].filter(value => value !== authorId)).size
    return {
      mediaPath, thumbnailPath: optional('thumbnailURL'), audioPath: optional('audioURL'),
      story: { id, authorId, mediaType, hasThumbnail: Boolean(optional('thumbnailURL')), audio: Boolean(optional('audioURL')), caption: stringField(f, 'caption', maxChannelStoryCaption * 4),
        createdAt, expiresAt, viewed: authorId === uid || viewers.includes(uid) || viewedAt[uid] !== undefined,
        reaction: typeof reaction === 'string' && (channelStoryReactions as readonly string[]).includes(reaction) ? reaction : null, viewCount }
    }
  } catch { return null }
}

export class ChannelStories {
  private reader: FirestoreReader | null = null
  private readonly lists = new Map<string, { rows: Row[]; readAt: number }>()
  private readonly loading = new Set<string>()
  private wanted: string[] = []
  private held: Held[] = []
  private generation = 0
  private locked = false
  private closed = false

  constructor(private readonly uid: string, private readonly auth: ReadCredentials, private readonly allowed: () => boolean, private readonly changed: () => void) {}

  // Called where the channel tab or a channel screen shows these channels, never from a snapshot.
  setVisible(channelIds: string[]): void {
    if (this.closed || this.locked) return
    this.wanted = [...new Set(channelIds.map(id => identifier(id)))].slice(0, maxChannels)
    for (const id of this.wanted) void this.read(id, false)
  }
  refresh(channelId: string): Promise<void> { return this.read(identifier(channelId), true) }
  private async read(channelId: string, force: boolean): Promise<void> {
    const known = this.lists.get(channelId)
    if (this.closed || this.locked || this.loading.has(channelId) || (!force && known && Date.now() - known.readAt < lifetime)) return
    if (!this.allowed()) return
    this.loading.add(channelId)
    const generation = this.generation
    try {
      this.reader ??= new FirestoreReader(this.auth)
      const rows = await this.reader.query(`${documents}/channels/${channelId}`, channelStoriesQuery(Date.now(), maxStories), AbortSignal.any([this.auth.signal, AbortSignal.timeout(35000)]))
      if (generation !== this.generation || this.closed || this.locked) return
      const decoded = rows.flatMap(doc => { const row = decodeChannelStory(doc, channelId, this.uid); return row ? [row] : [] }).sort((a, b) => a.story.createdAt - b.story.createdAt)
      this.lists.set(channelId, { rows: decoded, readAt: Date.now() })
      this.changed()
    } catch { /* The ring stays as it was; the next showing asks again. */ }
    finally { this.loading.delete(channelId) }
  }

  // Reading only: the channels on screen that have stories right now.
  snapshot(): ChannelStoriesSnapshot | null {
    if (this.closed || this.locked) return null
    const now = Date.now(), result: ChannelStoriesSnapshot = {}
    for (const id of this.wanted) {
      const stories = (this.lists.get(id)?.rows ?? []).map(row => row.story).filter(story => story.expiresAt > now)
      if (stories.length) result[id] = { channelId: id, stories, unread: stories.some(story => !story.viewed) }
    }
    return result
  }
  private row(channelId: string, storyId: string): Row {
    const row = this.lists.get(identifier(channelId))?.rows.find(value => value.story.id === identifier(storyId))
    if (!row || row.story.expiresAt <= Date.now()) throw new Error(tr('스토리가 만료되었거나 삭제되었습니다.'))
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

  // StoryService.markViewed: once, not for the author's own story.
  async markViewed(channelId: string, storyId: string): Promise<void> {
    const row = this.row(channelId, storyId)
    if (row.story.viewed) return
    row.story = { ...row.story, viewed: true }
    this.changed()
    this.reader ??= new FirestoreReader(this.auth)
    await this.reader.markChannelStoryViewed(identifier(channelId), row.story.id, this.uid, this.auth.signal).catch(() => {})
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
      await this.reader.setChannelStoryReaction(identifier(channelId), row.story.id, this.uid, next, this.auth.signal)
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
    const fields = channelStoryFields({ channelId, storyId, uid: this.uid, video, caption, durationSeconds: input.durationSeconds, now: Date.now() })
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
    this.lists.clear(); this.loading.clear(); this.wanted = []
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
