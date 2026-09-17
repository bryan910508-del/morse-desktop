import { identifier, object } from '../../shared/validation'
import type { FirestoreDocument } from './firestore-values'
// This field is owner metadata. Missing follows the existing server [] default;
// malformed, duplicated or oversized arrays never become an empty audience.
export function storyHiddenFrom(doc: FirestoreDocument): { hiddenFrom: string[]; field: 'missing' | 'stored' } {
  const field = doc.fields.hiddenFrom
  if (field === undefined) return { hiddenFrom: [], field: 'missing' }
  const array = object(field.arrayValue), values = array.values === undefined ? [] : array.values
  if (!Array.isArray(values) || values.length > 1000) throw new Error('Unsupported story hidden audience')
  const hiddenFrom = values.map(value => identifier(object(value).stringValue))
  if (new Set(hiddenFrom).size !== hiddenFrom.length) throw new Error('Duplicate story hidden audience')
  return { hiddenFrom, field: 'stored' }
}
