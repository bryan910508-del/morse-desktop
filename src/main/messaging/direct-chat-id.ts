import { createHash } from 'node:crypto'

// Telegram names a private dialog by the peer: PeerId(namespace: CloudUser, id), MessageId.peerId,
// enqueueMessages(account:peerId:messages:) and messages.sendMessage(peer: inputPeer, randomId:)
// (Telegram-iOS 6ad963e5). No two devices can therefore name one conversation differently.
//
// Morse names the 1:1 dialog by its two account ids. The Railway server (directChatId in
// morse-message-authority.js), iOS (MorseDirectChatIdentity) and Android compute the same value, and the
// server refuses a second direct chat for a pair (DIRECT_CHAT_EXISTS). Chats made before this keep their
// random ids and are found by their participants first. A secret session is not the pair's dialog.
//
// Account ids are [A-Za-z0-9_-]: code-unit order is byte order, and the newline separator is unambiguous.
export function directChatId(a: string, b: string): string {
  const [low, high] = a < b ? [a, b] : [b, a]
  return `direct_${createHash('sha256').update(`morse-direct-v1\n${low}\n${high}`, 'utf8').digest('hex').slice(0, 32)}`
}
