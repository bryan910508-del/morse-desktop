// 투표 결과의 막대 길이. 공식 Telegram 은 각 선택지의 몫을 정수 퍼센트로 적고 합이 100 이 되게 맞춘다
// (TelegramMediaPollResults 의 voters/totalVoters 로 그린다). 그냥 반올림하면 33+33+33=99 처럼 합이
// 어긋나므로, 내림한 뒤 남은 몫을 나머지가 큰 순서로 하나씩 나눠 준다.

export interface PollBar { index: number; count: number; percent: number }

export function pollBars(counts: readonly number[], totalVoters: number): PollBar[] {
  const safe = counts.map(count => Math.max(0, Math.trunc(count) || 0))
  // 합계는 집계 배열에서 얻는다. totalVoters 는 «사람 수» 라서 복수 선택이면 표의 합과 다르다.
  const total = safe.reduce((sum, count) => sum + count, 0)
  if (total <= 0) return safe.map((count, index) => ({ index, count, percent: 0 }))
  const exact = safe.map(count => (count * 100) / total)
  const floors = exact.map(value => Math.floor(value))
  let left = 100 - floors.reduce((sum, value) => sum + value, 0)
  // 나머지가 큰 것부터. 같으면 앞의 선택지가 먼저다 — 같은 입력이면 늘 같은 그림이어야 한다.
  const order = exact.map((value, index) => ({ index, rest: value - Math.floor(value) }))
    .sort((a, b) => b.rest - a.rest || a.index - b.index)
  const percent = [...floors]
  for (const entry of order) {
    if (left <= 0) break
    percent[entry.index] = (percent[entry.index] ?? 0) + 1
    left -= 1
  }
  return safe.map((count, index) => ({ index, count, percent: percent[index] ?? 0 }))
}

/** 결과를 보여줄 때인가. 내가 표를 넣었거나, 닫혔거나, 퀴즈에서 답을 골랐을 때다. */
export function pollShowsResults(mine: readonly number[] | null, closed: boolean): boolean {
  return closed || (mine !== null && mine.length > 0)
}
