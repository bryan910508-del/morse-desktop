import type { FirestoreReader } from '../network/firestore-rpc'
import { documents, numberField, type FirestoreDocument } from '../network/firestore-values'

// A15-5 (§31, user «권장대로» 10-03 18:3x): the account no longer waits for the message server's socket, so what that
// socket's registration watched for this device is watched here, on Firestore, which carries where the socket does not
// (B95). talky-server index.js:559-566 ends a registration when the account document goes or says accountDeleted
// («account-unavailable»), when this sign-in's session document goes, asks to be revoked or names another sign-in
// («session-revoked»), and when this sign-in's generation is revoked (revokedAuthTimes — which the rules also make every
// read of this device refuse, firestore.rules v4.8.x :393). As with the socket (registration-outcome.ts, A5 §3-1), none
// of these signs out by itself: each only sends the account to ask startMorseDeviceSession, and only its
// «session-revoked» ends the sign-in. Telegram signs out on the server's AUTH_KEY_UNREGISTERED alone, whichever
// request it answers (tdesktop mtproto/mtp_instance.cpp, main/main_account.cpp).
export type SignInWord = 'fine' | 'account-unavailable' | 'session-revoked'

export function signInWord(account: FirestoreDocument | undefined, session: FirestoreDocument | undefined, authTime: number): SignInWord {
  if (!account || account.fields?.accountDeleted?.booleanValue === true) return 'account-unavailable'
  if (!session || session.fields?.revokeRequestedAt !== undefined) return 'session-revoked'
  let stored: number
  try { stored = numberField(session.fields ?? {}, 'authTime') } catch { return 'session-revoked' }
  return stored === authTime ? 'fine' : 'session-revoked'
}

// How long a watch that the server refused waits before it listens again.
export const signInWatchRetryMs = 60000

// Watches the account and this sign-in's session document for as long as `signal` lives; `ask` is told each time they
// say the sign-in may be gone, and when the reads are refused (a revoked generation).
export function watchSignIn(reader: FirestoreReader, uid: string, sessionId: string, authTime: number, signal: AbortSignal,
  ask: (reason: SignInWord | 'read-refused') => void): void {
  const account = `${documents}/users/${uid}`, session = `${account}/signInSessions/${sessionId}`
  const listen = (): void => {
    if (signal.aborted) return
    const stop = reader.watch({ documents: { documents: [account, session] } }, signal, {
      snapshot: found => { const word = signInWord(found.get(account), found.get(session), authTime); if (word !== 'fine') ask(word) },
      state: (state, error) => {
        if (state !== 'error') return
        if (error?.code === 'permission') ask('read-refused')
        stop()
        const again = setTimeout(listen, signInWatchRetryMs)
        signal.addEventListener('abort', () => clearTimeout(again), { once: true })
      },
      reconnecting: () => {}
    }, 2, 64 * 1024)
  }
  listen()
}
