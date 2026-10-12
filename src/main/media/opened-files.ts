import { createHash, randomUUID } from 'node:crypto'
import { mkdir, open, rename, rm, stat, unlink } from 'node:fs/promises'
import { extname, join } from 'node:path'
import type { FileState, MediaRequest } from '../../shared/media'
import { fileWarning, type FileWarning } from './file-types'
import type { ReadCredentials } from '../network/firestore-rpc'
import { safeFileName, type MediaResource } from './media-document'
import { restoreFile } from './compression'
import { downloadMedia, MediaFailure } from './download-media'
import { mediaCacheFor } from '../accounts/media-cache'
import { tr } from '../../shared/i18n'

// tdesktop HistoryView::Document (history_view_document.cpp:1455-1463): a file's bubble is pressed to fetch it when it is
// not here (_savel), pressed again to stop while it comes (_cancell), and pressed to open once it is here (_openl) —
// Data::ResolveDocument hands it to the system (data_document_resolver.cpp:232-305, LaunchWithWarning :78). Several
// files come at once, each in its own bubble, and one keeps coming after its room is left.
//
// The bytes come into the account's sealed cache as any attachment does. Only a file pressed to be opened is written
// out as itself, in the account's own folder, because the program that opens it reads it from the disk (tdesktop keeps
// every downloaded file so); sign-out and «캐시 지우기» take that folder away. A one-time attachment is never written.
interface Loading { abort: AbortController; loaded: number; total: number | null }
export type OpenOutcome = 'opened' | 'shown' | 'cancelled'
export interface OpenedFileSystem {
  // The system's own program for the file; a message when there is none.
  open(path: string): Promise<string>
  show(path: string): void
  confirm(warning: FileWarning, extension: string): Promise<boolean>
}

export class OpenedFiles {
  private readonly loading = new Map<string, Loading>()
  private closed = false

  constructor(private readonly credentials: ReadCredentials,
    private readonly resolve: (chatId: string, request: MediaRequest) => MediaResource | null,
    private readonly directory: string,
    private readonly changed: (chatId: string, messageId: string, index: number, state: FileState) => void,
    private readonly system: OpenedFileSystem) {}

  private resource(chatId: string, request: MediaRequest): MediaResource {
    const resource = this.resolve(chatId, request)
    if (this.closed || !resource?.path || !resource.summary.available || resource.summary.kind !== 'file' || resource.summary.blind)
      throw new MediaFailure(tr('현재 메시지에서 열 수 있는 첨부를 확인하지 못했습니다.'))
    return resource
  }
  private place(resource: MediaResource): { folder: string; file: string } {
    const folder = join(this.directory, createHash('sha256').update(resource.path!).digest('hex').slice(0, 32))
    return { folder, file: join(folder, safeFileName(resource.summary.name)) }
  }
  private async written(resource: MediaResource): Promise<string | null> {
    const { file } = this.place(resource)
    try { return (await stat(file)).isFile() ? file : null } catch { return null }
  }

  async state(chatId: string, request: MediaRequest): Promise<FileState> {
    const resource = this.resource(chatId, request)
    const loading = this.loading.get(resource.path!)
    if (loading) return { state: 'loading', loaded: loading.loaded, total: loading.total }
    if (await this.written(resource) || await mediaCacheFor(this.credentials)?.has(resource.path!)) return { state: 'ready' }
    return { state: 'remote' }
  }

  // The press on a file not here: it comes into the cache, and its bubble follows by changed().
  fetch(chatId: string, request: MediaRequest): void {
    const resource = this.resource(chatId, request), path = resource.path!
    if (this.loading.has(path)) return
    const loading: Loading = { abort: new AbortController(), loaded: 0, total: null }
    this.loading.set(path, loading)
    const tell = (state: FileState): void => { if (!this.closed) this.changed(chatId, request.messageId, request.index, state) }
    tell({ state: 'loading', loaded: 0, total: null })
    void this.bytes(resource, loading.abort.signal, (loaded, total) => {
      loading.loaded = loaded; loading.total = total
      tell({ state: 'loading', loaded, total })
    }).then(bytes => { bytes.fill(0); tell({ state: 'ready' }) }, error => {
      tell(loading.abort.signal.aborted ? { state: 'remote' }
        : { state: 'remote', error: error instanceof MediaFailure ? error.message : tr('첨부를 불러오지 못했습니다. 다시 시도해 주세요.') })
    }).finally(() => { if (this.loading.get(path) === loading) this.loading.delete(path) })
  }
  cancel(chatId: string, request: MediaRequest): void {
    const resource = this.resolve(chatId, request)
    if (resource?.path) this.loading.get(resource.path)?.abort.abort()
  }

  private async bytes(resource: MediaResource, signal: AbortSignal, progress: (loaded: number, total: number | null) => void): Promise<Buffer> {
    const cache = mediaCacheFor(this.credentials), path = resource.path!
    const stored = await cache?.read(path)
    if (stored) { progress(stored.length, stored.length); return stored }
    const bytes = await downloadMedia(this.credentials, resource, signal, () => {
      if (this.closed) throw new MediaFailure(tr('다운로드가 취소되었습니다.'))
    }, progress)
    cache?.write(path, bytes)
    return bytes
  }

  // The press on a file that is here. A name tdesktop asks about first (Core::DetectNameType — a program, a kind it does
  // not know, or one that reveals the address: LauncherWouldWarn) is asked about; one with no extension opens its folder,
  // as tdesktop forces «Open With» for it (data_document_resolver.cpp:95-106); one the system has no program for is
  // shown in its folder.
  async open(chatId: string, request: MediaRequest): Promise<OpenOutcome> {
    const file = await this.write(this.resource(chatId, request))
    const extension = extname(file).slice(1).toLowerCase()
    if (!extension) { this.system.show(file); return 'shown' }
    const warning = fileWarning(extension)
    if (warning && !await this.system.confirm(warning, extension)) return 'cancelled'
    if (this.closed) throw new MediaFailure(tr('다운로드가 취소되었습니다.'))
    if (!await this.system.open(file)) return 'opened'
    this.system.show(file)
    return 'shown'
  }
  // «폴더에서 보기» (lng_context_show_in_folder).
  async show(chatId: string, request: MediaRequest): Promise<void> {
    this.system.show(await this.write(this.resource(chatId, request)))
  }

  private async write(resource: MediaResource): Promise<string> {
    const existing = await this.written(resource)
    if (existing) return existing
    const signal = AbortSignal.any([this.credentials.signal, AbortSignal.timeout(120000)])
    let bytes = await this.bytes(resource, signal, () => {})
    try {
      const restored = await restoreFile(bytes, signal)
      if (restored !== bytes) { bytes.fill(0); bytes = restored }
    } catch (error) { bytes.fill(0); throw new MediaFailure(error instanceof Error ? error.message : tr('압축 파일을 복원하지 못했습니다.')) }
    const { folder, file } = this.place(resource)
    let temporary: string | null = join(folder, `.morse-open-${randomUUID()}.part`)
    try {
      if (this.closed) throw new MediaFailure(tr('다운로드가 취소되었습니다.'))
      await mkdir(folder, { recursive: true, mode: 0o700 })
      const handle = await open(temporary, 'wx', 0o600)
      try { await handle.writeFile(bytes); await handle.sync() } finally { await handle.close() }
      await rename(temporary, file)
      temporary = null
      return file
    } catch (error) {
      throw error instanceof MediaFailure ? error : new MediaFailure(tr('파일을 저장하지 못했습니다. 저장 위치와 여유 공간을 확인해 주세요.'))
    } finally {
      bytes.fill(0)
      if (temporary) await unlink(temporary).catch(() => {})
    }
  }

  // «캐시 지우기»; sign-out takes it with the account's other stores (close(true)).
  async clear(): Promise<void> {
    for (const loading of this.loading.values()) loading.abort.abort()
    await rm(this.directory, { recursive: true, force: true }).catch(() => {})
  }
  async close(purge: boolean): Promise<void> {
    this.closed = true
    for (const loading of this.loading.values()) loading.abort.abort()
    this.loading.clear()
    if (purge) await rm(this.directory, { recursive: true, force: true }).catch(() => {})
  }
}
