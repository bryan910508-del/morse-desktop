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
  // B246: a sticker sent as a reference is forwarded as that reference (tdesktop forwards the document itself), while
  // the switch is on; its bytes stay beside it only to be checked.
  sticker?: { id: string; kind: 'png' | 'gif' | 'mp4'; setId?: string }
}
