import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { accountMayRead, reactionPlaceShown, reactionSeenAllowed, type ReactionSeenState } from '../../src/shared/reaction-seen'

// Phase1 11-05 (iOS R2, server log 08:36:17.6): switching to an account whose chat was still chosen marked its unseen
// reaction seen at once, with the window behind others. tdesktop reads a reaction only when its place is painted in the
// visible area of a window that is marking as read (history_inner_widget.cpp:1518-1528, :1549; mainwindow.cpp:597-606).
const session = readFileSync('src/main/accounts/session.ts', 'utf8')
const visible = readFileSync('src/renderer/src/history/visible-read.ts', 'utf8')

test('reaction seen: nothing acknowledges a reaction when a chat is chosen or the list arrives', () => {
  const calls = [...session.matchAll(/this\.acknowledgeReaction\(/g)].length
  assert.equal(calls, 1, 'only markReactionVisible acknowledges')
  assert.doesNotMatch(session, /queueMicrotask\(\(\) => \{ if \(this\.selected === history\) this\.acknowledgeReaction\(\) \}\)/)
})

test('reaction seen: only the open chat, in a window that may read, for the message the window shows', () => {
  const body = session.slice(session.indexOf('  markReactionVisible(chatId: string, messageId: string): boolean {'), session.indexOf('  private acknowledgeReaction(shown: string): boolean {'))
  assert.match(body, /canRead: this\.events\.canRead\(\)/)
  assert.match(body, /selectedChatId: this\.selected\?\.dialog\.summary\.id, chatId/)
  assert.match(session, /!unseen \|\| unseen\.messageId !== shown\) return false/)
})

test('reaction seen: the window asks once the reacted message\'s reactions are on screen and the window has focus', () => {
  assert.match(visible, /document\.visibilityState === 'visible' && document\.hasFocus\(\)/)
  const body = visible.slice(visible.indexOf('const seeReaction ='), visible.indexOf('// Once per newest message'))
  assert.match(body, /querySelector<HTMLElement>\('\.bubble-reactions'\)/)
  assert.match(body, /reactionPlaceShown\(bounds, visible/)
  assert.match(body, /document\.elementFromPoint\(x, y\)/)
  assert.match(body, /window\.morse\.markReactionVisible\(view\.accountUid, view\.chatId, id\)/)
  assert.match(readFileSync('src/renderer/src/history/history-widget.tsx', 'utf8'), /reaction: dialog\?\.unseenReaction\?\.messageId \}\)/)
})

// The three conditions as behaviour (review 11-05 09:3x): a background account 0, a covered window 0, off screen 0, shown 1.
const open: ReactionSeenState = { closed: false, locked: false, ready: true, canRead: true, selectedChatId: 'c1', chatId: 'c1', unseenMessageId: 'm1', shownMessageId: 'm1' }
test('reaction seen: a background account whose chat is still chosen reads nothing', () => {
  assert.equal(accountMayRead(true, 'me', 'me'), true)
  assert.equal(accountMayRead(true, 'other', 'me'), false, 'another account is the one on screen')
  assert.equal(reactionSeenAllowed({ ...open, canRead: accountMayRead(true, 'other', 'me') }), false)
  assert.match(readFileSync('src/main/index.ts', 'utf8'), /canRead: \(\) => accountMayRead\(canReadWindow\(\), accounts\.active\?\.profile\.uid, uid\)/)
})
test('reaction seen: a covered, hidden or locked window reads nothing', () => {
  assert.equal(reactionSeenAllowed({ ...open, canRead: accountMayRead(false, 'me', 'me') }), false, 'window not marking as read')
  assert.equal(reactionSeenAllowed({ ...open, locked: true }), false)
  assert.equal(reactionSeenAllowed({ ...open, closed: true }), false)
  assert.equal(reactionSeenAllowed({ ...open, ready: false }), false)
  const index = readFileSync('src/main/index.ts', 'utf8')
  assert.match(index.slice(index.indexOf('function canReadWindow'), index.indexOf('function canReadWindow') + 400), /!screenLocked[\s\S]*isVisible\(\) && mainWindow\.isFocused\(\) && !mainWindow\.isMinimized\(\)/)
})
test('reaction seen: a message off screen, laid over, or not the unseen one reads nothing', () => {
  const visible = { top: 100, bottom: 600, left: 0, right: 800 }, mine = () => true
  assert.equal(reactionPlaceShown({ top: 20, bottom: 60, left: 50, right: 300 }, visible, mine), false, 'above the visible part')
  assert.equal(reactionPlaceShown({ top: 640, bottom: 680, left: 50, right: 300 }, visible, mine), false, 'below it')
  assert.equal(reactionPlaceShown({ top: 300, bottom: 340, left: 900, right: 1000 }, visible, mine), false, 'beside it')
  assert.equal(reactionPlaceShown({ top: 300, bottom: 300, left: 50, right: 300 }, visible, mine), false, 'not drawn')
  assert.equal(reactionPlaceShown(null, visible, mine), false)
  assert.equal(reactionPlaceShown({ top: 300, bottom: 340, left: 50, right: 300 }, visible, () => false), false, 'something drawn over it')
  assert.equal(reactionSeenAllowed({ ...open, shownMessageId: 'm2' }), false, 'another message')
  assert.equal(reactionSeenAllowed({ ...open, unseenMessageId: null }), false, 'nothing unseen')
  assert.equal(reactionSeenAllowed({ ...open, selectedChatId: 'c2' }), false, 'another chat open')
})
test('reaction seen: the open chat of the account on screen, in a reading window, with the reaction drawn — once', () => {
  const visible = { top: 100, bottom: 600, left: 0, right: 800 }, points: number[][] = []
  assert.equal(reactionPlaceShown({ top: 300, bottom: 340, left: 50, right: 300 }, visible, (x, y) => { points.push([x, y]); return true }), true)
  assert.deepEqual(points, [[175, 320]], 'asks what is drawn at the middle of the reactions')
  assert.equal(reactionSeenAllowed({ ...open, canRead: accountMayRead(true, 'me', 'me') }), true)
})
