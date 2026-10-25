import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { notesListPreview } from '../../src/shared/space-notes'
import { SpaceNotesReader } from '../../src/main/accounts/space-notes'
import { FirestoreReader } from '../../src/main/network/firestore-rpc'
import { documents, type FirestoreDocument } from '../../src/main/network/firestore-values'

// B503 (three-app model, review 10-26 02:1x): the chat list's «노트» row has Telegram's Saved Messages menu — open, pin or
// unpin, never archive (tdesktop window_peer_menu.cpp:544-, :1906-, :4674-4676). Its pin is this device's (iOS
// memoPinned_<uid>, pinned by default, pinnedAt from the moment it is pinned again), and unpinned it stands among the
// chats by its first note (iOS MorseChatListDialogProvider :516-528, MorseNotesListPreview, SpaceNote.sortedForDisplay).

const store = new Map<string, string>()
;(globalThis as unknown as { localStorage: unknown }).localStorage = {
  getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => { store.set(key, value) }, removeItem: (key: string) => { store.delete(key) }
}
let served: unknown = null
;(globalThis as unknown as { window: unknown }).window = { morse: { spaceNotesPreview: async () => served } }

const at = (seconds: number) => ({ seconds, nanoseconds: 0 })
test('the row\'s note is the first in the notes\' own order: a pinned note, else the newest; none, nothing', () => {
  const note = (title: string, seconds: number, pinned: boolean | null = false) => ({ title, preview: `${title} body`, updated: at(seconds), pinned })
  assert.equal(notesListPreview([note('old', 1), note('new', 9)])!.line, 'new')
  assert.equal(notesListPreview([note('new', 9), note('kept', 1, true)])!.line, 'kept', 'a pinned note comes first, as in the notes list')
  assert.equal(notesListPreview([{ ...note('', 5), preview: 'only body' }])!.line, 'only body', 'a note with no title shows its words')
  assert.equal(notesListPreview([]), null)
})

test('the row is pinned until unpinned here, below the other pins until it has a time; unpinned it keeps no time', async () => {
  const { notesRowState, setNotesPinned, setNotesPinnedAt } = await import('../../src/renderer/src/dialogs/notes-row-state')
  assert.deepEqual(notesRowState('u1'), { pinned: true, pinnedAt: 0, at: null, line: '' }, 'the ordinary state: pinned, no time')
  setNotesPinned('u1', false)
  assert.deepEqual([notesRowState('u1').pinned, notesRowState('u1').pinnedAt], [false, 0])
  assert.equal(store.get('morse.notesRow.u1'), JSON.stringify({ pinned: false }), 'kept on this device')
  setNotesPinnedAt('u1', 77)
  assert.equal(notesRowState('u1').pinnedAt, 0, 'an unpinned row takes no place among the pins')
  const before = Date.now() / 1000
  setNotesPinned('u1', true)
  assert.ok(notesRowState('u1').pinnedAt >= before, 'pinned again: on top of the pins (iOS setMemoPinned)')
  setNotesPinnedAt('u1', 42)
  assert.equal(notesRowState('u1').pinnedAt, 42, 'a drag gives it its place')
  // A stored value this build cannot read is the ordinary state, not a broken row.
  store.set('morse.notesRow.u2', JSON.stringify({ pinned: 'yes', pinnedAt: 'x', at: -1, line: 5 }))
  assert.deepEqual(notesRowState('u2'), { pinned: true, pinnedAt: 0, at: null, line: '' })
})

test('the line and time are learnt from a read and kept; a read that finds no notes clears them', async () => {
  const { learnNotesPreview, notesRowState, refreshNotesPreview } = await import('../../src/renderer/src/dialogs/notes-row-state')
  learnNotesPreview('u3', { updated: at(1_790_000_000), line: '장보기' })
  assert.deepEqual([notesRowState('u3').at, notesRowState('u3').line], [1_790_000_000_000, '장보기'], 'milliseconds, as a chat\'s last message')
  served = null
  refreshNotesPreview('u3')
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual([notesRowState('u3').at, notesRowState('u3').line], [null, ''])
})

test('the server read: the 24 newest notes by updatedAt, a note it cannot read left out', async () => {
  const note = (id: string, seconds: number, title: string, pinned = false): FirestoreDocument => ({ name: `${documents}/users/me/spaceNotes/${id}`,
    updateTime: { seconds: String(seconds), nanos: 0 }, createTime: { seconds: '1', nanos: 0 },
    fields: { title: { stringValue: title }, body: { stringValue: `${title} body` }, updatedAt: { timestampValue: { seconds: String(seconds), nanos: 0 } }, isPinned: { booleanValue: pinned } } } as unknown as FirestoreDocument)
  const broken = { name: `${documents}/users/me/spaceNotes/bad`, updateTime: { seconds: '99', nanos: 0 }, fields: { title: { integerValue: '1' } } } as unknown as FirestoreDocument
  const asked: unknown[] = []
  const query = FirestoreReader.prototype.query
  FirestoreReader.prototype.query = async function (_parent: string, structured: unknown) { asked.push(structured); return [broken, note('a', 50, 'newest'), note('b', 10, 'pinned', true)] }
  try {
    const reader = new SpaceNotesReader('me', { signal: new AbortController().signal, authorize: async () => { throw new Error('unused') } } as never, () => true, () => {})
    const preview = await reader.listPreview()
    assert.equal(preview!.line, 'pinned')
    assert.deepEqual(asked[0], { from: [{ collectionId: 'spaceNotes' }], orderBy: [{ field: { fieldPath: 'updatedAt' }, direction: 'DESCENDING' }], limit: { value: 24 } })
    const locked = new SpaceNotesReader('me', { signal: new AbortController().signal, authorize: async () => { throw new Error('unused') } } as never, () => false, () => {})
    await assert.rejects(locked.listPreview(), 'nothing is read while locked')
  } finally { FirestoreReader.prototype.query = query }
})

test('the list: the row with the pins while pinned, among the chats by its note once not, its own menu, its own place in a drag', () => {
  const widget = readFileSync(join(__dirname, '../../src/renderer/src/dialogs/dialogs-widget.tsx'), 'utf8')
  assert.doesNotMatch(widget, /result\.push\(\{ kind: 'notes' \}\)/, 'no longer always on top')
  assert.match(widget, /if \(!archived && !needle && folder === 'all'\) \(notes\.pinned \? pinnedChats : notesRows\)\.push\(\{ kind: 'notes' \}\)/)
  assert.match(widget, /row\.kind === 'notes' \? notes\.at \?\? -Infinity : -Infinity/)
  assert.match(widget, /: row\.kind === 'notes' \? notes\.pinnedAt : 0/)
  assert.match(widget, /const besideChats = \[\.\.\.inquiries, \.\.\.notesRows\]/)
  assert.match(widget, /else if \(row\.kind === 'notes'\) setNotesPinnedAt\(accountUid, ranks\[index\]!\)/, 'a drag moves its device place, never the account\'s ranks')
  const menu = widget.slice(widget.indexOf('function openNotesMenu'), widget.indexOf('function openMenu('))
  assert.match(menu, /tr\('노트 열기'\)/)
  assert.match(menu, /pinnedNow \? tr\('고정 해제'\) : tr\('고정'\)/)
  assert.doesNotMatch(menu, /보관/, 'never archived')
  assert.match(widget, /onContextMenu=\{event => \{ event\.preventDefault\(\); openNotesMenu\(pointFor\(event, event\.currentTarget\)\) \}\}/)
  assert.match(widget, /useEffect\(\(\) => \{ if \(section !== 'notes'\) refreshNotesPreview\(accountUid\) \}, \[accountUid, section\]\)/, 'read when the list shows and when the notes screen closes')
  assert.match(widget, /snapshot\.spaceNotes\.page\.number === 1 \? snapshot\.spaceNotes\.rows : null/)
})
