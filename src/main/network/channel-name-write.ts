import type { ChannelNameEdit } from '../../shared/channel-name'
import { writeChannelMetadata } from './channel-metadata-write'
export { ChannelMetadataWriteFailure as ChannelNameWriteFailure } from './channel-metadata-write'
export function writeChannelName(client: Parameters<typeof writeChannelMetadata>[0], auth: Parameters<typeof writeChannelMetadata>[1], uid: string, edit: ChannelNameEdit, signal: AbortSignal, validate: () => void): Promise<number> {
  return writeChannelMetadata(client, auth, uid, { kind: 'name', edit }, signal, validate)
}
