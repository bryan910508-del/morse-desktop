import type { PublicChannelPreviewRequest } from '../../shared/channel-public-preview'
import { channelDiscoveryRequest, discoveryTag, type ChannelDiscoveryBranch, type ChannelDiscoveryRequest, type ChannelDiscoveryRow, type ChannelDiscoverySnapshot } from '../../shared/channel-discovery'
import { FirestoreReader, type ReadCredentials } from '../network/firestore-rpc'
import { ReadFailure } from '../network/firestore-values'
import { discoveryRow, mergeDiscoveryRows } from './channel-discovery-values'
import { tr } from '../../shared/i18n'
const empty = (): ChannelDiscoverySnapshot => ({ requestId: null, query: '', status: 'idle', rows: [], message: '', nameResult: null, tagResult: null, limited: false, observedAt: null })
export class ChannelDiscovery {
  private closed = false
  private owner: { request: ChannelDiscoveryRequest; abort: AbortController; reader: FirestoreReader } | null = null
  private expiry: ReturnType<typeof setTimeout> | null = null
  private value = empty()
  constructor(private readonly auth: ReadCredentials, private readonly allowed: () => boolean, private readonly changed: () => void) {}
  get snapshot(): ChannelDiscoverySnapshot { return !this.allowed() ? empty() : { ...this.value, rows: this.value.rows.map(row => ({ ...row, tags: row.tags ? [...row.tags] : null })) } }
  private publish(): void { if (!this.closed) this.changed() }
  pause(): void { this.owner?.abort.abort(); this.owner?.reader.close(); this.owner = null; if (this.expiry) clearTimeout(this.expiry); this.expiry = null; this.value = empty(); this.publish() }
  selection(request: PublicChannelPreviewRequest): void {
    if (this.closed || !this.allowed() || this.value.status !== 'ready' || this.value.requestId !== request.searchRequestId || this.value.observedAt === null || Date.now() - this.value.observedAt >= 60000 || !this.value.rows.some(row => row.id === request.channelId && row.version === request.version)) throw new Error(tr('최신 공개 채널 검색 결과에서 다시 선택해 주세요.'))
  }
  dismiss(requestId: string): void { if (this.owner?.request.requestId === requestId || this.value.requestId === requestId) this.pause() }
  async search(input: ChannelDiscoveryRequest): Promise<void> {
    if (this.closed || !this.allowed()) throw new Error(tr('현재 계정 연결과 잠금을 확인해 주세요.'))
    const request = channelDiscoveryRequest(input), tag = discoveryTag(request.query)
    this.pause()
    const owner = { request, abort: new AbortController(), reader: new FirestoreReader(this.auth) }; this.owner = owner
    const signal = AbortSignal.any([owner.abort.signal, this.auth.signal, AbortSignal.timeout(40000)])
    const validate = (): void => { signal.throwIfAborted(); if (this.closed || this.owner !== owner || !this.allowed()) throw new Error(tr('검색 범위가 변경되었습니다.')) }
    this.value = { ...empty(), requestId: request.requestId, query: request.query, status: 'loading' }; this.publish()
    const branch = async (kind: 'name' | 'tag'): Promise<{ state: ChannelDiscoveryBranch; rows: ChannelDiscoveryRow[]; limited: boolean }> => {
      if (kind === 'tag' && !tag) return { state: 'skipped', rows: [], limited: false }
      try {
        const docs = await owner.reader.discoverChannels({ query: request.query, tag }, kind, signal, validate)
        validate()
        const rows = docs.map(doc => discoveryRow(doc, request.query, tag, kind))
        return { state: 'ready', rows: rows.slice(0, 20), limited: rows.length > 20 }
      } catch (error) {
        return { state: error instanceof ReadFailure && ['index', 'permission', 'network', 'data'].includes(error.code) ? error.code as ChannelDiscoveryBranch : 'data', rows: [], limited: false }
      }
    }
    try {
      const [name, tags] = await Promise.all([branch('name'), branch('tag')])
      validate()
      const denied = name.state === 'permission' || tags.state === 'permission'
      const rows = denied ? [] : mergeDiscoveryRows([name.rows, tags.rows])
      const ready = !denied && (name.state === 'ready' || tags.state === 'ready')
      const partial = !['ready', 'skipped'].includes(name.state) || !['ready', 'skipped'].includes(tags.state)
      this.value = { ...this.value, status: ready ? 'ready' : 'error', rows: rows.slice(0, 20), nameResult: name.state, tagResult: tags.state, limited: name.limited || tags.limited || rows.length > 20, observedAt: Date.now(),
        message: denied ? tr('현재 검색 권한을 확인하지 못했습니다. 다른 검색 경로의 결과도 표시하지 않습니다.') : !ready ? tr('공개 채널 검색을 완료하지 못했습니다. 아래 조회 상태를 확인해 주세요.') : partial ? tr('일부 검색 경로를 완료하지 못했습니다. 성공한 경로의 제한된 결과만 표시합니다.') : tr('검색 시점의 공개 채널 정보입니다. 게시물 열람·가입·토론방 참여 권한을 확인한 것은 아닙니다.') }
      this.expiry = setTimeout(() => { if (this.owner !== owner) return; this.value = { ...empty(), requestId: request.requestId, query: request.query, status: 'expired', message: tr('검색 결과의 표시 시간이 지났습니다. 다시 검색해 현재 정보를 확인해 주세요.') }; this.expiry = null; this.publish() }, 60000)
    } catch {
      if (this.owner === owner && this.allowed() && !this.closed) this.value = { ...empty(), requestId: request.requestId, query: request.query, status: 'error', message: tr('검색을 완료하지 못했습니다. 현재 연결을 확인한 뒤 다시 검색해 주세요.') }
    } finally { owner.reader.close(); if (this.owner === owner) this.publish() }
  }
  close(): void { this.closed = true; this.pause() }
}
