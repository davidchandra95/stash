import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { pdfAssets } from './src/pdf/assets.ts'
import { drawingAssets } from './src/drawing/assets.ts'
export default defineConfig({
  plugins: [react(), pdfAssets(), drawingAssets()],
  // PDF.js requires class and function names to survive minification.
  build: { rolldownOptions: { output: { keepNames: true } } },
  server: {
    host: process.env.TAURI_DEV_HOST || '127.0.0.1',
    port: 1420,
    strictPort: true,
    watch: { ignored: ['**/src-tauri/**'] },
  },
  clearScreen: false,
})
