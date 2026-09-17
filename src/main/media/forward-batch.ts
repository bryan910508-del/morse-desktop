import type { ForwardProgress } from '../../shared/forward'
import type { ReadCredentials } from '../network/firestore-rpc'
import { clearForwardBatch, type PreparedForwardItem } from '../storage/forward-batch-protocol'
import { prepareForwardMedia, type ForwardMediaSource } from './forward-media'

export async function prepareForwardBatch(credentials: ReadCredentials, resolve: () => ForwardMediaSource[], targetCount: number,
  signal: AbortSignal, progress: (value: Omit<ForwardProgress, 'operationId'>) => void): Promise<PreparedForwardItem[]> {
  const original = resolve(), count = original.reduce((sum, source) => sum + source.resources.length, 0)
  const content: PreparedForwardItem[] = []
  let retained = false, bytes = 0, completed = 0
  try {
    for (const [index, source] of original.entries()) {
      signal.throwIfAborted(); resolve()
      if (source.message.kind === 'text') content.push({ kind: 'text', text: source.message.text, isSilent: Boolean(source.message.silent) })
      else {
        const media = await prepareForwardMedia(credentials, () => resolve()[index]!, targetCount, signal,
          value => progress({ ...value, current: completed + value.current, count }), bytes)
        content.push({ kind: 'media', media })
        bytes += media.parts.reduce((sum, part) => sum + part.bytes.length, 0)
        completed += media.parts.length
      }
    }
    signal.throwIfAborted(); resolve(); retained = true
    return content
  } finally { if (!retained) clearForwardBatch(content) }
}
