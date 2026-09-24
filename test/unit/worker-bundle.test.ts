import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, normalize } from 'node:path'
import { test } from 'node:test'

// A worker thread is not the main thread: `require('electron')` throws there, and the worker dies the
// moment it starts. The delivery worker holds everything the account writes — what is being sent, the
// drafts, the read marks — so one such import took the whole storage down with it and every message
// after it («전송 저장소를 사용할 수 없습니다»). It happened: a diagnostic added to media-document.ts,
// which the worker reaches through channel-post-creation-table, pulled app.getPath('logs') in with it.
// Nothing in the build said so, and the worker only runs in the packaged app, so no test saw it either.
const entries = ['src/main/storage/delivery-worker.ts', 'src/main/media/compression-worker.ts']
const mainOnly = ['electron']

function resolveImport(from: string, specifier: string): string | null {
  if (!specifier.startsWith('.')) return null
  const path = normalize(join(dirname(from), specifier))
  for (const candidate of [`${path}.ts`, `${path}.tsx`, join(path, 'index.ts')]) if (existsSync(candidate)) return candidate
  return null
}
const importPattern = /(?:^|\n)\s*(?:import|export)[^;\n]*?from\s*['"]([^'"]+)['"]/g

// Every module the entry reaches, with the chain that reached it, so a failure names the import to undo.
function reach(entry: string): Map<string, string[]> {
  const chains = new Map<string, string[]>([[entry, [entry]]])
  const queue = [entry]
  while (queue.length) {
    const current = queue.shift()!
    const source = readFileSync(current, 'utf8')
    for (const [, specifier] of source.matchAll(importPattern)) {
      if (mainOnly.includes(specifier)) {
        const chain = [...chains.get(current)!, specifier]
        assert.fail(`a worker cannot require '${specifier}':\n  ${chain.join('\n  → ')}`)
      }
      const target = resolveImport(current, specifier)
      if (target && !chains.has(target)) { chains.set(target, [...chains.get(current)!, target]); queue.push(target) }
    }
  }
  return chains
}

test('nothing a worker thread loads reaches a main-process-only module', () => {
  for (const entry of entries) {
    assert.ok(existsSync(entry), `${entry} is the worker this test guards; rename it here if it moves`)
    reach(entry)
  }
  // The walk really covers the path that broke: the delivery worker reaches media-document.ts, which is
  // where the import was added.
  assert.ok(reach(entries[0]!).has('src/main/media/media-document.ts'), 'the worker still reaches the module that broke it')
})
