import { Fragment, useMemo } from 'react'
import { ChevronRight, Link as LinkIcon } from 'lucide-react'
import { channelShareCard, findTextLinks, linkTarget, type ChannelShareCard } from '../../../shared/text-links'
import { openLink } from '../app/links'
import { Avatar } from '../ui/avatar'
import { tr } from '../../../shared/i18n'

// Message text with its links pressable, as Telegram Desktop draws url and email entities.
export function LinkedText({ accountUid, text, disabled }: { accountUid: string; text: string; disabled?: boolean }) {
  const links = useMemo(() => findTextLinks(text), [text])
  if (!links.length) return <>{text}</>
  const parts: React.ReactNode[] = []
  let at = 0
  for (const link of links) {
    if (link.start > at) parts.push(<Fragment key={`t${at}`}>{text.slice(at, link.start)}</Fragment>)
    const target = linkTarget(link)
    parts.push(<a key={`l${link.start}`} className="bubble-link" href={target} data-link={target} data-email={link.kind === 'email' ? '' : undefined}
      onClick={event => { event.preventDefault(); if (disabled) return; event.stopPropagation(); void openLink(accountUid, target) }}>{link.text}</a>)
    at = link.end
  }
  if (at < text.length) parts.push(<Fragment key={`t${at}`}>{text.slice(at)}</Fragment>)
  return <>{parts}</>
}

// MorseChatManualTextBubble: the first link of a text message gets a card under the text — the channel's name for
// a shared channel, otherwise the address's host and the address itself.
export function linkCardFor(text: string): { share: ChannelShareCard | null; url: string | null } {
  const share = channelShareCard(text)
  if (share) return { share, url: share.url }
  const first = findTextLinks(text).find(link => link.kind === 'url')
  return { share: null, url: first ? linkTarget(first) : null }
}

export function LinkCard({ accountUid, text, disabled }: { accountUid: string; text: string; disabled?: boolean }) {
  const { share, url } = useMemo(() => linkCardFor(text), [text])
  if (!url) return null
  let host = url
  try { host = new URL(url).host || url } catch { /* The address is shown as written. */ }
  return <button type="button" className={`bubble-link-card${share ? ' share' : ''}`} disabled={disabled}
    onClick={event => { event.stopPropagation(); void openLink(accountUid, url) }}>
    {share ? <Avatar name={share.channelName} size={36} /> : <LinkIcon size={14} className="bubble-link-card-icon" />}
    <span className="bubble-link-card-text">
      <strong className="ellipsis">{share ? share.channelName : host}</strong>
      <small className="ellipsis">{share ? tr('📢 채널 공유') : url}</small>
    </span>
    {share && <ChevronRight size={16} className="bubble-link-card-chevron" />}
  </button>
}

// MorseChatBubbleLayoutShared.isEmojiOnlyText: no ASCII, letters or digits, and at least one emoji.
export function emojiOnlyText(text: string): boolean {
  const trimmed = text.trim()
  if (!trimmed) return false
  for (const { segment } of new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(trimmed)) {
    if (/^\s+$/u.test(segment)) continue
    if (segment.length === 1 && segment.charCodeAt(0) < 128) return false
    if (/^[\p{L}\p{N}]/u.test(segment)) return false
  }
  return [...trimmed].some(ch => /\p{Emoji}/u.test(ch) && ch.codePointAt(0)! > 0xFF)
}

// emojiOnlyFontSize: 94pt for one emoji, smaller tiers by the longest line or the number of lines.
const emojiTiers = [1, .84, .69, .53, .46, .38, .32, .27, .24]
export function emojiOnlyFontSize(text: string): number {
  const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' })
  const lines = text.split('\n')
  let longest = 0
  for (const line of lines) longest = Math.max(longest, [...segmenter.segment(line)].filter(part => !/^\s+$/u.test(part.segment)).length)
  const length = Math.max(longest, lines.length)
  return Math.floor(94 * (emojiTiers[length - 1] ?? .21))
}
