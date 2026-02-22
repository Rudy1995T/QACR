import { defineConfig, devices } from '@playwright/test';
import dotenv from 'dotenv';

dotenv.config();

export default defineConfig({
  testDir: './tests',
  testIgnore: ['**/recordings/**'], // Recordings suite uses its own config
  fullyParallel: false, // Run sequentially for AI agent tests
  forbidOnly: !!process.env.CI,
  retries: 0, // AI agent handles retries internally
  workers: 1, // Single worker for deterministic execution
  reporter: [
    ['html', { outputFolder: 'playwright-report' }],
    ['list']
  ],
  timeout: 300000, // 5 minutes per test (AI agents need time)
  use: {
    trace: 'retain-on-failure',
    actionTimeout: 30000,
    navigationTimeout: 30000,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
