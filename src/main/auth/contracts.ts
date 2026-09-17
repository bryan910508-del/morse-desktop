import type { AccountProfile } from '../../shared/model'
import { tr } from '../../shared/i18n'

export interface AppCheckProof { token: string; expiresAt: number; appId: string }
export interface DesktopAppProofProvider {
  getProof(signal: AbortSignal): Promise<AppCheckProof>
}
export interface DesktopAuthConfiguration {
  apiKey: string
  appId: string
  projectId: 'talky-a38c3'
  projectNumber: '123713400904'
  // The exact string must be approved in the server's app identity policy.
  platform: 'macOS' | 'Windows'
  proof: DesktopAppProofProvider
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
  provider?: 'apple.com'
}
export type AuthFailureCode = 'unavailable' | 'app-proof' | 'invalid-code' | 'rate-limited' | 'invalid-credential' | 'revoked' | 'network' | 'storage' | 'protocol' | 'cancelled' | 'id-taken' | 'account-limit' | 'saved-account' | 'already-added' | 'device-limit' | 'apple' | 'stale-identity'
const messages: Record<AuthFailureCode, string> = {
  unavailable: tr('현재 이 버전에서는 계정을 연결할 수 없습니다.'),
  'app-proof': tr('보안 확인을 완료하지 못했습니다. 잠시 후 다시 시도해 주세요.'),
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
  // The server refused to give a withdrawn account's Apple identity a new profile; signing in again gets a new one.
  'stale-identity': tr('Apple 로그인에 실패했어요. 다시 시도해 주세요.')
}
export class AuthenticationFailure extends Error {
  constructor(readonly code: AuthFailureCode) { super(messages[code]); this.name = 'AuthenticationFailure' }
}
export function asAuthFailure(error: unknown): AuthenticationFailure {
  return error instanceof AuthenticationFailure ? error : new AuthenticationFailure('protocol')
}
