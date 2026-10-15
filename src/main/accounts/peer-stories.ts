// Portions of this file follow Telegram Desktop (https://github.com/telegramdesktop/tdesktop, 7.3.1),
// Copyright (c) 2014-2026 The Telegram Desktop Authors. Licensed under GPL-3.0-or-later; see LEGAL.
import type { OwnStoryDetail, StoryPrivacy } from '../../shared/own-stories'
import { positionAt } from '../../shared/model'
import { firstStoryCaptionLink } from '../../shared/story-caption-link'
import { peerStoriesRequest, peerStoryLink, peerStoryReaction, peerStoryTarget, storyReactions, type PeerStoriesResult, type PeerStoryRow, type PeerStoryTarget } from '../../shared/peer-stories'
import { status } from '@grpc/grpc-js'
import { DocumentWriteFailure, FirestoreReader, type ReadCredentials } from '../network/firestore-rpc'
import { callMorseFunction } from '../network/morse-callable'
import { serverNow } from '../network/server-clock'
import type { FeedStory, StoryReadMark } from '../network/story-feed-document'
import { callableStories, storyReactionWrite, storyReadMarkWrite, storyViewedWrite } from '../network/story-views'
import { ReadFailure, type FirestoreDocument } from '../network/firestore-values'
import { storyMediaPaths } from './story-media-paths'
import { recordStoryStep } from '../platform/story-diagnostics'
import { tr } from '../../shared/i18n'

// An error as a code fit for a log a person may share: its class, and the status it carries (a gRPC status name or a
// read failure's kind) — never its message.
export function failureCode(error: unknown): string {
  if (error instanceof DocumentWriteFailure) return `DocumentWriteFailure ${error.code ? status[error.code] ?? String(error.code) : error.uncertain ? 'uncertain' : 'not-sent'}`
  if (error instanceof ReadFailure) return `ReadFailure ${error.code}`
  return error instanceof Error ? (error.name === 'Error' ? 'Error' : error.name).slice(0, 40) : 'unknown'
}
// What PeerStories reads the feed and read marks through (story-bar.ts StoryBarApi).
export interface PeerStoryFeed {
  feedStories(ownerType: 'user', ownerId: string): FeedStory[]
  mark(ownerType: 'user', ownerId: string): StoryReadMark | undefined
  noteRead(story: Pick<FeedStory, 'ownerType' | 'ownerId' | 'createdAt' | 'storyId'>): boolean
  inFeed(storyPath: string): boolean
}
interface Opened { id: string; ownerId: string; stories: Map<string, FeedStory> }
// What the media viewers fetch a story from: its detail and the addresses its copy names.
export interface PeerStoryDetail { ownerId: string; story: OwnStoryDetail; image: string | null; poster: string | null; video: string | null; audio: string | null }
// This account's own record on a story, read once per run (iOS StoryService.myView :240-250).
interface MyView { viewed: boolean; reaction: string | null }

// B408 S2 (contracts/B408-stories-access.md §14): one person's stories, and what this account does with them.
// - Opening: this account's storyFeed first, getMorsePeerStories only when the feed holds none of theirs (iOS
//   MorsePersonStories :20-24; tdesktop requestPeerStories, data_stories.cpp:324-341). Stories the callable gives are
//   put in the feed by the server, so a view of them may be written too (iOS mayRecordView).
// - Shown: the read mark moves to it at once (storyReadMarks, forward only), and unless this device views without
//   being seen, this account's `views/{me}` gets viewedAt — once, at the server's time (tdesktop markAsRead →
//   stories.readStories, :1235·:1394-1409; iOS markViewed :220-237). A write that fails is written at the next showing
//   (the same record, merged).
// - A reaction is that record's `reaction`, set or taken back (stories.sendReaction :1092-1098).
// - Its media is fetched from the addresses the copy names; the story document itself is never read.
export class PeerStories {
  private closed = false
  private opened: Opened | null = null
  private readonly fetched = new Set<string>()
  private readonly views = new Map<string, MyView>()
  private reader: FirestoreReader | null = null
  constructor(private readonly uid: string, private readonly auth: ReadCredentials, private readonly feed: PeerStoryFeed,
    private readonly allowed: () => void, private readonly stealth: () => boolean,
    private readonly ask: (ownerId: string, signal: AbortSignal) => Promise<unknown> = (ownerId, signal) => callMorseFunction(auth, 'getMorsePeerStories', { ownerId }, signal),
    private readonly now: () => number = serverNow) {}

  private validate(): void { if (this.closed) throw new Error(tr('계정이 변경되었습니다.')); this.auth.signal.throwIfAborted(); this.allowed() }
  private write(): FirestoreReader { this.reader ??= new FirestoreReader(this.auth); return this.reader }

  async open(input: unknown): Promise<PeerStoriesResult> {
    const request = peerStoriesRequest(input)
    this.validate()
    if (request.ownerId === this.uid) throw new Error(tr('내 스토리는 내 스토리에서 확인해 주세요.'))
    let stories = this.feed.feedStories('user', request.ownerId), message = ''
    if (!stories.length) {
      try {
        stories = callableStories(await this.ask(request.ownerId, AbortSignal.any([this.auth.signal, AbortSignal.timeout(30000)])), 'user', request.ownerId)
        for (const story of stories) this.fetched.add(story.storyPath)
      } catch { message = tr('스토리를 불러오지 못했습니다. 잠시 뒤 다시 열어 주세요.') }
      this.validate()
    }
    const at = this.now()
    stories = stories.filter(story => story.expiresAt > at && story.ownerId === request.ownerId && story.collection !== 'channel')
    this.opened = { id: request.id, ownerId: request.ownerId, stories: new Map(stories.map(story => [story.storyId, story])) }
    const mark = this.feed.mark('user', request.ownerId)
    const rows: PeerStoryRow[] = stories.map(story => ({ id: story.storyId, version: story.version, caption: story.caption, mediaType: story.mediaType, audio: story.audio,
      hasThumbnail: story.hasThumbnail, createdAt: story.createdAt, expiresAt: story.expiresAt, privacy: story.privacy as StoryPrivacy }))
    return { id: request.id, ownerId: request.ownerId, outcome: message ? 'unavailable' : 'ready', rows,
      readUpTo: mark ? { createdAt: mark.maxReadCreatedAt, storyId: mark.maxReadStoryId } : null, observedAt: at, message }
  }
  close(id: string): void { if (this.opened?.id === id) this.opened = null }
  pause(): void { this.opened = null }

  // The story a request names, as the open list holds it.
  story(target: PeerStoryTarget): FeedStory {
    const opened = this.opened, story = opened?.stories.get(target.storyId)
    if (this.closed || !opened || opened.id !== target.requestId || !story || story.version !== target.version || story.expiresAt <= this.now()) throw new Error(tr('스토리가 바뀌었거나 끝났습니다. 다시 열어 주세요.'))
    return story
  }
  // OwnStoryDetail for the media viewers (own-story-photo.ts and the others), from the copy.
  detail(target: PeerStoryTarget): PeerStoryDetail {
    const story = this.story(target)
    // The same rules an own story's document is read by (story-media-paths.ts), over the fields the copy carries.
    const text = (value: string | null): { stringValue: string } | undefined => value === null ? undefined : { stringValue: value }
    const paths = storyMediaPaths({ name: story.storyPath, fields: { mediaType: { stringValue: story.mediaType }, mediaURL: { stringValue: story.mediaURL }, thumbnailURL: text(story.thumbnailURL), audioURL: text(story.audioURL) } } as unknown as FirestoreDocument, story.ownerId)
    const detail: OwnStoryDetail = { audio: story.audio, hasThumbnail: story.hasThumbnail, id: story.storyId, version: story.version, privacy: story.privacy as StoryPrivacy,
      caption: story.caption, preview: story.caption.slice(0, 160).replace(/\s+/g, ' '), created: positionAt(story.createdAt, story.storyId), expires: positionAt(story.expiresAt, story.storyId), mediaType: story.mediaType }
    return { ownerId: story.ownerId, story: detail, image: paths.image, poster: paths.poster, video: paths.video, audio: story.audio === 'attached' ? paths.audio : null }
  }

  // A story was shown.
  async seen(input: unknown): Promise<void> {
    const story = this.story(peerStoryTarget(input))
    this.validate()
    const moved = this.feed.noteRead(story)
    const started = performance.now(), took = (): number => Math.round(performance.now() - started)
    // B416: what became of each showing, for story-check.log — step names, milliseconds, and the error's class and
    // status only (a message can name a document path, and the file may be sent to support as a picture).
    const failed = (step: string, error: unknown): void => recordStoryStep(step, `${failureCode(error)} ms=${took()}`)
    if (moved) await this.write().commitStoryWrite(storyReadMarkWrite(this.uid, { ownerType: 'user', ownerId: story.ownerId, maxReadCreatedAt: story.createdAt, maxReadStoryId: story.storyId }), this.auth.signal).catch(error => failed('read-mark-failed', error))
    if (this.stealth()) { recordStoryStep('view-unseen', `ms=${took()}`); return }
    if (!(this.feed.inFeed(story.storyPath) || this.fetched.has(story.storyPath))) { recordStoryStep('view-not-in-feed', `ms=${took()}`); return }
    const mine = await this.myView(story).catch(error => { failed('view-read-failed', error); return null })
    if (!mine || mine.viewed) return
    try { await this.write().commitStoryWrite(storyViewedWrite(story.storyPath, this.uid), this.auth.signal) }
    catch (error) { failed('view-write-failed', error); throw error }
    recordStoryStep('view-written', `ms=${took()}`)
    mine.viewed = true
  }
  // This account's reaction on a story, from its own record.
  async reaction(input: unknown): Promise<string | null> {
    const story = this.story(peerStoryTarget(input))
    this.validate()
    return (await this.myView(story)).reaction
  }
  async react(input: unknown): Promise<string | null> {
    const request = peerStoryReaction(input), story = this.story(request)
    this.validate()
    if (!(this.feed.inFeed(story.storyPath) || this.fetched.has(story.storyPath))) throw new Error(tr('이 스토리에는 지금 반응할 수 없습니다.'))
    const mine = await this.myView(story)
    if (mine.reaction === request.emoji) return mine.reaction
    // Taking back a reaction that was never written leaves nothing to change.
    if (request.emoji === null && mine.reaction === null) return null
    await this.write().commitStoryWrite(storyReactionWrite(story.storyPath, this.uid, request.emoji), this.auth.signal)
    mine.reaction = request.emoji
    return mine.reaction
  }
  // The first web address of a story's caption, as it is (shared/story-caption-link.ts).
  link(input: unknown): string {
    const request = peerStoryLink(input), story = this.story(request), url = firstStoryCaptionLink(story.caption)
    if (!url || url !== request.url) throw new Error(tr('스토리 설명의 링크를 다시 확인해 주세요.'))
    return url
  }

  private async myView(story: FeedStory): Promise<MyView> {
    const known = this.views.get(story.storyPath)
    if (known) return known
    const doc = await this.write().getDocument(`${story.storyPath}/views/${this.uid}`, AbortSignal.any([this.auth.signal, AbortSignal.timeout(30000)]))
    const raw = (doc?.fields.reaction as { stringValue?: unknown } | undefined)?.stringValue
    const view: MyView = { viewed: doc?.fields.viewedAt !== undefined, reaction: typeof raw === 'string' && (storyReactions as readonly string[]).includes(raw) ? raw : null }
    this.views.set(story.storyPath, view)
    return view
  }
  dispose(): void { this.closed = true; this.opened = null; this.reader?.close(); this.reader = null; this.views.clear(); this.fetched.clear() }
}
