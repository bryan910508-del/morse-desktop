import assert from 'node:assert/strict'
import { test } from 'node:test'
import { actionRequest, pollVoteSelection } from '../../src/shared/message-actions'
import { maxPollOptions } from '../../src/shared/poll-draft'

// A vote is sent the way a reaction is — under its own clientRevision, so the repeat of a lost answer
// is applied once (morse-release-authority.js keeps it in pollVotes/{uid}). The selection therefore has
// to read the same way every time it is built.
test('a selection is each option once, in the poll’s own order', () => {
  assert.deepEqual(pollVoteSelection([2, 0, 1]), [0, 1, 2])
  assert.deepEqual(pollVoteSelection([1, 1, 1]), [1])
  assert.deepEqual(pollVoteSelection([]), [], 'an empty selection takes the vote back')
})

test('nothing that is not a place in the poll’s list is accepted', () => {
  assert.throws(() => pollVoteSelection([-1]), /투표할 선택지/)
  assert.throws(() => pollVoteSelection([maxPollOptions]), /투표할 선택지/)
  assert.throws(() => pollVoteSelection([1.5]), /투표할 선택지/)
  assert.throws(() => pollVoteSelection(['1']), /투표할 선택지/)
  assert.throws(() => pollVoteSelection(null), /투표할 선택지/)
  assert.throws(() => pollVoteSelection(Array.from({ length: maxPollOptions + 1 }, (_, index) => index)), /투표할 선택지/)
})

test('a vote reaches the action queue as its own kind, beside an edit and a reaction', () => {
  const request = actionRequest({ id: '3f2504e0-4f89-41d3-9a0c-0305e82c3303', messageId: 'm1', version: '100:0', kind: 'poll-vote', options: [2, 0] })
  assert.equal(request.kind, 'poll-vote')
  assert.deepEqual(request.options, [0, 2])
  assert.equal(request.reactions, undefined)
  assert.equal(request.text, undefined)
})
