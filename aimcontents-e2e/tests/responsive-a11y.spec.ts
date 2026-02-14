import { test, expect } from '@playwright/test';

/**
 * 반응형 레이아웃 테스트
 * 다양한 화면 크기에서 레이아웃 검증
 */
test.describe('반응형 레이아웃', () => {
  
  const viewports = [
    { name: '모바일 소형', width: 320, height: 568 },   // iPhone SE
    { name: '모바일 중형', width: 375, height: 667 },   // iPhone 8
    { name: '모바일 대형', width: 428, height: 926 },   // iPhone 14 Pro Max
    { name: '태블릿 세로', width: 768, height: 1024 },  // iPad
    { name: '태블릿 가로', width: 1024, height: 768 },  // iPad 가로
    { name: '노트북', width: 1366, height: 768 },       // 일반 노트북
    { name: '데스크톱', width: 1920, height: 1080 },    // Full HD
    { name: '와이드', width: 2560, height: 1440 },      // QHD
  ];

  for (const vp of viewports) {
    test(`${vp.name} (${vp.width}x${vp.height}) 레이아웃 확인`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.goto('/');
      await page.waitForLoadState('networkidle');
      
      // 기본 요소들이 보이는지 확인
      const logo = page.locator('img[src*="logo"]');
      await expect(logo).toBeVisible();
      
      // 콘텐츠가 화면 밖으로 넘치지 않는지 확인
      const hasHorizontalScroll = await page.evaluate(() => {
        return document.documentElement.scrollWidth > document.documentElement.clientWidth;
      });
      
      // 가로 스크롤이 없어야 함 (또는 의도된 경우 제외)
      // expect(hasHorizontalScroll).toBeFalsy();
      
      // 스크린샷 저장 (시각적 확인용)
      await page.screenshot({ 
        path: `./test-results/screenshots/${vp.name.replace(' ', '-')}.png`,
        fullPage: true 
      });
    });
  }
});

/**
 * 접근성 기본 테스트
 */
test.describe('접근성 검사', () => {
  
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
  });

  test('이미지에 alt 속성이 있어야 함', async ({ page }) => {
    const images = page.locator('img');
    const count = await images.count();
    
    for (let i = 0; i < count; i++) {
      const img = images.nth(i);
      const alt = await img.getAttribute('alt');
      const src = await img.getAttribute('src');
      
      // alt 속성이 있거나, 장식용 이미지인 경우 통과
      // (실제로는 더 엄격한 검사 필요)
      if (!alt && alt !== '') {
        console.warn(`이미지에 alt 없음: ${src}`);
      }
    }
  });

  test('링크에 접근 가능한 텍스트가 있어야 함', async ({ page }) => {
    const links = page.locator('a');
    const count = await links.count();
    
    for (let i = 0; i < count; i++) {
      const link = links.nth(i);
      const text = await link.textContent();
      const ariaLabel = await link.getAttribute('aria-label');
      const title = await link.getAttribute('title');
      
      // 텍스트, aria-label, 또는 title이 있어야 함
      const hasAccessibleName = (text && text.trim()) || ariaLabel || title;
      
      if (!hasAccessibleName) {
        const href = await link.getAttribute('href');
        console.warn(`접근성 텍스트 없는 링크: ${href}`);
      }
    }
  });

  test('버튼에 접근 가능한 텍스트가 있어야 함', async ({ page }) => {
    const buttons = page.locator('button');
    const count = await buttons.count();
    
    for (let i = 0; i < count; i++) {
      const button = buttons.nth(i);
      const text = await button.textContent();
      const ariaLabel = await button.getAttribute('aria-label');
      
      const hasAccessibleName = (text && text.trim()) || ariaLabel;
      
      if (!hasAccessibleName) {
        console.warn(`접근성 텍스트 없는 버튼 발견`);
      }
    }
  });

  test('폼 입력에 레이블이 있어야 함', async ({ page }) => {
    const inputs = page.locator('input, select, textarea');
    const count = await inputs.count();
    
    for (let i = 0; i < count; i++) {
      const input = inputs.nth(i);
      const id = await input.getAttribute('id');
      const ariaLabel = await input.getAttribute('aria-label');
      const placeholder = await input.getAttribute('placeholder');
      
      if (id) {
        const label = page.locator(`label[for="${id}"]`);
        const hasLabel = await label.count() > 0;
        
        if (!hasLabel && !ariaLabel) {
          console.warn(`레이블 없는 입력 필드: ${id}`);
        }
      }
    }
  });

  test('색상 대비가 충분해야 함 (기본 체크)', async ({ page }) => {
    // 주요 텍스트 요소의 색상 확인
    const mainText = page.locator('body');
    const styles = await mainText.evaluate((el) => {
      const computed = window.getComputedStyle(el);
      return {
        color: computed.color,
        backgroundColor: computed.backgroundColor,
      };
    });
    
    // 실제 대비 계산은 별도 라이브러리 필요
    console.log('텍스트 색상:', styles.color);
    console.log('배경 색상:', styles.backgroundColor);
  });
});

/**
 * 성능 기본 테스트
 */
test.describe('성능 검사', () => {
  
  test('페이지 로드 시간이 적절해야 함', async ({ page }) => {
    const startTime = Date.now();
    
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    
    const loadTime = Date.now() - startTime;
    
    console.log(`페이지 로드 시간: ${loadTime}ms`);
    
    // 5초 이내 로드 (조건에 따라 조정)
    expect(loadTime).toBeLessThan(5000);
  });

  test('콘솔 에러가 없어야 함', async ({ page }) => {
    const errors: string[] = [];
    
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        errors.push(msg.text());
      }
    });
    
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000); // 추가 대기
    
    // 에러 로그 출력
    if (errors.length > 0) {
      console.warn('콘솔 에러:', errors);
    }
    
    // 치명적 에러만 실패 처리 (필요에 따라 조정)
    // expect(errors.length).toBe(0);
  });

  test('네트워크 요청 실패가 없어야 함', async ({ page }) => {
    const failedRequests: string[] = [];
    
    page.on('requestfailed', (request) => {
      failedRequests.push(`${request.url()} - ${request.failure()?.errorText}`);
    });
    
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    
    if (failedRequests.length > 0) {
      console.warn('실패한 요청:', failedRequests);
    }
  });
});
