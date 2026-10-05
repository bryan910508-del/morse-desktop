import type { FirestoreDocument, WireObject } from '../network/firestore-values'
import { boolField } from '../network/firestore-values'

// Server r35 §1 (morse-feature-switch.js decide()): a switch is on for an account when it is on for everyone —
// app_config/{name}.enabled === true — or for that account — users/{uid}/featureAccess/state[field] === true. The
// account's document is written by the operator only and read by its owner only, so no app learns which other accounts
// have a feature; with none, or a read the rules refuse, the decision is the global switch alone, as before.
// Android FeatureSwitch (e8ed5297) holds the same table.
export const featureSwitches = { qr_login: 'qrLogin', two_step: 'twoStep', system_notices: 'systemNotices' } as const
export type FeatureSwitchName = keyof typeof featureSwitches
export const featureAccessPath = (uid: string): string => `users/${uid}/featureAccess/state`

export function featureOn(name: FeatureSwitchName, config: FirestoreDocument | null, access: FirestoreDocument | null): boolean {
  const fields = (document: FirestoreDocument | null): Record<string, WireObject> => (document?.fields ?? {}) as Record<string, WireObject>
  return boolField(fields(config), 'enabled') || boolField(fields(access), featureSwitches[name])
}
