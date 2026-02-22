import { defineConfig, devices } from '@playwright/test';

const isCI = !!process.env.CI;

const screenshotMode = process.env.RECORDINGS_SCREENSHOTS as
  | 'off'
  | 'on'
  | 'only-on-failure'
  | undefined;

const videoMode = process.env.RECORDINGS_VIDEO as
  | 'off'
  | 'on'
  | 'retain-on-failure'
  | 'on-first-retry'
  | undefined;

export default defineConfig({
  testDir: './tests/recordings',
  fullyParallel: true,
  forbidOnly: isCI,
  retries: isCI ? 1 : 0,
  /* Use default workers (not restricted to 1) */
  reporter: [
    ['html', { outputFolder: 'playwright-report-recordings' }],
    ['list'],
  ],
  timeout: 60_000,
  use: {
    trace: 'on-first-retry',
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
    screenshot: screenshotMode ?? 'off',
    video: videoMode ?? 'off',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
