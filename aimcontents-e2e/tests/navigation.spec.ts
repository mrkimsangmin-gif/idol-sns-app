import { test, expect } from '@playwright/test';

/**
 * 전 메뉴 공통 정의 및 4-Gate Assertion 스펙
 */
const CORE_MENUS = [
  {
    name: 'SNS랭킹',
    pathRegex: /\/(ranking)?$/,
    heading: 'SNS 팔로워 순위',
    containerSelector: '#ranking-container, [data-section="ranking"], .ranking-table, table',
  },
  {
    name: '컴백일정',
    pathRegex: /\/calendar|\/comeback/,
    heading: '컴백/데뷔 일정',
    containerSelector: '#calendar-container, [data-section="calendar"], .calendar-grid, .calendar-view',
  },
  {
    name: '엔터뉴스',
    pathRegex: /\/news/,
    heading: '실시간 엔터테인먼트 뉴스',
    containerSelector: '#news-container, [data-section="news"], article, .news-item',
  },
  {
    name: '채용정보',
    pathRegex: /\/jobs/,
    heading: '엔터테인먼트 채용정보',
    containerSelector: '#jobs-container, [data-section="jobs"], .job-card, .job-item',
  },
  {
    name: '중국트렌드',
    pathRegex: /\/douyin|\/china/,
    heading: '중국 도우인 인기 챌린지',
    containerSelector: '#douyin-container, [data-section="douyin"], .trend-item',
  },
  {
    name: '링크모음',
    pathRegex: /\/links/,
    heading: 'K-POP 링크 모음',
    containerSelector: '#links-container, [data-section="links"], .link-category',
  },
];

test.describe('전 메뉴 E2E 4-Gate 정상 작동 검증 (Desktop & Mobile)', () => {

  test.beforeEach(async ({ page }) => {
    // 1. 배너 오버레이 간섭 방어 (CSS 무력화)
    await page.addStyleTag({
      content: `
        #lang-suggest-banner { display: none !important; }
        * { animation-duration: 0s !important; transition-duration: 0s !important; }
      `
    }).catch(() => {});
  });

  for (const menu of CORE_MENUS) {
    test(`[${menu.name}] 메뉴 정상 작동 검증 (Gate 1~4 SLA)`, async ({ page, isMobile }) => {
      // [Gate 1] 런타임 콘솔/JS 에러 감지 준비
      const pageErrors: string[] = [];
      page.on('pageerror', err => pageErrors.push(err.message));

      await page.goto('/');
      await page.waitForLoadState('domcontentloaded');

      // 배너 스타일 재주입
      await page.addStyleTag({
        content: '#lang-suggest-banner { display: none !important; }'
      }).catch(() => {});

      // 모바일 환경일 경우 햄버거 메뉴 먼저 클릭
      if (isMobile) {
        const menuButton = page.locator('button[aria-label*="menu"], button[aria-label*="메뉴"], .hamburger, .mobile-menu-btn');
        if (await menuButton.first().isVisible()) {
          await menuButton.first().click({ force: true });
          await page.waitForTimeout(300);
        }
      }

      // 메뉴 링크 클릭
      const menuLink = page.getByRole('link', { name: menu.name }).or(
        page.locator(`nav a, .nav a, ul li a, .mobile-nav a`).filter({ hasText: menu.name })
      ).first();

      await expect(menuLink, `[${menu.name}] 메뉴 링크가 DOM에 존재해야 함`).toBeVisible();
      await menuLink.click({ force: true });
      await page.waitForTimeout(500);

      // [Gate 2] URL 및 라우팅 정합성 확인
      expect(page.url()).toMatch(menu.pathRegex);

      // [Gate 3] 해당 섹션의 헤딩 및 실제 콘텐츠 렌더링 확인
      const sectionHeading = page.locator('h1, h2, h3').filter({ hasText: menu.heading }).first();
      await expect(sectionHeading, `[${menu.name}] 섹션 제목('${menu.heading}')이 보여야 함`).toBeVisible({ timeout: 10000 });

      const contentItem = page.locator(menu.containerSelector).first();
      await expect(contentItem, `[${menu.name}] 실제 데이터 콘텐츠가 렌더링되어야 함`).toBeVisible({ timeout: 10000 });

      // [Gate 4] 데이터 바인딩 오류(NaN, undefined) 검증
      const textContent = (await contentItem.innerText()).trim();
      expect(textContent.length, `[${menu.name}] 콘텐츠 텍스트가 비어있지 않아야 함`).toBeGreaterThan(3);
      expect(textContent, `[${menu.name}] 데이터 바인딩 오류(undefined/NaN) 포함 여부 검증`).not.toMatch(/\b(undefined|NaN)\b|\[object Object\]/);

      // Gate 1 최종 확인: 치명적 런타임 오류가 없었는지
      expect(pageErrors, `[${menu.name}] 진입 중 런타임 JS 에러 발생: ${pageErrors.join(', ')}`).toEqual([]);
    });
  }
});
