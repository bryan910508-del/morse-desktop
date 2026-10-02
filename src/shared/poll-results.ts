// 투표 결과의 막대 길이. 공식 Telegram 은 각 선택지의 몫을 정수 퍼센트로 적고, 모자란 만큼만 나머지가
// 큰 순서로 채워 합을 100 으로 맞춘다 (history_view_poll.cpp CountNicePercent / AdjustPercentCount).

export interface PollBar { index: number; count: number; percent: number }

export function pollBars(counts: readonly number[], totalVoters: number): PollBar[] {
  const safe = counts.map(count => Math.max(0, Math.trunc(count) || 0))
  // 분모는 «사람 수»다. 복수 선택 투표에서 표의 합은 사람 수보다 크고, 그때 각 몫은 «이 선택지를 고른
  // 사람의 비율»이라 합이 100 을 넘는다 — 공식 Telegram 이 그렇게 그린다 (history_view_poll.cpp
  // CountNicePercent 는 total 로 나누고, 100 맞추기(AdjustPercentCount)는 `left > 0 && left <= count`
  // 일 때만 한다). 표 합계로 나누면 단일 선택에서는 같고 복수 선택에서만 세 앱의 숫자가 갈린다.
  const total = Math.max(0, Math.trunc(totalVoters) || 0)
  if (total <= 0) return safe.map((count, index) => ({ index, count, percent: 0 }))
  const percent = safe.map(count => Math.floor((count * 100) / total))
  const left = 100 - percent.reduce((sum, value) => sum + value, 0)
  // 모자란 만큼만 나눠 준다. 남는 쪽(합이 100 을 넘는 복수 선택)은 그대로 둔다.
  if (left > 0 && left <= safe.length) {
    // 나머지가 큰 것부터. 같으면 앞의 선택지가 먼저다 — 같은 입력이면 늘 같은 그림이어야 한다.
    const order = safe.map((count, index) => ({ index, rest: (count * 100) - (Math.floor((count * 100) / total) * total) }))
      .sort((a, b) => b.rest - a.rest || a.index - b.index)
    for (const entry of order.slice(0, left)) percent[entry.index] = (percent[entry.index] ?? 0) + 1
  }
  return safe.map((count, index) => ({ index, count, percent: percent[index] ?? 0 }))
}

/** 결과를 보여줄 때인가. 내가 표를 넣었거나, 닫혔거나, 퀴즈에서 답을 골랐을 때다. */
export function pollShowsResults(mine: readonly number[] | null, closed: boolean): boolean {
  return closed || (mine !== null && mine.length > 0)
}
