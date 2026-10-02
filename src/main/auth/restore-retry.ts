// A saved account whose connection failed on the network reconnects by itself, and keeps trying at the last wait
// for as long as it takes, as Telegram's connection never stops retrying (session_private.cpp: up to 64 s). When the
// network is back (network/reachability.ts) it does not wait at all (auth/domain.ts restoreNow).
const retryDelays = [5000, 15000, 45000, 120000]
export function restoreRetryDelay(attempt: number): number { return retryDelays[Math.min(attempt, retryDelays.length - 1)]! }
