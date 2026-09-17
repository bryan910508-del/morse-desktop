import type { AccountProfile, ConnectionState } from '../../shared/model'
import type { AccountAuthorization } from '../messaging/outbox'
import { join } from 'node:path'
import { AccountSession, type AccountEvents } from './session'
import { tr } from '../../shared/i18n'

// Main::Domain accounts: every signed-in account keeps its session (lists, sends, notifications);
// the window shows the active one.
export class AccountRegistry {
  private readonly sessions = new Map<string, AccountSession>()
  private activeUid: string | null = null
  private readonly closing = new Map<string, Promise<void>>()
  private closeFailed = false
  constructor(private readonly events: (uid: string) => AccountEvents) {}
  get active(): AccountSession | null { return this.activeUid ? this.sessions.get(this.activeUid) ?? null : null }
  get all(): AccountSession[] { return [...this.sessions.values()] }
  get profiles(): AccountProfile[] { return this.all.map(session => ({ ...session.profile })) }
  get(uid: string): AccountSession | null { return this.sessions.get(uid) ?? null }
  // Only verified authentication calls activation. IPC cannot create sessions.
  activate(profile: AccountProfile, credentials: AccountAuthorization, directory: string, makeActive: boolean): void {
    this.close(profile.uid, true)
    const previous = (this.closing.get(profile.uid) ?? Promise.resolve()).then(() => { if (this.closeFailed) throw new Error(tr('이전 계정 저장소를 닫지 못했습니다.')) })
    const session = new AccountSession(profile, credentials, this.events(profile.uid), join(directory, profile.uid), previous)
    this.sessions.set(profile.uid, session)
    session.setConnection('ready')
    if (makeActive || !this.active) this.activeUid = profile.uid
  }
  setActive(uid: string): void {
    if (!this.sessions.has(uid)) throw new Error(tr('연결된 계정을 찾을 수 없습니다.'))
    this.activeUid = uid
  }
  connection(uid: string, state: ConnectionState): void { this.sessions.get(uid)?.setConnection(state) }
  select(uid: string): void { this.requireActive(uid) }
  requireActive(uid: string): AccountSession {
    const session = this.active
    if (!session || session.profile.uid !== uid) throw new Error(tr('계정이 변경되었습니다. 대화를 다시 선택해 주세요.'))
    return session
  }
  close(uid: string, purge = false): void {
    const old = this.sessions.get(uid)
    if (!old) return
    this.sessions.delete(uid)
    if (this.activeUid === uid) this.activeUid = this.sessions.keys().next().value ?? null
    const closing = old.close(purge)
    this.closing.set(uid, Promise.all([this.closing.get(uid), closing]).then(() => {}).catch(() => { this.closeFailed = true }))
  }
  closeAll(): void { for (const uid of [...this.sessions.keys()]) this.close(uid) }
  async flush(): Promise<void> {
    await Promise.all(this.closing.values())
    if (this.closeFailed) throw new Error(tr('계정의 전송 저장소를 정상적으로 닫지 못했습니다.'))
  }
}
