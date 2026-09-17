import { object } from '../../shared/validation'
import { storyReactionChoices, type ContactStoryReactionValue } from '../../shared/contact-story-reaction'
import type { FirestoreDocument } from './firestore-values'
export function currentViewerReaction(doc: FirestoreDocument, uid: string, adding = false): ContactStoryReactionValue {
  const field = doc.fields.reactionByUid
  if (field === undefined) return { field: 'missing', value: null, supported: true }
  const entries = object(object(field.mapValue).fields ?? {})
  if (Object.keys(entries).length > 1000) throw new Error('Unsupported reaction map size')
  if (adding && Object.keys(entries).length >= 1000 && !Object.hasOwn(entries, uid)) throw new Error('Reaction map capacity')
  if (!Object.hasOwn(entries, uid)) return { field: 'absent', value: null, supported: true }
  const value = object(entries[uid]).stringValue
  if (typeof value !== 'string' || !value || value.length > 64 || Array.from(value).some(char => { const code = char.codePointAt(0)!; return code >= 0xD800 && code <= 0xDFFF })) throw new Error('Unsupported viewer reaction')
  return { field: 'stored', value, supported: storyReactionChoices.some(emoji => emoji === value) }
}
