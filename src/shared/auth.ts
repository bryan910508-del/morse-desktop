import type { AccountProfile } from './model'
import { tr } from './i18n'

export type AuthPhase = 'unavailable' | 'signed-out' | 'verifying' | 'restoring' | 'connecting' | 'signed-in' | 'suspended' | 'error'
export interface AuthenticationSnapshot {
  phase: AuthPhase
  available: boolean
  account: AccountProfile | null
  message: string
}

// No credential, App Check token or session secret is part of the public model.
export interface AuthenticationBridge {
  signInWithBackupCode(code: string): Promise<void>
  signInWithApple(): Promise<void>
  cancelSignIn(): Promise<void>
  restoreSignIn(uid: string): Promise<void>
  signOut(uid?: string): Promise<void>
  addAccount(): Promise<void>
  cancelAddAccount(): Promise<void>
  switchAccount(uid: string): Promise<void>
  createAccount(userId: string): Promise<AccountCreationResult | null>
}

// One saved account on this device: connection phase, whether its session runs, whether the window shows it.
export interface AccountAuthState { uid: string; userId: string; displayName: string; phase: AuthPhase; message: string; connected: boolean; active: boolean; unread: number; photo: string | null }

// The recovery code is shown once; `connected` is false when the account exists but this device could not finish connecting.
export interface AccountCreationResult { userId: string; backupCode: string; connected: boolean }

// Morse IDs are eight characters from the server's unambiguous alphabet.
export const morseUserIdAlphabet = 'abcdefghjkmnpqrstuvwxyz23456789'
export function morseUserId(raw: unknown): string {
  if (typeof raw !== 'string' || !/^[abcdefghjkmnpqrstuvwxyz23456789]{8}$/.test(raw)) throw new Error(tr('Morse ID를 다시 만들어 주세요.'))
  return raw
}

export function normalizeBackupCode(raw: unknown): string {
  if (typeof raw !== 'string' || raw.length > 256) throw new Error(tr('복구 코드를 확인해 주세요.'))
  // The existing server normalizes trim → uppercase → whitespace removal.
  // Retain legacy TALKY prefixes and hyphens instead of inventing a new format.
  const result = raw.trim().toUpperCase().replace(/\s+/g, '')
  if (!result) throw new Error(tr('복구 코드를 입력해 주세요.'))
  return result
}
