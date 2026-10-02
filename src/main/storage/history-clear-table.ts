import type Database from 'better-sqlite3-multiple-ciphers'
import { historyClearRequest, type HistoryClearRequest } from '../../shared/history-clears'

// Histories cleared for everyone that the server has not confirmed yet (accounts/history-clears.ts), kept through a
// restart as the channel operation queue is. `held`: its answer was lost while the server was not yet known to take a
// fixed boundary, so it waits (A4 §7-2) instead of going again. history_clear_meta keeps whether the server has
// answered with `applied` — the sign that sending the same boundary again is safe.
export interface StoredHistoryClear { request: HistoryClearRequest; state: 'queued' | 'held'; createdAt: number }
export type HistoryClearCommand =
  | { kind: 'history-clear-list' }
  // Puts a request in, taking out the waiting ones for the same room it replaces (a later boundary covers them).
  | { kind: 'history-clear-put'; request: HistoryClearRequest; replaces: string[]; createdAt: number }
  // The boundary found at the first send, or the state, of one request.
  | { kind: 'history-clear-update'; request: HistoryClearRequest; state: 'queued' | 'held' }
  | { kind: 'history-clear-remove'; id: string }
  | { kind: 'history-clear-server-applies' }

export const maxHistoryClears = 200
const target = (request: HistoryClearRequest): string => `${request.kind === 'inquiry-clear' ? 'inquiry' : 'chat'}:${request.targetId}`

export function executeHistoryClear(db: Database.Database, command: HistoryClearCommand): unknown {
  switch (command.kind) {
    case 'history-clear-list': {
      const rows = db.prepare('SELECT payload,state,created_at FROM history_clears ORDER BY sequence').all() as { payload: string; state: 'queued' | 'held'; created_at: number }[]
      const applies = Boolean(db.prepare("SELECT 1 FROM history_clear_meta WHERE key='server-applies'").get())
      return { applies, rows: rows.flatMap(row => {
        try { return [{ request: historyClearRequest(JSON.parse(row.payload)), state: row.state === 'held' ? 'held' : 'queued', createdAt: row.created_at }] }
        catch { return [] }
      }) }
    }
    case 'history-clear-put': return db.transaction(() => {
      const request = historyClearRequest(command.request)
      if (db.prepare('SELECT 1 FROM history_clears WHERE id=?').get(request.id)) return null
      const remove = db.prepare('DELETE FROM history_clears WHERE id=?')
      for (const id of command.replaces) remove.run(id)
      if ((db.prepare('SELECT COUNT(*) AS n FROM history_clears').get() as { n: number }).n >= maxHistoryClears) throw Object.assign(new Error('History clear capacity'), { deliveryCode: 'capacity' })
      db.prepare("INSERT INTO history_clears(id,target,payload,state,created_at) VALUES(?,?,?,'queued',?)").run(request.id, target(request), JSON.stringify(request), command.createdAt)
      return null
    })()
    case 'history-clear-update': {
      const request = historyClearRequest(command.request)
      db.prepare('UPDATE history_clears SET payload=?,state=? WHERE id=?').run(JSON.stringify(request), command.state === 'held' ? 'held' : 'queued', request.id)
      return null
    }
    case 'history-clear-remove': db.prepare('DELETE FROM history_clears WHERE id=?').run(command.id); return null
    case 'history-clear-server-applies': db.prepare("INSERT OR IGNORE INTO history_clear_meta(key,value) VALUES('server-applies','1')").run(); return null
  }
}
