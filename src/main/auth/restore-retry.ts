// A saved account whose connection failed on the network reconnects by itself, and keeps trying at the last wait
// for as long as it takes, as Telegram's connection never stops retrying (session_private.cpp: up to 64 s). When the
// network is back (network/reachability.ts) it does not wait at all (auth/domain.ts restoreNow).
const retryDelays = [5000, 15000, 45000, 120000]
export function restoreRetryDelay(attempt: number): number { return retryDelays[Math.min(attempt, retryDelays.length - 1)]! }
// B522: a restore the security check failed waits and tries again as well — the next try offers the account's own session
// first (controller.ts restore → useSession) and opens no check page in view — but only this many times, so a network
// where reCAPTCHA refuses is not asked again every two minutes. The network coming back or the computer waking starts the
// tries over (domain.ts restoreNow, resume); until then the account's line keeps its failure, as before.
export const proofRestoreTries = 4
export function restoreRetryKind(failure: string | null): 'network' | 'proof' | null {
  return failure === 'network' ? 'network' : failure === 'app-proof' || failure === 'app-proof-refused' ? 'proof' : null
}
