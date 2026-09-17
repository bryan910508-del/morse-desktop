import { app } from 'electron'
import { join } from 'node:path'
import { Worker } from 'node:worker_threads'
import { tr } from '../../shared/i18n'

export async function restoreFile(bytes: Buffer, signal: AbortSignal): Promise<Buffer> {
  if (bytes.subarray(0, 10).toString('ascii') !== 'TALKY_LZF1') return bytes
  if (bytes.length <= 18) throw new Error(tr('압축 파일 헤더가 손상되었습니다.'))
  const expected = bytes.readBigUInt64LE(10)
  if (expected === 0n || expected >= 200000000n) throw new Error(tr('압축 파일의 원본 크기가 지원 범위를 벗어납니다.'))
  signal.throwIfAborted()
  const modulePath = app.isPackaged ? join(process.resourcesPath, 'app.asar.unpacked/resources/native/morse_lzfse.node') : join(app.getAppPath(), 'resources/native/morse_lzfse.node')
  const worker = new Worker(join(__dirname, 'compression-worker.cjs'), { workerData: { input: bytes.subarray(18), expected: Number(expected), modulePath } })
  try {
    return await new Promise<Buffer>((resolve, reject) => {
      const fail = (): void => reject(new Error(tr('압축 파일을 복원하지 못했습니다. 파일이 손상되었거나 작업이 취소되었습니다.')))
      const aborted = (): void => fail()
      signal.addEventListener('abort', aborted, { once: true })
      const timer = setTimeout(fail, 30000)
      const finish = (): void => { clearTimeout(timer); signal.removeEventListener('abort', aborted) }
      worker.once('message', (value: { ok: boolean; output?: Uint8Array }) => {
        finish()
        if (!value.ok || !(value.output instanceof Uint8Array) || value.output.byteLength !== Number(expected) || signal.aborted) { value.output?.fill(0); fail(); return }
        resolve(Buffer.from(value.output.buffer, value.output.byteOffset, value.output.byteLength))
      })
      worker.once('error', () => { finish(); fail() })
      worker.once('exit', () => { finish(); fail() })
      if (signal.aborted) { finish(); fail() }
    })
  } finally { await worker.terminate() }
}
