import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import en from '../../src/shared/i18n/en.json'
import ru from '../../src/shared/i18n/ru.json'

// B382 (review 10-14 14:0x): clearing a chat's history has no «undo» on either side, as in tdesktop — the box clears at
// once after its confirmation (delete_messages_box.cpp:565-570) and says «This action cannot be undone.» (lang.strings
// :2556). The words read as if «나에게만» could be taken back; both boxes now say neither can.
const boxes = {
  'src/renderer/src/dialogs/clear-history-box.tsx': '나에게만 지우면 내 모든 기기에서 이 대화의 기록이 지워지고, 대화는 목록에 남아요. 모두에게서 지우면 참여자 모두의 기록에서 지워져요. 어느 쪽이든 되돌릴 수 없어요.',
  'src/renderer/src/dialogs/dialogs-widget.tsx': '나에게만 지우면 내 모든 기기에서 기록이 지워지고, 새 메시지가 오면 그 메시지부터 다시 보여요. 모두에게서 지우면 상대방 목록과 기록에서도 사라져요. 어느 쪽이든 되돌릴 수 없어요.'
}

test('both delete boxes say that neither choice can be undone, in every language', () => {
  for (const [file, words] of Object.entries(boxes)) {
    assert.ok(readFileSync(file, 'utf8').includes(`tr('${words}')`), file)
    assert.match(words, /어느 쪽이든 되돌릴 수 없어요\.$/)
    assert.match((en as Record<string, string>)[words] ?? '', /Either way, this can't be undone\.$/)
    assert.match((ru as Record<string, string>)[words] ?? '', /В обоих случаях это нельзя отменить\.$/)
  }
})

test('the words that read as if only «모두에게서» was final are gone', () => {
  const sources = Object.keys(boxes).map(file => readFileSync(file, 'utf8')).join('\n')
  assert.ok(!sources.includes('참여자 모두의 기록에서 지워지고 되돌릴 수 없어요'))
  assert.ok(!sources.includes('상대방 목록과 기록에서도 사라지고 되돌릴 수 없어요'))
})
