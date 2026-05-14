import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { visualizer } from 'rollup-plugin-visualizer'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// Resolve __dirname under ESM so the alias below works regardless of
// where Vite is launched from.
const __dirname = path.dirname(fileURLToPath(import.meta.url))

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    // Bundle X-ray: emits dist/stats.html after every `npm run build`.
    // Open it in a browser to see a treemap of every module + its gzip
    // / brotli size. Build-only, never shipped to the user. Toggle with
    // ANALYZE=1 if it ever gets noisy, but the file is cheap so we
    // leave it on by default.
    visualizer({
      filename: 'dist/stats.html',
      template: 'treemap',
      gzipSize: true,
      brotliSize: true,
      open: false,
    }),
  ],
  resolve: {
    alias: {
      // `@/foo` → `<frontend>/src/foo`. Mirrors the `paths` entry in
      // tsconfig.app.json so the bundler and the TS server agree.
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    rollupOptions: {
      output: {
        // Group stable third-party deps into their own chunks. These
        // chunks change only when we upgrade the library, NOT when our
        // application code changes — so the browser keeps them cached
        // across our deploys. A code-only release invalidates app chunks
        // but reuses vendor chunks, saving repeat visitors ~50KB+ gzip.
        //
        // We intentionally do NOT bucket every node_module into a
        // single `vendor.js`. Modern Vite/Rolldown already auto-extracts
        // shared chunks from dynamic imports; we only override that for
        // the framework-tier deps where stability beats granularity.
        // Vite 8 / Rolldown wants the function form. It's called once
        // per module with its absolute path; return the chunk name (or
        // undefined to let the bundler decide).
        manualChunks(id) {
          if (id.includes('node_modules')) {
            if (
              /[\\/]node_modules[\\/](react|react-dom|react-router|react-router-dom|scheduler)[\\/]/.test(
                id,
              )
            ) {
              return 'react-vendor';
            }
            if (/[\\/]node_modules[\\/]axios[\\/]/.test(id)) {
              return 'http-vendor';
            }
            // Rolls the 80+ individual lucide icon chunks into one
            // cacheable file. Trades per-icon code-splitting (which
            // we weren't really benefiting from) for fewer HTTP
            // requests.
            if (/[\\/]node_modules[\\/]lucide-react[\\/]/.test(id)) {
              return 'icons-vendor';
            }
          }
          return undefined;
        },
      },
    },
  },
})
