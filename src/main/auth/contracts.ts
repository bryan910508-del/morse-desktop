import type { AccountProfile } from '../../shared/model'
import { tr } from '../../shared/i18n'
import { waitText } from '../../shared/two-step'
import { bannedNotice } from '../../shared/sanctions'

export interface AppCheckProof { token: string; expiresAt: number; appId: string }
export interface DesktopAppProofProvider {
  getProof(signal: AbortSignal): Promise<AppCheckProof>
  // A16: a signed-in account offers its session to prove this app (web-app-proof.ts); the result takes it back.
  useSession?(uid: string, proof: (signal: AbortSignal) => Promise<string | null>): () => void
  // «Try now» (tdesktop window_connecting_widget lng_reconnecting_try_now): the check again at once, its wait skipped.
  retryNow?(signal: AbortSignal): Promise<AppCheckProof>
}
export interface DesktopAuthConfiguration {
  apiKey: string
  appId: string
  projectId: 'talky-a38c3'
  projectNumber: '123713400904'
  // The exact string must be approved in the server's app identity policy.
  platform: 'macOS' | 'Windows'
  proof: DesktopAppProofProvider
  // Server r35 §1 (가): a development run or the Phase1 test app, never a release — the only builds that show the QR code
  // while app_config/qr_login is on only for the accounts trying it (`testing`).
  testingBuild?: boolean
}
export interface AuthTokens {
  idToken: string
  refreshToken: string
  uid: string
  authTime: number
  expiresAt: number
}
export interface SavedCredential {
  version: 1
  profile: AccountProfile
  sessionId: string
  refreshToken: string
  authTime: number
  // How this device signed in, for the server's session list (iOS sends the Firebase provider ID).
  provider?: 'apple.com' | 'google.com' | 'qr'
}
export type AuthFailureCode = 'unavailable' | 'update-required' | 'app-proof' | 'app-proof-refused' | 'invalid-code' | 'rate-limited' | 'invalid-credential' | 'revoked' | 'network' | 'storage' | 'protocol' | 'cancelled' | 'id-taken' | 'account-limit' | 'saved-account' | 'already-added' | 'device-limit' | 'apple' | 'google' | 'account-exists' | 'stale-identity' | 'banned' | 'qr-disabled' | 'qr-expired' | 'password-needed'
const messages: Record<AuthFailureCode, string> = {
  unavailable: tr('현재 이 버전에서는 계정을 연결할 수 없습니다.'),
  // The server needs a newer Morse. What was waiting to go is still here, and goes once it is updated.
  'update-required': tr('최신 버전의 Morse로 업데이트해야 연결할 수 있습니다. 보내지 않은 메시지와 초안은 그대로 있습니다.'),
  'app-proof': tr('보안 확인을 완료하지 못했습니다. 잠시 후 다시 시도해 주세요.'),
  // The exchange answered 403: reCAPTCHA scored this network low (a VPN exit — B99, A16). Waiting does not change that.
  'app-proof-refused': tr('이 네트워크에서 보안 확인이 거절됐어요. VPN 이나 프록시를 쓰고 있다면 끄고 다시 시도해 주세요.'),
  'invalid-code': tr('복구 코드가 올바른지 확인해 주세요.'),
  'rate-limited': tr('요청이 많습니다. 잠시 후 다시 시도해 주세요.'),
  'invalid-credential': tr('로그인 정보가 만료되었습니다. 복구 코드로 다시 로그인해 주세요.'),
  revoked: tr('이 기기의 로그인이 해제되었습니다. 다시 로그인해 주세요.'),
  network: tr('계정 연결을 확인하지 못했습니다. 네트워크 연결을 확인해 주세요.'),
  storage: tr('로그인 정보를 안전하게 저장하지 못했습니다. 다시 시도해 주세요.'),
  protocol: tr('계정 정보를 확인할 수 없습니다. 다시 시도해 주세요.'),
  cancelled: tr('계정 연결을 취소했습니다.'),
  'id-taken': tr('이미 사용 중인 ID예요. 다른 ID를 만들어 주세요.'),
  'account-limit': tr('이 기기에서 만들 수 있는 계정 수에 도달했어요. 기존 계정은 복구 코드로 연결해 주세요.'),
  'saved-account': tr('이 기기에 저장된 로그인이 있어요. 저장된 로그인을 지운 뒤 새 계정을 만들어 주세요.'),
  'already-added': tr('이미 이 기기에 추가된 계정이에요. 계정 목록에서 선택해 주세요.'),
  'device-limit': tr('계정 한도에 도달했어요.'),
  apple: tr('Apple 로그인에 실패했어요. 다시 시도해 주세요.'),
  google: tr('Google 로그인에 실패했어요. 다시 시도해 주세요.'),
  // signInWithIdp's needConfirmation: the email belongs to an account made another way. Accounts are not linked
  // (Android's 2026-09-21 decision, A14): the person signs in the way that account was made.
  'account-exists': tr('이 이메일은 다른 로그인 수단으로 만든 계정에 쓰이고 있어요. 그 수단으로 로그인해 주세요.'),
  // The server refused to give a withdrawn account's Apple identity a new profile; signing in again gets a new one.
  'stale-identity': tr('Apple 로그인에 실패했어요. 다시 시도해 주세요.'),
  // A10 §4 (Telegram PHONE_NUMBER_BANNED): the operator banned the account. What it kept stays on this device — the
  // operator can lift a ban — and the account offers «도움», a mail to the operator.
  banned: bannedNotice(),
  // A13: the QR sign-in is off on the server (the code area goes away), or this code's attempt is over (a new code).
  'qr-disabled': tr('지금은 QR 코드로 연결할 수 없어요. 복구 코드로 연결해 주세요.'),
  'qr-expired': tr('QR 코드가 만료됐어요. 새 코드를 띄웁니다.'),
  // A13-2 ②: the account's two-step password is asked for on its own step; this is only the word if one ever escapes.
  'password-needed': tr('이 계정은 2단계 인증 비밀번호가 필요해요.')
}
// What a failed token refresh does to the account on this device. When the sign-in itself is over — the refresh
// token refused, or the session revoked — the account is signed out and what it kept is cleared, as Telegram does on
// 401. A failure to save the new token in the Keychain is this device's own trouble, not the server's word: the
// account is only disconnected, and the messages waiting to go, the uploads and drafts stay for when it connects
// again (F-RT-001, 11_phase1-work §E-1).
export function tokenFailureEffect(code: AuthFailureCode): 'none' | 'disconnect' | 'sign-out' {
  if (code === 'invalid-credential' || code === 'revoked') return 'sign-out'
  if (code === 'storage' || code === 'banned') return 'disconnect'
  return 'none'
}
export class AuthenticationFailure extends Error {
  constructor(readonly code: AuthFailureCode) { super(messages[code]); this.name = 'AuthenticationFailure' }
}
// A failed check's wait (web-app-proof proofRetryDelay) asked into: how long is left, rather than the same failure again.
export class ProofWaiting extends AuthenticationFailure {
  constructor(readonly retryAfterMs: number, refused: boolean) {
    super(refused ? 'app-proof-refused' : 'app-proof')
    this.message = tr('{0} 다시 시도할 수 있어요.', [waitText(Math.max(1, Math.ceil(retryAfterMs / 1000)))])
  }
}
// A13-2 ② (contract §6): the server holds this sign-in for the account's two-step password — startMorseDeviceSession's
// failed-precondition, any callable's permission-denied, both with details.reason 'password-needed' — with the hint and
// a pending reset's date. The sign-in goes to the password step, whichever way it came (tdesktop intro_code.cpp:287-294
// SESSION_PASSWORD_NEEDED → intro_password_check.cpp).
export class PasswordNeeded extends AuthenticationFailure {
  constructor(readonly hint: string, readonly resetAt: number | null) { super('password-needed') }
}
export function asAuthFailure(error: unknown): AuthenticationFailure {
  return error instanceof AuthenticationFailure ? error : new AuthenticationFailure('protocol')
}
