import { trackWrite } from './drafts'

// Serializes device draft writes for one channel post or comment target. Drafts
// live only on this device, so the newest input replaces a stale stored revision.
export class DraftWriter<R extends { revision: string | null }> {
  private chain: Promise<unknown> = Promise.resolve()
  revision: string | null = null
  constructor(private readonly read: () => Promise<R>, private readonly write: (expected: string | null, revision: string) => Promise<R>) {}
  private queue<T>(work: () => Promise<T>): Promise<T> {
    const task = this.chain.then(work, work)
    this.chain = task.catch(() => {})
    return trackWrite(task)
  }
  private adopt(value: R): R { this.revision = value.revision; return value }
  load(): Promise<R> { return this.queue(async () => this.adopt(await this.read())) }
  save(): Promise<R> { return this.change(this.write) }
  change(write: (expected: string | null, revision: string) => Promise<R>): Promise<R> {
    return this.queue(async () => {
      try { return this.adopt(await write(this.revision, crypto.randomUUID())) }
      catch {
        this.adopt(await this.read())
        return this.adopt(await write(this.revision, crypto.randomUUID()))
      }
    })
  }
}
