import { randomUUID } from 'node:crypto'
import type { ChannelSummary } from '../../shared/channels'
import { channelCategoryId, type ChannelCategoryId, type ChannelHomeChannel, type ChannelHomeImage, type ChannelHomePost, type ChannelHomeSnapshot } from '../../shared/channel-home'
import type { ChannelPostText } from '../../shared/channel-posts'
import { backgroundImageInfo } from '../../shared/background-photo-bytes'
import { comparePosition, positionMilliseconds, type MessagePosition } from '../../shared/model'
import { FirestoreReader, type ReadCredentials } from '../network/firestore-rpc'
import { documents, type FirestoreDocument, type WireObject } from '../network/firestore-values'
import { callMorseFunction } from '../network/morse-callable'
import { downloadChannelPostMedia } from '../network/channel-post-media'
import { channelPostMedia, channelPostRevision } from '../media/channel-post-media-document'
import { ChannelImages } from './channel-images'
import { ChannelPostPictures, type PictureSource } from './channel-post-pictures'
import { decodeChannelPost, publicChannelPosts } from './channel-posts'
import { decodeChannelSummary } from './channels'
import { channelPostLikeState } from './channel-post-like-state'
import { tr } from '../../shared/i18n'

// iOS ChannelFeedView.reload: three posts from every subscribed or owned channel, newest twenty,
// refreshed at most once a minute (recentPostsTTL); ChannelService.loadTrendingChannels /
// loadNewChannels (eight each) and loadChannelsByCategory (thirty); ChannelPromoteService.fetchActive.
const recentTTL = 60000
const maxFeedChannels = 60, postsPerChannel = 3, maxFeedPosts = 20
const discoverLimit = 8, categoryLimit = 30, maxBoosted = 3, maxPromotedChannels = 5

export interface ListedChannels {
  // ChannelsSession's current list; empty while the channel surface is not on screen.
  items(): ChannelSummary[]
  status(): 'idle' | 'loading' | 'ready' | 'error'
  document(channelId: string): FirestoreDocument | null
}
interface FeedPost { channelId: string; doc: FirestoreDocument; post: ChannelPostText; promoted: boolean }

const isPublic: WireObject = { fieldFilter: { field: { fieldPath: 'isPublic' }, op: 'EQUAL', value: { booleanValue: true } } }
function publicChannels(order: 'subscriberCount' | 'createdAt', limit: number, category?: ChannelCategoryId): WireObject {
  const where = category
    ? { compositeFilter: { op: 'AND', filters: [isPublic, { fieldFilter: { field: { fieldPath: 'category' }, op: 'EQUAL', value: { stringValue: category } } }] } }
    : isPublic
  return { from: [{ collectionId: 'channels' }], where, orderBy: [{ field: { fieldPath: order }, direction: 'DESCENDING' }], limit: { value: limit } }
}
async function each<T>(items: T[], jobs: number, work: (item: T) => Promise<void>): Promise<void> {
  let next = 0
  await Promise.all(Array.from({ length: Math.min(jobs, items.length) }, async () => { while (next < items.length) await work(items[next++]!) }))
}
// ChannelFeedView.randomizedDiscoverChannels: popularity, a week of recency and a random boost.
function randomized(channels: ChannelSummary[]): ChannelSummary[] {
  const now = Date.now()
  return channels.map(channel => {
    const last = channel.updated ? positionMilliseconds(channel.updated) : now
    const recency = Math.max(0, 7 - (now - last) / 86400000)
    return { channel, score: (channel.subscriberCount ?? 0) * 0.55 + recency * 12 + Math.random() * 120 }
  }).sort((a, b) => b.score - a.score).map(item => item.channel)
}

export class ChannelHome {
  readonly avatars: ChannelImages
  readonly images: ChannelPostPictures
  private visible = false
  private closed = false
  private feed: FeedPost[] = []
  private boosted: FeedPost[] = []
  // Channel documents outside the account's own list (discover rail, categories, promotions).
  private others = new Map<string, FirestoreDocument>()
  private trending: string[] = []
  private newest: string[] = []
  private promoted: string[] = []
  private status: ChannelHomeSnapshot['status'] = 'loading'
  private message = ''
  private discoverStatus: ChannelHomeSnapshot['discover']['status'] = 'loading'
  private category: { id: ChannelCategoryId; status: 'loading' | 'ready' | 'error'; ids: string[] } | null = null
  private loadedAt = 0
  private job: AbortController | null = null
  private categoryJob: AbortController | null = null
  private waiting: ReturnType<typeof setTimeout> | null = null
  private forcePending = false
  // The account's channels and their last post times the feed was read for.
  private loadedSignature = ''
  private jobSignature = ''
  constructor(private readonly uid: string, private readonly auth: ReadCredentials, private readonly listed: ListedChannels,
    private readonly allowed: () => boolean, private readonly changed: () => void) {
    this.avatars = new ChannelImages(auth, id => this.otherDocument(id), changed)
    this.images = new ChannelPostPictures(auth, key => this.imageSource(key), changed)
  }
  private otherDocument(id: string): FirestoreDocument {
    const doc = this.others.get(id)
    if (this.closed || !this.visible || !this.allowed() || !doc) throw new Error('Channel not in the channel tab')
    return doc
  }
  // The feed draws the post's own picture, and its blurred thumb until that picture is there.
  private imageSource(key: string): PictureSource {
    if (this.closed || !this.visible || !this.allowed()) throw new Error('Channel tab closed')
    const item = [...this.boosted, ...this.feed].find(post => `${post.channelId}/${post.post.id}` === key)
    const media = item ? channelPostMedia(item.doc, item.channelId).items[0] : undefined
    if (!item || !media?.path || media.kind === 'unsupported') throw new Error('Post picture unavailable')
    return { path: media.path, video: media.kind === 'video', postId: item.post.id,
      blur: media.blur, width: media.width ?? 0, height: media.height ?? 0 }
  }

  // The feed's posts of one channel among `ids` (iOS reads the channel tab feed as the channel screen).
  seenPosts(channelId: string, ids: readonly string[]): { id: string; position: MessagePosition; own: boolean }[] {
    return [...this.boosted, ...this.feed].filter(item => item.channelId === channelId && ids.includes(item.post.id))
      .map(item => ({ id: item.post.id, position: { ...item.post.position }, own: item.post.own }))
  }
  get snapshot(): ChannelHomeSnapshot | null {
    if (this.closed || !this.visible || !this.allowed()) return null
    const items = this.listed.items().filter(item => item.status === 'ready')
    const byId = new Map(items.map(item => [item.id, item]))
    const channel = (id: string): ChannelHomeChannel | null => {
      const item = byId.get(id)
      if (item) return { id, name: item.name, description: item.description, subscriberCount: item.subscriberCount, avatar: item.avatar, listed: true, owned: item.owned }
      const doc = this.others.get(id)
      if (!doc) return null
      try {
        const value = decodeChannelSummary(doc, this.uid, false)
        return { id, name: value.name, description: value.description, subscriberCount: value.subscriberCount, avatar: this.avatars.snapshot(id), listed: false, owned: value.owned }
      } catch { return null }
    }
    const list = (ids: string[]): ChannelHomeChannel[] => ids.flatMap(id => { const value = channel(id); return value ? [value] : [] })
    const boostedIds = new Set(this.boosted.map(item => item.post.id))
    const posts: ChannelHomePost[] = [...this.boosted, ...this.feed.filter(item => !boostedIds.has(item.post.id))].flatMap(item => {
      if (!channel(item.channelId)) return []
      const { post } = item
      const likes = channelPostLikeState(item.doc, this.uid).info
      return [{ channelId: item.channelId, id: post.id, text: post.text, position: post.position, mediaCount: post.mediaCount,
        image: this.images.snapshot(`${item.channelId}/${post.id}`), likeCount: likes.status === 'ready' ? likes.count : post.likeCount, commentCount: post.commentCount,
        liked: likes.status === 'ready' ? likes.selected : null, visibility: post.visibility, promoted: item.promoted }]
    })
    // ChannelFeedState.feedSubscribedStrip: subscribed channels, then channels the feed shows.
    const strip = [...new Set([...items.filter(item => !item.owned).map(item => item.id), ...this.feed.map(item => item.channelId)])]
    const referenced = [...new Set([...posts.map(post => post.channelId), ...strip])]
    const mine = items.find(item => item.owned)
    // While the account's channel list is being read (again), the tab shows loading rather than «아직 채널이 없어요».
    const listReady = this.listed.status() === 'ready' && !this.listed.items().some(item => item.status === 'loading')
    return {
      status: listReady ? this.status : 'loading', message: this.message, mine: mine ? channel(mine.id) : null, subscribed: list(strip), posts, channels: list(referenced),
      discover: { status: this.discoverStatus, trending: list(this.trending), newest: list(this.newest), promoted: list(this.promoted) },
      category: this.category ? { id: this.category.id, status: this.category.status, channels: list(this.category.ids) } : null
    }
  }

  // ChannelFeedInteractiveTimelineRow.toggleLike: the heart under a post in the tab, written the way the channel
  // screen writes it (likedBy and likeCount together, on the post version that was read), then the post read again.
  async like(channelId: string, postId: string): Promise<void> {
    if (this.closed || !this.allowed()) throw new Error(tr('계정 연결을 확인해 주세요.'))
    const items = [...this.boosted, ...this.feed].filter(item => item.channelId === channelId && item.post.id === postId)
    const item = items[0]
    if (!item) throw new Error(tr('게시물을 다시 불러와 주세요.'))
    const { info } = channelPostLikeState(item.doc, this.uid)
    if (info.status !== 'ready' || info.selected === null || info.count === null) throw new Error(info.message || tr('좋아요 상태를 확인하지 못했습니다.'))
    const request = { id: randomUUID(), requestId: randomUUID(), channelId, postId, revision: channelPostRevision(item.doc), selected: info.selected, count: info.count, desired: !info.selected }
    const reader = new FirestoreReader(this.auth)
    try {
      await reader.setChannelPostLike(this.uid, request, this.auth.signal, () => item.doc)
      const fresh = await reader.getDocument(item.doc.name, this.auth.signal)
      if (fresh) for (const value of items) value.doc = fresh
      this.changed()
    } finally { reader.close() }
  }

  open(): void {
    if (this.closed) return
    this.visible = true
    this.schedule(false)
    this.changed()
  }
  // The pictures stay in memory while the tab is closed (they are served only while it is open), so opening the
  // channels tab again does not load them once more; a lock forgets them (pause).
  close(): void {
    this.visible = false
    this.cancelWait()
    this.changed()
  }
  refresh(): void { this.schedule(true) }
  // A lock or a lost connection stops reading; a lock also forgets what was shown.
  pause(forget: boolean): void {
    this.cancelWait()
    this.job?.abort(); this.job = null
    this.categoryJob?.abort(); this.categoryJob = null
    if (forget) {
      this.images.clear(); this.avatars.clear()
      this.feed = []; this.boosted = []; this.others.clear(); this.trending = []; this.newest = []; this.promoted = []
      this.category = null; this.loadedAt = 0; this.status = 'loading'; this.discoverStatus = 'loading'
    }
  }
  resume(): void { if (this.visible) this.schedule(false) }
  // ChannelsSession changed: a new subscription or a channel's new post (lastPostAt) reads the feed again,
  // as iOS inserts a created post at once instead of waiting for the one-minute refresh.
  listChanged(): void { if (this.visible && !this.closed && this.allowed()) this.schedule(false) }
  private wantImages(): void { this.images.setWanted([...this.boosted, ...this.feed].map(item => `${item.channelId}/${item.post.id}`)) }
  private cancelWait(): void { if (this.waiting) clearTimeout(this.waiting); this.waiting = null }
  private signature(): string {
    return this.listed.items().filter(item => item.status === 'ready').map(item => `${item.id}:${item.updated?.seconds ?? 0}:${item.updated?.nanoseconds ?? 0}`).join('|')
  }
  private schedule(force: boolean): void {
    if (this.closed || !this.visible || !this.allowed()) return
    // The feed follows the account's channel list, so it waits until that list has been read.
    if (this.listed.status() !== 'ready' || this.listed.items().some(item => item.status === 'loading')) {
      if (force) this.forcePending = true
      if (!this.waiting) this.waiting = setTimeout(() => {
        this.waiting = null
        if (!this.loadedAt && this.visible && !this.closed && !this.job) { this.status = 'error'; this.changed() }
      }, 20000)
      return
    }
    this.cancelWait()
    const signature = this.signature()
    force ||= this.forcePending
    if (!force && (this.job ? signature === this.jobSignature : this.loadedAt && Date.now() - this.loadedAt < recentTTL && signature === this.loadedSignature)) {
      if (!this.job) this.wantImages()
      return
    }
    this.forcePending = false
    this.job?.abort()
    void this.load(signature)
  }
  private async load(signature: string): Promise<void> {
    const abort = new AbortController()
    this.job = abort
    this.jobSignature = signature
    const signal = AbortSignal.any([abort.signal, this.auth.signal, AbortSignal.timeout(90000)])
    const current = (): void => { signal.throwIfAborted(); if (this.closed || this.job !== abort || !this.allowed()) throw new Error('Channel tab changed') }
    const reader = new FirestoreReader(this.auth)
    if (!this.loadedAt) { this.status = 'loading'; this.changed() }
    try {
      const items = this.listed.items().filter(item => item.status === 'ready').slice(0, maxFeedChannels)
      const listedIds = new Set(items.map(item => item.id))
      const posts: FeedPost[] = []
      await each(items, 6, async item => {
        try {
          const docs = await reader.query(`${documents}/channels/${item.id}`, { from: [{ collectionId: 'posts' }],
            orderBy: [{ field: { fieldPath: 'createdAt' }, direction: 'DESCENDING' }], limit: { value: postsPerChannel } }, signal)
          current()
          for (const doc of docs) {
            // The query succeeded as this member, so both public and subscriber posts are readable.
            try { posts.push({ channelId: item.id, doc, post: decodeChannelPost(doc, item.id, 'member', this.uid), promoted: false }) } catch { /* A malformed post stays out. */ }
          }
        } catch (error) { if (signal.aborted) throw error /* A channel whose posts cannot be read stays out of the feed. */ }
      })
      current()
      this.feed = posts.sort((a, b) => comparePosition(b.post.position, a.post.position)).slice(0, maxFeedPosts)
      this.status = 'ready'; this.message = ''; this.loadedAt = Date.now(); this.loadedSignature = signature
      this.wantImages()
      this.changed()

      const others = new Map<string, FirestoreDocument>()
      const discover = async (order: 'subscriberCount' | 'createdAt'): Promise<string[]> => {
        const docs = await reader.query(documents, publicChannels(order, discoverLimit), signal)
        current()
        const channels = docs.flatMap(doc => { try { const value = decodeChannelSummary(doc, this.uid, false); others.set(value.id, doc); return [value] } catch { return [] } })
        return randomized(channels.filter(channel => !listedIds.has(channel.id))).map(channel => channel.id)
      }
      const [trending, newest] = await Promise.allSettled([discover('subscriberCount'), discover('createdAt')])
      current()
      const boosted: FeedPost[] = [], promoted: string[] = []
      try {
        const result = await callMorseFunction(this.auth, 'listActiveChannelPostPromotions', {}, signal)
        current()
        const rows = result.ok === true && Array.isArray(result.promotions) ? result.promotions.slice(0, 30) : []
        const channelDoc = async (id: string): Promise<FirestoreDocument | null> => {
          const doc = this.listed.document(id) ?? others.get(id) ?? await reader.getDocument(`${documents}/channels/${id}`, signal).catch(() => null)
          current()
          if (!doc) return null
          try { decodeChannelSummary(doc, this.uid, false) } catch { return null }
          if (!listedIds.has(id)) others.set(id, doc)
          return doc
        }
        const promotions = rows.flatMap(row => {
          const value = row && typeof row === 'object' ? row as Record<string, unknown> : {}
          const channelId = typeof value.channelId === 'string' && /^[A-Za-z0-9_-]{1,160}$/.test(value.channelId) ? value.channelId : ''
          const postId = typeof value.postId === 'string' && /^[A-Za-z0-9_-]{1,160}$/.test(value.postId) ? value.postId : ''
          const placements = Array.isArray(value.placements) ? value.placements.filter(item => typeof item === 'string') : ['feed_boosted', 'discover_rail']
          return channelId && postId ? [{ channelId, postId, placements }] : []
        })
        for (const promotion of promotions) {
          if (boosted.length >= maxBoosted) break
          if (!promotion.placements.includes('feed_boosted')) continue
          const doc = await channelDoc(promotion.channelId)
          if (!doc) continue
          const scope = listedIds.has(promotion.channelId) ? 'member' : publicChannelPosts(doc) ? 'public' : null
          if (!scope) continue
          const postDoc = await reader.getDocument(`${documents}/channels/${promotion.channelId}/posts/${promotion.postId}`, signal).catch(() => null)
          current()
          if (!postDoc) continue
          try { boosted.push({ channelId: promotion.channelId, doc: postDoc, post: decodeChannelPost(postDoc, promotion.channelId, scope, this.uid), promoted: true }) } catch { continue }
          if (promotion.placements.includes('discover_rail') && !promoted.includes(promotion.channelId)) promoted.push(promotion.channelId)
        }
        for (const promotion of promotions) {
          if (promoted.length >= maxPromotedChannels) break
          if (!promotion.placements.includes('discover_rail') || promoted.includes(promotion.channelId)) continue
          if (await channelDoc(promotion.channelId)) promoted.push(promotion.channelId)
        }
      } catch (error) { if (signal.aborted) throw error /* Without promotions the feed and rail keep their own order. */ }
      current()
      this.boosted = boosted
      this.promoted = promoted
      this.trending = trending.status === 'fulfilled' ? trending.value : []
      this.newest = newest.status === 'fulfilled' ? newest.value : []
      this.discoverStatus = trending.status === 'fulfilled' || newest.status === 'fulfilled' ? 'ready' : 'error'
      for (const id of this.category?.ids ?? []) { const doc = this.others.get(id); if (doc && !others.has(id)) others.set(id, doc) }
      this.others = others
      this.avatars.prune()
      this.wantImages()
    } catch {
      if (this.job === abort && !this.closed && this.allowed()) {
        if (!this.loadedAt) { this.status = 'error'; this.message = '' }
        if (this.discoverStatus === 'loading') this.discoverStatus = 'error'
      }
    } finally {
      reader.close()
      if (this.job === abort) { this.job = null; this.changed() }
    }
  }
  // ChannelExploreCategoryPane: the most subscribed public channels of one category.
  async openCategory(raw: unknown): Promise<void> {
    const id = channelCategoryId(raw)
    if (this.closed || !this.visible || !this.allowed()) throw new Error('Channel tab closed')
    this.categoryJob?.abort()
    const abort = new AbortController()
    this.categoryJob = abort
    const signal = AbortSignal.any([abort.signal, this.auth.signal, AbortSignal.timeout(40000)])
    this.category = { id, status: 'loading', ids: [] }
    this.changed()
    const reader = new FirestoreReader(this.auth)
    try {
      const docs = await reader.query(documents, publicChannels('subscriberCount', categoryLimit, id), signal)
      if (this.categoryJob !== abort || this.closed || !this.allowed()) return
      const ids: string[] = []
      for (const doc of docs) {
        try { const value = decodeChannelSummary(doc, this.uid, false); if (!this.listed.document(value.id)) this.others.set(value.id, doc); ids.push(value.id) } catch { /* skipped */ }
      }
      this.category = { id, status: 'ready', ids }
      this.avatars.prune()
    } catch {
      if (this.categoryJob === abort) this.category = { id, status: 'error', ids: [] }
    } finally {
      reader.close()
      if (this.categoryJob === abort) { this.categoryJob = null; this.changed() }
    }
  }
  closeCategory(): void { this.categoryJob?.abort(); this.categoryJob = null; this.category = null; this.changed() }
  closeAll(): void { this.closed = true; this.pause(true); this.images.close(); this.avatars.close() }
}

