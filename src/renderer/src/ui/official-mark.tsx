import type { OfficialKind } from '../../../shared/model'
import { tr } from '../../../shared/i18n'

export const officialLabel = (kind: OfficialKind): string => kind === 'support' ? tr('공식 고객센터') : tr('공식 계정')

// B111: an official account's mark (publicProfiles.official — the support account and Morse's notices alike), drawn as
// Telegram's verified badge: a filled badge in the accent colour with a white check (contracts/B111 §6; lucide
// BadgeCheck's outline, filled). It sits right after a name, as tdesktop's drawVerifyCheck places it
// (ui/unread_badge.cpp:330-340: the name's start + min(the name's width, the room − the icon)) — a long name gives way,
// the mark stays. The same mark in the chat list, the contacts, a profile and a chat's title.
export function OfficialMark({ kind, size = 14, className = 'official-mark' }: { kind: OfficialKind; size?: number; className?: string }) {
  return <svg className={className} width={size} height={size} viewBox="0 0 24 24" role="img" aria-label={officialLabel(kind)}>
    <path fill="currentColor" d="M3.85 8.62a4 4 0 0 1 4.78-4.77 4 4 0 0 1 6.74 0 4 4 0 0 1 4.78 4.78 4 4 0 0 1 0 6.74 4 4 0 0 1-4.77 4.78 4 4 0 0 1-6.75 0 4 4 0 0 1-4.78-4.77 4 4 0 0 1 0-6.76Z" />
    <path fill="none" stroke="#fff" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" d="m16 9-5.5 5.5L8 12" />
  </svg>
}
