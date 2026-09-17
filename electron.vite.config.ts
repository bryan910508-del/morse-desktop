import { resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'electron-vite'
import type { Plugin } from 'vite'

// The preload and the page's photo workers only word messages in Korean for the window to translate, so they take
// src/shared/i18n/korean.ts instead of the dictionaries.
function koreanWords(): Plugin {
  const dictionaries = resolve('src/shared/i18n/index.ts'), korean = resolve('src/shared/i18n/korean.ts')
  return {
    name: 'morse-korean-words',
    enforce: 'pre',
    async resolveId(source, importer, options) {
      if (!/i18n(\/index(\.ts)?)?$/.test(source)) return null
      const resolved = await this.resolve(source, importer, { ...options, skipSelf: true })
      return resolved?.id === dictionaries ? korean : null
    }
  }
}

export default defineConfig({
  main: {
    build: {
      rollupOptions: {
        input: {
          boot: resolve('src/main/boot.ts'),
          index: resolve('src/main/index.ts'),
          'compression-worker': resolve('src/main/media/compression-worker.ts'),
          'delivery-worker': resolve('src/main/storage/delivery-worker.ts')
        },
        output: { entryFileNames: '[name].cjs', format: 'cjs' }
      }
    }
  },
  preload: {
    plugins: [koreanWords()],
    build: {
      rollupOptions: {
        input: { index: resolve('src/preload/index.ts'), 'app-proof': resolve('src/preload/app-proof.ts') },
        output: { entryFileNames: '[name].cjs', format: 'cjs' }
      }
    }
  },
  renderer: {
    publicDir: resolve('resources/brand'),
    plugins: [react()],
    worker: { plugins: () => [koreanWords()] },
    build: { sourcemap: false }
  }
})
