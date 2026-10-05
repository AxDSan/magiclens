import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 120_000,
  expect: { timeout: 30_000 },
  workers: 1,
  reporter: [['list']],
  outputDir: 'test-results',
  globalSetup: './tests/e2e/global-setup.ts',
  webServer: {
    command: 'node tests/e2e/server.mjs',
    url: 'http://localhost:4599/index.html',
    reuseExistingServer: true,
    stdout: 'ignore',
  },
});
