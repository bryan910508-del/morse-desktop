import type Database from 'better-sqlite3-multiple-ciphers'
import { storyViewReceiptRequest, type StoryViewReceiptRequest, type PendingStoryViewReceipt, type StoryViewReceiptState } from '../../shared/story-view-receipt'
import { backgroundPhotoId } from '../../shared/chat-background'
export type StoryViewReceiptCommand = { kind: 'story-view-receipt-read' } | { kind: 'story-view-receipt-prepare'; request: StoryViewReceiptRequest } | { kind: 'story-view-receipt-state'; id: string; expected: StoryViewReceiptState; state: StoryViewReceiptState | 'dismissed' }
const conflict = (): never => { throw Object.assign(new Error('Story view receipt changed'), { deliveryCode: 'conflict' }) }
function pending(db: Database.Database, uid: string): PendingStoryViewReceipt | null {
  const rows = db.prepare('SELECT id,payload,state FROM story_view_receipts WHERE payload IS NOT NULL LIMIT 2').all() as { id: string; payload: string; state: string }[]
  if (rows.length > 1) return conflict()
  const row = rows[0]; if (!row) return null
  if (!['prepared','submitted','confirmed','rejected'].includes(row.state) || row.payload.length > 16000) return conflict()
  const request = storyViewReceiptRequest(JSON.parse(row.payload))
  if (request.id !== row.id || request.viewerId !== uid) return conflict()
  return { ...request, state: row.state as StoryViewReceiptState }
}
export function executeStoryViewReceipt(db: Database.Database, command: StoryViewReceiptCommand, uid: string): PendingStoryViewReceipt | null {
  if (command.kind === 'story-view-receipt-read') return pending(db, uid)
  return db.transaction(() => {
    const current = pending(db, uid)
    if (command.kind === 'story-view-receipt-prepare') {
      const request = storyViewReceiptRequest(command.request)
      if (request.viewerId !== uid) return conflict()
      if (current) { const { state, ...previous } = current; if (state === 'prepared' && JSON.stringify(previous) === JSON.stringify(request)) return current; return conflict() }
      if (db.prepare('SELECT 1 FROM story_view_receipts WHERE id=?').get(request.id)) return conflict()
      if ((db.prepare('SELECT COUNT(*) AS n FROM story_view_receipts').get() as { n: number }).n >= 10000) throw Object.assign(new Error('Story view receipt capacity'), { deliveryCode: 'capacity' })
      const payload = JSON.stringify(request); if (payload.length > 16000) return conflict()
      db.prepare("INSERT INTO story_view_receipts(id,payload,state) VALUES(?,?,'prepared')").run(request.id, payload)
    } else {
      backgroundPhotoId(command.id)
      if (command.kind !== 'story-view-receipt-state' || !current || current.id !== command.id || current.state !== command.expected) return conflict()
      if (!(command.state === 'dismissed' || (current.state === 'prepared' && command.state === 'submitted') || (current.state === 'submitted' && ['confirmed','rejected'].includes(command.state)))) return conflict()
      db.prepare('UPDATE story_view_receipts SET state=?,payload=CASE WHEN ? THEN NULL ELSE payload END WHERE id=?').run(command.state, command.state === 'dismissed' ? 1 : 0, command.id)
    }
    return pending(db, uid)
  })()
}
