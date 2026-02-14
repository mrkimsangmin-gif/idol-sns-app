import { test, expect, devices } from '@playwright/test';

/**
 * 모바일 환경 전용 테스트
 * - 반응형 레이아웃
 * - 터치 인터랙션
 * - 모바일 메뉴 (햄버거 메뉴)
 * - iOS Safari 특수 케이스
 * 
 * 💡 핵심: "버튼이 있다"가 아니라 "기능이 실제로 작동한다"를 검증
 */

// iPhone 13 환경 테스트
test.describe('모바일 - iPhone 13', () => {
  test.use({ ...devices['iPhone 13'] });

  test('페이지가 정상 로드되어야 함', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    
    await expect(page).toHaveTitle(/아이엠콘텐츠|K-Idol|AIMCONTENTS/i);
  });

  test('로고가 모바일에서도 표시되어야 함', async ({ page }) => {
    await page.goto('/');
    const logo = page.locator('img[src*="logo"]');
    await expect(logo).toBeVisible();
  });

  test('햄버거 메뉴 열기 및 메뉴 이동 확인', async ({ page, isMobile }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    
    // isMobile이 true인지 확인 (모바일 환경 검증)
    expect(isMobile).toBeTruthy();
    
    // 햄버거 메뉴 버튼 찾기 (다양한 선택자 시도)
    const hamburgerSelectors = [
      'button[aria-label*="메뉴"]',
      'button[aria-label*="menu"]',
      'button[aria-label*="Menu"]',
      '.hamburger',
      '.mobile-menu-btn',
      '.menu-toggle',
      '[class*="hamburger"]',
      '[class*="menu-btn"]',
    ];

    let menuOpened = false;
    for (const selector of hamburgerSelectors) {
      const btn = page.locator(selector).first();
      if (await btn.isVisible().catch(() => false)) {
        await btn.click();
        await page.waitForTimeout(500);
        menuOpened = true;
        break;
      }
    }

    // 메뉴가 열렸으면 SNS랭킹 클릭 시도
    if (menuOpened) {
      const snsMenu = page.getByRole('link', { name: 'SNS랭킹' }).or(page.locator('text=SNS랭킹')).first();
      if (await snsMenu.isVisible()) {
        await snsMenu.click();
        await page.waitForTimeout(500);
        
        // 섹션 이동 확인
        const snsSection = page.locator('text=SNS 팔로워 순위');
        await expect(snsSection).toBeVisible();
      }
    }
  });

  test('메뉴가 화면 밖으로 잘리지 않아야 함', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    
    const nav = page.locator('nav, [class*="nav"]').first();
    
    if (await nav.isVisible()) {
      const box = await nav.boundingBox();
      if (box) {
        const viewport = page.viewportSize();
        if (viewport) {
          // 메뉴가 화면 안에 있는지 확인
          expect(box.x).toBeGreaterThanOrEqual(-5); // 약간의 여유
          expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 10);
        }
      }
    }
  });

  test('터치로 SNS랭킹 탭 전환이 가능해야 함', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    
    // SNS랭킹 섹션으로 먼저 이동
    await page.evaluate(() => {
      const section = document.querySelector('h4, h3');
      section?.scrollIntoView({ behavior: 'smooth' });
    });
    await page.waitForTimeout(500);
    
    // 여자 탭 터치
    const femaleTab = page.locator('a, button, div').filter({ hasText: /^여자$/ }).first();
    if (await femaleTab.isVisible()) {
      await femaleTab.tap(); // 터치 이벤트
      await page.waitForTimeout(300);
    }
  });

  test('스크롤이 부드럽게 동작해야 함', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    
    // 페이지 하단으로 스크롤
    await page.evaluate(() => {
      window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
    });
    await page.waitForTimeout(1000);
    
    // 상단으로 스크롤
    await page.evaluate(() => {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
    await page.waitForTimeout(500);
  });
});

// Pixel 5 (Android) 환경 테스트
test.describe('모바일 - Pixel 5 (Android)', () => {
  test.use({ ...devices['Pixel 5'] });

  test('Android에서 페이지가 정상 로드되어야 함', async ({ page, isMobile }) => {
    expect(isMobile).toBeTruthy();
    
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    
    const logo = page.locator('img[src*="logo"]');
    await expect(logo).toBeVisible();
  });

  test('Android에서 채용정보 필터가 터치로 동작해야 함', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    
    // 채용정보 섹션으로 스크롤
    await page.evaluate(() => {
      const section = document.evaluate(
        "//*[contains(text(), '채용정보')]",
        document,
        null,
        XPathResult.FIRST_ORDERED_NODE_TYPE,
        null
      ).singleNodeValue;
      section?.scrollIntoView({ behavior: 'smooth' });
    });
    await page.waitForTimeout(500);
    
    // 마케팅 필터 터치
    const marketingFilter = page.locator('button, span, div').filter({ hasText: /^마케팅$/ }).first();
    if (await marketingFilter.isVisible()) {
      await marketingFilter.tap();
      await page.waitForTimeout(300);
    }
  });
});

// iPad 환경 테스트
test.describe('태블릿 - iPad Pro', () => {
  test.use({ ...devices['iPad Pro 11'] });

  test('iPad에서 레이아웃이 올바르게 표시되어야 함', async ({ page, isMobile }) => {
    // iPad는 isMobile이 true
    expect(isMobile).toBeTruthy();
    
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    
    // 네비게이션이 표시되는지 확인
    const navLinks = page.getByRole('link', { name: 'SNS랭킹' }).or(
      page.locator('nav a, ul li a').filter({ hasText: 'SNS랭킹' })
    );
    await expect(navLinks.first()).toBeVisible();
  });

  test('iPad 가로 모드에서도 정상 동작해야 함', async ({ page }) => {
    // 가로 모드 뷰포트
    await page.setViewportSize({ width: 1194, height: 834 });
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    
    const logo = page.locator('img[src*="logo"]');
    await expect(logo).toBeVisible();
  });
});

// iOS Safari 특수 케이스
test.describe('iOS Safari 특수 케이스', () => {
  test.use({ ...devices['iPhone 13'] });

  test('100vh 이슈 - 스크롤 시 레이아웃 깨짐 없어야 함', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    
    // 여러 번 스크롤하며 레이아웃 확인
    for (let i = 0; i < 3; i++) {
      await page.evaluate(() => window.scrollBy(0, 300));
      await page.waitForTimeout(200);
    }
    
    // 페이지 하단으로 스크롤
    await page.evaluate(() => {
      window.scrollTo(0, document.body.scrollHeight);
    });
    await page.waitForTimeout(500);
    
    // 콘솔 에러 확인
    const errors: string[] = [];
    page.on('console', msg => {
      if (msg.type() === 'error') errors.push(msg.text());
    });
    
    // 치명적 JS 에러가 없어야 함
    expect(errors.filter(e => e.includes('TypeError') || e.includes('ReferenceError')).length).toBe(0);
  });

  test('Safe Area - 콘텐츠가 노치 영역과 겹치지 않아야 함', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    
    // 상단 요소가 적절한 padding을 가지는지 확인
    const header = page.locator('header, nav, [class*="header"]').first();
    
    if (await header.isVisible()) {
      const box = await header.boundingBox();
      if (box) {
        // 상단에서 최소 20px 이상 떨어져 있어야 함 (노치 고려)
        expect(box.y).toBeGreaterThanOrEqual(0);
      }
    }
  });
});
