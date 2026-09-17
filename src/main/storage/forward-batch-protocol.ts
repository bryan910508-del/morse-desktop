import type { ForwardBatchRequest } from '../../shared/forward-batch'
import type { PreparedForwardMedia } from './forward-media-protocol'

export type PreparedForwardItem = { kind: 'text'; text: string; isSilent: boolean } | { kind: 'media'; media: PreparedForwardMedia }
export type ForwardBatchCommand =
  | { kind: 'forward-batch-known'; request: ForwardBatchRequest }
  | { kind: 'enqueue-forward-batch'; request: ForwardBatchRequest; content: PreparedForwardItem[] }
export function clearForwardBatch(content: PreparedForwardItem[]): void {
  for (const item of content) if (item.kind === 'media') for (const part of item.media.parts) part.bytes.fill(0)
}
