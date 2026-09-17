import type { DataBatch, DesktopSnapshot, DialogSummary } from '../../shared/model'

type Fields = DataBatch['fields']

// Mirrors Telegram Desktop's Data::Changes: the renderer receives the slices
// and dialog rows that changed, never a rebuilt copy of the whole session.
export class DataPublisher {
  private revision = -1
  private fields = new Map<string, string>()
  private rows = new Map<string, string>()
  private order = ''

  reset(snapshot: DesktopSnapshot): void {
    if (snapshot.revision < this.revision) return
    this.revision = snapshot.revision
    this.fields = new Map(Object.entries(snapshot).filter(([key]) => key !== 'revision' && key !== 'dialogs').map(([key, value]) => [key, JSON.stringify(value)]))
    this.rows = new Map(snapshot.dialogs.map(dialog => [dialog.id, JSON.stringify(dialog)]))
    this.order = JSON.stringify(snapshot.dialogs.map(dialog => dialog.id))
  }

  diff(snapshot: DesktopSnapshot): DataBatch | null {
    // Without a renderer baseline there is nothing to diff against; the next
    // snapshot request establishes one. Older snapshots never move it back.
    if (this.revision < 0 || snapshot.revision <= this.revision) return null
    const fields: Fields = {}
    let changedFields = false
    for (const [key, value] of Object.entries(snapshot)) {
      if (key === 'revision' || key === 'dialogs') continue
      const json = JSON.stringify(value)
      if (this.fields.get(key) === json) continue
      this.fields.set(key, json); (fields as Record<string, unknown>)[key] = value; changedFields = true
    }
    const upsert: DialogSummary[] = [], seen = new Set<string>()
    for (const dialog of snapshot.dialogs) {
      seen.add(dialog.id)
      const json = JSON.stringify(dialog)
      if (this.rows.get(dialog.id) !== json) { this.rows.set(dialog.id, json); upsert.push(dialog) }
    }
    const remove = [...this.rows.keys()].filter(id => !seen.has(id))
    for (const id of remove) this.rows.delete(id)
    const ids = snapshot.dialogs.map(dialog => dialog.id), order = JSON.stringify(ids), reordered = order !== this.order
    this.order = order
    if (!changedFields && !upsert.length && !remove.length && !reordered) return null
    const base = this.revision
    this.revision = snapshot.revision
    return { base, revision: snapshot.revision, fields, ...(upsert.length || remove.length || reordered ? { dialogs: { order: ids, upsert, remove } } : {}) }
  }
}
