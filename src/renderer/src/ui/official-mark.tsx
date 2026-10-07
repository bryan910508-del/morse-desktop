// Portions of this file follow Telegram Desktop (https://github.com/telegramdesktop/tdesktop, 7.2.8, 272f6f5c),
// Copyright (c) 2014-2026 The Telegram Desktop Authors. Licensed under GPL-3.0-or-later; see LEGAL.
import type { OfficialKind } from '../../../shared/model'
import { tr } from '../../../shared/i18n'

// B178 §2-1: a person's mark — the contacts list's own word when they are a contact, else the mark read for the screen.
export const officialOf = (own: OfficialKind | null | undefined, marks: Readonly<Record<string, OfficialKind>>, uid: string): OfficialKind | null =>
  own ?? marks[uid] ?? null

export const officialLabel = (kind: OfficialKind): string => kind === 'support' ? tr('공식 고객센터') : tr('공식 계정')

// B111: an official account's mark (publicProfiles.official — the support account and Morse's notices alike), drawn as
// Telegram's verified badge: a filled badge in the accent colour with a white check (contracts/B111 §6; lucide
// BadgeCheck's outline, filled). It sits right after a name, as tdesktop's drawVerifyCheck places it
// (ui/unread_badge.cpp:330-340: the name's start + min(the name's width, the room − the icon)) — a long name gives way,
// the mark stays. The same mark in the chat list, the contacts, a profile and a chat's title.
export function OfficialMark({ kind, size = 14, className = 'official-mark' }: { kind: OfficialKind; size?: number; className?: string }) {
  return <svg className={className} width={size} height={size} viewBox="0 0 24 24" role="img" aria-label={officialLabel(kind)}>
    <path fill="currentColor" d="M3.85 8.62a4 4 0 0 1 4.78-4.77 4 4 0 0 1 6.74 0 4 4 0 0 1 4.78 4.78 4 4 0 0 1 0 6.74 4 4 0 0 1-4.77 4.78 4 4 0 0 1-6.75 0 4 4 0 0 1-4.78-4.77 4 4 0 0 1 0-6.76Z" />
    <path fill="none" stroke="var(--official-check, #fff)" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" d="m16 9-5.5 5.5L8 12" />
  </svg>
}

// B178 §2-2: a person's name on a row of people, the mark right after it — the contacts list's shape (a long name gives
// way, the mark stays), for every list that draws a person on one line: pickers, forwarding, members, blocked, search.
export function PeerRowName({ name, official }: { name: string; official?: OfficialKind | null }) {
  return <strong className="peer-row-name"><span className="ellipsis">{name}</span>{official && <OfficialMark kind={official} />}</strong>
}
