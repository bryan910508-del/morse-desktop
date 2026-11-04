import { MorseCallableFailure } from '../network/morse-callable'
import { TwoStepFailure } from './two-step'
import { twoStepReasonText, type DeleteAccountOutcome } from '../../shared/two-step'
import { tr } from '../../shared/i18n'

// B525 (contract B525-in-app-delete-2fa §3, §9): the account's own deletion carries its two-step password's SRP answer
// when it has one, as Telegram's does (Telegram-iOS TelegramEngineAuth.swift:104-134 deleteAccount(reason:password:);
// tdesktop boxes/self_destruction_box.cpp:58-73 MTPaccount_DeleteAccount with f_password). The screen checked the
// password first (verifyMorsePassword) and the person confirmed after; that check has answered, so the answer here comes
// from a fresh one. Every request says this build can send the password (twoStepCapable), with a password or without.
export interface PasswordAnswer { srpId: string; A: string; M1: string }
// The refusals the screen acts on (morse-two-step.js webDeletePassword with the session's generation): asked for the
// password (turned on meanwhile), a wrong one, a lock, too many checks — each back to the password step with its words.
const passwordRefusals = new Set(['password-needed', 'password-wrong', 'password-flood', 'rate-limited', 'check-expired'])

export async function deleteOwnAccount(uid: string, password: string | null, prove: (password: string) => Promise<PasswordAnswer | null>,
  send: (data: Record<string, unknown>) => Promise<Record<string, unknown>>): Promise<DeleteAccountOutcome> {
  // A check that ran out between its making and its answer is made again once (contract §9), never more.
  for (let attempt = 0; ; attempt++) {
    let answer: PasswordAnswer | null = null
    try { answer = password ? await prove(password) : null }
    catch (error) {
      if (error instanceof TwoStepFailure) return { ok: false, reason: error.reason, message: error.message }
      throw new Error(tr('계정을 삭제하지 못했습니다. 연결을 확인한 뒤 다시 시도해 주세요.'))
    }
    let result: Record<string, unknown>
    try { result = await send({ expectedUid: uid, twoStepCapable: true, ...(answer ? { password: answer } : {}) }) }
    catch (error) {
      if (!(error instanceof MorseCallableFailure)) throw new Error(tr('계정을 삭제하지 못했습니다. 연결을 확인한 뒤 다시 시도해 주세요.'))
      if (error.delivery === 'answered' && passwordRefusals.has(error.reason)) {
        if (error.reason === 'check-expired' && password && attempt === 0) continue
        return { ok: false, reason: error.reason,
          message: error.reason === 'password-needed' ? tr('계정을 삭제하려면 2단계 인증 비밀번호를 입력해 주세요.') : twoStepReasonText(error.reason, error.retryAfterSec) }
      }
      throw new Error(error.delivery === 'not-sent' ? tr('계정을 삭제하지 못했습니다. 연결을 확인한 뒤 다시 시도해 주세요.')
        : error.delivery === 'unknown' ? tr('계정 삭제 결과를 확인하지 못했습니다.') : tr('계정을 삭제하지 못했습니다.'))
    }
    if (result.ok !== true || result.deletedUid !== uid) throw new Error(tr('계정 삭제 결과를 확인하지 못했습니다.'))
    return { ok: true }
  }
}
