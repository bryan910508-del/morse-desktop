// B153 (contracts/B153-official-profile-photo.md §4): who sees a person's picture, as Telegram keeps a per-person
// privacy rule for the profile photo (PrivacyControlActivity PRIVACY_RULES_TYPE_PHOTO) — the server writes it into the
// public profile as `privacy.photo`. «everyone»: anyone (the two official accounts); «nobody»: the person alone; anything
// else, or nothing, is «contacts»: mutual contacts only, the rule every account had until now (A7). An account gone
// shows none. Every surface that paints someone else's picture asks this one question.
export type PhotoPrivacy = 'everyone' | 'contacts' | 'nobody'

export function photoVisible({ deleted, privacy, mutual }: { deleted: boolean; privacy: string; mutual: boolean }): boolean {
  if (deleted) return false
  if (privacy === 'everyone') return true
  return privacy !== 'nobody' && mutual
}
