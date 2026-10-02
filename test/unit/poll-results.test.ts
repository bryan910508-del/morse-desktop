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

// 분모는 «사람 수»다. 공식 Telegram 의 CountNicePercent 가 total 로 나누고, 100 맞추기는 모자랄 때만
// 한다 (AdjustPercentCount: `left > 0 && left <= count`). 복수 선택이면 합이 100 을 넘는 것이 맞다 —
// «이 선택지를 고른 사람의 비율»이기 때문이다. 표 합계로 나누면 iOS·안드로이드와 숫자가 갈린다.
test('with multiple answers each share is of the people, so the shares may pass a hundred', () => {
  // 3명이 저마다 둘 다 골랐다. 각 선택지를 고른 사람은 셋 중 셋이다.
  assert.deepEqual(pollBars([3, 3], 3).map(bar => bar.percent), [100, 100])
  // 4명 중 3명·2명이 골랐다 (한 사람은 둘 다).
  assert.deepEqual(pollBars([3, 2], 4).map(bar => bar.percent), [75, 50])
})

test('a share over a hundred is left alone, and one short of it is filled', () => {
  // 모자랄 때만 채운다. 33+33+33 = 99 → 하나를 올려 100.
  assert.equal(pollBars([1, 1, 1], 3).reduce((sum, bar) => sum + bar.percent, 0), 100)
  // 넘칠 때는 손대지 않는다 — 내림한 값 그대로다.
  assert.deepEqual(pollBars([2, 2, 2], 3).map(bar => bar.percent), [66, 66, 66])
})

test('a tally larger than the number of people is still read', () => {
  // 사람 수가 0 인데 표가 있는 문서는 망가진 것이다. 막대를 그리지 않는다.
  assert.deepEqual(pollBars([2, 1], 0).map(bar => bar.percent), [0, 0])
})

test('results are shown once you have voted, or once it is closed', () => {
  assert.equal(pollShowsResults(null, false), false)
  assert.equal(pollShowsResults([], false), false)
  assert.equal(pollShowsResults([0], false), true)
  assert.equal(pollShowsResults(null, true), true, '닫힌 투표는 표를 넣지 않았어도 결과를 보여준다')
})
