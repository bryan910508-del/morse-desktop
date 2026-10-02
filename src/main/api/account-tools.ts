import type { ReportRequest } from '../../shared/reports'
import { defaultSessionTtlDays, sessionTtlDayOptions, type AccountPrivacy, type BlockTarget, type BlockedUser, type DataExport, type LastSeenPrivacy, type SessionPlatform, type SignInSession, type SignInSessions } from '../../shared/account-tools'
import { normalizeBackupCode } from '../../shared/auth'
import type { AccountAuthorization } from '../messaging/outbox'
import { autoDeleteSecondsValue } from '../../shared/chat-auto-delete'
import { maxFolderChats, maxFolders, type ChatFolder } from '../../shared/chat-folders'
import { DocumentWriteFailure, FirestoreReader } from '../network/firestore-rpc'
import { boolField, childId, documents, numberField, stringField, timestamp, type FirestoreDocument, type WireObject } from '../network/firestore-values'
import { callMorseFunction, MorseCallableFailure } from '../network/morse-callable'
import { tr } from '../../shared/i18n'

type Value = { stringValue?: string; timestampValue?: string; mapValue?: { fields?: Record<string, Value> }; arrayValue?: { values?: Value[] } }
const fieldsOf = (doc: FirestoreDocument): Record<string, Value> => (doc.fields ?? {}) as unknown as Record<string, Value>
const text = (value: Value | undefined, max = 512): string => typeof value?.stringValue === 'string' ? value.stringValue.slice(0, max) : ''
// A Firestore timestamp in milliseconds. gRPC reads give {seconds, nanos}; the RFC 3339 string form is read too. Only
// the string form was read before, so sessions' last activity and blocking times always came out empty.
const time = (value: Value | undefined): number | null => {
  const raw = value?.timestampValue as unknown
  if (raw && typeof raw === 'object') {
    try { const at = timestamp(raw, ''); return at.seconds * 1000 + Math.floor(at.nanoseconds / 1e6) } catch { return null }
  }
  const parsed = typeof raw === 'string' ? Date.parse(raw) : NaN
  return Number.isFinite(parsed) ? parsed : null
}
const lastSegment = (name: string): string => name.slice(name.lastIndexOf('/') + 1)

function folderIds(fields: Record<string, WireObject>, key: string): string[] {
  const values = (fields[key] as { arrayValue?: { values?: { stringValue?: unknown }[] } } | undefined)?.arrayValue?.values
  if (!Array.isArray(values)) return []
  return [...new Set(values.flatMap(value => typeof value?.stringValue === 'string' && /^[A-Za-z0-9_-]{1,160}$/.test(value.stringValue) ? [value.stringValue] : []))].slice(0, maxFolderChats)
}
export function decodeChatFolder(doc: FirestoreDocument, uid: string): ChatFolder {
  const f = doc.fields ?? {}
  return { id: childId(doc.name, `${documents}/users/${uid}/folders`), name: stringField(f, 'name', 512), emoji: stringField(f, 'emoji', 32),
    chatIds: folderIds(f, 'chatIds'), excludeChatIds: folderIds(f, 'excludeChatIds'), pinnedChatIds: folderIds(f, 'pinnedChatIds'),
    excludeMuted: boolField(f, 'excludeMuted'), excludeRead: boolField(f, 'excludeRead'), excludeArchived: f.excludeArchived === undefined ? true : boolField(f, 'excludeArchived'),
    includeContacts: boolField(f, 'includeContacts'), includeNonContacts: boolField(f, 'includeNonContacts'), includeGroups: boolField(f, 'includeGroups'),
    includeChannels: boolField(f, 'includeChannels'), order: numberField(f, 'order') }
}

const platforms: SessionPlatform[] = ['iOS', 'Android', 'macOS', 'Windows']
const lastActive = (row: SignInSession): number => row.lastSeenAt ?? row.createdAt ?? 0
// One session document as a row. A document still marked as revoked is left out (A6 §4-4: an old one without a login
// generation, which the server can only mark). A row written before A6 has no device model or app name: the model
// comes from its old label without «Morse · », the name from the platform the server verified (A6 §3-3).
export function decodeSignInSession(doc: FirestoreDocument, currentSessionId: string): SignInSession | null {
  const f = fieldsOf(doc), id = lastSegment(doc.name)
  if (f.revokeRequestedAt) return null
  const verified = text(f.platform, 20), platform = platforms.find(item => item === verified) ?? 'other'
  return {
    id, platform, current: id === currentSessionId,
    deviceModel: text(f.deviceModel, 100).trim() || text(f.deviceLabel, 160).replace(/^Morse\s*·\s*/, '').trim() || tr('알 수 없는 기기'),
    appName: text(f.appName, 40).trim() || (platform === 'other' ? 'Morse' : `Morse ${platform}`),
    appVersion: text(f.appVersion, 40).trim(), systemVersion: text(f.systemVersion, 40).trim(),
    lastSeenAt: time(f.lastSeenAt), createdAt: time(f.createdAt)
  }
}

// Account-level tools that the iOS app reaches through callables or its own user documents:
// chat history clearing, the memo chat, blocking, sign-in sessions, recovery code, privacy and deletion.
// reports/{auto-id} as firestore.rules isValidReport takes it: the common fields, then each kind's own (A10 §3-1).
export function reportFields(uid: string, request: ReportRequest, now: number): Record<string, WireObject> {
  const target = request.target
  const fields: Record<string, WireObject> = { type: { stringValue: target.type }, targetId: { stringValue: target.targetId }, reporterId: { stringValue: uid },
    category: { stringValue: request.category }, createdAt: { timestampValue: { seconds: String(Math.floor(now / 1000)), nanos: (now % 1000) * 1000000 } } }
  if (target.type === 'post') fields.channelId = { stringValue: target.channelId }
  if (target.type === 'message') fields.chatId = { stringValue: target.chatId }
  if (target.type === 'comment') { fields.channelId = { stringValue: target.channelId }; fields.postId = { stringValue: target.postId } }
  if (target.type === 'story') { fields.ownerType = { stringValue: target.ownerType }; fields.ownerId = { stringValue: target.ownerId } }
  if (request.extra) fields.extra = { stringValue: request.extra }
  return fields
}
export class AccountToolsApi {
  constructor(private readonly uid: string, private readonly auth: AccountAuthorization, private readonly allowed: () => unknown) {}
  private get sessionId(): string { const scope = this.auth.storageScope; return scope.slice(0, scope.lastIndexOf(':')) }
  private async read<T>(work: (reader: FirestoreReader, signal: AbortSignal) => Promise<T>): Promise<T> {
    this.allowed()
    const reader = new FirestoreReader(this.auth)
    try { return await work(reader, AbortSignal.timeout(35000)) } finally { reader.close() }
  }
  private call(name: string, data: Record<string, unknown>): Promise<Record<string, unknown>> {
    this.allowed()
    return callMorseFunction(this.auth, name, data, AbortSignal.timeout(65000))
  }

  // Clearing a room's history for everyone (clearMorseChatHistory, deleteDirectChatHistory) is the device queue's:
  // accounts/history-clears.ts (A4).
  // AppState.getOrCreateMemoChat: the server creates chats/memo_{uid} once.
  async prepareMemoChat(): Promise<string> {
    const chatId = `memo_${this.uid}`
    let result: Record<string, unknown>
    try { result = await this.call('prepareMorseMemoChat', {}) } catch { throw new Error(tr('내 메모를 준비하지 못했습니다.')) }
    if (result.chatId !== chatId) throw new Error(tr('내 메모를 준비하지 못했습니다.'))
    return chatId
  }
  blockedUsers(): Promise<BlockedUser[]> {
    return this.read(async (reader, signal) => (await reader.query(`${documents}/users/${this.uid}`, { from: [{ collectionId: 'blocked' }] }, signal)).map(doc => {
      const f = fieldsOf(doc), userId = text(f.userId, 160)
      return { uid: lastSegment(doc.name), userId, displayName: text(f.displayName) || userId || tr('알 수 없는 사용자'), blockedAt: time(f.blockedAt) }
    }).sort((a, b) => (b.blockedAt ?? 0) - (a.blockedAt ?? 0)))
  }
  async setBlocked(target: BlockTarget, blocked: boolean): Promise<void> {
    if (target.uid === this.uid) throw new Error(tr('자기 자신은 차단할 수 없습니다.'))
    try { await this.read((reader, signal) => blocked ? reader.setBlockedUser(this.uid, target, signal) : reader.deleteBlockedUser(this.uid, target.uid, signal)) }
    catch { throw new Error(blocked ? tr('사용자를 차단하지 못했습니다.') : tr('차단을 해제하지 못했습니다.')) }
  }
  // Telegram's account.getAuthorizations: this device first, then the others by last activity, and the account's
  // «terminate old sessions» period (users/{uid}/signInSettings/main, A6 §3-2).
  signInSessions(): Promise<SignInSessions> {
    return this.read(async (reader, signal) => {
      const [docs, settings] = await Promise.all([
        reader.query(`${documents}/users/${this.uid}`, { from: [{ collectionId: 'signInSessions' }] }, signal),
        reader.getDocument(`${documents}/users/${this.uid}/signInSettings/main`, signal)
      ])
      const sessions = docs.flatMap(doc => { const row = decodeSignInSession(doc, this.sessionId); return row ? [row] : [] })
        .sort((a, b) => a.current !== b.current ? (a.current ? -1 : 1) : lastActive(b) - lastActive(a))
      const days = settings ? numberField(settings.fields ?? {}, 'authorizationTtlDays') : NaN
      return { sessions, ttlDays: sessionTtlDayOptions.includes(days as typeof sessionTtlDayOptions[number]) ? days : defaultSessionTtlDays }
    })
  }
  // revokeMorseDeviceSession: one other session, or every session except this device's. The server deletes them at
  // once and refuses their sign-ins everywhere (A6 §3-1); this device signs itself out from settings.
  async revokeSessions(sessionId: string | null): Promise<void> {
    if (sessionId === this.sessionId) throw new Error(tr('이 기기는 설정의 로그아웃으로 로그아웃해 주세요.'))
    try { await this.call('revokeMorseDeviceSession', sessionId ? { sessionId } : { allOthers: true, currentSessionId: this.sessionId }) }
    catch { throw new Error(tr('세션을 종료하지 못했습니다.')) }
  }
  // setMorseSessionTtl: the account's own period for ending idle sessions (Telegram account.setAuthorizationTTL).
  async setSessionTtl(days: number): Promise<void> {
    try { await this.call('setMorseSessionTtl', { days }) }
    catch { throw new Error(tr('기간을 바꾸지 못했습니다.')) }
  }
  // AuthService.updateBackupCode: the current code proves ownership of the new one.
  // One send of a recovery code change; the change itself — kept, sent again, confirmed — is auth/backup-code-rotation.ts
  // (A3). A failure is thrown as it came: MorseCallableFailure says whether the server answered.
  async updateBackupCode(oldCode: string, newCode: string): Promise<void> {
    await this.call('updateBackupCode', { newBackupCode: newCode, oldBackupCode: normalizeBackupCode(oldCode) })
  }
  lastSeenPrivacy(): Promise<LastSeenPrivacy> {
    return this.read(async (reader, signal) => {
      const doc = await reader.getDocument(`${documents}/users/${this.uid}`, signal)
      const lastSeen = doc ? fieldsOf(doc).privacy?.mapValue?.fields?.lastSeen?.mapValue?.fields : undefined
      const ids = (value: Value | undefined): string[] => (value?.arrayValue?.values ?? []).map(item => item.stringValue).filter((item): item is string => typeof item === 'string').slice(0, 200)
      const mode = text(lastSeen?.mode, 16)
      // MorseLastSeenPrivacySettings.default: everybody when nothing is stored.
      return { mode: mode === 'contacts' || mode === 'nobody' ? mode : 'everybody', alwaysShareWith: ids(lastSeen?.alwaysShareWith), neverShareWith: ids(lastSeen?.neverShareWith) }
    })
  }
  async setLastSeenPrivacy(value: LastSeenPrivacy): Promise<void> {
    try { await this.call('syncPrivacySettings', { lastSeenPrivacy: { mode: value.mode, alwaysShareWith: value.alwaysShareWith, neverShareWith: value.neverShareWith } }) }
    catch { throw new Error(tr('마지막 접속 공개 범위를 저장하지 못했습니다.')) }
  }
  // AppState folder listener: users/{uid}/folders sorted by order. Unreadable documents are skipped.
  chatFolders(): Promise<ChatFolder[]> {
    return this.read(async (reader, signal) => (await reader.query(`${documents}/users/${this.uid}`, { from: [{ collectionId: 'folders' }] }, signal)).flatMap(doc => {
      try { return [decodeChatFolder(doc, this.uid)] } catch { return [] }
    }).sort((a, b) => a.order - b.order || a.id.localeCompare(b.id)).slice(0, maxFolders))
  }
  // The account's default for new chats. An account that has never stored one adopts this device's old value once,
  // so moving the setting off the device does not quietly turn it off.
  async accountAutoDeleteDefault(deviceSeconds: number): Promise<number> {
    return this.read(async (reader, signal) => {
      const doc = await reader.getDocument(`${documents}/users/${this.uid}/private/chatSettings`, signal)
      const fields = doc?.fields ?? {}
      if (fields.defaultAutoDeleteSeconds !== undefined) return autoDeleteSecondsValue(Math.trunc(numberField(fields, 'defaultAutoDeleteSeconds')))
      const legacy = autoDeleteSecondsValue(deviceSeconds)
      if (legacy > 0) await reader.setAccountDefaultAutoDelete(this.uid, legacy, signal)
      return legacy
    })
  }
  setAccountAutoDeleteDefault(seconds: number): Promise<'done' | 'unconfirmed'> {
    return this.documentWrite((reader, signal) => reader.setAccountDefaultAutoDelete(this.uid, seconds, signal),
      tr('자동 삭제 설정을 저장할 수 없어요. 연결을 확인해 주세요.'))
  }
  private async documentWrite(work: (reader: FirestoreReader, signal: AbortSignal) => Promise<void>, failure: string): Promise<'done' | 'unconfirmed'> {
    try { await this.read(work); return 'done' }
    catch (error) {
      if (error instanceof DocumentWriteFailure && error.uncertain) return 'unconfirmed'
      throw new Error(failure)
    }
  }
  // AppState.createFolder writes the whole folder; updateFolder merges the edited fields into an existing one.
  saveChatFolder(folder: ChatFolder, create: boolean): Promise<'done' | 'unconfirmed'> {
    const list = (ids: string[]): WireObject => ({ arrayValue: { values: ids.map(id => ({ stringValue: id })) } })
    const fields: Record<string, WireObject> = {
      id: { stringValue: folder.id }, name: { stringValue: folder.name },
      chatIds: list(folder.chatIds), excludeChatIds: list(folder.excludeChatIds), pinnedChatIds: list(folder.pinnedChatIds),
      excludeMuted: { booleanValue: folder.excludeMuted }, excludeRead: { booleanValue: folder.excludeRead }, excludeArchived: { booleanValue: folder.excludeArchived },
      includeContacts: { booleanValue: folder.includeContacts }, includeNonContacts: { booleanValue: folder.includeNonContacts },
      includeGroups: { booleanValue: folder.includeGroups }, includeChannels: { booleanValue: folder.includeChannels }, order: { integerValue: String(folder.order) }
    }
    if (folder.emoji) fields.emoji = { stringValue: folder.emoji }
    const mask = [...Object.keys(fields).filter(key => key !== 'emoji'), 'emoji']
    if (create) { const now = Date.now(); fields.createdAt = { timestampValue: { seconds: String(Math.floor(now / 1000)), nanos: (now % 1000) * 1000000 } } }
    return this.documentWrite((reader, signal) => reader.saveChatFolder(this.uid, folder.id, fields, create ? null : mask, signal), tr('폴더를 저장하지 못했습니다.'))
  }
  deleteChatFolder(folderId: string): Promise<'done' | 'unconfirmed'> {
    return this.documentWrite((reader, signal) => reader.deleteChatFolder(this.uid, folderId, signal), tr('폴더를 삭제하지 못했습니다.'))
  }
  reorderChatFolders(folderIds: string[]): Promise<'done' | 'unconfirmed'> {
    return this.documentWrite((reader, signal) => reader.reorderChatFolders(this.uid, folderIds, signal), tr('폴더 순서를 저장하지 못했습니다.'))
  }
  // The server policy trigger posts the notice to the other participants.
  setChatAutoDelete(chatId: string, seconds: number): Promise<'done' | 'unconfirmed'> {
    return this.documentWrite((reader, signal) => reader.setChatAutoDelete(this.uid, chatId, seconds, signal), tr('자동 삭제 설정을 저장할 수 없어요. 연결을 확인해 주세요.'))
  }
  // InviteLinkService.createLink uses its defaults: one use, valid for 24 hours.
  async createInviteLink(): Promise<{ token: string; url: string; expiresAt: number }> {
    let result: Record<string, unknown>
    try { result = await this.call('createInviteLink', { oneTime: true, expiresInHours: 24 }) } catch { throw new Error(tr('초대 링크를 만들지 못했습니다.')) }
    if (typeof result.token !== 'string' || typeof result.url !== 'string' || typeof result.expiresAt !== 'number' || !/^https:\/\//.test(result.url)) throw new Error(tr('초대 링크를 만들지 못했습니다.'))
    return { token: result.token, url: result.url, expiresAt: result.expiresAt }
  }
  // InviteLinkService.useLink returns the person who made the link; adding the contact is a separate step.
  async useInviteLink(token: string): Promise<{ uid: string; userId: string; displayName: string; bio: string }> {
    let result: Record<string, unknown>
    try { result = await this.call('useInviteLink', { token }) } catch { throw new Error(tr('초대 링크를 열지 못했습니다. 링크를 다시 확인해 주세요.')) }
    const value = (key: string, max: number): string => typeof result[key] === 'string' ? (result[key] as string).slice(0, max) : ''
    if (typeof result.creatorId !== 'string' || !result.creatorId) throw new Error(tr('초대 링크를 열지 못했습니다.'))
    if (result.creatorId === this.uid) throw new Error(tr('내가 만든 초대 링크입니다.'))
    return { uid: result.creatorId, userId: value('creatorUserId', 160), displayName: value('displayName', 512), bio: value('bio', 500) }
  }
  // A report the way iOS files one; firestore.rules v4.8.10 allows only this create, under the reporter's own uid.
  // B52: whether this account closed the «unknown person» bar for a peer, on any of its devices.
  peerBarHidden(peer: string): Promise<boolean> {
    return this.read(async (reader, signal) => (await reader.getDocument(`${documents}/users/${this.uid}/settings/peerBar_${peer}`, signal))?.fields?.hidden?.booleanValue === true)
  }
  hidePeerBar(peer: string): Promise<void> { return this.read((reader, signal) => reader.hidePeerBar(this.uid, peer, signal)) }
  async report(request: ReportRequest): Promise<void> {
    if (request.target.type === 'user' && request.target.targetId === this.uid) throw new Error(tr('자신은 신고할 수 없어요.'))
    const fields = reportFields(this.uid, request, Date.now())
    try { await this.read((reader, signal) => reader.createReport(fields, signal)) }
    catch (error) {
      const code = (error as { code?: number }).code
      throw new Error(code === 7 ? tr('신고 실패: 서버가 신고 저장을 허용하지 않았어요.') : tr('신고 실패: 연결을 확인한 뒤 다시 시도해 주세요.'))
    }
  }
  // The iOS UI shows six months until a value is stored (AppStorage autoDeleteAccountMonths = 6).
  accountPrivacy(): Promise<AccountPrivacy> {
    return this.read(async (reader, signal) => {
      const doc = await reader.getDocument(`${documents}/users/${this.uid}`, signal)
      const fields = (doc?.fields ?? {}) as Record<string, WireObject>
      const privacy = ((fields.privacy as { mapValue?: { fields?: Record<string, WireObject> } } | undefined)?.mapValue?.fields ?? {})
      const stored = privacy.autoDeleteAccountMonths === undefined ? 6 : Math.trunc(numberField(privacy, 'autoDeleteAccountMonths'))
      return { isPrivate: doc ? boolField(fields, 'isPrivate') : false, autoDeleteMonths: stored }
    })
  }
  // PrivacyModeRowView.save: AuthService.updateProfile(uid, ["isPrivate": value]).
  async setPrivateMode(value: boolean): Promise<'done' | 'unconfirmed'> {
    return this.documentWrite((reader, signal) => reader.updateUserFields(this.uid, { isPrivate: { booleanValue: value } }, ['isPrivate'], signal), tr('비공개 모드를 바꾸지 못했습니다.'))
  }
  // PrivacyService.syncSettings(autoDeleteAccountMonths:).
  async setAutoDeleteMonths(months: number): Promise<void> {
    try { await this.call('syncPrivacySettings', { autoDeleteAccountMonths: months }) }
    catch { throw new Error(tr('자동 회원 탈퇴 기간을 저장하지 못했습니다.')) }
  }
  // PrivacyService.requestDataExport: a JSON file on the server and a signed address that expires.
  async requestDataExport(): Promise<DataExport> {
    let result: Record<string, unknown>
    try { result = await this.call('requestDataExport', {}) }
    catch { throw new Error(tr('데이터를 준비하지 못했습니다. 잠시 후 다시 시도해 주세요.')) }
    const url = typeof result.downloadURL === 'string' ? result.downloadURL : '', expiresAt = Number(result.expiresAt), size = Number(result.fileSizeBytes)
    let parsed: URL | null = null
    try { parsed = new URL(url) } catch { parsed = null }
    if (!parsed || parsed.protocol !== 'https:' || !Number.isFinite(expiresAt) || !Number.isSafeInteger(size) || size < 0) throw new Error(tr('응답 형식이 올바르지 않아요'))
    return { downloadURL: parsed.href, expiresAt, fileSizeBytes: size }
  }
  // deleteCurrentMorseAccount purges the account and its owned channels on the server.
  async deleteAccount(): Promise<void> {
    let result: Record<string, unknown>
    try { result = await this.call('deleteCurrentMorseAccount', { expectedUid: this.uid }) }
    catch { throw new Error(tr('계정을 삭제하지 못했습니다. 연결을 확인한 뒤 다시 시도해 주세요.')) }
    if (result.ok !== true || result.deletedUid !== this.uid) throw new Error(tr('계정 삭제 결과를 확인하지 못했습니다.'))
  }
}
