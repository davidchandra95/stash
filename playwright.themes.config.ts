import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests/themes',
  testMatch: '**/*.e2e.ts',
  outputDir: '.artifact-work/aster/browser-tests',
  timeout: 45000,
  use: {
    baseURL: 'http://127.0.0.1:1420',
    viewport: { width: 1280, height: 800 },
    reducedMotion: 'reduce',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npm run dev',
    url: 'http://127.0.0.1:1420',
    reuseExistingServer: !process.env.CI,
  },
})
