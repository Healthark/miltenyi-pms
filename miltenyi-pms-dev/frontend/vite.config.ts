import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// Resolve __dirname under ESM so the alias below works regardless of
// where Vite is launched from.
const __dirname = path.dirname(fileURLToPath(import.meta.url))

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      // `@/foo` → `<frontend>/src/foo`. Mirrors the `paths` entry in
      // tsconfig.app.json so the bundler and the TS server agree.
      '@': path.resolve(__dirname, './src'),
    },
  },
})
