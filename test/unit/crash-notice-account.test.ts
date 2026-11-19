import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { accountSettled, CrashNotice, crashNoticeWait, type CrashNoticeAction } from '../../src/renderer/src/app/crash-notice'

// 0.241.53 pre-release line 3 (reports/desktop/2026-11-06-0.241.53-prerelease.md §3, review 18:4x (가)): the crash notice
// waits for the account state, so a signed-in person gets «문제 보고» (F-ST-004 §7-1 2, R12); at most 10 s.
const tick = () => new Promise(resolve => setImmediate(resolve))
function notice(crashed = true) {
  let uid: string | null = null, asks = 0
  const shown: CrashNoticeAction[] = []
  const n = new CrashNotice(async () => { asks++; return crashed }, () => uid, action => { shown.push(action) })
  return { n, shown, setUid: (value: string | null) => { uid = value }, asks: () => asks }
}

test('signed in, restore slow: nothing until the account is open, then «문제 보고»', async () => {
  const { n, shown, setUid, asks } = notice()
  const restoring = { activeAccountUid: null, authentication: { starting: true }, accountStates: [{ phase: 'restoring' as const }] }
  n.update({ ready: true, settled: accountSettled(restoring), expired: false }); await tick()
  assert.deepEqual([asks(), shown], [0, []], 'main is not asked yet — its answer is true only once')
  const connecting = { activeAccountUid: null, authentication: { starting: false }, accountStates: [{ phase: 'connecting' as const }] }
  n.update({ ready: true, settled: accountSettled(connecting), expired: false }); await tick()
  assert.equal(asks(), 0)
  setUid('JvKU…'); n.update({ ready: true, settled: accountSettled({ activeAccountUid: 'JvKU…' }), expired: false }); await tick()
  assert.deepEqual([asks(), shown], [1, ['report']])
})

test('signed out: once no saved account is coming back, «기록 폴더 열기» at once', async () => {
  const { n, shown } = notice()
  assert.equal(accountSettled({ activeAccountUid: null, authentication: { starting: false }, accountStates: [] }), true)
  assert.equal(accountSettled({ activeAccountUid: null, authentication: { starting: false }, accountStates: [{ phase: 'signed-out' }] }), true)
  n.update({ ready: true, settled: true, expired: false }); await tick()
  assert.deepEqual(shown, ['logs'])
})

test('past the limit with the account still not known: the notice is not lost — «기록 폴더 열기»', async () => {
  const { n, shown } = notice()
  n.update({ ready: true, settled: false, expired: true }); await tick()
  assert.deepEqual(shown, ['logs'])
  assert.equal(crashNoticeWait, 10000)
})

test('once only: later changes ask nothing more; no crash shows nothing; not before the window has its state', async () => {
  const one = notice()
  one.n.update({ ready: false, settled: true, expired: true }); await tick()
  assert.equal(one.asks(), 0, 'not before the first state')
  one.setUid('JvKU…'); one.n.update({ ready: true, settled: true, expired: false }); await tick()
  one.n.update({ ready: true, settled: true, expired: true }); await tick()
  assert.deepEqual([one.asks(), one.shown], [1, ['report']])
  const none = notice(false)
  none.n.update({ ready: true, settled: true, expired: false }); await tick()
  assert.deepEqual([none.asks(), none.shown], [1, []])
})

test('the window wires it: settled from the snapshot, a 10 s limit from the first state, the same two buttons', () => {
  const main = readFileSync('src/renderer/src/main.tsx', 'utf8')
  assert.match(main, /const settled = useDesktop\(snapshot => accountSettled\(snapshot\)\)/)
  assert.match(main, /setTimeout\(\(\) => setExpired\(true\), crashNoticeWait\)/)
  assert.match(main, /crashNotice\.current\?\.update\(\{ ready, settled, expired \}\)/)
  assert.doesNotMatch(main, /if \(!ready\) return\n    void window\.morse\.takeCrashNotice\(\)/, 'no longer asked at the first state')
  assert.match(main, /label: tr\('문제 보고'\)/); assert.match(main, /label: tr\('기록 폴더 열기'\)/)
})
