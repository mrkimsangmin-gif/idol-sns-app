import { test, expect } from '@playwright/test';

/**
 * 시각적 회귀 테스트 (Visual Regression Testing)
 * 페이지의 스크린샷을 비교하여 UI 변경 감지
 */
test.describe('시각적 회귀 테스트', () => {
  
  test('홈페이지 전체 스크린샷', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1000); // 모든 애니메이션 완료 대기
    
    // 전체 페이지 스크린샷
    await expect(page).toHaveScreenshot('homepage-full.png', {
      fullPage: true,
      // 허용 오차 (픽셀 수)
      maxDiffPixels: 100,
    });
  });

  test('SNS 랭킹 섹션 스크린샷', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.click('text=SNS랭킹');
    await page.waitForTimeout(500);
    
    const snsSection = page.locator('text=SNS 팔로워 순위').locator('..');
    
    if (await snsSection.isVisible()) {
      await expect(snsSection).toHaveScreenshot('sns-ranking-section.png', {
        maxDiffPixels: 50,
      });
    }
  });

  test('채용정보 섹션 스크린샷', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.click('text=채용정보');
    await page.waitForTimeout(500);
    
    const jobSection = page.locator('text=엔터테인먼트 채용정보').locator('..');
    
    if (await jobSection.isVisible()) {
      await expect(jobSection).toHaveScreenshot('job-listing-section.png', {
        maxDiffPixels: 50,
      });
    }
  });

  // 헤더/네비게이션 스크린샷
  test('헤더 스크린샷', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    
    const header = page.locator('header, nav, [class*="header"], [class*="nav"]').first();
    
    if (await header.isVisible()) {
      await expect(header).toHaveScreenshot('header.png', {
        maxDiffPixels: 30,
      });
    }
  });
});

/**
 * 다크 모드 테스트 (사이트가 지원하는 경우)
 */
test.describe('다크 모드', () => {
  
  test('다크 모드 스크린샷', async ({ page }) => {
    // 다크 모드 선호 설정
    await page.emulateMedia({ colorScheme: 'dark' });
    
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(500);
    
    await page.screenshot({
      path: './test-results/screenshots/dark-mode.png',
      fullPage: true,
    });
  });

  test('라이트 모드 스크린샷', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light' });
    
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(500);
    
    await page.screenshot({
      path: './test-results/screenshots/light-mode.png',
      fullPage: true,
    });
  });
});

/**
 * 동적 콘텐츠 로딩 테스트
 */
test.describe('동적 콘텐츠 로딩', () => {
  
  test('뉴스 로딩 완료 후 스크린샷', async ({ page }) => {
    await page.goto('/');
    await page.click('text=엔터뉴스');
    
    // 로딩 완료 대기 (로딩 텍스트가 사라질 때까지)
    try {
      await page.waitForSelector('text=뉴스를 불러오는 중', { 
        state: 'hidden',
        timeout: 10000 
      });
    } catch {
      // 로딩 텍스트가 없거나 이미 로드됨
    }
    
    await page.waitForTimeout(1000);
    
    await page.screenshot({
      path: './test-results/screenshots/news-loaded.png',
    });
  });

  test('채용정보 로딩 완료 후 스크린샷', async ({ page }) => {
    await page.goto('/');
    await page.click('text=채용정보');
    
    try {
      await page.waitForSelector('text=채용정보를 불러오는 중', { 
        state: 'hidden',
        timeout: 10000 
      });
    } catch {
      // 이미 로드됨
    }
    
    await page.waitForTimeout(1000);
    
    await page.screenshot({
      path: './test-results/screenshots/jobs-loaded.png',
    });
  });
});
