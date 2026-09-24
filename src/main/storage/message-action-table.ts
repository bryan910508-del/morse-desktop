import { createHash } from 'node:crypto'
import type Database from 'better-sqlite3-multiple-ciphers'
import { actionRequest } from '../../shared/message-actions'
import { identifier } from '../../shared/validation'
import type { MessageActionCommand, StoredMessageAction } from './message-action-protocol'
import { tr } from '../../shared/i18n'

export function executeMessageAction(db: Database.Database, command: MessageActionCommand): unknown {
  switch (command.kind) {
    case 'action-list': {
      const rows = db.prepare('SELECT payload,state,reason FROM message_actions WHERE payload IS NOT NULL ORDER BY sequence').all() as { payload: string; state: StoredMessageAction['state']; reason: string }[]
      // A reason kept in an earlier language is shown in the current one when it is one of the app's own words.
      return rows.map(row => ({ ...JSON.parse(row.payload) as StoredMessageAction, state: row.state, reason: tr(row.reason) }))
    }
    case 'action-enqueue': return db.transaction(() => {
      const input = command.action, request = actionRequest(input), chatId = identifier(input.chatId)
      const digest = createHash('sha256').update(JSON.stringify({ ...request, chatId })).digest('hex')
      const old = db.prepare('SELECT digest FROM message_actions WHERE id=?').get(request.id) as { digest: string } | undefined
      if (old) {
        if (old.digest !== digest) throw Object.assign(new Error('Action conflict'), { deliveryCode: 'conflict' })
        return null
      }
      // A reaction is the last selection the account made on that message, so a newer one replaces whatever is
      // still waiting — iOS does the same (MorsePendingReactionSync.enqueue drops the intents of that message before
      // adding its own). Without this a reaction whose outcome could not be proven ('uncertain') would refuse every
      // later reaction on that message for good: it is not dismissible until it is inspected, and inspecting a
      // reaction can never resolve it. An edit or a delete still refuses, being a conditional write on one version.
      const pending = db.prepare("SELECT id,payload FROM message_actions WHERE chat_id=? AND message_id=? AND state IN ('queued','uncertain')")
        .get(chatId, request.messageId) as { id: string; payload: string } | undefined
      if (pending) {
        const waiting = JSON.parse(pending.payload) as { kind?: string }
        if (request.kind !== 'reaction' || waiting.kind !== 'reaction') throw Object.assign(new Error('Action pending'), { deliveryCode: 'conflict' })
        db.prepare("UPDATE message_actions SET state='dismissed',payload=NULL,reason='' WHERE id=?").run(pending.id)
      }
      const count = db.prepare('SELECT COUNT(*) AS count FROM message_actions WHERE payload IS NOT NULL').get() as { count: number }
      if (count.count >= 100) throw Object.assign(new Error('Action queue full'), { deliveryCode: 'capacity' })
      db.prepare("INSERT INTO message_actions(id,chat_id,message_id,digest,payload,state) VALUES(?,?,?,?,?,'queued')")
        .run(request.id, chatId, request.messageId, digest, JSON.stringify({ ...request, chatId, preview: String(input.preview).slice(0, 160) }))
      return null
    })()
    case 'action-claim': return db.prepare("UPDATE message_actions SET state='uncertain',reason='결과를 확인하고 있습니다.' WHERE id=? AND state='queued' AND payload IS NOT NULL").run(command.id).changes === 1
    case 'action-state': db.prepare('UPDATE message_actions SET state=?,reason=? WHERE id=? AND payload IS NOT NULL').run(command.state, command.reason, command.id); return null
    case 'action-finish': db.prepare("UPDATE message_actions SET state='done',payload=NULL,reason='' WHERE id=?").run(command.id); return null
    case 'action-dismiss': db.prepare("UPDATE message_actions SET state='dismissed',payload=NULL,reason='' WHERE id=? AND state IN ('queued','failed')").run(command.id); return null
    case 'action-prune': return db.transaction(() => {
      const allowed = new Set(command.allowed)
      const rows = db.prepare('SELECT DISTINCT chat_id FROM message_actions WHERE payload IS NOT NULL').all() as { chat_id: string }[]
      for (const row of rows) if (!allowed.has(row.chat_id)) db.prepare("UPDATE message_actions SET state='dismissed',payload=NULL,reason='' WHERE chat_id=?").run(row.chat_id)
      return null
    })()
  }
}
