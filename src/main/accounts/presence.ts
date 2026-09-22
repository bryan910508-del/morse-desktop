import { randomUUID } from 'node:crypto'
import { deleteApp, initializeApp, type FirebaseApp } from '@firebase/app'
import { _initStandalone, goOffline, onDisconnect, onValue, ref, serverTimestamp, update, type Database } from '@firebase/database'
import type { FirebaseAuthInternal } from '@firebase/auth-interop-types'
import type { FirebaseAppCheckInternal } from '@firebase/app-check-interop-types'
import { peerPresence, type PeerPresence } from '../../shared/presence'
import type { ReadCredentials } from '../network/firestore-rpc'
import { callMorseFunction } from '../network/morse-callable'
import { PresenceHold } from './presence-hold'

// The Realtime Database client exports _initStandalone at runtime but leaves it out of its public
// typings; it is the documented way to supply custom auth and App Check tokens without Firebase Auth.
declare module '@firebase/database' {
  export function _initStandalone(options: {
    app: FirebaseApp; url: string; version: string; customAuthImpl: FirebaseAuthInternal
    customAppCheckImpl?: FirebaseAppCheckInternal; nodeAdmin?: boolean
  }): Database
}

const databaseURL = 'https://talky-a38c3-default-rtdb.asia-southeast1.firebasedatabase.app'
// MorseAppConfig.contactListPresenceMaxSubscriptions; resolvePeerPresences takes up to 48 as well.
const maxWatched = 48
// UserData::lastseen stays known after a row leaves the screen; the value is read again when the row comes back.
const maxRemembered = 2000
export type PresenceSurface = 'chat' | 'profile' | 'dialogs' | 'contacts'
const surfaceOrder: PresenceSurface[] = ['chat', 'profile', 'dialogs', 'contacts']

// One account's presence on the Realtime Database, as MorseAccountPresenceWriter and
// MorsePeerPresenceStore do on iOS: presence/{me} {online, lastSeen} with an onDisconnect
// fallback, and presenceRedacted/{me}/{peer} for the people on screen. When the account is
// online is decided by the app (Telegram Api::Updates::updateOnline).
export class AccountPresence {
  private app: FirebaseApp | null = null
  private database: Database | null = null
  private stopConnected: (() => void) | null = null
  private stopOwn: (() => void) | null = null
  private connected = false
  private online = false
  // What presence/{me} holds as far as this connection knows: true after writing online.
  private written = false
  private readonly surfaces = new Map<PresenceSurface, string[]>()
  private readonly watched = new Map<string, () => void>()
  private readonly values = new Map<string, PeerPresence>()
  private readonly held = new PresenceHold()
  private readonly resolving = new Set<string>()
  private closed = false
  constructor(private readonly uid: string, private readonly credentials: ReadCredentials, private readonly changed: () => void) {}

  private token = async (force: boolean): Promise<{ idToken: string; appCheckToken: string }> => this.credentials.authorize(this.credentials.signal, force)
  private db(): Database | null {
    if (this.closed || this.credentials.signal.aborted) return null
    if (this.database) return this.database
    const app = initializeApp({ projectId: 'talky-a38c3', databaseURL }, `morse-presence-${randomUUID()}`)
    const auth: FirebaseAuthInternal = {
      getToken: async refresh => { try { return { accessToken: (await this.token(Boolean(refresh))).idToken } } catch { return null } },
      getUid: () => this.uid,
      addAuthTokenListener: () => {},
      removeAuthTokenListener: () => {}
    }
    const appCheck: FirebaseAppCheckInternal = {
      getToken: async () => { try { return { token: (await this.token(false)).appCheckToken } } catch (error) { return { token: '', error: error instanceof Error ? error : new Error('App Check unavailable') } } },
      getLimitedUseToken: async () => { try { return { token: (await this.token(false)).appCheckToken } } catch (error) { return { token: '', error: error instanceof Error ? error : new Error('App Check unavailable') } } },
      addTokenListener: () => {},
      removeTokenListener: () => {}
    }
    const database = _initStandalone({ app, url: databaseURL, version: 'morse-desktop', customAuthImpl: auth, customAppCheckImpl: appCheck })
    this.app = app; this.database = database
    this.stopConnected = onValue(ref(database, '.info/connected'), snapshot => {
      if (this.closed) return
      this.connected = snapshot.val() === true
      // A new connection starts offline: onDisconnect already ran for the previous one.
      if (this.connected) this.written = false
      this.apply()
    })
    return database
  }
  private apply(): void {
    const database = this.database
    if (!database || !this.connected || this.closed || this.written === this.online) return
    const me = ref(database, `presence/${this.uid}`), online = this.online
    this.written = online
    const retry = (): void => { if (this.written === online) this.written = !online }
    if (online) {
      void onDisconnect(me).update({ online: false, lastSeen: serverTimestamp() }).catch(() => {})
      void update(me, { online: true, lastSeen: serverTimestamp() }).catch(retry)
      this.watchOwn(database)
    } else {
      // This device's own sign-off must not look like another device's.
      this.stopOwn?.(); this.stopOwn = null
      void onDisconnect(me).cancel().catch(() => {})
      void update(me, { online: false, lastSeen: serverTimestamp() }).catch(retry)
    }
  }
  // presence/{uid} is one place for the whole account, with no room per device, so the onDisconnect of any device that
  // signs off writes the account offline while this one is still here. Telegram keeps an account online while any of
  // its sessions says so (TelegramCore ManagedAccountPresence). This window therefore watches its own place and writes
  // itself online again when it finds it false; two windows that are both online write nothing, and when the last one
  // leaves nobody writes again, so the account goes offline as it should.
  private watchOwn(database: Database): void {
    if (this.stopOwn || this.closed) return
    this.stopOwn = onValue(ref(database, `presence/${this.uid}/online`), snapshot => {
      if (!this.reassert(snapshot.val())) return
      this.written = !this.online
      this.apply()
    }, () => {})
  }
  // Whether this window must write itself online again: it is connected, it should be online, and the account's place
  // does not say so.
  private reassert(value: unknown): boolean { return !this.closed && this.connected && this.online && value !== true }
  // The connection is opened while the window is shown, so the first rows of a list read their status at once.
  prepare(): void { this.db() }
  setOnline(online: boolean): void {
    if (this.closed || this.online === online) return
    this.online = online
    if (online) this.db()
    else { this.stopOwn?.(); this.stopOwn = null }
    this.apply()
  }

  // The people whose status is on screen: the open chat, an open profile, visible chat rows and contacts.
  setPeers(surface: PresenceSurface, uids: string[]): void {
    if (this.closed) return
    const next = [...new Set(uids.filter(id => id && id !== this.uid))]
    if (JSON.stringify(this.surfaces.get(surface) ?? []) === JSON.stringify(next)) return
    this.surfaces.set(surface, next)
    this.reconcile()
  }
  private reconcile(): void {
    const wanted: string[] = []
    for (const surface of surfaceOrder) for (const id of this.surfaces.get(surface) ?? []) if (!wanted.includes(id)) wanted.push(id)
    const target = new Set(wanted.slice(0, maxWatched))
    // Only a value with its moment outlives the watch (MorsePeerPresenceStore, Telegram's stored present(until:) that
    // ages by itself): an «online» nobody refreshes any more would stay online for as long as it is remembered.
    let dropped = false
    for (const [id, stop] of this.watched) {
      if (target.has(id)) continue
      stop(); this.watched.delete(id); this.held.forget(id)
      if (this.values.get(id)?.s === 'online') { this.values.delete(id); dropped = true }
    }
    if (dropped) this.changed()
    for (const id of this.values.keys()) {
      if (this.values.size <= maxRemembered) break
      if (!this.watched.has(id)) this.values.delete(id)
    }
    const added = [...target].filter(id => !this.watched.has(id))
    if (added.length) {
      const database = this.db()
      if (database) {
        for (const id of added) {
          this.held.start(id)
          this.watched.set(id, onValue(ref(database, `presenceRedacted/${this.uid}/${id}`), snapshot => {
            if (!this.watched.has(id)) return
            const value = this.held.receive(id, peerPresence(snapshot.val()))
            if (!value) return
            // Most recently read last, so the oldest remembered values give way first.
            this.values.delete(id); this.values.set(id, value); this.changed()
          }, () => {}))
        }
        void this.resolve(added)
      }
    }
  }
  // resolvePeerPresences writes the redacted value for people the server does not fan out to.
  private async resolve(ids: string[]): Promise<void> {
    const fresh = ids.filter(id => !this.resolving.has(id))
    for (const id of fresh) this.resolving.add(id)
    try {
      for (let index = 0; index < fresh.length; index += maxWatched) {
        const batch = fresh.slice(index, index + maxWatched).filter(id => this.watched.has(id))
        if (!batch.length || this.closed) continue
        const result = await callMorseFunction(this.credentials, 'resolvePeerPresences', { targetUids: batch }, this.credentials.signal)
        const presences = result.presences && typeof result.presences === 'object' ? result.presences as Record<string, unknown> : {}
        let changed = false
        for (const id of batch) if (!this.closed && this.watched.has(id) && id in presences) { this.values.delete(id); this.values.set(id, this.held.answered(id, peerPresence(presences[id]))); changed = true }
        if (changed) this.changed()
      }
    } catch { /* The Realtime Database value stays authoritative. */ }
    finally {
      let changed = false
      for (const id of fresh) {
        this.resolving.delete(id)
        const copy = this.held.settled(id)
        if (!copy || !this.watched.has(id)) continue
        this.values.delete(id); this.values.set(id, copy); changed = true
      }
      if (changed && !this.closed) this.changed()
    }
  }
  snapshot(): Record<string, PeerPresence> { return Object.fromEntries([...this.values].map(([id, value]) => [id, { ...value }])) }

  async close(): Promise<void> {
    if (this.closed) return
    const database = this.database, app = this.app, wasOnline = this.connected && this.written
    this.closed = true
    this.stopConnected?.(); this.stopConnected = null
    this.stopOwn?.(); this.stopOwn = null
    for (const stop of this.watched.values()) stop()
    this.watched.clear(); this.values.clear(); this.held.clear(); this.surfaces.clear()
    if (database && wasOnline) {
      await Promise.race([update(ref(database, `presence/${this.uid}`), { online: false, lastSeen: serverTimestamp() }).catch(() => {}), new Promise(done => setTimeout(done, 1500))])
    }
    if (database) goOffline(database)
    if (app) await deleteApp(app).catch(() => {})
  }
}
