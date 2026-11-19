import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { DeferredMessages, type DeferredCheck } from '../../src/main/accounts/deferred-messages'
import { documents, type FirestoreDocument } from '../../src/main/network/firestore-values'
import type { FirestoreReader } from '../../src/main/network/firestore-rpc'
import en from '../../src/shared/i18n/en.json'
import ru from '../../src/shared/i18n/ru.json'

// N-36 (contracts/N-36-scheduled-messages-list.md): the queued messages of a room — three states, cancel and retry.
type Snapshot = (rows: Map<string, FirestoreDocument>) => void
function setup() {
  const listeners: Record<string, Snapshot> = {}
  const reader = { watch: (target: { query: { structuredQuery: { from: { collectionId: string }[] } } }, _signal: AbortSignal, handlers: { snapshot: Snapshot }) => {
    listeners[target.query.structuredQuery.from[0]!.collectionId] = handlers.snapshot; return () => {}
  } } as unknown as FirestoreReader
  let changes = 0
  const deferred = new DeferredMessages('me', new AbortController().signal, () => { changes++ })
  deferred.bind('chat1', reader)
  const queue = (collection: string, id: string, status: string, at?: number): void => {
    const name = `${documents}/${collection}/${id}`
    listeners[collection]!(new Map([[name, { name, fields: { senderId: { stringValue: 'me' }, chatId: { stringValue: 'chat1' }, status: { stringValue: status },
      text: { stringValue: `line ${id}\nmore` }, ...(at ? { scheduledAt: { timestampValue: new Date(at).toISOString() } } : {}) } } as unknown as FirestoreDocument]]))
  }
  const items = () => deferred.snapshot('chat1')!.items.map(item => `${item.kind}:${item.id}:${item.status}:${item.retry ? 'retry' : '-'}`)
  return { deferred, queue, items, changes: () => changes }
}
const entry = (id: string) => ({ chatId: 'chat1', kind: 'scheduled' as const, id, text: 'hello', scheduledAt: Date.now() + 3600_000, fields: {} })
const writeError = (code: number, uncertain: boolean) => Object.assign(new Error('write'), { code, uncertain })
const check = (over: Partial<DeferredCheck> & { log?: string[] }): DeferredCheck => {
  const log = over.log ?? []
  return { queued: over.queued ?? (async () => false), outcome: over.outcome ?? (async () => null),
    create: over.create ?? (async () => { log.push('create') }), remove: over.remove ?? (async () => { log.push('remove') }) }
}

test('§1-3: the server queue shows «대기 중» and «보내지 못했어요»; a server failure is never sent again under its id', () => {
  const { queue, items } = setup()
  queue('scheduledMessages', 'A', 'pending', Date.now() + 60_000)
  queue('pendingOnlineMessages', 'B', 'failed')
  assert.deepEqual(items(), ['scheduled:A:waiting:-', 'online:B:failed:-'])
  queue('pendingOnlineMessages', 'B', 'sent')
  assert.deepEqual(items(), ['scheduled:A:waiting:-'], 'finished ones are not listed (§1-2)')
})

test('§1-3: a send on its way is «확인 중»; once the server answers it is gone, and the server\'s row takes its place', async () => {
  const { deferred, queue, items } = setup()
  let land!: () => void
  const sending = deferred.submit(entry('C'), () => new Promise<void>(resolve => { land = resolve }), async () => {})
  assert.deepEqual(items(), ['scheduled:C:checking:-'], 'no retry while it is still on its way')
  queue('scheduledMessages', 'C', 'pending')
  assert.deepEqual(items(), ['scheduled:C:waiting:-'], 'the queue\'s own row, not two')
  land(); await sending
  assert.equal(deferred.localEntry('chat1', 'scheduled', 'C'), null)
})

test('§1-3: a lost answer stays «확인 중» with «다시 시도»; a definite refusal leaves no row (the composer keeps the text)', async () => {
  const { deferred, items } = setup()
  await assert.rejects(deferred.submit(entry('D'), async () => { throw writeError(14, true) }, async () => {}))
  assert.deepEqual(items(), ['scheduled:D:checking:retry'])
  await assert.rejects(deferred.submit(entry('E'), async () => { throw writeError(7, false) }, async () => {}))
  assert.deepEqual(items(), ['scheduled:D:checking:retry'])
})

test('§1-4: «다시 시도» asks the queue and the outcome first, then writes the same id once', async () => {
  const run = async (over: Partial<DeferredCheck>, log: string[] = []) => {
    const { deferred, items } = setup()
    await assert.rejects(deferred.submit(entry('F'), async () => { throw writeError(4, true) }, async () => {}))
    const result = await deferred.retry('chat1', 'scheduled', 'F', check({ ...over, log })).then(() => 'ok', (error: Error & { code?: number }) => `error ${error.code}`)
    return { result, items: items(), log }
  }
  assert.deepEqual(await run({ queued: async () => true }), { result: 'ok', items: [], log: [] }, 'already in the queue: nothing written')
  assert.deepEqual(await run({ outcome: async () => 'sent' }), { result: 'ok', items: [], log: [] }, 'already sent: nothing written')
  assert.deepEqual(await run({ outcome: async () => 'rejected' }), { result: 'ok', items: ['scheduled:F:failed:-'], log: [] }, 'refused by the server: cancel only')
  assert.deepEqual(await run({}), { result: 'ok', items: [], log: ['create'] }, 'not there: written again')
  assert.deepEqual(await run({ create: async () => { throw writeError(9, false) } }), { result: 'ok', items: [], log: [] }, 'exists=false refused: the first try landed')
  assert.deepEqual(await run({ create: async () => { throw writeError(7, false) } }), { result: 'error 7', items: ['scheduled:F:failed:retry'], log: [] }, 'a refusal now: «보내지 못했어요» with retry')
  assert.deepEqual(await run({ create: async () => { throw writeError(14, true) } }), { result: 'error 14', items: ['scheduled:F:checking:retry'], log: [] })
})

test('§4: «취소» of a row the server does not show — on its way, it is taken back once it lands; unknown, it is deleted if there', async () => {
  const { deferred, items } = setup()
  let land!: () => void
  const removed: string[] = []
  const sending = deferred.submit(entry('G'), () => new Promise<void>(resolve => { land = resolve }), async () => { removed.push('G') })
  await deferred.cancelLocal('chat1', 'scheduled', 'G', async () => { removed.push('now') })
  assert.deepEqual(items(), [], 'the row leaves at once')
  land(); await sending
  assert.deepEqual(removed, ['G'], 'deleted after it landed, not before')
  await assert.rejects(deferred.submit(entry('H'), async () => { throw writeError(4, true) }, async () => {}))
  await deferred.cancelLocal('chat1', 'scheduled', 'H', async () => { throw writeError(9, false) })
  assert.deepEqual(items(), [], 'nothing there to delete is fine')
})

// Review 16:1x: the three cases, each on its own.
test('review: a row the server refused has no «다시 시도» — whether the queue says failed or the outcome says rejected', async () => {
  const { deferred, queue, items } = setup()
  queue('scheduledMessages', 'R', 'failed')
  assert.deepEqual(items(), ['scheduled:R:failed:-'])
  await assert.rejects(deferred.submit(entry('S'), async () => { throw writeError(4, true) }, async () => {}))
  await deferred.retry('chat1', 'scheduled', 'S', check({ outcome: async () => 'rejected' }))
  assert.deepEqual(items(), ['scheduled:S:failed:-', 'scheduled:R:failed:-'], 'a timed one first')
  await assert.rejects(deferred.retry('chat1', 'scheduled', 'S', check({})), /not retryable/, 'and it cannot be tried again')
})
test('review: «다시 시도» of a lost answer writes the same id, with the fields it was first sent with', async () => {
  const { deferred } = setup()
  const fields = { messageId: { stringValue: 'T' }, text: { stringValue: 'hello' } }
  await assert.rejects(deferred.submit({ ...entry('T'), fields }, async () => { throw writeError(4, true) }, async () => {}))
  assert.deepEqual(deferred.localEntry('chat1', 'scheduled', 'T')?.fields, fields)
  const session = readFileSync('src/main/accounts/session.ts', 'utf8')
  const retry = session.slice(session.indexOf('  async retryDeferred('), session.indexOf('  private pinLimit('))
  assert.match(retry, /create: \(\) => reader\.createDeferredMessage\(collection, messageId, entry\.fields, signal\)/, 'the same id and fields')
  assert.match(session, /async createDeferredMessage|createDeferredMessage\(collection, request\.messageId, fields/)
  assert.match(retry, /recordDeferredStep\('retry-failed', `\$\{kind\} grpc-\$\{failure\.code \?\? 0\}`\)/, 'the log keeps the code only, never the detail')
  assert.doesNotMatch(session.slice(session.indexOf('  async sendDeferred('), session.indexOf('  private pinLimit(')), /recordDeferredStep\([^)]*detail/, 'nor does the first send')
  const rpc = readFileSync('src/main/network/firestore-rpc.ts', 'utf8')
  assert.match(rpc, /createDeferredMessage[^]*?currentDocument: \{ exists: false \}/, 'a second write of the same id never replaces the first')
})
test('review: a lost answer that did land turns into «대기 중» as soon as the queue shows it', async () => {
  const { deferred, queue, items } = setup()
  await assert.rejects(deferred.submit(entry('U'), async () => { throw writeError(4, true) }, async () => {}))
  assert.deepEqual(items(), ['scheduled:U:checking:retry'])
  queue('scheduledMessages', 'U', 'pending')
  assert.deepEqual(items(), ['scheduled:U:waiting:-'], 'one row, the server\'s, with no retry')
})

// The window, by its source.
test('§1-1: a clock in the composer, only while nothing is typed and nothing is edited; the bar under the header is gone', () => {
  const compose = readFileSync('src/renderer/src/history/compose.tsx', 'utf8')
  assert.match(compose, /\{!hasText && !editing && dialog && !secret && <DeferredButton items=\{deferredItems\}/)
  assert.ok(compose.indexOf('<DeferredButton') < compose.indexOf('compose-entities'), 'inside the field\'s row, before the emoji button')
  const widget = readFileSync('src/renderer/src/history/history-widget.tsx', 'utf8')
  assert.doesNotMatch(widget, /DeferredBar/)
  const inquiry = readFileSync('src/renderer/src/channels/channel-inquiry-panel.tsx', 'utf8')
  assert.match(inquiry, /\{!text\.trim\(\) && <DeferredButton items=\{thread\?\.scheduled \?\? noScheduled\}/)
  assert.doesNotMatch(inquiry, /DeferredItemsBar/)
  const send = readFileSync('src/renderer/src/history/deferred-send.tsx', 'utf8')
  assert.match(send, /const failed = items\.some\(item => item\.status === 'failed'\)/)
  assert.match(send, /\{failed && <span className="compose-deferred-dot"/, 'a dot for a message that could not be sent')
  assert.match(send, /\{item\.retry && actions\.retry && <button/, 'retry only where the state allows it')
  assert.match(send, /if \(!await confirmBox\(\{ title: tr\('예약된 메시지'\), text: tr\('아직 대기 중인 메시지만 취소할 수 있어요\. 이미 보냈다면 취소로 지워지지 않아요\.'\)/, 'cancel asks once')
})

test('§3: the words, in all three tables', () => {
  for (const key of ['예약된 메시지', '예약된 메시지가 없어요', '예약 전송', '대기 중', '확인 중', '보내지 못했어요', '취소', '다시 시도',
    '아직 대기 중인 메시지만 취소할 수 있어요. 이미 보냈다면 취소로 지워지지 않아요.', '예약이 취소됐어요', '예약을 취소하지 못했어요', '{0} 예약', '상대가 접속하면 전송'])
    assert.ok(key in en && key in ru, key)
  assert.equal((en as Record<string, string>)['{0} 예약'], 'Scheduled for {0}')
})

test('§3-1: en is the same in all three apps (TI form, US spelling); ru keeps its words; «Retry» elsewhere stays', () => {
  const table = en as Record<string, string>, rus = ru as Record<string, string>
  const words: [string, string][] = [['예약된 메시지', 'Scheduled Messages'], ['예약된 메시지가 없어요', 'No scheduled messages'], ['{0} 예약', 'Scheduled for {0}'],
    ['상대가 접속하면 전송', 'When they come online'], ['대기 중', 'Waiting'], ['확인 중', 'Checking'], ['보내지 못했어요', 'Not sent'],
    ['취소', 'Cancel'], ['다시 시도\u0004deferred', 'Try Again'], ['닫기', 'Close'],
    ['아직 대기 중인 메시지만 취소할 수 있어요. 이미 보냈다면 취소로 지워지지 않아요.', 'Only messages that are still waiting can be canceled. If it was already sent, canceling won\'t remove it.'],
    ['예약이 취소됐어요', 'Scheduled message canceled'], ['예약을 취소하지 못했어요', 'Couldn\'t cancel the scheduled message']]
  for (const [key, value] of words) assert.equal(table[key], value, key)
  assert.equal(table['다시 시도'], 'Retry', 'the other screens\' retry is not this one')
  assert.equal(rus['다시 시도\u0004deferred'], rus['다시 시도'])
  const send = readFileSync('src/renderer/src/history/deferred-send.tsx', 'utf8')
  assert.match(send, /\{tr\('다시 시도', \[\], 'deferred'\)\}/)
})
