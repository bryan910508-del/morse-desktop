import assert from 'node:assert/strict'
import { test } from 'node:test'
import { pollBars, pollShowsResults } from '../../src/shared/poll-results'

test('the percentages add up to a hundred', () => {
  // 33.3 셋을 그냥 반올림하면 99 가 된다. 남는 1 을 나머지가 큰 것에 준다.
  assert.deepEqual(pollBars([1, 1, 1], 3).map(bar => bar.percent), [34, 33, 33])
  assert.deepEqual(pollBars([1, 1, 1, 1, 1, 1], 6).map(bar => bar.percent), [17, 17, 17, 17, 16, 16])
  for (const counts of [[5, 3, 2], [7, 7, 7, 7], [1, 0, 0], [2, 1], [10, 20, 30, 40]]) {
    assert.equal(pollBars(counts, counts.reduce((a, b) => a + b, 0)).reduce((sum, bar) => sum + bar.percent, 0), 100,
      `${counts} 의 합이 100 이어야 한다`)
  }
})

test('nobody has voted yet, so every bar is empty', () => {
  assert.deepEqual(pollBars([0, 0], 0), [{ index: 0, count: 0, percent: 0 }, { index: 1, count: 0, percent: 0 }])
})

test('a tie is drawn the same way every time', () => {
  // 나머지가 같으면 앞의 선택지가 먼저 받는다. 같은 입력이 같은 그림이어야 한다.
  assert.deepEqual(pollBars([1, 1, 1], 3), pollBars([1, 1, 1], 3))
  assert.deepEqual(pollBars([1, 1, 1], 3).map(bar => bar.percent), [34, 33, 33])
})

test('a broken tally is read as zero, not as a negative bar', () => {
  assert.deepEqual(pollBars([-3, 5], 5).map(bar => bar.percent), [0, 100])
  assert.deepEqual(pollBars([Number.NaN, 4], 4).map(bar => bar.percent), [0, 100])
})

test('with multiple answers the shares are of the votes, not of the people', () => {
  // 3명이 각각 둘씩 골라 표가 6개다. 몫은 표 기준이어야 막대가 100 을 넘지 않는다.
  assert.deepEqual(pollBars([3, 3], 3).map(bar => bar.percent), [50, 50])
})

test('results are shown once you have voted, or once it is closed', () => {
  assert.equal(pollShowsResults(null, false), false)
  assert.equal(pollShowsResults([], false), false)
  assert.equal(pollShowsResults([0], false), true)
  assert.equal(pollShowsResults(null, true), true, '닫힌 투표는 표를 넣지 않았어도 결과를 보여준다')
})
