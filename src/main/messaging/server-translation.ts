import { createHash } from 'node:crypto'
import { MorseCallableFailure } from '../network/morse-callable'
import { maxTranslationText, serverTranslationBatch, translationTarget, type TranslationResult } from '../../shared/translation'

// B343 (contracts/B343-server-translation.md): a translation made on the server, translateMorseMessages, where this
// device cannot translate (Windows, macOS before 26) and the server switch is on. As Telegram's server translation the
// request names the messages, not their text — the server reads them itself (tdesktop PrepareTranslateProviderRequest,
// lang/translate_provider.cpp:48-67; MTPmessages_TranslateText with ids, translate_mtproto_provider.cpp:46-104) — and
// asks for many at once, up to 20. Results are kept in memory as the device's are (ChatTranslator), never on disk.
type Call = (name: string, data: Record<string, unknown>) => Promise<Record<string, unknown>>
export interface ServerTranslationItem { id: string; text: string }
const cacheLimit = 500

export class ServerTranslator {
  private readonly results = new Map<string, TranslationResult>()
  constructor(private readonly uid: string, private readonly call: Call) {}

  private key(chatId: string, item: ServerTranslationItem): string {
    return createHash('sha256').update(translationTarget()).update('\0').update(chatId).update('\0').update(item.id).update('\0').update(item.text).digest('hex')
  }
  private remember(key: string, result: TranslationResult): void {
    this.results.delete(key); this.results.set(key, result)
    if (this.results.size > cacheLimit) this.results.delete(this.results.keys().next().value!)
  }

  // Each message's result. Kept: a translation and «same language» (asked again only when the text changes); a failure
  // is asked again next time. A refusal for the account's rate (RATE_LIMITED) answers every message still waiting so.
  async translate(chatId: string, items: readonly ServerTranslationItem[]): Promise<Map<string, TranslationResult>> {
    const out = new Map<string, TranslationResult>(), waiting: ServerTranslationItem[] = []
    for (const item of items) {
      if (!item.text.trim()) { out.set(item.id, { status: 'same-language' }); continue }
      if (item.text.length > maxTranslationText) { out.set(item.id, { status: 'failed' }); continue }
      const known = this.results.get(this.key(chatId, item))
      if (known) out.set(item.id, known)
      else if (!waiting.some(other => other.id === item.id)) waiting.push(item)
    }
    for (let start = 0; start < waiting.length; start += serverTranslationBatch) {
      const batch = waiting.slice(start, start + serverTranslationBatch)
      let answer: Record<string, unknown>
      try {
        answer = await this.call('translateMorseMessages', { kind: 'chat', roomId: chatId, messageIds: batch.map(item => item.id), target: translationTarget(), expectedUid: this.uid })
      } catch (error) {
        const limited = error instanceof MorseCallableFailure && (error.reason === 'RATE_LIMITED' || error.status === 'RESOURCE_EXHAUSTED')
        for (const item of waiting.slice(start)) out.set(item.id, { status: limited ? 'rate-limited' : 'failed' })
        return out
      }
      const results = Array.isArray(answer.results) ? answer.results as Record<string, unknown>[] : []
      for (const item of batch) {
        const raw = results.find(value => value && value.messageId === item.id)
        const result: TranslationResult = raw?.status === 'translated' && typeof raw.text === 'string' && raw.text.length > 0 && raw.text.length <= maxTranslationText * 4
          ? { status: 'translated', text: raw.text } : raw?.status === 'same-language' ? { status: 'same-language' } : { status: 'failed' }
        if (result.status !== 'failed') this.remember(this.key(chatId, item), result)
        out.set(item.id, result)
      }
    }
    return out
  }
  close(): void { this.results.clear() }
}
