import { parentPort, workerData } from 'node:worker_threads'

const { input, expected, modulePath } = workerData as { input: Uint8Array; expected: number; modulePath: string }
let output: Uint8Array<ArrayBuffer> | undefined
try {
  if (!(input instanceof Uint8Array) || !input.byteLength || input.byteLength >= 52428800 ||
    !Number.isSafeInteger(expected) || expected <= 0 || expected >= 200000000) throw new Error('Invalid LZFSE input bounds')
  const binding = require(modulePath) as { decodeInto(input: Buffer, expected: number, output: Buffer): Buffer }
  // Own the transferable ArrayBuffer; the native call borrows views only for
  // its synchronous decode. Neither a pooled nor native-owned Buffer is moved.
  output = new Uint8Array(expected)
  binding.decodeInto(Buffer.from(input.buffer, input.byteOffset, input.byteLength), expected,
    Buffer.from(output.buffer, output.byteOffset, output.byteLength))
  parentPort!.postMessage({ ok: true, output }, [output.buffer])
  output = undefined // The receiver now owns the bytes; the worker's views are detached.
} catch { parentPort!.postMessage({ ok: false }) }
finally {
  output?.fill(0)
  if (input instanceof Uint8Array) input.fill(0)
  parentPort!.close()
}
