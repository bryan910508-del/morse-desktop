import { resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// `npx vite --config test/harness/vite.config.ts` serves the renderer with the fake bridge.
export default defineConfig({
  root: resolve(__dirname),
  publicDir: resolve(__dirname, '../../resources/brand'),
  plugins: [react()],
  server: { port: 5199, strictPort: true, fs: { allow: [resolve(__dirname, '../..')] } }
})
