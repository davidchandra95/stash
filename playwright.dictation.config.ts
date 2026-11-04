import { defineConfig } from '@playwright/test'

// Isolated port: never exercise another worktree's development server.
export default defineConfig({
  testDir: './tests/ui',
  testMatch: 'dictation.e2e.ts',
  outputDir: '.artifact-work/dictation-ui',
  timeout: 30000,
  workers: 1,
  use: {
    baseURL: 'http://127.0.0.1:1428',
    viewport: { width: 1280, height: 800 },
    reducedMotion: 'reduce',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npm run dev -- --port 1428',
    url: 'http://127.0.0.1:1428',
    reuseExistingServer: false,
  },
})
