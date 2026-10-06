// Portions of this file follow Telegram Desktop (https://github.com/telegramdesktop/tdesktop, 7.2.8, 272f6f5c),
// Copyright (c) 2014-2026 The Telegram Desktop Authors. Licensed under GPL-3.0-or-later; see LEGAL.
// What a refused socket registration means for this device, from the server's `registrationFailed`
// ({ error, reason }, talky-server index.js registrationFailure and the post-registration watches).
//
// Telegram signs a device out — and forgets what it kept — only when the server says the sign-in itself is gone
// (401 AUTH_KEY_UNREGISTERED: tdesktop mtproto/mtp_instance.cpp, main/main_account.cpp; Telegram-iOS
// Network.swift). Every other refusal is retried. In Morse that word is startMorseDeviceSession's «session-revoked»
// (A5 contract §3-1, user decision 2026-09-30, the same for iOS, Android and Desktop): a socket that says the session
// is revoked, the credential revoked, the account unavailable or the session unconfirmed only sends the account to
// ask that function, and registers again unless it answers «session-revoked». Nothing the socket sends signs out by
// itself, so the two servers disagreeing for a moment never costs the messages waiting to go, the uploads, the
// drafts or what this device hid.
export type RegistrationOutcome =
  // The token the registration was made with ran out, or was not this account's: connect again with a fresh one.
  | 'renew'
  // The sign-in may be gone: ask the server (startMorseDeviceSession), then register again unless it says it is.
  | 'confirm'
  // Temporary, or not about this device's sign-in: fetch the token again and register again, later each time.
  | 'retry'
  // The sign-in itself is gone — startMorseDeviceSession said «session-revoked». Never read from a socket refusal; the
  // account reaches it only through 'confirm'. The only outcome that clears this account's data on this device.
  | 'revoked'
  // This build is older than the server accepts.
  | 'update'
  // The server does not speak what this build needs (it is older than this build).
  | 'unsupported'
  // The registration itself was malformed; sending it again would be refused again.
  | 'refused'

// session-unconfirmed: talky-server found no session document, or one of another sign-in (A5 contract §3-2).
const confirmReasons = new Set(['session-revoked', 'credential-revoked', 'account-unavailable', 'session-unconfirmed'])
// Every error and reason the server is known to send (talky-server registrationFailure), read below or retried. They
// name no account, token or session, so connection-check.log keeps them whole.
export const registrationWords: ReadonlySet<string> = new Set([...confirmReasons,
  'token-expired', 'token-account-mismatch', 'UPGRADE_REQUIRED', 'client-protocol-too-old', 'PROTOCOL_UNSUPPORTED', 'server-protocol-too-old',
  'protocol-unsupported', 'INVALID_REGISTRATION', 'malformed-registration', 'session-required', 'UNAUTHORIZED', 'SERVICE_UNAVAILABLE',
  'authentication-failed', 'credential-generation-missing', 'authorization-monitor-failed'])

export function registrationOutcome(body: { error?: unknown; reason?: unknown } | null | undefined): RegistrationOutcome {
  const reason = typeof body?.reason === 'string' ? body.reason : ''
  const error = typeof body?.error === 'string' ? body.error : ''
  if (confirmReasons.has(reason)) return 'confirm'
  if (reason === 'token-expired' || reason === 'token-account-mismatch') return 'renew'
  if (error === 'UPGRADE_REQUIRED' || reason === 'client-protocol-too-old') return 'update'
  // `protocol-unsupported` is this build's own reading of a `registered` that lacks what it needs.
  if (error === 'PROTOCOL_UNSUPPORTED' || reason === 'server-protocol-too-old' || reason === 'protocol-unsupported') return 'unsupported'
  if (error === 'INVALID_REGISTRATION' || reason === 'malformed-registration' || reason === 'session-required') return 'refused'
  // SERVICE_UNAVAILABLE, authentication-failed (any failure the server did not expect), credential-generation-missing,
  // authorization-monitor-failed, and anything a later server adds.
  return 'retry'
}

// The account's local data — the queue of messages not yet sent, uploads, drafts, what this device hid — is
// cleared only when the sign-in is gone.
export function purgesAccountData(outcome: RegistrationOutcome): boolean { return outcome === 'revoked' }

// What the account row says, by cause.
export function rejectionFailure(outcome: RegistrationOutcome): 'revoked' | 'update-required' | 'unavailable' | 'protocol' | 'network' {
  switch (outcome) {
    case 'revoked': return 'revoked'
    case 'update': return 'update-required'
    case 'unsupported': return 'unavailable'
    case 'refused': return 'protocol'
    // Never a refusal the transport gives up on; if one ever arrives, it is the kind that is tried again.
    default: return 'network'
  }
}

// The wait before registering again: one second doubling to thirty, give or take a fifth.
export function registrationDelay(attempt: number, random = Math.random): number {
  return Math.min(30000, 1000 * 2 ** Math.min(Math.max(attempt, 0), 5)) * (0.8 + random() * 0.4)
}
