import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ChannelJoinDecisions } from '../../src/main/accounts/channel-join-decisions'
import { ChannelAccessEditor } from '../../src/main/accounts/channel-access-edit'
import { ChannelDiscussionJoin } from '../../src/main/accounts/channel-discussion-join'
import type { ReadCredentials } from '../../src/main/network/firestore-rpc'

// AccountSession.setConnection('ready') starts these reads with `void x.refresh().catch(() => {})`. A locked
// screen (or a sleeping Mac) makes `allowed` throw; that must reach the catch, not escape as an uncaught exception.
const credentials: ReadCredentials = { signal: new AbortController().signal, authorize: async () => { throw new Error('unused') } }
const locked = (): void => { throw new Error('계정 연결과 화면 잠금을 확인해 주세요.') }
const refreshers: Array<[string, () => { refresh(): Promise<void> }]> = [
  ['channel join decisions', () => new ChannelJoinDecisions('me', credentials, locked, () => {}, () => {}, async <T>() => null as T, () => {})],
  ['channel access', () => new ChannelAccessEditor('me', credentials, locked, () => { throw new Error('unused') }, async <T>() => null as T, () => {})],
  ['discussion join', () => new ChannelDiscussionJoin('me', credentials, locked, () => {}, async <T>() => null as T, () => {})]
]

for (const [name, make] of refreshers) {
  test(`${name}: refreshing while the screen is locked rejects instead of throwing`, async () => {
    const target = make()
    let result: Promise<void> | undefined
    assert.doesNotThrow(() => { result = target.refresh() })
    await assert.rejects(result!, /화면 잠금/)
  })
}
