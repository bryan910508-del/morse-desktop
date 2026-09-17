import { io, type Socket } from 'socket.io-client'
import type { ChatMessage, ConnectionState, MessagePosition, SendAcknowledgement, SendWire } from '../../shared/model'
import type { ReadAcknowledgement } from '../../shared/read-receipts'
import { committedReadAck, committedSendAck, incomingMessage, NotEmitted, ProtocolFailure, serverContract } from './contracts'
import { tr } from '../../shared/i18n'

export interface SessionCredentials {
  uid: string
  sessionId: string
  idToken(forceRefresh: boolean): Promise<string>
}
export interface TransportEvents {
  state(state: ConnectionState): void
  message(message: ChatMessage): void
  needsReconciliation(): void
  rejected?(reason: string): void
}

export class SocketMessageTransport {
  private socket: Socket | null = null
  private generation = 0
  private registrationTimer?: ReturnType<typeof setTimeout>
  private registrationCycle = 0
  private registerAttempt = 0
  private currentState: ConnectionState = 'offline'
  private credentials: SessionCredentials | null = null

  constructor(private readonly version: string, private readonly events: TransportEvents) {}
  get ready(): boolean { return this.currentState === 'ready' }
  get state(): ConnectionState { return this.currentState }
  private transition(value: ConnectionState): void { this.currentState = value; this.events.state(value) }
  private invalidateRegistration(): number {
    clearTimeout(this.registrationTimer)
    this.registrationTimer = undefined
    return ++this.registrationCycle
  }

  connect(credentials: SessionCredentials, forceRefresh = false): void {
    this.stop('offline')
    this.credentials = credentials
    const generation = this.generation
    const socket = io(serverContract.socketURL, {
      autoConnect: false, reconnection: true, reconnectionAttempts: Infinity,
      reconnectionDelay: 2000, reconnectionDelayMax: 30000, randomizationFactor: 0.5
    })
    this.socket = socket
    const active = (): boolean => generation === this.generation && socket === this.socket
    const register = async (): Promise<void> => {
      if (!active() || !socket.connected) return
      const cycle = this.invalidateRegistration()
      // A Socket instance survives automatic reconnects. Its old token request
      // must not register again on the new connection or leave an orphan timer.
      const current = (): boolean => active() && socket.connected && cycle === this.registrationCycle && this.currentState === 'registering'
      this.transition('registering')
      try {
        const idToken = await credentials.idToken(forceRefresh || this.registerAttempt > 0)
        if (!current()) return
        socket.emit('register', {
          uid: credentials.uid, idToken, sessionId: credentials.sessionId,
          appVersion: this.version, clientProtocolVersion: serverContract.clientProtocolVersion,
          capabilities: serverContract.capabilities
        })
        this.registrationTimer = setTimeout(() => { if (current()) retryRegister() }, 12000)
      } catch { if (current()) retryRegister() }
    }
    const retryRegister = (): void => {
      if (!active() || !socket.connected || this.currentState !== 'registering') return
      const cycle = this.invalidateRegistration()
      this.registerAttempt += 1
      const delay = Math.min(30000, 1000 * 2 ** Math.min(this.registerAttempt, 5)) * (0.8 + Math.random() * 0.4)
      this.registrationTimer = setTimeout(() => {
        if (active() && cycle === this.registrationCycle && this.currentState === 'registering') void register()
      }, delay)
    }
    socket.on('connect', () => { if (active()) void register() })
    socket.on('disconnect', () => {
      if (!active()) return
      this.invalidateRegistration()
      this.transition('offline')
    })
    socket.on('connect_error', () => { if (active()) this.transition('connecting') })
    socket.on('registered', (body: unknown) => {
      if (!active() || this.currentState !== 'registering') return
      const value = body as Record<string, unknown> | null
      if (!value || value.ok !== true || value.uid !== credentials.uid ||
          value.clientProtocolVersion !== 2 || !Array.isArray(value.capabilities) ||
          !value.capabilities.includes('durable-message-ack') || !value.capabilities.includes('session-bound-registration')) {
        this.events.rejected?.('protocol-unsupported')
        this.stop('rejected')
        return
      }
      this.invalidateRegistration()
      this.registerAttempt = 0
      this.transition('ready')
      this.events.needsReconciliation()
    })
    socket.on('registrationFailed', (body: { reason?: string; error?: string }) => {
      if (!active()) return
      // The server disconnects the namespace after token expiry. Socket.IO does
      // not automatically reconnect a server-disconnected namespace.
      if (body?.reason === 'token-expired') {
        this.stop('connecting')
        const nextGeneration = this.generation
        this.registrationTimer = setTimeout(() => {
          if (this.generation === nextGeneration) this.connect(credentials, true)
        }, 2000)
      } else if (body?.error === 'SERVICE_UNAVAILABLE') retryRegister()
      else {
        this.events.rejected?.(typeof body?.reason === 'string' ? body.reason : 'authentication-failed')
        this.stop('rejected')
      }
    })
    socket.on('newMessage', (body: unknown) => {
      if (!active() || !this.ready) return
      try { this.events.message(incomingMessage(body)) }
      catch { this.events.needsReconciliation() }
    })
    this.transition('connecting')
    socket.connect()
  }

  async send(wire: SendWire, signal: AbortSignal): Promise<SendAcknowledgement> {
    const socket = this.socket
    const generation = this.generation
    if (signal.aborted || !socket || !socket.connected || !socket.io.engine?.transport?.writable || !this.ready ||
        wire.senderId !== this.credentials?.uid) throw new NotEmitted(tr('연결을 기다리고 있습니다.'))
    // SQLite owns replay. Socket.IO must not silently buffer this across a new
    // connection before that connection has completed application registration.
    const pending = socket.volatile.timeout(15000).emitWithAck('sendMessage', wire)
    let cancel!: () => void
    const body: unknown = await new Promise((resolve, reject) => {
      cancel = () => reject(new ProtocolFailure(tr('전송 결과를 확인해야 합니다.')))
      signal.addEventListener('abort', cancel, { once: true })
      pending.then(resolve, reject)
      if (signal.aborted) cancel()
    }).finally(() => signal.removeEventListener('abort', cancel))
    if (signal.aborted || generation !== this.generation || socket !== this.socket) throw new ProtocolFailure(tr('연결이 변경되었습니다.'))
    return committedSendAck(body, wire)
  }

  async markRead(chatId: string, readerId: string, target: MessagePosition, signal: AbortSignal): Promise<ReadAcknowledgement> {
    const socket = this.socket, generation = this.generation
    if (signal.aborted || !socket?.connected || !socket.io.engine?.transport?.writable || !this.ready ||
        readerId !== this.credentials?.uid) throw new NotEmitted(tr('연결을 기다리고 있습니다.'))
    // Existing contract: the server derives identity and timestamp itself.
    const pending = socket.volatile.timeout(15000).emitWithAck('markRead', { chatId, messageId: target.id })
    let cancel!: () => void
    const body: unknown = await new Promise((resolve, reject) => {
      cancel = () => reject(new ProtocolFailure(tr('읽음 응답을 다시 확인해야 합니다.')))
      signal.addEventListener('abort', cancel, { once: true })
      pending.then(resolve, reject)
      if (signal.aborted) cancel()
    }).finally(() => signal.removeEventListener('abort', cancel))
    if (signal.aborted || generation !== this.generation || socket !== this.socket) throw new ProtocolFailure(tr('연결이 변경되었습니다.'))
    return committedReadAck(body, chatId, readerId, target)
  }

  suspend(): void { this.stop('suspended') }
  resume(): void {
    const credentials = this.credentials
    if (credentials) this.connect(credentials)
  }
  stop(state: ConnectionState = 'offline'): void {
    this.generation += 1
    this.invalidateRegistration()
    this.socket?.removeAllListeners()
    this.socket?.disconnect()
    this.socket = null
    this.transition(state)
  }
}
