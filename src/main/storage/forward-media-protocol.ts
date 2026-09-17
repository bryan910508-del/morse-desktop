import type { MediaSendWire } from '../../shared/model'
import type { MediaMetadata } from '../../shared/media-metadata'
export interface ForwardMediaPart { name: string; contentType: string; extension: string; sha256: string; md5: string; bytes: Uint8Array }
export interface PreparedForwardMedia {
  kind: MediaSendWire['type']
  metadata: MediaMetadata
  caption: string
  isSilent: boolean
  blind: boolean
  parts: ForwardMediaPart[]
}
