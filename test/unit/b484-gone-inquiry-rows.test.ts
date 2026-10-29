import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { InquiryRows } from '../../src/main/accounts/inquiry-rows'
import { documents, type FirestoreDocument } from '../../src/main/network/firestore-values'
import { subscriberRowId } from '../../src/shared/channel-inquiries'

// B484 (Desktop side): a room deleted while this device was off or elsewhere takes what this device kept for its row —
// archive, pin, notifications, unread mark — as tdesktop's Session::deleteConversationLocally takes a chat's pin, folder
// and list entry with it (data_session.cpp:1699-1726). A subscriber's room is always <channel>_<uid>, so without this a
// room made again under that id inherited the old one's archive or pin.

const store = new Map<string, string>()
;(globalThis as unknown as { localStorage: unknown }).localStorage = {
  getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => { store.set(key, value) }, removeItem: (key: string) => { store.delete(key) }
}
let answer: { answered: boolean; gone: string[] } = { answered: false, gone: [] }
const asked: string[][] = []
;(globalThis as unknown as { window: unknown }).window = { morse: { goneInquiries: async (_uid: string, ids: string[]) => { asked.push(ids); return answer } } }

const room = (id: string): FirestoreDocument => ({ name: `${documents}/channelInquiries/${id}`, fields: {} } as unknown as FirestoreDocument)
function lists(reads: Record<string, 'there' | 'gone' | 'fails'>) {
  const rows = new InquiryRows('me', { signal: new AbortController().signal, authorize: async () => { throw new Error('unused') } } as never, () => {}, () => {})
  const inner = rows as unknown as { reader: unknown; answered: { subscriber: boolean; owner: boolean }; subscriber: Map<string, FirestoreDocument>; owner: Map<string, FirestoreDocument> }
  inner.reader = { getDocument: async (path: string) => {
    const id = path.slice(path.lastIndexOf('/') + 1), read = reads[id]
    if (read === 'fails') throw new Error('offline')
    return read === 'there' ? room(id) : null
  } }
  return { rows, inner }
}

test('gone is known only once both lists answered: listed rooms are not read, a missing room is gone, a pushed-out or unread one is not', async () => {
  const { rows, inner } = lists({ 'ch1_me': 'gone', 'ch2_me': 'there', 'ch3_me': 'fails' })
  assert.deepEqual(await rows.gone(['ch1_me']), { answered: false, gone: [] }, 'before the lists answer, nothing is gone')
  inner.answered = { subscriber: true, owner: false }
  assert.deepEqual(await rows.gone(['ch1_me']), { answered: false, gone: [] }, 'one list is not both')
  inner.answered = { subscriber: true, owner: true }
  inner.subscriber.set(`${documents}/channelInquiries/ch4_me`, room('ch4_me'))
  assert.deepEqual(await rows.gone(['ch1_me', 'ch2_me', 'ch3_me', 'ch4_me']), { answered: true, gone: ['ch1_me'] },
    'gone: read and not there; a room pushed out of a full list is there; a failed read knows nothing; a listed room is not read')
})

test('the row state of a gone room goes; owner folders and other rooms stay; a room made again under the id starts new', async () => {
  const { forgetInquiryRows, inquiryRowState, setInquiryRowState, storedSubscriberRooms } = await import('../../src/renderer/src/dialogs/inquiry-row-state')
  setInquiryRowState('me', subscriberRowId('ch1_me'), { archived: true, pinned: true, muted: true, unread: true })
  setInquiryRowState('me', subscriberRowId('ch2_me'), { muted: true })
  setInquiryRowState('me', 'owner_ch9', { pinned: true })
  assert.deepEqual(storedSubscriberRooms('me').sort(), ['ch1_me', 'ch2_me'], 'only the asking side\'s rooms')
  forgetInquiryRows('me', [subscriberRowId('ch1_me')])
  assert.deepEqual(inquiryRowState('me', subscriberRowId('ch1_me')), { muted: false, pinned: false, unread: false, archived: false, pinnedAt: 0 }, 'the same id is a new room')
  assert.equal(inquiryRowState('me', subscriberRowId('ch2_me')).muted, true)
  assert.equal(inquiryRowState('me', 'owner_ch9').pinned, true)
  assert.ok(!store.get('morse.inquiryRows.me')!.includes('sub_inq_ch1_me'), 'gone from the device too')
})

test('the window asks about rooms it keeps state for and the lists do not show, once per run, again when the lists had not answered', async () => {
  const { forgetGoneInquiryRows } = await import('../../src/renderer/src/dialogs/gone-inquiry-rows')
  const { inquiryRowState, setInquiryRowState } = await import('../../src/renderer/src/dialogs/inquiry-row-state')
  setInquiryRowState('u2', subscriberRowId('a_u2'), { archived: true })
  setInquiryRowState('u2', subscriberRowId('b_u2'), { pinned: true })
  asked.length = 0
  await forgetGoneInquiryRows('u2', [{ kind: 'subscriber', inquiryId: 'b_u2' }])
  assert.deepEqual(asked, [['a_u2']], 'a listed room is not asked about')
  answer = { answered: false, gone: [] }
  await forgetGoneInquiryRows('u2', [{ kind: 'subscriber', inquiryId: 'b_u2' }])
  assert.equal(asked.length, 2, 'the lists had not answered: asked again')
  answer = { answered: true, gone: ['a_u2'] }
  await forgetGoneInquiryRows('u2', [{ kind: 'subscriber', inquiryId: 'b_u2' }])
  assert.equal(inquiryRowState('u2', subscriberRowId('a_u2')).archived, false, 'gone: its archive went')
  assert.equal(inquiryRowState('u2', subscriberRowId('b_u2')).pinned, true)
  const before = asked.length
  setInquiryRowState('u2', subscriberRowId('c_u2'), { muted: true }); answer = { answered: true, gone: [] }
  await forgetGoneInquiryRows('u2', [])
  await forgetGoneInquiryRows('u2', [])
  assert.equal(asked.length, before + 1, 'a room the server still has is asked once in a run')
})

test('this device\'s delete takes the row state once the delete is done; the gone check runs with the list', () => {
  const read = (path: string) => readFileSync(join(__dirname, '../../src', path), 'utf8')
  const remove = read('renderer/src/channels/inquiry-delete.ts'), widget = read('renderer/src/dialogs/dialogs-widget.tsx'), main = read('main/index.ts')
  assert.match(remove, /if \(result === 'done'\) forgetInquiryRows\(accountUid, \[subscriberRowId\(inquiryId\)\]\)/)
  assert.match(widget, /useGoneInquiryRows\(accountUid, inquiryRows\)/)
  assert.match(main, /handle\('gone-inquiries', \(uid, raw\) => \{/)
  assert.match(main, /inquiryRows\.gone\(raw\.map\(inquiryIdentifier\)\)/)
})
