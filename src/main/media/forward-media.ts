import { createHash } from 'node:crypto'
import type { ChatMessage } from '../../shared/model'
import { canForwardMedia, type ForwardProgress } from '../../shared/forward'
import type { ReadCredentials } from '../network/firestore-rpc'
import type { PreparedForwardMedia } from '../storage/forward-media-protocol'
import { downloadMedia } from './download-media'
import { restoreFile } from './compression'
import { forwardMediaFormat } from './forward-media-format'
import { mediaMetadata } from '../../shared/media-metadata'
import { safeFileName, type MediaResource } from './media-document'
import { tr } from '../../shared/i18n'

export interface ForwardMediaSource { message: ChatMessage; resources: MediaResource[] }
export async function prepareForwardMedia(credentials: ReadCredentials, resolve: () => ForwardMediaSource,
  targetCount: number, signal: AbortSignal, progress: (value: Omit<ForwardProgress, 'operationId'>) => void, reservedBytes = 0): Promise<PreparedForwardMedia> {
  const original = resolve(), message = original.message
  if (!canForwardMedia(message)) throw new Error(tr('전달할 수 있는 첨부를 다시 선택해 주세요.'))
  const kind = message.kind as PreparedForwardMedia['kind'], parts: PreparedForwardMedia['parts'] = []
  const metadata = mediaMetadata(message.mediaMetadata ?? {}, kind, original.resources.length)
  const check = (): void => {
    signal.throwIfAborted()
    const current = resolve()
    if (current.message.version !== message.version || current.resources.length !== original.resources.length ||
        current.resources.some((part, index) => !part.summary.available || !part.path || part.path !== original.resources[index]?.path)) throw new Error(tr('첨부 원본이 변경되었습니다.'))
  }
  let retained = false, bytes: Buffer | null = null, totalBytes = 0
  try {
    for (const [index, resource] of original.resources.entries()) {
      check()
      const limit = (kind === 'image' ? 10 : 50) * 1024 * 1024
      bytes = await downloadMedia(credentials, resource, signal, check, (loaded, total) => {
        if ((reservedBytes + totalBytes + Math.max(loaded, total ?? 0)) * targetCount > 250 * 1024 * 1024) throw new Error(tr('대상별 원본 합계가 250 MB를 넘습니다. 더 적은 메시지나 대화로 전달해 주세요.'))
        progress({ phase: 'preparing', current: index + 1, count: original.resources.length, loaded, total })
      }, limit)
      check()
      if (kind === 'file') {
        // Do not allocate a restored file larger than the existing upload limit.
        if (bytes.subarray(0, 10).toString('ascii') === 'TALKY_LZF1' && bytes.length > 18 && bytes.readBigUInt64LE(10) >= BigInt(limit)) throw new Error(tr('복원한 파일은 50 MB 미만이어야 전달할 수 있습니다.'))
        const restored = await restoreFile(bytes, signal)
        if (restored !== bytes) { bytes.fill(0); bytes = restored }
        check()
      }
      const type = forwardMediaFormat(kind, bytes)
      if (bytes.length >= type.limit) throw new Error(tr('원본 크기가 첨부 전송 범위를 넘습니다. 이미지 스티커는 10 MB 미만이어야 합니다.'))
      totalBytes += bytes.length
      if ((reservedBytes + totalBytes) * targetCount > 250 * 1024 * 1024) throw new Error(tr('대상별 원본 합계가 250 MB를 넘습니다. 더 적은 메시지나 대화로 전달해 주세요.'))
      parts.push({ name: safeFileName(resource.summary.name), contentType: type.contentType, extension: type.extension,
        sha256: createHash('sha256').update(bytes).digest('hex'), md5: createHash('md5').update(bytes).digest('base64'), bytes })
      bytes = null
    }
    check(); retained = true
    return { kind, metadata, caption: message.caption ?? '', isSilent: Boolean(message.silent), blind: Boolean(message.attachments?.some(part => part.blind)), parts }
  } catch (error) {
    throw new Error(signal.aborted ? tr('첨부 준비가 취소되었습니다. 아직 저장되지 않은 원본은 정리했습니다.') : error instanceof Error ? error.message : tr('첨부 원본을 준비하지 못했습니다.'))
  } finally {
    bytes?.fill(0)
    if (!retained) for (const part of parts) part.bytes.fill(0)
  }
}
