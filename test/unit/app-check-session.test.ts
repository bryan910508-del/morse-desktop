import assert from 'node:assert/strict'
import { test } from 'node:test'
import { HostedWebAppProof, proofRetryDelay } from '../../src/main/auth/web-app-proof'
import { AuthenticationFailure, type AppCheckProof } from '../../src/main/auth/contracts'

// A16 (§33, B99 — a VPN exit's low reCAPTCHA score refused every exchange and the security check kept opening): a
// signed-in account proves the app through its session (getMorseDesktopAppCheckToken), the window in view is only for the
// sign-in, a failed exchange waits before the next, and a token in hand is used until it is about to run out.
const appId = '1:123713400904:web:test'
const token = (minutes = 60) => ['h', Buffer.from(JSON.stringify({ sub: appId, iss: 'https://firebaseappcheck.googleapis.com/123713400904',
  aud: ['projects/123713400904'], exp: Math.floor(Date.now() / 1000) + minutes * 60 })).toString('base64url'), 's'].join('.')
const proofOf = (minutes = 60): AppCheckProof => ({ token: token(minutes), expiresAt: Date.now() + minutes * 60000, appId })
const signal = () => new AbortController().signal
function provider(page: (visible: boolean) => Promise<AppCheckProof>) {
  const pages: boolean[] = []
  const proof = new HostedWebAppProof('https://morse-desktop-auth.web.app', appId, 'macOS', null, async (_signal, visible) => { pages.push(visible); return page(visible) })
  return { proof, pages }
}
const refused = () => Object.assign(new AuthenticationFailure('app-proof'), { proofStep: 'page-error' })

test('before any sign-in the page proves the app: hidden first, then the window in view', async () => {
  const { proof, pages } = provider(async visible => { if (!visible) throw refused(); return proofOf() })
  assert.equal((await proof.getProof(signal())).appId, appId)
  assert.deepEqual(pages, [false, true])
})

test('a signed-in account\'s session proves the app: no page, no window', async () => {
  const { proof, pages } = provider(async () => { throw new Error('page used') })
  let asked = 0
  proof.useSession('u1', async () => { asked++; return token() })
  assert.equal((await proof.getProof(signal())).appId, appId)
  assert.equal(asked, 1); assert.deepEqual(pages, [])
  assert.equal((await proof.getProof(signal())).appId, appId); assert.equal(asked, 1, 'the token in hand is reused')
})

test('signed in, a session that cannot ask leaves it to the hidden page only — never the window in view', async () => {
  const { proof, pages } = provider(async visible => { if (!visible) throw refused(); return proofOf() })
  proof.useSession('u1', async () => null)
  await assert.rejects(proof.getProof(signal()), AuthenticationFailure)
  assert.deepEqual(pages, [false], 'no window in view once signed in')
})

test('a failed exchange waits before the next, so the check is not opened again and again', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.now() })
  const { proof, pages } = provider(async () => { throw refused() })
  proof.useSession('u1', async () => { throw new AuthenticationFailure('network') })
  await assert.rejects(proof.getProof(signal()))
  assert.equal(pages.length, 1)
  await assert.rejects(proof.getProof(signal()), (error: unknown) => (error as { proofStep?: string }).proofStep === 'backoff')
  assert.equal(pages.length, 1, 'nothing was tried while waiting')
  t.mock.timers.tick(proofRetryDelay(1))
  await assert.rejects(proof.getProof(signal()))
  assert.equal(pages.length, 2, 'tried again once the wait was over')
  assert.deepEqual([1, 2, 3, 6, 9].map(proofRetryDelay), [2000, 4000, 8000, 60000, 60000])
  t.mock.timers.reset()
})

test('a token in hand is used until it is about to run out, whatever its renewal does', async () => {
  const { proof } = provider(async () => { throw refused() })
  let next: string | null = token(5)
  proof.useSession('u1', async () => { const value = next; next = null; if (!value) throw new AuthenticationFailure('network'); return value })
  const first = await proof.getProof(signal())
  // Five minutes left: the renewal runs behind (and fails), the token in hand still answers.
  await new Promise(resolve => setImmediate(resolve))
  assert.equal((await proof.getProof(signal())).token, first.token)
})

test('an account that leaves takes its session back', async () => {
  const { proof, pages } = provider(async () => proofOf())
  const stop = proof.useSession('u1', async () => token())
  assert.equal(proof.signedIn, true)
  stop()
  assert.equal(proof.signedIn, false)
  await proof.getProof(signal())
  assert.deepEqual(pages, [false], 'signed out: the page again')
})
