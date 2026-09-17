// Sign in with Apple for the web. The Services ID is configured with the Firebase handler as its
// only Return URL; Apple posts the result there and the sign-in window reads it before it leaves the app.
export const appleServicesId = 'com.kimbryan.talky.signin'
export const appleReturnURL = 'https://talky-a38c3.firebaseapp.com/__/auth/handler'

export interface AppleIdentity { idToken: string; rawNonce: string }
export type AppleAnswer = { kind: 'token'; idToken: string } | { kind: 'cancelled' } | { kind: 'failed'; step: 'apple-error' | 'invalid-response'; detail: string }

// The form Apple posts to the Return URL (response_mode=form_post): state, code, id_token and, the
// first time, user; or state and error.
export function appleAnswer(body: Buffer | null, state: string): AppleAnswer {
  if (!body || body.byteLength > 65536) return { kind: 'failed', step: 'invalid-response', detail: 'no form' }
  const fields = new URLSearchParams(body.toString('utf8'))
  if (fields.get('state') !== state) return { kind: 'failed', step: 'invalid-response', detail: 'state' }
  const error = fields.get('error')
  if (error === 'user_cancelled_authorize') return { kind: 'cancelled' }
  if (error) return { kind: 'failed', step: 'apple-error', detail: error.replace(/[^a-z_]/g, '').slice(0, 40) }
  const idToken = fields.get('id_token')
  if (!idToken || idToken.length > 16384 || idToken.split('.').length !== 3) return { kind: 'failed', step: 'invalid-response', detail: 'token' }
  return { kind: 'token', idToken }
}
