import { newPasswordSettings, srpProof, toBytes } from '../auth/srp'
import { MorseCallableFailure } from '../network/morse-callable'
import { twoStepReasonText } from '../../shared/two-step'

// Two-step verification's calls (server morse-two-step.js; contracts A13 §5, A13-2), as tdesktop's CloudPassword
// API (api/api_cloud_password.cpp): read the state (account.getPassword), prove the password for a sign-in
// (auth.checkPassword), set, change or remove it (account.updatePasswordSettings), and the 7-day reset and its cancel
// (account.resetPassword / declinePasswordReset). Every proof asks for a fresh check: a srpId answers once.
export type TwoStepCall = (name: string, data: Record<string, unknown>) => Promise<Record<string, unknown>>

// A refusal's words come from its reason (never the server's message); `uncertain` is a request that may have been
// carried out (no answer came), which the caller settles by reading the state again.
export class TwoStepFailure extends Error {
  constructor(readonly reason: string, readonly retryAfterSec = 0, readonly uncertain = false) { super(twoStepReasonText(reason, retryAfterSec)) }
}

interface Salts { salt1: Buffer; salt2: Buffer }
export type PasswordState =
  | { enabled: false; issued: Salts }
  | { enabled: true; issued: Salts; current: Salts; B: bigint; srpId: string; hint: string; resetAt: number | null }

const hex = (value: unknown, bytes: number): Buffer => {
  if (typeof value !== 'string' || !/^[0-9a-f]+$/i.test(value) || value.length !== bytes * 2) throw new TwoStepFailure('malformed')
  return Buffer.from(value, 'hex')
}
const salts = (raw: unknown, first: number, second: number): Salts => {
  const value = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {}
  return { salt1: hex(value.salt1, first), salt2: hex(value.salt2, second) }
}
const millis = (value: unknown): number | null => typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null

export class TwoStepApi {
  constructor(private readonly call: TwoStepCall) {}

  private async send(name: string, data: Record<string, unknown>): Promise<Record<string, unknown>> {
    try { return await this.call(name, data) }
    catch (error) {
      if (error instanceof MorseCallableFailure) throw new TwoStepFailure(error.reason || error.status.toLowerCase(), error.retryAfterSec, error.uncertain)
      throw error
    }
  }

  // getMorsePasswordCheck: on — the salts, B, a one-use srpId, the hint and a pending reset; off — fresh salts only.
  async state(): Promise<PasswordState> {
    const answer = await this.send('getMorsePasswordCheck', {})
    const issued = salts(answer.newAlgo, 32, 32)
    if (answer.enabled !== true) return { enabled: false, issued }
    const algo = answer.algo && typeof answer.algo === 'object' ? answer.algo as Record<string, unknown> : {}
    const current = { salt1: hex(algo.salt1, 64), salt2: hex(algo.salt2, 32) }
    const srpId = hex(answer.srpId, 16).toString('hex'), B = BigInt(`0x${hex(answer.srpB, 256).toString('hex')}`)
    const hint = typeof answer.hint === 'string' ? answer.hint.slice(0, 64) : ''
    return { enabled: true, issued, current, B, srpId, hint, resetAt: millis(answer.resetAt) }
  }

  // The proof of a password against a fresh check.
  private async proof(password: string): Promise<{ srpId: string; A: string; M1: string }> {
    const state = await this.state()
    if (!state.enabled) throw new TwoStepFailure('password-off')
    const { A, M1 } = await srpProof(password, state.current.salt1, state.current.salt2, state.B)
    return { srpId: state.srpId, A: toBytes(A).toString('hex'), M1: M1.toString('hex') }
  }

  // checkMorsePassword: a sign-in held for the password goes on with the token it answers (morsePwdOk).
  async signIn(password: string, qrSecret?: string): Promise<{ customToken: string; sessionId: string | null }> {
    const answer = await this.send('checkMorsePassword', { ...await this.proof(password), ...(qrSecret ? { qrSecret } : {}) })
    if (typeof answer.customToken !== 'string' || !answer.customToken) throw new TwoStepFailure('malformed', 0, true)
    return { customToken: answer.customToken, sessionId: typeof answer.sessionId === 'string' && answer.sessionId ? answer.sessionId : null }
  }

  // verifyMorsePassword (Telegram account.getPasswordSettings, which takes the SRP answer): the current password,
  // checked and nothing else — no token, no new generation. It counts toward the locks like every answer.
  async verify(password: string): Promise<void> {
    const answer = await this.send('verifyMorsePassword', await this.proof(password))
    if (answer.ok !== true) throw new TwoStepFailure('malformed', 0, true)
  }

  // updateMorsePassword. The new verifier is made from the salts the server issued, which it checks (salt-stale).
  async enable(password: string, hint: string, sessionId: string): Promise<void> {
    const state = await this.state()
    if (state.enabled) throw new TwoStepFailure('password-on')
    await this.send('updateMorsePassword', { action: 'enable', sessionId, ...(hint.trim() ? { hint: hint.trim() } : {}), next: await this.next(password, state.issued) })
  }
  async change(current: string, password: string, hint: string, sessionId: string): Promise<void> {
    const state = await this.state()
    if (!state.enabled) throw new TwoStepFailure('password-off')
    const { A, M1 } = await srpProof(current, state.current.salt1, state.current.salt2, state.B)
    await this.send('updateMorsePassword', { action: 'change', sessionId, ...(hint.trim() ? { hint: hint.trim() } : {}),
      current: { srpId: state.srpId, A: toBytes(A).toString('hex'), M1: M1.toString('hex') }, next: await this.next(password, state.issued) })
  }
  async disable(current: string, sessionId: string): Promise<void> {
    await this.send('updateMorsePassword', { action: 'disable', sessionId, current: await this.proof(current) })
  }
  private async next(password: string, issued: Salts): Promise<{ salt1: string; salt2: string; v: string }> {
    const made = await newPasswordSettings(password, issued.salt1, issued.salt2)
    return { salt1: made.salt1.toString('hex'), salt2: made.salt2.toString('hex'), v: toBytes(made.v).toString('hex') }
  }

  // requestMorsePasswordReset: 'waiting' until resetAt; asked again after it, the password is off ('done'). A held QR
  // sign-in sends its attempt's secret, and 'done' names the session the server kept back for it (server 10-04).
  async requestReset(qrSecret?: string): Promise<{ state: 'none' | 'waiting' | 'done'; resetAt: number | null; sessionId: string | null }> {
    const answer = await this.send('requestMorsePasswordReset', qrSecret ? { qrSecret } : {})
    // Read strictly: an answer that names no known state is not «none» (which lets the sign-in go on without a password).
    if (answer.state !== 'none' && answer.state !== 'waiting' && answer.state !== 'done') throw new TwoStepFailure('malformed', 0, true)
    const state = answer.state
    const sessionId = typeof answer.sessionId === 'string' && /^[A-Za-z0-9_-]{8,128}$/.test(answer.sessionId) ? answer.sessionId : null
    return { state, resetAt: millis(answer.resetAt), sessionId }
  }
  // cancelMorsePasswordReset: true when a reset was waiting and is now cancelled.
  async cancelReset(): Promise<boolean> {
    const answer = await this.send('cancelMorsePasswordReset', {})
    return answer.cancelled === true
  }
}
