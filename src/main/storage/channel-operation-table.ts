import { createHash } from 'node:crypto'
import type Database from 'better-sqlite3-multiple-ciphers'
import { channelOperationRequest, type ChannelOperationRequest } from '../../shared/channel-operations'

// Changes to channel posts and comments this account asked for and the server has not shown yet (channel-operations.ts):
// kept through a restart, as the reaction queue and the inquiry queue are.
export interface StoredChannelOperation { request: ChannelOperationRequest; target: string; state: 'queued' | 'failed'; reason: string; createdAt: number }
export type ChannelOperationCommand =
  | { kind: 'channel-operation-list' }
  // Puts a request in, taking out those it replaces (a waiting like or waiting words for the same post) in the same step.
  | { kind: 'channel-operation-put'; request: ChannelOperationRequest; target: string; replaces: string[]; createdAt: number }
  | { kind: 'channel-operation-state'; id: string; state: 'queued' | 'failed'; reason: string }
  | { kind: 'channel-operation-remove'; id: string }

export const maxChannelOperations = 200
const conflict = (reason: string): never => { throw Object.assign(new Error(reason), { deliveryCode: 'conflict' }) }
const digest = (request: ChannelOperationRequest): string => createHash('sha256').update(JSON.stringify(request)).digest('hex')

export function executeChannelOperation(db: Database.Database, command: ChannelOperationCommand): unknown {
  switch (command.kind) {
    case 'channel-operation-list': {
      const rows = db.prepare('SELECT payload,target,state,reason,created_at FROM channel_operations ORDER BY sequence').all() as
        { payload: string; target: string; state: 'queued' | 'failed'; reason: string; created_at: number }[]
      return rows.flatMap(row => {
        try { return [{ request: channelOperationRequest(JSON.parse(row.payload)), target: row.target, state: row.state, reason: row.reason, createdAt: row.created_at }] }
        catch { return [] }
      })
    }
    case 'channel-operation-put': return db.transaction(() => {
      const request = channelOperationRequest(command.request), key = digest(request)
      const old = db.prepare('SELECT digest FROM channel_operations WHERE id=?').get(request.id) as { digest: string } | undefined
      // The same request handed over twice stays one; another under its id is refused.
      if (old) { if (old.digest !== key) return conflict('Channel operation conflict'); return null }
      const remove = db.prepare('DELETE FROM channel_operations WHERE id=?')
      for (const id of command.replaces) remove.run(id)
      if ((db.prepare('SELECT COUNT(*) AS n FROM channel_operations').get() as { n: number }).n >= maxChannelOperations) throw Object.assign(new Error('Channel operation capacity'), { deliveryCode: 'capacity' })
      db.prepare("INSERT INTO channel_operations(id,target,kind,digest,payload,state,reason,created_at) VALUES(?,?,?,?,?,'queued','',?)")
        .run(request.id, command.target, request.kind, key, JSON.stringify(request), command.createdAt)
      return null
    })()
    case 'channel-operation-state': db.prepare('UPDATE channel_operations SET state=?,reason=? WHERE id=?').run(command.state, command.reason, command.id); return null
    case 'channel-operation-remove': db.prepare('DELETE FROM channel_operations WHERE id=?').run(command.id); return null
  }
}
