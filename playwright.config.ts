import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60_000,
  reporter: [['list'], ['json', { outputFile: 'reports/e2e-results.json' }]],
  use: {
    baseURL: 'http://localhost:4000',
    channel: 'msedge', // systémový Microsoft Edge (bez sťahovania prehliadača)
    viewport: { width: 1480, height: 1000 },
    deviceScaleFactor: 1.5,
  },
  webServer: {
    command: 'npm start',
    url: 'http://localhost:4000/sandbox/state',
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
