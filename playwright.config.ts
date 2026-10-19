import { defineConfig } from '@playwright/test';
const url = process.env.TEST_DATABASE_URL;
if (!url || !/^learnspace_test(?:_[\w-]+)?$/.test(new URL(url).pathname.slice(1))) throw new Error('Playwright requires a separate migrated TEST_DATABASE_URL.');
export default defineConfig({
  testDir: './tests/e2e', fullyParallel: false, workers: 1, timeout: 30000,
  use: { baseURL: 'http://127.0.0.1:3101', headless: true, trace: 'retain-on-failure' },
  webServer: {
    command: 'node dist/e2e/tests/support/server.js', url: 'http://127.0.0.1:3101/api/v1/health/ready', reuseExistingServer: false,
    env: { NODE_ENV: 'production', DATABASE_URL: url, API_PORT: '3101', API_HOST: '127.0.0.1', WEB_ORIGIN: 'http://127.0.0.1:3101', DATA_DIR: './data/milestone2-e2e' }
  }
});
