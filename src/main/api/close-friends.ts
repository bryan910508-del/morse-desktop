import { randomUUID } from 'node:crypto'
import type { CloseFriendChangeRequest } from '../../shared/close-friend-change'
import { identifier } from '../../shared/validation'
import { FirestoreReader, type ReadCredentials } from '../network/firestore-rpc'
import { CloseFriendChangeFailure } from '../network/close-friend-change-write'
import { childId, documents, documentVersion } from '../network/firestore-values'
import { tr } from '../../shared/i18n'

const pageSize = 500, maxPages = 20

// Close friends as a plain membership set (users/{uid}/closeFriends/{peer}).
// Each toggle is a single conditional write; the final state is read back
// only when the write result is not definite.
export class CloseFriendsApi {
  constructor(private readonly uid: string, private readonly auth: ReadCredentials, private readonly allowed: () => void,
    private readonly candidate: (uid: string) => { displayName: string; version: string }, private readonly contactName: (uid: string) => string | null) {}

  async list(): Promise<string[]> {
    this.allowed()
    const reader = new FirestoreReader(this.auth), parent = `${documents}/users/${this.uid}`, result: string[] = []
    try {
      let cursor: string | null = null
      for (let page = 0; page < maxPages; page++) {
        const docs = await reader.query(parent, { from: [{ collectionId: 'closeFriends' }], orderBy: [{ field: { fieldPath: '__name__' }, direction: 'ASCENDING' }], limit: { value: pageSize },
          ...(cursor ? { startAt: { before: false, values: [{ referenceValue: `${parent}/closeFriends/${cursor}` }] } } : {}) }, this.auth.signal)
        this.allowed()
        for (const doc of docs) result.push(identifier(childId(doc.name, `${parent}/closeFriends`)))
        if (docs.length < pageSize) break
        cursor = result[result.length - 1] ?? null
      }
      return [...new Set(result)]
    } finally { reader.close() }
  }

  async set(peerUid: string, add: boolean): Promise<void> {
    this.allowed()
    if (peerUid === this.uid) throw new Error(tr('다른 사용자를 선택해 주세요.'))
    const reader = new FirestoreReader(this.auth), signal = this.auth.signal
    const path = `${documents}/users/${this.uid}/closeFriends/${peerUid}`
    const validate = (): void => { this.allowed(); if (add) this.candidate(peerUid) }
    try {
      const current = await reader.getDocument(path, signal, validate)
      if (Boolean(current) === add) return
      let request: CloseFriendChangeRequest
      if (add) {
        const contact = this.candidate(peerUid)
        request = { id: randomUUID(), ownerId: this.uid, mode: 'add', peerUid, displayName: contact.displayName, version: null, contactVersion: contact.version }
      } else {
        request = { id: randomUUID(), ownerId: this.uid, mode: 'remove', peerUid, displayName: (this.contactName(peerUid) ?? peerUid).slice(0, 512), version: documentVersion(current!), contactVersion: null }
      }
      try { await reader.changeCloseFriend(this.uid, request, signal, validate) }
      catch (error) {
        let after: unknown = undefined
        try { after = await reader.getDocument(path, signal) } catch { /* fall through to the write error */ }
        if (after !== undefined && Boolean(after) === add) return
        throw new Error(error instanceof CloseFriendChangeFailure && !error.uncertain ? tr('친한 친구를 변경하지 못했습니다.') : tr('친한 친구 변경 결과를 확인하지 못했습니다. 다시 시도해 주세요.'))
      }
    } finally { reader.close() }
  }
}
