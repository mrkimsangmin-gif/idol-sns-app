import { test, expect } from '@playwright/test';

/**
 * 네비게이션 메뉴 테스트
 * - 모든 메뉴 항목이 클릭 가능한지
 * - 각 섹션으로 정상 이동하는지
 * - 모바일에서 햄버거 메뉴 동작 확인
 */
test.describe('네비게이션 메뉴', () => {
  
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
  });

  test('로고가 표시되어야 함', async ({ page }) => {
    const logo = page.locator('img[src*="logo"]');
    await expect(logo).toBeVisible();
  });

  test('모든 네비게이션 메뉴가 표시되어야 함', async ({ page, isMobile }) => {
    // 모바일 환경일 경우 햄버거 메뉴 먼저 클릭
    if (isMobile) {
      const menuButton = page.locator('button[aria-label*="menu"], button[aria-label*="메뉴"], .hamburger, .mobile-menu-btn');
      if (await menuButton.first().isVisible()) {
        await menuButton.first().click();
        await page.waitForTimeout(300);
      }
    }

    const menuItems = [
      'SNS랭킹',
      '컴백일정',
      '엔터뉴스',
      '링크모음',
      '채용정보',
      '중국트렌드',
    ];

    for (const menuText of menuItems) {
      const menuLink = page.getByRole('link', { name: menuText }).or(
        page.locator(`nav a, .nav a, ul li a`).filter({ hasText: menuText })
      );
      await expect(menuLink.first()).toBeVisible();
    }
  });

  test('SNS랭킹 메뉴 클릭 시 해당 섹션으로 이동', async ({ page, isMobile }) => {
    // 모바일 환경일 경우 햄버거 메뉴 먼저 클릭
    if (isMobile) {
      const menuButton = page.locator('button[aria-label*="menu"], button[aria-label*="메뉴"], .hamburger');
      if (await menuButton.first().isVisible()) {
        await menuButton.first().click();
        await page.waitForTimeout(300);
      }
    }

    await page.getByRole('link', { name: 'SNS랭킹' }).or(page.locator('text=SNS랭킹')).first().click();
    await page.waitForTimeout(500);
    
    const snsSection = page.locator('h1, h2').filter({ hasText: 'SNS 팔로워 순위' }).first();
    await expect(snsSection).toBeVisible();
  });

  test('컴백일정 메뉴 클릭 시 해당 섹션으로 이동', async ({ page, isMobile }) => {
    if (isMobile) {
      const menuButton = page.locator('button[aria-label*="menu"], .hamburger');
      if (await menuButton.first().isVisible()) {
        await menuButton.first().click();
        await page.waitForTimeout(300);
      }
    }

    await page.getByRole('link', { name: '컴백일정' }).or(page.locator('text=컴백일정')).first().click();
    await page.waitForTimeout(500);
    
    const comebackSection = page.locator('h2').filter({ hasText: '컴백/데뷔 일정' }).first();
    await expect(comebackSection).toBeVisible();
  });

  test('엔터뉴스 메뉴 클릭 시 해당 섹션으로 이동', async ({ page, isMobile }) => {
    if (isMobile) {
      const menuButton = page.locator('button[aria-label*="menu"], .hamburger');
      if (await menuButton.first().isVisible()) {
        await menuButton.first().click();
        await page.waitForTimeout(300);
      }
    }

    await page.getByRole('link', { name: '엔터뉴스' }).or(page.locator('text=엔터뉴스')).first().click();
    await page.waitForTimeout(500);
    
    const newsSection = page.locator('h2').filter({ hasText: '실시간 엔터테인먼트 뉴스' }).first();
    await expect(newsSection).toBeVisible();
  });

  test('링크모음 메뉴 클릭 시 해당 섹션으로 이동', async ({ page, isMobile }) => {
    if (isMobile) {
      const menuButton = page.locator('button[aria-label*="menu"], .hamburger');
      if (await menuButton.first().isVisible()) {
        await menuButton.first().click();
        await page.waitForTimeout(300);
      }
    }

    await page.getByRole('link', { name: '링크모음' }).or(page.locator('text=링크모음')).first().click();
    await page.waitForTimeout(500);
    
    const linkSection = page.locator('text=K-POP 링크 모음');
    await expect(linkSection).toBeVisible();
  });

  test('채용정보 메뉴 클릭 시 해당 섹션으로 이동', async ({ page, isMobile }) => {
    if (isMobile) {
      const menuButton = page.locator('button[aria-label*="menu"], .hamburger');
      if (await menuButton.first().isVisible()) {
        await menuButton.first().click();
        await page.waitForTimeout(300);
      }
    }

    await page.getByRole('link', { name: '채용정보' }).or(page.locator('text=채용정보')).first().click();
    await page.waitForTimeout(500);
    
    const jobSection = page.locator('h2').filter({ hasText: '엔터테인먼트 채용정보' }).first();
    await expect(jobSection).toBeVisible();
  });

  test('중국트렌드 메뉴 클릭 시 해당 섹션으로 이동', async ({ page, isMobile }) => {
    if (isMobile) {
      const menuButton = page.locator('button[aria-label*="menu"], .hamburger');
      if (await menuButton.first().isVisible()) {
        await menuButton.first().click();
        await page.waitForTimeout(300);
      }
    }

    await page.getByRole('link', { name: '중국트렌드' }).or(page.locator('text=중국트렌드')).first().click();
    await page.waitForTimeout(500);
    
    const chinaSection = page.locator('text=중국 도우인 인기 챌린지');
    await expect(chinaSection).toBeVisible();
  });
});
