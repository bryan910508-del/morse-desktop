import { memo, useEffect, useRef, useState, type MouseEvent } from 'react'
import { Camera, Check, CircleAlert, Clock3, Download, File as FileIcon, Image as ImageIcon, LockKeyhole, Megaphone, MessageSquareText, MessageSquareWarning, Mic, NotebookPen, Pause, Play, Reply } from 'lucide-react'
import type { ChatMessage, ReplyPreview } from '../../../shared/model'
import type { LocalOutgoing } from '../../../shared/delivery'
import type { MessageStorySource } from '../../../shared/message-story-source'
import { positionMilliseconds } from '../../../shared/model'
import { decodeMemoNote } from '../../../shared/memo-note'
import { messageKindLabel, unsupportedMessageNotice } from '../../../shared/message-kinds'
import { duration as formatDuration, messageTime } from '../app/format'
import { RoundCheck, Spinner } from '../ui/controls'
import { pointFor } from '../ui/popup-menu'
import { QueuedVoicePlay } from './voice-record'
import { UserAvatar } from '../ui/user-avatar'
import { useTranslation } from '../app/translations'
import { useDesktop } from '../app/store'
import { controller } from '../app/ui'
import { endPlayback, startPlayback } from './playback-bar'
import { showReactionPeople } from './reaction-people'
import { showStickerPackSheet } from './sticker-pack-sheet'
import { emojiOnlyFontSize, emojiOnlyText, LinkCard, linkCardFor, LinkedText } from './linked-text'
import { PollCard } from './attachment-cards'
import { locale, tr } from '../../../shared/i18n'

export interface MessageLayout { date: boolean; unread: boolean; top: boolean; bottom: boolean; name: boolean; photo: boolean; gutter: boolean; roomOnly: boolean }

function rowClass(own: boolean, layout: Pick<MessageLayout, 'top' | 'bottom'>, extra = ''): string {
  return `history-message ${own ? 'own' : 'peer'}${layout.top ? ' attached-top' : ''}${layout.bottom ? ' attached-bottom' : ''}${extra}`
}

function ReplyQuote({ preview, onOpen }: { preview: ReplyPreview; onOpen(): void }) {
  if (preview.state !== 'ready') return <div className="bubble-quote"><strong>{tr('답장')}</strong><span className="ellipsis">{preview.state === 'loading' ? tr('원본을 불러오는 중…') : tr('원본 메시지를 볼 수 없습니다')}</span></div>
  return <button type="button" className="bubble-quote" onClick={event => { event.stopPropagation(); onOpen() }} title={tr('원본 메시지로 이동')}>
    {/* The quote is the original's own one-line preview and nothing else, as Telegram's is
        (HistoryView::Reply draws item->toPreview). ReplyContext.originalPreview already begins it with
        the kind's name, so naming the kind again here read «사진 · 사진 · 사진 설명». */}
    <strong className="ellipsis">{preview.senderName}</strong><span className="ellipsis">{preview.text}</span>
  </button>
}

function StorySource({ source }: { source: MessageStorySource }) {
  if (source.status !== 'ready') return <div className="bubble-quote story"><strong><Camera size={13} />{' '}{tr('스토리')}</strong><span>{tr('스토리 정보를 확인하지 못했습니다')}</span></div>
  return <div className="bubble-quote story" title={source.expiresAt ? tr('만료 {0}', [new Date(source.expiresAt).toLocaleString(locale())]) : undefined}>
    <strong className="ellipsis"><Camera size={13} /> {source.ownerType === 'channel' ? tr('채널 스토리') : tr('스토리')} · {source.ownerName}</strong>
    <span className="ellipsis">{source.expiresAt !== null && source.expiresAt < Date.now() ? tr('만료된 스토리에 대한 답장') : tr('스토리에 대한 답장')}</span>
  </div>
}

function VoicePlayer({ accountUid, chatId, message, own }: { accountUid: string; chatId: string; message: ChatMessage; own: boolean }) {
  const [state, setState] = useState<'idle' | 'loading' | 'playing' | 'paused' | 'error'>('idle')
  const [progress, setProgress] = useState(0)
  const audio = useRef<HTMLAudioElement | null>(null), request = useRef<string | null>(null)
  const samples = message.mediaMetadata?.voiceWaveform ?? [], seconds = message.mediaMetadata?.voiceDuration
  const bars = Array.from({ length: 36 }, (_, index) => {
    if (!samples.length) return .25
    const start = Math.floor(index * samples.length / 36), end = Math.max(start + 1, Math.floor((index + 1) * samples.length / 36))
    return Math.max(...samples.slice(start, end), 0)
  })
  useEffect(() => () => {
    audio.current?.pause(); endPlayback(audio.current)
    const id = request.current; if (id) void window.morse.closeMedia(accountUid, id).catch(() => {})
  }, [accountUid])
  async function toggle(): Promise<void> {
    const current = audio.current
    if (state === 'playing' && current) { current.pause(); return }
    if (state === 'paused' && current) { startPlayback({ chatId, messageId: message.id, kind: 'voice', element: current }); void current.play().catch(() => setState('error')); return }
    const id = crypto.randomUUID(); request.current = id; setState('loading')
    try {
      const ready = await window.morse.openMedia(accountUid, chatId, { requestId: id, messageId: message.id, version: message.version, index: 0 })
      if (request.current !== id || !ready.url) return
      const element = new Audio(ready.url)
      element.ontimeupdate = () => setProgress(element.duration ? element.currentTime / element.duration : 0)
      element.onplay = () => setState('playing')
      element.onpause = () => setState('paused')
      element.onended = () => { setState('paused'); setProgress(0) }
      element.onerror = () => setState('error')
      audio.current = element
      startPlayback({ chatId, messageId: message.id, kind: 'voice', element })
      await element.play()
    } catch { if (request.current === id) setState('error') }
  }
  const transcript = useTranscript(accountUid, chatId, message)
  return <div className="voice-message-wrap" onClick={event => event.stopPropagation()}>
  <div className={`voice-message${own ? ' own' : ''}`}>
    <button type="button" className="voice-message-play" aria-label={state === 'playing' ? tr('일시 정지') : tr('재생')} disabled={!message.attachments?.[0]?.available} onClick={() => { void toggle() }}>
      {state === 'loading' ? <Spinner size={18} /> : state === 'playing' ? <Pause size={20} /> : <Play size={20} />}
    </button>
    <span className="voice-message-body">
      <span className="voice-message-wave" aria-hidden="true">{bars.map((value, index) => <i key={index} className={index / bars.length < progress ? 'played' : undefined} style={{ height: `${Math.round(3 + value * 17)}px` }} />)}</span>
      <small>{state === 'error' ? tr('재생할 수 없습니다') : seconds !== undefined ? formatDuration(seconds) : tr('음성 메시지')}</small>
    </span>
    {/* MorseChatUIKitNativeMediaBubbleRow sttButton: the voice message's words under it. */}
    <button type="button" className={`voice-transcribe${transcript.expanded ? ' active' : ''}`} aria-label={tr('텍스트로 보기')} disabled={!message.attachments?.[0]?.available || transcript.state === 'loading'}
      onClick={() => transcript.toggle()}>{transcript.state === 'loading' ? <Spinner size={14} /> : transcript.state === 'error' ? <MessageSquareWarning size={16} /> : <MessageSquareText size={16} />}</button>
  </div>
  {transcript.expanded && transcript.state !== 'loading' && <p className="voice-transcript selectable">{transcript.text}</p>}
  </div>
}

// MorseVoiceTranscriptService: recognized once per message on this device and kept while the app runs.
const transcripts = new Map<string, { status: 'ok' | 'denied' | 'failed' | 'unavailable'; text: string }>()
function useTranscript(accountUid: string, chatId: string, message: ChatMessage) {
  const key = `${accountUid}/${chatId}/${message.id}`
  const [expanded, setExpanded] = useState(false), [loading, setLoading] = useState(false), [, redraw] = useState(0)
  const known = transcripts.get(key)
  async function run(): Promise<void> {
    setLoading(true)
    const id = crypto.randomUUID()
    try {
      const ready = await window.morse.openMedia(accountUid, chatId, { requestId: id, messageId: message.id, version: message.version, index: 0 })
      if (!ready.url) throw new Error('unavailable')
      const bytes = new Uint8Array(await (await fetch(ready.url)).arrayBuffer())
      const result = await window.morse.transcribeVoice(accountUid, bytes)
      bytes.fill(0)
      transcripts.set(key, result.status === 'ok' ? { status: 'ok', text: result.text } : { status: result.status, text: '' })
    } catch { transcripts.set(key, { status: 'failed', text: '' }) }
    finally { void window.morse.closeMedia(accountUid, id).catch(() => {}); setLoading(false); redraw(value => value + 1) }
  }
  const text = !known ? '' : known.status === 'ok' ? known.text : known.status === 'denied' ? tr('음성 인식 권한이 필요해요. 시스템 설정 → 개인정보 보호 및 보안 → 음성 인식에서 Morse를 허용해 주세요.')
    : known.status === 'unavailable' ? tr('이 Mac에서는 음성 인식을 사용할 수 없어요.') : tr('오류가 발생했어요')
  return { expanded, text, state: loading ? 'loading' as const : !known ? 'idle' as const : known.status === 'ok' ? 'ready' as const : 'error' as const,
    toggle: () => { if (!known && !loading) { setExpanded(true); void run() } else setExpanded(value => !value) } }
}

// Telegram's round video message (history_view_gif.cpp, isVideoMessage): the square video cut to a
// circle no wider than maxVideoMessageSize (240px), its length at the bottom. A press does not open the
// viewer - ResolveDocument hands a video message to Media::Player::playPause - so it plays right in the
// bubble with sound, a ring round the edge showing how far it has gone. Its thumbnail follows the same
// blur rule as any video's (sharp from 240px).
function RoundVideo({ accountUid, chatId, message }: { accountUid: string; chatId: string; message: ChatMessage }) {
  const part = message.attachments?.[0]
  const [state, setState] = useState<'idle' | 'loading' | 'playing' | 'paused' | 'error'>('idle')
  const [url, setUrl] = useState<string | null>(null)
  const [position, setPosition] = useState({ at: 0, length: 0 })
  const [sharp, setSharp] = useState(false)
  const video = useRef<HTMLVideoElement | null>(null), request = useRef<string | null>(null)
  const thumb = message.mediaMetadata?.thumbData ?? '', seconds = message.mediaMetadata?.videoDuration ?? 0
  useEffect(() => () => {
    video.current?.pause(); endPlayback(video.current)
    const id = request.current; if (id) void window.morse.closeMedia(accountUid, id).catch(() => {})
  }, [accountUid])
  useEffect(() => {
    const element = video.current
    if (!url || !element) return
    startPlayback({ chatId, messageId: message.id, kind: 'round', element })
    void element.play().catch(() => setState('error'))
  }, [url])
  async function toggle(): Promise<void> {
    const current = video.current
    if (state === 'playing' && current) { current.pause(); return }
    if (state === 'paused' && current) { startPlayback({ chatId, messageId: message.id, kind: 'round', element: current }); void current.play().catch(() => setState('error')); return }
    if (state === 'loading' || !part?.available) return
    const id = crypto.randomUUID(); request.current = id; setState('loading')
    try {
      const ready = await window.morse.openMedia(accountUid, chatId, { requestId: id, messageId: message.id, version: message.version, index: 0 })
      if (request.current !== id) return
      if (!ready.url) { setState('error'); return }
      setUrl(ready.url)
    } catch { if (request.current === id) setState('error') }
  }
  const length = Number.isFinite(position.length) && position.length > 0 ? position.length : seconds
  const progress = length ? Math.min(1, position.at / length) : 0
  const shown = state === 'playing' || state === 'paused' ? Math.max(0, Math.ceil(length - position.at)) : seconds
  const ring = 2 * Math.PI * 48
  return <button type="button" className={`round-video ${state}`} disabled={!part?.available} aria-label={state === 'playing' ? tr('일시 정지') : tr('원형 영상 재생')}
    onClick={event => { event.stopPropagation(); void toggle() }}>
    {thumb && <img className={`round-video-thumb${sharp ? ' sharp' : ''}`} src={`data:image/jpeg;base64,${thumb}`} alt="" aria-hidden="true"
      onLoad={event => { const image = event.currentTarget; setSharp(image.naturalWidth >= 240 || image.naturalHeight >= 240) }} />}
    {url && <video ref={element => { video.current = element }} src={url} playsInline preload="auto"
      onPlay={() => setState('playing')} onPause={() => setState(current => current === 'playing' ? 'paused' : current)}
      onTimeUpdate={event => { const element = event.currentTarget; setPosition({ at: element.currentTime, length: element.duration }) }}
      onEnded={event => { const element = event.currentTarget; element.currentTime = 0; setPosition({ at: 0, length: element.duration }); setState('paused') }}
      onError={() => setState('error')} />}
    <svg className="round-video-ring" viewBox="0 0 100 100" aria-hidden="true">
      <circle cx="50" cy="50" r="48" style={{ strokeDasharray: ring, strokeDashoffset: ring * (1 - progress) }} />
    </svg>
    {state !== 'playing' && <span className="round-video-icon">{state === 'loading' ? <Spinner size={24} /> : <Play size={30} />}</span>}
    <span className="round-video-time">{state === 'error' ? tr('재생할 수 없습니다') : formatDuration(shown)}</span>
  </button>
}

// Telegram's automatic media download: a photo fills its tile as soon as it arrives, and a press
// still opens the full-size view. Anything else, and a photo with the preference off, keeps the tile.
export function MediaTile({ accountUid, chatId, message, part, label, single, ratio, shape = 'fixed', onOpen }: {
  accountUid: string; chatId: string; message: ChatMessage; part: NonNullable<ChatMessage['attachments']>[number]
  label: string; single: boolean; ratio: number | null
  // 'natural': the shape given only holds the place; once the picture is there it keeps its own, as Telegram's does.
  shape?: 'fixed' | 'natural'
  onOpen(message: ChatMessage, index: number): void
}) {
  const [preview, setPreview] = useState<string | null>(null)
  const [fetched, setFetched] = useState('')
  // Telegram Desktop blurs a photo until its full size is there (Photo::prepareImageCacheWithLarge),
  // but a video only while its thumbnail is under 240px both ways (Gif, kUseNonBlurredThreshold): the
  // 320px thumbnail a Telegram client sends shows sharp, in its low resolution.
  const [sharpThumb, setSharpThumb] = useState(false)
  // Telegram draws a circled download arrow on a photo it has not fetched and a cancel with a radial
  // ring while it fetches (history_view_photo.cpp: historyFileThumbDownload / historyFileThumbCancel),
  // so a picture held back by the automatic download setting can be asked for where it is. Pressing it
  // fetches it into the bubble; once it is there, pressing opens it.
  const [asked, setAsked] = useState(false)
  // The automatic attempt came back with nothing: the limit for this room's kind of peer is off, or the
  // picture is over it (Data::AutoDownload). It is one press away.
  const [held, setHeld] = useState(false)
  const showable = part.kind === 'image' && part.available && !part.blind
  // Telegram draws the tiny placeholder that came with the message, blurred, until the picture
  // itself is there. A message carrying none is the case Telegram answers by asking the server for
  // the small size whatever the preference says, so a photo is never a blank tile; Morse keeps no
  // small size, so the main process fetches the picture once and keeps only a 32px placeholder.
  const carried = message.mediaMetadata?.thumbData ?? ''
  const wantedThumb = held && !asked && !carried && showable
  // Every photo is asked for once; main answers with nothing when this room's limit holds it back, and
  // the person's own press asks again without one.
  useEffect(() => {
    if (!showable || preview) return
    let alive = true
    void window.morse.photoPreview(accountUid, chatId, { requestId: crypto.randomUUID(), messageId: message.id, version: message.version, index: part.index }, asked)
      .then(next => { if (!alive) return; if (next) setPreview(next); else setHeld(true) }).catch(() => { if (alive) setHeld(true) })
    return () => { alive = false }
  }, [showable, asked, preview, accountUid, chatId, message.id, message.version, part.index])
  useEffect(() => {
    if (!wantedThumb || fetched) return
    let alive = true
    void window.morse.photoThumb(accountUid, chatId, { requestId: crypto.randomUUID(), messageId: message.id, version: message.version, index: part.index })
      .then(next => { if (alive && next) setFetched(next) }).catch(() => {})
    return () => { alive = false }
  }, [wantedThumb, fetched, accountUid, chatId, message.id, message.version, part.index])
  const placeholder = preview || part.blind ? '' : carried || fetched
  // The picture is not here and was not asked for: the press fetches it, as Telegram's download button
  // does, instead of opening a viewer that would have to fetch it anyway.
  const fetches = showable && !preview && held && !asked
  // One photo keeps the shape it was taken in, the way Telegram shows it; an album stays a mosaic.
  return <button type="button" data-part-index={part.index} className={`media-tile${preview ? ' previewed' : ''}${placeholder ? ' placeholder' : ''}${single ? ' single' : ''}`}
    // Telegram gives a photo its place from the size that came with the message, before any of it is
    // here (Photo::countOptimalSize reads the photo's own width and height), so the bubble does not
    // change shape when the picture arrives — and a picture waiting to be asked for keeps that shape
    // instead of collapsing to a band.
    disabled={!part.available} style={single && ratio && (shape === 'fixed' || !preview) ? { aspectRatio: String(ratio) } : undefined}
    aria-label={fetches ? tr('사진 내려받기') : undefined}
    onClick={event => { event.stopPropagation(); if (fetches) setAsked(true); else onOpen(message, part.index) }}>
    {placeholder && <img className={`media-thumb${sharpThumb ? ' sharp' : ''}`} src={`data:image/jpeg;base64,${placeholder}`} alt="" aria-hidden="true"
      onLoad={event => { const image = event.currentTarget; setSharpThumb(part.kind === 'video' && (image.naturalWidth >= 240 || image.naturalHeight >= 240)) }} />}
    {preview ? <img src={preview} alt={label} onError={() => setPreview(null)} />
      : part.blind ? <LockKeyhole size={26} /> : part.kind === 'video' ? <Play size={30} /> : part.kind === 'voice' ? <Mic size={26} />
        : asked ? <span className="media-download" aria-hidden="true"><Spinner size={22} /></span>
          : fetches ? <span className="media-download" aria-hidden="true"><Download size={22} /></span> : <ImageIcon size={26} />}
    <span>{label}</span>
  </button>
}

// iOS sticker message (MessageBubbleLayoutCalculator .sticker: 184pt square, no bubble): a PNG or GIF drawn as it
// is, an MP4 looping silently.
function StickerView({ accountUid, chatId, message }: { accountUid: string; chatId: string; message: ChatMessage }) {
  const [ready, setReady] = useState<{ url: string; video: boolean } | null>(null), [failed, setFailed] = useState(false)
  useEffect(() => {
    let alive = true
    const id = crypto.randomUUID()
    void window.morse.openMedia(accountUid, chatId, { requestId: id, messageId: message.id, version: message.version, index: 0 })
      .then(value => { if (alive && value.url) setReady({ url: value.url, video: value.presentation === 'video' }); else if (alive) setFailed(true) })
      .catch(() => { if (alive) setFailed(true) })
    return () => { alive = false; void window.morse.closeMedia(accountUid, id).catch(() => {}) }
  }, [accountUid, chatId, message.id, message.version])
  // Telegram OpenChatMessage → StickerPackScreen: a tap opens the sticker's set, never a photo viewer.
  return <div className="sticker-view" data-sticker-url={ready?.url} role="button" tabIndex={0} title={tr('스티커팩 보기')}
    onClick={event => { event.stopPropagation(); showStickerPackSheet(accountUid, chatId, message.id, message.version) }}
    onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); showStickerPackSheet(accountUid, chatId, message.id, message.version) } }}>
    {ready ? ready.video ? <video src={ready.url} autoPlay loop muted playsInline /> : <img src={ready.url} alt={tr('스티커')} draggable={false} />
      : failed ? <span className="sticker-missing">{tr('스티커')}</span> : <Spinner size={20} />}
  </div>
}

export function Attachments({ accountUid, chatId, message, own, onOpen }: { accountUid: string; chatId: string; message: ChatMessage; own: boolean; onOpen(message: ChatMessage, index: number): void }) {
  const parts = message.attachments ?? []
  if (message.kind === 'voice' && parts[0] && !parts[0].blind) return <VoicePlayer accountUid={accountUid} chatId={chatId} message={message} own={own} />
  if (message.kind === 'video' && message.circular && parts.length === 1 && !parts[0]!.blind) return <RoundVideo accountUid={accountUid} chatId={chatId} message={message} />
  if (message.kind === 'sticker' && parts[0] && !parts[0].blind) return <StickerView accountUid={accountUid} chatId={chatId} message={message} />
  if (message.kind === 'file') return <>{parts.map(part => <button key={part.index} type="button" className="file-message" disabled={!part.available} onClick={event => { event.stopPropagation(); onOpen(message, part.index) }}>
    <span className="file-message-icon">{part.blind ? <LockKeyhole size={20} /> : <FileIcon size={20} />}</span>
    <span className="file-message-text"><strong className="ellipsis">{part.name}</strong><small>{part.available ? tr('눌러서 열기') : tr('아직 열 수 없습니다')}</small></span>
  </button>)}</>
  const metadata = message.mediaMetadata
  const single = parts.length === 1
  // iOS records a photo's size in mediaWidthPx/mediaHeightPx and a video's in videoWidthPx/videoHeightPx.
  const width = metadata?.mediaWidthPx ?? metadata?.videoWidthPx, height = metadata?.mediaHeightPx ?? metadata?.videoHeightPx
  const ratio = width && height ? width / height : null
  return <div className={`media-grid count-${Math.min(parts.length, 4)}`}>{parts.map(part => <MediaTile key={part.index} accountUid={accountUid} chatId={chatId} message={message} part={part} single={single} ratio={ratio}
    label={part.blind ? tr('가려진 {0}', [messageKindLabel(part.kind)]) : part.kind === 'video' && metadata?.videoDuration !== undefined ? formatDuration(metadata.videoDuration) : message.circular && part.kind === 'video' ? tr('원형 영상') : messageKindLabel(part.kind)}
    onOpen={onOpen} />)}</div>
}

// The link under the pointer when a message menu opens, for Telegram's «링크 복사» / «이메일 복사».
export interface MessageLink { url: string; email: boolean }
// The album item under the pointer, so «저장» saves that picture.
// MorseOutgoingMessageStatusChrome .sent(read: true): iOS draws a read message as `checkmark.circle.fill` in readCheck,
// and Android as the same filled circle with a white tick; sent stays one tick.
export function ReadMark() {
  return <svg className="read-mark" width="15" height="15" viewBox="0 0 16 16" role="img" aria-label={tr('읽음')}>
    <circle cx="8" cy="8" r="7.5" fill="currentColor" />
    <path d="M4.6 8.3 7 10.6l4.5-5" fill="none" stroke="#fff" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
}

export interface MessageMenuTarget { link?: MessageLink; part?: number }

export interface MessageViewProps {
  accountUid: string; chatId: string; message: ChatMessage; own: boolean; layout: MessageLayout; read: 'sent' | 'read'
  selecting: boolean; selected: boolean; highlighted: boolean
  onMenu(message: ChatMessage, point: { x: number; y: number }, target?: MessageMenuTarget): void; onReply(message: ChatMessage): void; onJumpReply(message: ChatMessage): void
  onOpenMedia(message: ChatMessage, index: number): void; onToggle(message: ChatMessage): void; onReaction(message: ChatMessage, emoji: string): void
  autoTranslate: boolean
}

// HistoryView::Message: bubble with Telegram geometry and Morse colors.
export const MessageView = memo(function MessageView(props: MessageViewProps) {
  const { accountUid, chatId, message, own, layout, read, selecting, selected, highlighted } = props
  const translation = useTranslation(accountUid, chatId, message.id)
  // A channel post mirrored into the discussion room is a card with the post's picture, its channel and its text,
  // the way iOS draws it (MorseChatUIKitNativeChannelPostRow) and Telegram shows a channel's post in the group.
  if (message.channelPost) {
    const card = message.channelPost, part = message.attachments?.[0]
    // The picture answers for itself — it is fetched where it is, and opens the post once it is here —
    // while the card's words lead to the channel. One button around both made the picture unreachable:
    // every press on it left the room (and a button inside a button is not a control a reader can use).
    return <div className="history-service" data-message-id={message.id}>
      <div className="channel-post-card">
        {/* ChannelPostMediaView.singleImage: the card is always the shape the post chose — 4:5 when it
            chose none — and the picture is fitted inside it, never cropped. Its place is the same before
            the picture is here and after, so the card does not change shape as it loads. */}
        {part && <MediaTile accountUid={accountUid} chatId={chatId} message={message} part={part} label={tr('채널 게시물')} single ratio={card.ratio ?? 4 / 5} shape="fixed"
          onOpen={() => controller.openChannel(card.channelId, card.postId)} />}
        <button type="button" className="channel-post-card-body" onClick={() => controller.openChannel(card.channelId, card.postId)}>
          <strong className="ellipsis"><Megaphone size={14} />{card.channelName || tr('채널 게시물')}</strong>
          {message.text && <span className="channel-post-card-text">{message.text}</span>}
        </button>
      </div>
    </div>
  }
  if (message.system) return <div className="history-service" data-message-id={message.id}><span className="service-pill selectable">{message.text || messageKindLabel(message.kind) || tr('시스템 메시지')}</span></div>
  const time = positionMilliseconds(message.position)
  const openMenu = (event: MouseEvent<HTMLElement>): void => {
    if (selecting || message.encrypted) return
    const selection = window.getSelection()
    if (selection && !selection.isCollapsed && event.currentTarget.contains(selection.anchorNode)) return
    event.preventDefault()
    const anchor = (event.target as HTMLElement).closest<HTMLAnchorElement>('a.bubble-link')
    const tile = (event.target as HTMLElement).closest<HTMLElement>('[data-part-index]')
    props.onMenu(message, pointFor(event, event.currentTarget), {
      link: anchor?.dataset.link ? { url: anchor.dataset.link, email: anchor.dataset.email !== undefined } : undefined,
      part: tile ? Number(tile.dataset.partIndex) : undefined
    })
  }
  const translated = !message.encrypted && message.kind === 'text' && translation?.status === 'shown' && translation.source === message.text && (translation.manual || props.autoTranslate) ? translation.text : null
  const media = !message.encrypted && message.kind !== 'text' && (message.attachments?.length ?? 0) > 0
  // A poll is a card with no attachment, so it never reached `Attachments`, which draws only what a
  // message carries — a received poll showed as a bubble reading «투표» and nothing else. It is drawn
  // here beside the attachments instead, inside the ordinary bubble, as Telegram draws one.
  const poll = !message.encrypted && message.kind === 'poll' && message.poll ? message.poll : null
  // A caption with nothing to read (spaces, zero-width characters) is no caption: it would only add an empty
  // line and keep the picture in a bubble.
  const caption = message.caption ?? '', blankCaption = !/[^\s\u200B-\u200D\u2060\uFEFF]/.test(caption)
  const text = message.encrypted ? tr('이 기기에서 열 수 없는 비밀 메시지입니다.') : message.kind === 'text' ? translated ?? message.text : media && blankCaption ? '' : caption
  // Telegram draws a video message on its own, never inside a bubble.
  const round = media && ((message.kind === 'video' && message.circular) || message.kind === 'sticker')
  // A bubble has room for the whole notice, and Telegram puts it in the message's own text; every other
  // place has one line, and gets the name (message-kinds.ts).
  const plainLabel = !message.encrypted && message.kind !== 'text' && !media && !poll
    ? (message.kind === 'unsupported' ? unsupportedMessageNotice() : messageKindLabel(message.kind)) : ''
  // A text message made only of emoji is drawn large with no bubble; a shared channel keeps the words before its
  // address and shows the channel as a card (iOS MorseChatManualTextBubble).
  const plainText = !message.encrypted && message.kind === 'text' && translated === null
  // A note iOS kept in the memo room's own messages, drawn as the note it is rather than as its wire
  // (MorseChatUIKitNativeBubbleRow: memoContentRow, gated on the room being memo_{uid}). It carries no
  // link card, as iOS leaves its linkURL nil.
  const memo = plainText && chatId.startsWith('memo_') ? decodeMemoNote(message.text) : null
  const emojiOnly = plainText && !memo && emojiOnlyText(message.text)
  const card = plainText && !memo && !emojiOnly ? linkCardFor(message.text) : null
  const shown = card?.share ? card.share.bodyText : text
  const mediaOnly = media && !text && !plainLabel
  // ChatMessageDateAndStatusNode: under reactions the date joins their LAST row when that row's width and the date's
  // fit the bubble (`currentRowWidth + dateWidth <= constrainedWidth`), whatever the number of rows, and goes below
  // otherwise — the date is the row's last item, pushed to its end. A picture alone and a sticker keep theirs on it.
  const inlineMeta = message.reactions.length > 0 && !mediaOnly && !round && !emojiOnly
  const metaSpace = <span className={`bubble-meta-space${message.edited ? ' edited' : ''}${own ? ' own' : ''}`} />
  const meta = <span className={`bubble-meta${inlineMeta ? ' inline' : ''}`}>
    {message.edited && !emojiOnly && <span>{tr('수정됨')}</span>}
    <time dateTime={new Date(time).toISOString()}>{messageTime(time)}</time>
    {own && (read === 'read' ? <ReadMark /> : <Check size={15} aria-label={tr('보냄')} />)}
  </span>
  return <div className={rowClass(own, layout, `${selected ? ' selected' : ''}${highlighted ? ' highlight' : ''}${selecting ? ' selecting' : ''}`)}
    data-message-id={message.id} onContextMenu={openMenu} onClick={selecting ? () => props.onToggle(message) : undefined}
    onDoubleClick={event => { if (!selecting && !message.encrypted && (event.target as HTMLElement).closest('.bubble')) { window.getSelection()?.removeAllRanges(); props.onReply(message) } }}>
    {selecting && <span className="history-check"><RoundCheck checked={selected} /></span>}
    {layout.gutter && <span className="history-photo">{layout.photo && <UserAvatar uid={message.senderId} name={message.senderName || '?'} size={33} roomOnly={layout.roomOnly} />}</span>}
    <div className={`bubble${message.encrypted ? ' encrypted' : ''}${mediaOnly ? ' media-only' : ''}${round ? ' round' : ''}${emojiOnly ? ' emoji-only' : ''}${card?.url ? ' has-link-card' : ''}`}>
      {layout.name && !own && message.senderName && <div className="bubble-name ellipsis">{message.senderName}</div>}
      {!message.encrypted && message.storySource && <StorySource source={message.storySource} />}
      {!message.encrypted && message.reply && <ReplyQuote preview={message.reply} onOpen={() => props.onJumpReply(message)} />}
      {media && <Attachments accountUid={accountUid} chatId={chatId} message={message} own={own} onOpen={props.onOpenMedia} />}
      {poll && <PollCard accountUid={accountUid} message={message} poll={poll} />}
      {memo ? <div className="bubble-memo selectable">
        {memo.title.trim() && <strong><NotebookPen size={14} aria-hidden />{memo.title.trim()}{!memo.body && metaSpace}</strong>}
        {/* The date sits at the bubble's end, so the room it needs belongs to the note's last line. */}
        {memo.body ? <span>{memo.body}{metaSpace}</span> : !memo.title.trim() && metaSpace}
      </div>
        : emojiOnly ? <div className="bubble-emoji selectable" style={{ fontSize: emojiOnlyFontSize(message.text) }}>{message.text.trim()}</div>
        : (text || plainLabel || !media) && <div className="bubble-text selectable">{plainLabel ? <em className={message.kind === 'unsupported' ? 'unsupported' : undefined}>{plainLabel}</em> : message.encrypted ? text : <LinkedText accountUid={accountUid} text={shown} disabled={selecting} />}{!card?.url && !inlineMeta && <span className={`bubble-meta-space${message.edited ? ' edited' : ''}${own ? ' own' : ''}`} />}</div>}
      {card?.url && <LinkCard accountUid={accountUid} text={message.text} disabled={selecting} />}
      {!inlineMeta && meta}
      {message.reactions.length > 0 && <div className="bubble-reactions">{message.reactions.slice(0, 20).map(reaction => {
        // Telegram and iOS MorseReactionButton: one to three people show as small photos instead of a number.
        const faces = reaction.users && reaction.count <= 3 && reaction.users.length === reaction.count ? reaction.users : null
        return <button key={reaction.emoji} type="button" className={reaction.selected ? 'selected' : undefined}
          aria-pressed={reaction.selected} aria-label={`${reaction.emoji} ${reaction.count}${reaction.users?.length ? ` · ${reaction.users.map(user => user.name).join(', ')}` : ''}`} disabled={selecting || !message.version}
          onClick={event => { event.stopPropagation(); props.onReaction(message, reaction.emoji) }}
          onContextMenu={event => { if (!reaction.users?.length) return; event.preventDefault(); event.stopPropagation(); showReactionPeople(reaction.emoji, reaction.count, reaction.users) }}>
          <span>{reaction.emoji}</span>{faces ? <span className="bubble-reaction-faces">{faces.map(user => <UserAvatar key={user.uid} uid={user.uid} name={user.name} size={20} roomOnly={layout.roomOnly} />)}</span> : reaction.count}
        </button>
      })}{inlineMeta && meta}</div>}
    </div>
  </div>
})

export const LocalMessageView = memo(function LocalMessageView({ accountUid, item, layout, onMenu }: { accountUid: string; item: LocalOutgoing; layout: MessageLayout; onMenu(item: LocalOutgoing, point: { x: number; y: number }): void }) {
  const failed = item.state === 'failed' || item.state === 'upload-failed'
  const percent = item.progress ? Math.round(100 * item.progress.loaded / Math.max(1, item.progress.total)) : null
  return <div className={rowClass(true, layout, failed ? ' failed' : '')} onContextMenu={event => { event.preventDefault(); onMenu(item, pointFor(event, event.currentTarget)) }}>
    {failed && <button type="button" className="history-failed" aria-label={tr('보내지 못한 메시지 메뉴')} onClick={event => onMenu(item, pointFor(event, event.currentTarget))}><CircleAlert size={22} /></button>}
    <div className="bubble">
      {(item.forwarded || item.storyReply || item.replyToId) && <div className="bubble-label">{item.forwarded ? tr('전달된 메시지') : item.storyReply ? tr('스토리 답장') : <><Reply size={12} />{' '}{tr('답장')}</>}</div>}
      {item.voicePreview ? <div className="voice-message own local"><QueuedVoicePlay accountUid={accountUid} item={item} /><span className="voice-message-body"><small>{tr('음성 메시지 · {0}', [formatDuration(item.voicePreview.duration)])}</small></span></div>
        : <div className="bubble-text selectable">{item.text || tr('첨부')}<span className="bubble-meta-space own" /></div>}
      {item.progress && <div className="bubble-progress" role="progressbar" aria-valuenow={percent ?? 0} aria-valuemin={0} aria-valuemax={100}><i style={{ width: `${percent}%` }} /></div>}
      <span className="bubble-meta">
        <time>{messageTime(item.createdAt)}</time>
        {failed ? <CircleAlert size={14} aria-label={tr('전송 실패')} /> : item.state === 'sent' ? <Check size={15} aria-label={tr('보냄')} /> : <Clock3 size={13} aria-label={item.state === 'uploading' ? tr('업로드 중') : tr('보내는 중')} />}
      </span>
    </div>
    {failed && item.reason && <div className="history-failed-reason">{item.reason}</div>}
  </div>
})
