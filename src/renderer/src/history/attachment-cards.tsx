import { useState } from 'react'
import { BarChart3, Check, Lock } from 'lucide-react'
import type { ChatMessage, MessagePoll } from '../../../shared/model'
import { pollBars, pollShowsResults } from '../../../shared/poll-results'
import { tr } from '../../../shared/i18n'
import { votePoll } from './message-overlay'

// 투표 카드. 계약은 MorseIOS docs/attachment-contract-contact-poll-2026-09-24.md 다.
//
// 카드 전체를 버튼으로 감싸지 않는다. 투표 카드 안에는 선택지 버튼이 들어가고, 버튼 안의 버튼은 눌리지
// 않는다 — 채널 게시물 카드가 사진과 본문 두 개로 나뉘어 있는 것과 같은 이유다.

export function PollCard({ accountUid, message, poll }: { accountUid: string; message: ChatMessage; poll: MessagePoll }) {
  const showResults = pollShowsResults(poll.mine, poll.closed)
  const bars = pollBars(poll.voteCounts, poll.totalVoters)
  const chosen = new Set(poll.mine ?? [])
  // A closed poll takes no more votes, and one that forbids changing a vote takes none once this
  // account has voted — the server refuses both (POLL_REVOTE_FORBIDDEN), so the option stops being a
  // button rather than failing under the pointer.
  const votable = !poll.closed && Boolean(message.version) && (poll.canRevote || !(poll.mine ?? []).length)
  // Telegram sends a single answer the moment it is tapped, and lets several be chosen and sent
  // together when the poll allows it (ChatMessagePollBubbleContentNode: one tap votes, «Vote» submits).
  const [picked, setPicked] = useState<number[] | null>(null)
  const [busy, setBusy] = useState(false)
  const send = (options: number[]): void => {
    if (busy) return
    setBusy(true); setPicked(null)
    void votePoll(accountUid, message, options).finally(() => setBusy(false))
  }
  const choose = (index: number): void => {
    if (!votable || busy) return
    if (!poll.multipleAnswers || poll.quiz) { send([index]); return }
    setPicked(current => { const next = new Set(current ?? poll.mine ?? []); if (next.has(index)) next.delete(index); else next.add(index); return [...next].sort((a, b) => a - b) })
  }
  const waiting = picked !== null && picked.length > 0
  return <div className="attachment-card poll-card" data-message-id={message.id}>
    <span className="poll-card-kind">
      <BarChart3 size={14} />
      {poll.quiz ? tr('퀴즈') : poll.anonymous ? tr('익명 투표') : tr('공개 투표')}
      {poll.multipleAnswers && !poll.quiz ? ` · ${tr('복수 선택')}` : ''}
      {poll.closed ? ` · ${tr('종료됨')}` : ''}
    </span>
    <strong className="poll-card-question">{poll.question}</strong>
    <ol className="poll-card-options">
      {poll.options.map((option, index) => {
        const bar = bars[index]
        // 퀴즈의 정답은 결과를 볼 수 있을 때만 드러낸다.
        const correct = poll.quiz && showResults && poll.correctOption === index
        const marked = picked !== null ? picked.includes(index) : chosen.has(index)
        const line = <>
          <span className="poll-card-option-line">
            {marked && <Check size={14} />}
            <span className="poll-card-option-text">{option}</span>
            {showResults && <span className="poll-card-option-percent">{bar?.percent ?? 0}%</span>}
          </span>
          {showResults && <span className="poll-card-bar"><span className="poll-card-bar-fill" style={{ width: `${bar?.percent ?? 0}%` }} /></span>}
        </>
        return <li key={index} className={`poll-card-option${marked ? ' picked' : ''}${correct ? ' correct' : ''}`}>
          {votable ? <button type="button" className="poll-card-option-button" disabled={busy} aria-pressed={marked}
            onClick={event => { event.stopPropagation(); choose(index) }}>{line}</button> : line}
        </li>
      })}
    </ol>
    {votable && (poll.multipleAnswers && !poll.quiz) && <button type="button" className="poll-card-vote" disabled={busy || !waiting}
      onClick={event => { event.stopPropagation(); if (picked) send(picked) }}>{tr('투표하기')}</button>}
    <small className="poll-card-total">
      {poll.totalVoters > 0 ? tr('{0}명 참여', [poll.totalVoters]) : poll.closed ? tr('아무도 투표하지 않았어요') : tr('첫 번째로 투표해 보세요')}
      {poll.anonymous && <> · <Lock size={11} />{tr('익명')}</>}
    </small>
  </div>
}
