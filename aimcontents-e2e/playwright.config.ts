import { defineConfig, devices } from '@playwright/test';

/**
 * aimcontents.com E2E 테스트 설정
 * - 2-Tier 스케일러블 아키텍처: Desktop Chrome + Mobile Chrome (Pixel 5)
 */
export default defineConfig({
  testDir: './tests',
  testIgnore: process.env.CI ? [
    '**/local-gemini-test.spec.ts',
    '**/namu-smart-search.spec.ts',
    '**/fg-category-tests.spec.ts',
    '**/visual-regression.spec.ts',
  ] : [],
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: [
    ['html', { outputFolder: 'playwright-report' }],
    ['list'],
  ],
  
  use: {
    baseURL: 'https://aimcontents.com',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    actionTimeout: 10000,
    navigationTimeout: 30000,
  },

  timeout: 60000,
  expect: {
    timeout: 10000,
  },

  projects: [
    // ========== [Tier 1: 상시 CI 핵심 프로젝트] ==========
    {
      name: 'Desktop Chrome',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'Mobile Chrome',
      use: { 
        ...devices['Pixel 5'],
        isMobile: true,
        hasTouch: true,
      },
    },

    // ========== [Tier 2: 주간/온디맨드 매트릭스] ==========
    {
      name: 'Desktop Firefox',
      use: { ...devices['Desktop Firefox'] },
    },
    {
      name: 'Desktop Safari',
      use: { ...devices['Desktop Safari'] },
    },
    {
      name: 'Mobile Safari',
      use: { ...devices['iPhone 14 Pro Max'] },
    },
  ],
});
