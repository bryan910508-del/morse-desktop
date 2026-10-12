import { status, type ClientDuplexStream } from '@grpc/grpc-js'
import { database, document, ReadFailure, type FirestoreDocument, type WireObject } from './firestore-values'
import { object } from '../../shared/validation'
import { recordWatch } from '../platform/connection-diagnostics'
import { reachability } from './reachability'
import type { WatchEvents, WatchResumeToken } from './firestore-rpc'

// What a FirestoreReader lends the targets of one Listen stream: its channel and sign-in, and its rest, wake-up and
// close (FirestoreReader.listenTargets).
export interface ListenHost {
  bounded(signal: AbortSignal): AbortSignal
  open(signal: AbortSignal, force: boolean): Promise<{ stream: ClientDuplexStream<WireObject, WireObject>; renewAfter: number }>
  closed(): boolean
  resting(): boolean
  register(control: { hold(): void; release(): void }): () => void
  waitFor(wake: () => void): () => void
  failure(error: unknown): ReadFailure
  observe(error: unknown): void
  where(): string
}
// What the stream has asked of the server since it began: targets listened from nothing and from a resume token,
// documents received (each one a read), and targets the server refused.
export interface ListenTally { fresh: number; resumed: number; documents: number; refused: number }

interface Target {
  wire: WireObject
  events: WatchEvents
  maxDocuments: number
  maxBytes: number
  // The wire id of its present listen: a new one each time it is listened, so that a late message for an earlier
  // listen of it (one the server has not yet answered the removal of) finds nothing.
  id: number
  sent: boolean
  received: Map<string, FirestoreDocument>
  sizes: Map<string, number>
  bytes: number
  current: boolean
  dirty: boolean
  everCurrent: boolean
  // The token of its last consistent snapshot: the stream listening again starts this target from there, with the
  // documents that snapshot had, and Firestore sends only what changed since.
  token?: WatchResumeToken
  timeout?: ReturnType<typeof setTimeout>
  retry?: ReturnType<typeof setTimeout>
  attempt: number
  unwait?: () => void
}

const terminal = ['permission', 'index', 'data']
const backoff = (attempt: number): number => Math.min(30000, 1000 * 2 ** Math.min(attempt, 5)) * (0.8 + Math.random() * 0.4)

// B277 ②: many targets over one Listen stream, as Firestore's own clients carry every listener of a database on one
// (firebase-js-sdk PersistentListenStream: watchTarget/unwatchTarget, WatchChangeAggregator per target). Each target is
// added and removed on its own and keeps its own documents, consistency and resume token; the server refusing one of
// them (targetChange REMOVE with a cause) ends that one only. The stream itself retries, renews before its sign-in
// expires and rests while its reader is paused, as FirestoreReader.watch does; listening again, each target resumes
// from its last consistent snapshot.
export class ListenTargets {
  private readonly local = new AbortController()
  private readonly signal: AbortSignal
  private readonly targets = new Set<Target>()
  private readonly byId = new Map<number, Target>()
  private ids = 0
  private stream: ClientDuplexStream<WireObject, WireObject> | null = null
  private generation = 0
  private attempt = 0
  private force = false
  private woken = false
  private held = false
  private retry: ReturnType<typeof setTimeout> | undefined
  private renewal: ReturnType<typeof setTimeout> | undefined
  private unwait: (() => void) | undefined
  private readonly unregister: () => void
  readonly tally: ListenTally = { fresh: 0, resumed: 0, documents: 0, refused: 0 }

  constructor(private readonly host: ListenHost, signal: AbortSignal) {
    this.signal = host.bounded(AbortSignal.any([signal, this.local.signal]))
    this.unregister = host.register({ hold: () => this.hold(), release: () => this.release() })
    this.signal.addEventListener('abort', () => this.stop(), { once: true })
  }

  // Listens to one target until the returned function is called. Its events are a watch's (FirestoreReader.watch).
  add(wire: WireObject, events: WatchEvents, maxDocuments: number, maxBytes = 32 * 1024 * 1024): () => void {
    if (this.signal.aborted || this.host.closed()) return () => {}
    const target: Target = { wire, events, maxDocuments, maxBytes, id: 0, sent: false, received: new Map(), sizes: new Map(), bytes: 0, current: false, dirty: true, everCurrent: false, attempt: 0 }
    this.targets.add(target)
    if (this.stream) this.send(target, true)
    else {
      events.state('loading')
      if (!this.held && this.retry === undefined && this.targets.size === 1) void this.run()
    }
    return () => this.remove(target)
  }

  get size(): number { return this.targets.size }

  close(): void { this.local.abort() }

  private remove(target: Target): void {
    if (!this.targets.delete(target)) return
    this.drop(target)
    if (this.stream && target.sent) this.stream.write({ database, removeTarget: target.id })
    // Nothing left to listen to: the stream closes, and the next target opens it again.
    if (!this.targets.size) { this.cancelRetry(); this.stopCycle() }
  }

  private drop(target: Target): void {
    this.byId.delete(target.id)
    clearTimeout(target.timeout); clearTimeout(target.retry); target.retry = undefined
    target.unwait?.(); target.unwait = undefined
  }

  private stop(): void {
    this.cancelRetry(); this.stopCycle()
    for (const target of this.targets) this.drop(target)
    this.targets.clear()
    this.unregister()
  }

  private hold(): void { this.held = true; this.cancelRetry(); this.stopCycle() }

  private release(): void { if (!this.held) return; this.held = false; this.attempt = 0; void this.run() }

  private cancelRetry(): void {
    clearTimeout(this.retry); this.retry = undefined
    this.unwait?.(); this.unwait = undefined
  }

  private stopCycle(): void {
    this.generation++
    clearTimeout(this.renewal)
    this.stream?.cancel(); this.stream = null
    for (const target of this.targets) {
      this.byId.delete(target.id); target.sent = false
      clearTimeout(target.timeout); clearTimeout(target.retry); target.retry = undefined
      target.unwait?.(); target.unwait = undefined
    }
  }

  private relisten(target: Target, reason?: ReadFailure): void {
    if (target.everCurrent && target.events.reconnecting) target.events.reconnecting(reason)
    else target.events.state('loading', reason)
  }

  // Writes the target to the live stream under a new id, from its resume token when it has one.
  private send(target: Target, tell: boolean): void {
    if (!this.stream) return
    if (tell) this.relisten(target)
    this.byId.delete(target.id)
    target.id = ++this.ids
    this.byId.set(target.id, target)
    target.sent = true; target.current = false; target.dirty = true
    if (!target.token) { target.received.clear(); target.sizes.clear(); target.bytes = 0 }
    if (target.token) this.tally.resumed++; else this.tally.fresh++
    this.arm(target)
    this.stream.write({ database, addTarget: { ...target.wire, targetId: target.id, ...(target.token ? { resumeToken: target.token } : {}) } })
  }

  // A target the server does not make current within 45 s means the stream is not being answered: the stream listens
  // again (FirestoreReader.watch's own wait).
  private arm(target: Target): void {
    clearTimeout(target.timeout)
    target.timeout = setTimeout(() => this.end(new ReadFailure('network')), 45000)
  }

  // The target's own end: the server refused it, or what it holds broke its bounds. The other targets go on.
  private fail(target: Target, reason: ReadFailure): void {
    if (!this.targets.delete(target)) return
    if (this.stream && target.sent) this.stream.write({ database, removeTarget: target.id })
    this.drop(target)
    if (reason.code === 'permission') this.tally.refused++
    target.events.state('error', reason)
    if (!this.targets.size) { this.cancelRetry(); this.stopCycle() }
  }

  // The target listens again from nothing: its count disagreed with the server's (existence filter), or the server
  // removed it for a reason that may pass.
  private again(target: Target, reason: ReadFailure | undefined, wait: number): void {
    if (this.stream && target.sent) this.stream.write({ database, removeTarget: target.id })
    this.byId.delete(target.id); target.sent = false
    clearTimeout(target.timeout)
    target.token = undefined
    target.received.clear(); target.sizes.clear(); target.bytes = 0
    this.relisten(target, reason)
    if (!wait) { this.send(target, false); return }
    const cycle = this.generation
    const go = (): void => {
      target.unwait?.(); target.unwait = undefined; clearTimeout(target.retry); target.retry = undefined
      if (cycle === this.generation && this.targets.has(target)) this.send(target, false)
    }
    target.unwait = this.host.waitFor(go)
    target.retry = setTimeout(go, wait)
  }

  private async run(): Promise<void> {
    if (this.signal.aborted || this.host.closed() || !this.targets.size) return
    if (this.host.resting()) { this.hold(); return }
    this.cancelRetry()
    this.stopCycle()
    const cycle = this.generation
    const active = (): boolean => !this.signal.aborted && cycle === this.generation && !this.host.closed()
    let ended = false
    const end = (error: unknown): void => {
      if (!active() || ended) return
      ended = true
      this.ended(error)
    }
    this.end = end
    try {
      for (const target of this.targets) this.relisten(target)
      const { stream, renewAfter } = await this.host.open(this.signal, this.force)
      if (!active()) { stream.cancel(); return }
      this.stream = stream
      this.renewal = setTimeout(() => { void this.run() }, renewAfter)
      stream.on('data', (raw: WireObject) => { if (active() && !ended) { try { this.data(raw) } catch (error) { end(error instanceof ReadFailure ? error : new ReadFailure('data')) } } })
      stream.on('error', end)
      stream.on('end', () => end(new ReadFailure('network')))
      for (const target of [...this.targets]) this.send(target, false)
    } catch (error) { end(error) }
  }

  // Replaced by each run with the end of that run's stream.
  private end: (error: unknown) => void = () => {}

  private ended(error: unknown): void {
    const reason = this.host.failure(error)
    if ((error as { code?: number } | null)?.code === status.UNAUTHENTICATED && !this.force) this.force = true
    else if (terminal.includes(reason.code)) {
      // The stream itself is refused (its sign-in, not one target): every target ends.
      this.stopCycle()
      for (const target of [...this.targets]) this.fail(target, reason)
      return
    }
    this.stopCycle()
    for (const target of this.targets) this.relisten(target, reason)
    if (this.signal.aborted || this.host.closed() || !this.targets.size) return
    const wait = backoff(this.attempt++)
    recordWatch(error, wait, this.host.where())
    this.host.observe(error)
    const wake = (): void => { this.cancelRetry(); this.attempt = 0; this.woken = true; void this.run() }
    this.unwait = this.host.waitFor(wake)
    this.retry = setTimeout(() => { this.unwait?.(); this.unwait = undefined; this.retry = undefined; void this.run() }, wait)
  }

  // The targets a message names under their present ids; an id of an earlier listen names nothing.
  private listed(ids: unknown): Target[] {
    return (Array.isArray(ids) ? ids : []).flatMap(id => { const target = this.byId.get(Number(id)); return target ? [target] : [] })
  }

  // As `listed`, but a message that names none applies to every target on the stream (Firestore TargetChange.target_ids).
  private affected(ids: unknown): Target[] {
    return Array.isArray(ids) && ids.length ? this.listed(ids) : [...this.targets].filter(target => target.sent)
  }

  private take(target: Target, item: FirestoreDocument): void {
    const bytes = JSON.stringify(item).length
    target.bytes += bytes - (target.sizes.get(item.name) ?? 0)
    target.received.set(item.name, item); target.sizes.set(item.name, bytes); target.dirty = true
    if (target.bytes > target.maxBytes) this.fail(target, new ReadFailure('data'))
  }

  private leave(target: Target, name: string): void {
    if (!target.received.has(name)) return
    target.bytes -= target.sizes.get(name) ?? 0
    target.received.delete(name); target.sizes.delete(name); target.dirty = true
  }

  private data(raw: WireObject): void {
    if (raw.documentChange) {
      const change = object(raw.documentChange)
      const item = document(change.document)
      const into = this.listed(change.targetIds)
      if (into.length) this.tally.documents++
      for (const target of into) this.take(target, item)
      for (const target of this.listed(change.removedTargetIds)) this.leave(target, item.name)
    } else if (raw.documentDelete || raw.documentRemove) {
      const change = object(raw.documentDelete ?? raw.documentRemove)
      if (typeof change.document !== 'string') throw new ReadFailure('data')
      for (const target of this.affected(change.removedTargetIds)) this.leave(target, change.document)
    } else if (raw.filter) {
      const filter = object(raw.filter)
      const target = this.byId.get(Number(filter.targetId))
      if (target && Number(filter.count ?? 0) !== target.received.size) this.again(target, new ReadFailure('network'), 0)
    } else if (raw.targetChange) {
      const change = object(raw.targetChange)
      const type = change.targetChangeType ?? 'NO_CHANGE'
      const ids = Array.isArray(change.targetIds) ? change.targetIds : []
      if (type === 'REMOVE') {
        // A removal the client asked for is answered under an id no target has any more. One the client did not ask
        // for is the server ending that target.
        for (const target of this.listed(ids)) {
          const reason = change.cause ? this.host.failure(change.cause) : new ReadFailure('permission')
          if (terminal.includes(reason.code)) { this.byId.delete(target.id); target.sent = false; this.fail(target, reason) }
          else { target.sent = false; this.again(target, reason, backoff(target.attempt++)) }
        }
        return
      }
      const targets = this.affected(ids)
      for (const target of targets) {
        if (type === 'RESET') {
          target.current = false; target.received.clear(); target.sizes.clear(); target.bytes = 0; target.dirty = true
          this.arm(target)
          this.relisten(target)
        }
        if (type === 'CURRENT') target.current = true
      }
      // Publish only at a server snapshot boundary, never midway through a batch of removals/additions or before a
      // fresh target is current.
      if (change.readTime) for (const target of targets) if (target.current && this.targets.has(target) && target.sent) this.publish(target, change.resumeToken as WatchResumeToken | undefined)
    }
  }

  private publish(target: Target, token: WatchResumeToken | undefined): void {
    clearTimeout(target.timeout)
    // An added row may arrive before the matching removal from a limited query. Cardinality applies to a consistent
    // boundary.
    if (target.received.size > target.maxDocuments) { this.fail(target, new ReadFailure('data')); return }
    if (target.dirty) { target.dirty = false; target.events.snapshot(new Map(target.received)) }
    if (!this.targets.has(target)) return
    if (this.attempt || this.woken) recordWatch(null, undefined, this.host.where())
    this.woken = false
    reachability.reached('firestore')
    this.attempt = 0; this.force = false
    target.attempt = 0; target.everCurrent = true
    target.events.state('ready')
    if (token && this.targets.has(target)) { target.token = token; target.events.resumeToken?.(token) }
  }
}
