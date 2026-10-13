import assert from 'node:assert/strict'
import { test } from 'node:test'
import { translationAvailable, translationRoute, translationTarget, serverTranslationBatch } from '../../src/shared/translation'
import { featureOn } from '../../src/main/api/feature-switch'
import { ServerTranslator } from '../../src/main/messaging/server-translation'
import { MorseCallableFailure } from '../../src/main/network/morse-callable'
import type { FirestoreDocument, WireObject } from '../../src/main/network/firestore-values'
import type { ChatMessage } from '../../src/shared/model'

// B343 (contracts/B343-server-translation.md): where this device cannot translate, the server does — while its switch
// is on — as tdesktop picks the platform's translation and else the server's (lang/translate_provider.cpp:34-46,
// v7.3.0 42f8a36d; v7.3.1 changes no translation file).

test('one place picks the route: this device, else the server while its switch is on, else none', () => {
  assert.equal(translationRoute(true, false), 'device')
  assert.equal(translationRoute(true, true), 'device', 'this Mac first, as tdesktop prefers the platform\'s')
  assert.equal(translationRoute(false, true), 'server')
  assert.equal(translationRoute(false, false), 'none')
  assert.equal(translationRoute(true, false, 'server'), 'server', 'a development run may pin it')
  assert.equal(translationRoute(false, true, 'nonsense'), 'server', 'an unknown pin is ignored')
  assert.deepEqual((['device', 'server', 'none'] as const).map(translationAvailable), [true, true, false])
  assert.equal(translationAvailable(undefined), false)
})

test('the switch is the server\'s decision: for everyone or for this account; none, or nothing read, is off', () => {
  const doc = (fields: Record<string, WireObject>) => ({ name: 'x', fields } as unknown as FirestoreDocument)
  assert.equal(featureOn('server_translation', null, null), false)
  assert.equal(featureOn('server_translation', doc({ enabled: { booleanValue: true } }), null), true)
  assert.equal(featureOn('server_translation', doc({}), doc({ serverTranslation: { booleanValue: true } })), true)
  assert.equal(featureOn('server_translation', doc({ enabled: { booleanValue: false } }), doc({ stickerReferenceSend: { booleanValue: true } })), false, 'another switch is not this one')
})

function rig(answer: (data: Record<string, unknown>, call: number) => Promise<Record<string, unknown>>) {
  const requests: Record<string, unknown>[] = []
  const translator = new ServerTranslator('RAk6me', async (name, data) => {
    assert.equal(name, 'translateMorseMessages')
    requests.push(data)
    return answer(data, requests.length)
  })
  return { translator, requests }
}
const translated = (data: Record<string, unknown>) => ({ results: (data.messageIds as string[]).map(messageId => ({ messageId, status: 'translated', text: `T:${messageId}` })) })
const items = (count: number, prefix = 'm') => Array.from({ length: count }, (_, i) => ({ id: `${prefix}${i}`, text: `hello ${i}` }))

test('the server is asked by message id, up to 20 at once, into this window\'s language, for this account', async () => {
  const { translator, requests } = rig(async data => translated(data))
  const results = await translator.translate('chat1', items(45))
  assert.deepEqual(requests.map(request => (request.messageIds as string[]).length), [20, 20, 5])
  assert.deepEqual(Object.keys(requests[0]!).sort(), ['expectedUid', 'kind', 'messageIds', 'roomId', 'target'], 'no text goes up: the server reads the messages')
  assert.deepEqual([requests[0]!.kind, requests[0]!.roomId, requests[0]!.target, requests[0]!.expectedUid], ['chat', 'chat1', translationTarget(), 'RAk6me'])
  assert.equal(serverTranslationBatch, 20)
  assert.deepEqual(results.get('m44'), { status: 'translated', text: 'T:m44' })
})

test('each message keeps its own answer; translations and «same language» are kept, a failure is asked again', async () => {
  const { translator, requests } = rig(async () => ({ results: [{ messageId: 'a', status: 'translated', text: '안녕' }, { messageId: 'b', status: 'same-language' }, { messageId: 'c', status: 'failed' }] }))
  const first = await translator.translate('chat1', [{ id: 'a', text: 'hi' }, { id: 'b', text: '안녕' }, { id: 'c', text: 'x' }, { id: 'd', text: 'missing' }])
  assert.deepEqual([first.get('a'), first.get('b'), first.get('c'), first.get('d')], [{ status: 'translated', text: '안녕' }, { status: 'same-language' }, { status: 'failed' }, { status: 'failed' }])
  await translator.translate('chat1', [{ id: 'a', text: 'hi' }, { id: 'b', text: '안녕' }, { id: 'c', text: 'x' }])
  assert.deepEqual(requests[1]!.messageIds, ['c'], 'only the failed one goes again')
  await translator.translate('chat1', [{ id: 'a', text: 'hi, edited' }])
  assert.deepEqual(requests[2]!.messageIds, ['a'], 'an edited message is asked again')
})

test('the account\'s rate (RATE_LIMITED) answers every message still waiting so; other refusals are failures', async () => {
  const limited = rig(async (data, call) => { if (call === 2) throw new MorseCallableFailure('answered', 'RESOURCE_EXHAUSTED', 'RATE_LIMITED'); return translated(data) })
  const results = await limited.translator.translate('chat1', items(50))
  assert.equal(limited.requests.length, 2, 'no request after the refusal')
  assert.equal(results.get('m0')!.status, 'translated')
  assert.deepEqual([results.get('m20')!.status, results.get('m49')!.status], ['rate-limited', 'rate-limited'])
  for (const failure of [new MorseCallableFailure('answered', 'NOT_FOUND'), new MorseCallableFailure('not-sent', 'UNAVAILABLE')]) {
    const other = rig(async () => { throw failure })
    assert.equal((await other.translator.translate('chat1', items(1))).get('m0')!.status, 'failed')
  }
})

// «전체번역» on the server's route, in the window.
const calls: string[][] = []
let answer: (ids: string[]) => Record<string, unknown> = ids => Object.fromEntries(ids.map(id => [id, { status: 'translated', text: `T:${id}` }]))
;(globalThis as unknown as { window: unknown }).window = { morse: {
  translateMessages: async (_uid: string, _chat: string, ids: string[]) => { calls.push(ids); return answer(ids) },
  translationGate: async () => { throw new Error('the server route asks no gate') },
  translateMessage: async () => { throw new Error('the server route asks once for many') }
} }
const message = (id: string): ChatMessage => ({ id, chatId: 'chat1', senderId: 'peer', kind: 'text', text: `hello ${id}` } as unknown as ChatMessage)
const settle = () => new Promise(resolve => setTimeout(resolve, 20))

test('on the server\'s route «전체번역» asks for the messages on screen together, 20 at a time, and stops at the rate', async () => {
  const translations = await import('../../src/renderer/src/app/translations')
  translations.resetAutoTranslation()
  translations.autoTranslate('acc', 'chat1', Array.from({ length: 25 }, (_, i) => message(`s${i}`)), true)
  await settle()
  assert.deepEqual(calls.map(ids => ids.length), [20, 5])
  assert.ok(translations.translationShown('acc', 'chat1', 's24', 'hello s24', true))
  translations.autoTranslate('acc', 'chat1', [message('s3')], true)
  await settle()
  assert.equal(calls.length, 2, 'a translated message is not asked again')
  calls.length = 0
  answer = ids => Object.fromEntries(ids.map(id => [id, { status: 'rate-limited' }]))
  translations.autoTranslate('acc', 'chat2', [message('r1')], true)
  await settle()
  translations.autoTranslate('acc', 'chat2', [message('r2')], true)
  await settle()
  assert.deepEqual(calls, [['r1']], 'that room is not asked again after its rate')
})
