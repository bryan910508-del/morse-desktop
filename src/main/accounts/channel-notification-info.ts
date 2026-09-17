import { channelNotificationModes, type ChannelNotificationInfo } from '../../shared/channel-notification-info'
import { object } from '../../shared/validation'
import type { FirestoreDocument } from '../network/firestore-values'

export function channelNotificationInfo(subscription: FirestoreDocument | undefined): ChannelNotificationInfo {
  if (!subscription) return { mode: null, origin: 'unavailable' }
  const raw = subscription.fields.notificationMode
  if (raw === undefined) return { mode: 'on', origin: 'default' }
  try {
    const value = object(raw).stringValue
    if (typeof value === 'string' && Object.hasOwn(channelNotificationModes, value)) return { mode: value as keyof typeof channelNotificationModes, origin: 'stored' }
  } catch { /* Unsupported values are never silently converted to enabled notifications. */ }
  return { mode: null, origin: 'unknown' }
}
