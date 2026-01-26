import { test, expect } from '@playwright/test';

test.describe('네비게이션 메뉴', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
  });

  test('로고가 표시되어야 함', async ({ page }) => {
    const logo = page.locator('img[src*="logo"]');
    await expect(logo).toBeVisible();
  });

  test('SNS랭킹 메뉴 클릭', async ({ page }) => {
    await page.click('text=SNS랭킹');
    await page.waitForTimeout(500);
    await expect(page.locator('text=SNS 팔로워 순위')).toBeVisible();
  });

  test('채용정보 메뉴 클릭', async ({ page }) => {
    await page.click('text=채용정보');
    await page.waitForTimeout(500);
    await expect(page.locator('text=엔터테인먼트 채용정보')).toBeVisible();
  });
});
