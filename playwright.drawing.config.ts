import { defineConfig } from '@playwright/test'
export default defineConfig({
  testDir: './tests/drawing',
  testMatch: '**/*.e2e.ts',
  outputDir: '.artifact-work/drawing-tests',
  timeout: 60000,
  use: {
    baseURL: 'http://127.0.0.1:1420',
    viewport: { width: 1280, height: 800 },
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npm run dev',
    url: 'http://127.0.0.1:1420',
    reuseExistingServer: !process.env.CI,
  },
})
