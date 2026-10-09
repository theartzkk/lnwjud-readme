import { defineConfig } from '@playwright/test';

const port = Number(process.env.AWH_UI_QA_PORT || 4246);
const baseURL = `http://127.0.0.1:${port}`;
const viewports = [
  { name: 'iphone-390', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true },
  { name: 'iphone-430', viewport: { width: 430, height: 932 }, isMobile: true, hasTouch: true },
  { name: 'tablet-820', viewport: { width: 820, height: 1024 }, isMobile: true, hasTouch: true },
  { name: 'desktop-1366', viewport: { width: 1366, height: 768 }, isMobile: false, hasTouch: false },
  { name: 'desktop-1440', viewport: { width: 1440, height: 900 }, isMobile: false, hasTouch: false },
];

export default defineConfig({
  testDir: './test/ui',
  testMatch: '**/*.visual.spec.mjs',
  fullyParallel: false,
  workers: 1,
  timeout: 45_000,
  expect: { timeout: 12_000 },
  retries: 0,
  reporter: [['list'], ['json', { outputFile: '.awh-local/review/playwright/pilot-results.json' }]],
  metadata: { revision: process.env.AWH_UI_REVISION || '' },
  forbidOnly: true,
  failOnFlakyTests: true,
  outputDir: '.awh-local/review/playwright/artifacts',
  use: {
    baseURL,
    browserName: 'chromium',
    channel: process.env.AWH_UI_BROWSER === 'chromium' ? 'chromium' : 'chrome',
    headless: true,
    reducedMotion: 'reduce',
    deviceScaleFactor: 1,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    actionTimeout: 12_000,
  },
  projects: viewports.map(({name, ...use}) => ({ name, use })),
  webServer: {
    command: 'node scripts/qa/control-web-fixture.mjs',
    url: baseURL + '/panel.html',
    timeout: 25_000,
    reuseExistingServer: false,
    env: { AWH_WEB_FIXTURE_PORT: String(port), AWH_WEB_FIXTURE_ROOT: 'dist-web' },
  },
});
