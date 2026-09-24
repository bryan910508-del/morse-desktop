import assert from 'node:assert/strict'
import { test } from 'node:test'
import { textDigest } from '../../src/main/messaging/text-identity'
import type { SendWire } from '../../src/shared/model'

// payloadDigest 는 서버 canonical() (talky-server morse-message-authority.js) 이 저장하는 값과 같아야 한다.
// 다르면, 답을 잃은 전송을 나중에 찾아볼 때 이미 도착한 메시지를 CONFLICT 로 오판한다.
//
// 아래 해시는 그 서버 함수를 직접 불러 얻은 값이다 — talky-server 3f95bfd(2026-09-24 main 병합),
// morse-message-authority.js blob a6d610ba97b86225766328bade2c0267720f0f8e. 서버가 필드 차례나 기본값을
// 바꾸면 여기가 먼저 깨진다. 그게 이 테스트의 일이다.
const wire = (fields: Record<string, unknown>): SendWire => fields as unknown as SendWire
const poll = (over: Record<string, unknown> = {}): SendWire =>
  wire({ type: 'poll', text: '', isSilent: false, isEncrypted: false, pollQuestion: 'q', pollOptions: ['a', 'b'], ...over })

test('messages that carry no poll field digest as they always did', () => {
  // 기존 메시지의 해시가 바뀌면 이미 대기 중인 전송이 전부 오판된다.
  assert.equal(textDigest(wire({ type: 'text', text: '안녕', isSilent: false, isEncrypted: false })),
    '7e8900dbc62838c36a90e94a67694285dcf4037ac528fdeb803523c0a4a82f72')
})

test('a poll digests to what the server stores', () => {
  assert.equal(textDigest(poll()), 'ec60facd2af78baf1169cb6b98d727ae9b1585c3f822ade491d39cb76606539a')
})

test('a field that does not belong to the kind is not in the digest', () => {
  const clean = textDigest(wire({ type: 'text', text: 'hi', isSilent: false, isEncrypted: false }))
  assert.equal(clean, 'a625376cbd09aeddc1ae9249ddffa8e19d6388c3a30afafac0bead2a8d2fe4e9')
  // 서버는 종류가 아니면 pollQuestion 을 지운다. 연락처 필드는 이제 사본에 없다 — 섞여 와도 해시가 같다.
  assert.equal(textDigest(wire({ type: 'text', text: 'hi', isSilent: false, isEncrypted: false, contactShareId: 'share_x', pollQuestion: 'q' })), clean)
})

test('the tally a sender writes changes nothing — the server starts it at zero', () => {
  assert.equal(textDigest(poll({ pollVoteCounts: [99, 5], pollTotalVoters: 99, pollIsClosed: true })), textDigest(poll()))
  assert.equal(textDigest(poll({ pollOptions: [' a ', ' b '] })), textDigest(poll()), '선택지는 다듬어진 값으로 센다')
  assert.notEqual(textDigest(poll({ pollOptions: ['a', 'b', 'c'] })), textDigest(poll()))
})

test('each of the five switches lands where the server puts it', () => {
  // 값 하나하나가 서버 canonical() 을 같은 payload 로 불러 얻은 것이다. 키 차례가 어긋나면 값이 달라진다 —
  // 2026-09-24 에 이 사본은 퀴즈를 익명·복수 뒤에 넣고 있었고, 그래서 여섯 해시가 전부 서버와 달랐다.
  assert.equal(textDigest(poll({ pollIsAnonymous: true })), '9b515b80bff4017b8bef69c4660526fea53438585727da21189568f44f8e69a0')
  assert.equal(textDigest(poll({ pollMultipleAnswers: false })), '56a5659718ddc23b90338f87d586acc6a8be7893f7690f997258dc2104bab9dc')
  assert.equal(textDigest(poll({ pollIsQuiz: true, pollCorrectOption: 1 })), 'dc4b114178a95498bd8ec0778212bd9975c1a7507ee101ce78dcbed77451a325')
  assert.equal(textDigest(poll({ pollCanRevote: false })), '4728a43eb3c54e1c218aad79b02a13500b359ecefe9c86f8166d08fd93af624e')
  assert.equal(textDigest(poll({ pollShuffleOptions: true })), '437f1c78453fb24180a1cd51c58d0eba5b688e55089c22f83f661437d6bfc6d9')
})

test('a full poll digests to what the server stores', () => {
  assert.equal(textDigest(wire({ type: 'poll', text: '', isSilent: false, isEncrypted: false,
    pollQuestion: '점심?', pollOptions: ['국밥', '라면', '김밥'], pollIsAnonymous: true, pollMultipleAnswers: false,
    pollIsQuiz: false, pollCanRevote: false, pollShuffleOptions: true })),
  '5c0d1c8788e091b7bafd9c20b43ce6c839fa3f14de8dfae1512fc03d1871ebeb')
})

test('a quiz carries its answer, a plain poll has no such key', () => {
  assert.equal(textDigest(poll({ pollIsQuiz: false, pollCorrectOption: 1 })), textDigest(poll()))
  assert.notEqual(textDigest(poll({ pollIsQuiz: true, pollCorrectOption: 1 })), textDigest(poll({ pollIsQuiz: true, pollCorrectOption: 0 })))
})
