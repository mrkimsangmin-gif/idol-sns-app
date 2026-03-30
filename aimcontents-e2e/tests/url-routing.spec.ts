import { test, expect } from '@playwright/test';

/**
 * URL 라우팅 테스트
 * - 각 페이지 직접 접근 시 올바른 섹션 표시
 * - 404.html → index.html SPA 리다이렉트 동작
 * - SNS별 URL 직접 접근 (/ranking/bilibili 등)
 * - 뒤로가기/앞으로가기 (popstate) 동작
 */
test.describe('페이지 직접 접근 (SPA 라우팅)', () => {

  // 각 섹션별 직접 URL 접근 테스트
  const pages = [
    { path: '/ranking', sectionId: 'page-home', title: 'SNS랭킹' },
    { path: '/comeback', sectionId: 'page-comeback', title: '컴백일정' },
    { path: '/news', sectionId: 'page-news', title: '엔터뉴스' },
    { path: '/links', sectionId: 'page-links', title: '링크모음' },
    { path: '/jobs', sectionId: 'page-jobs', title: '채용정보' },
    { path: '/vendors', sectionId: 'page-vendors', title: '업체정보' },
    { path: '/douyin', sectionId: 'page-douyin', title: '중국트렌드' },
  ];

  for (const p of pages) {
    test(`${p.path} 직접 접근 시 ${p.title} 섹션이 표시되어야 함`, async ({ page }) => {
      // 직접 URL로 접근 (GitHub Pages 404 리다이렉트 → index.html 복원 과정 포함)
      // networkidle 대신 load — API 응답 대기 중 networkidle 미달성으로 timeout 발생
      await page.goto(p.path, { waitUntil: 'load' });
      // 리다이렉트 + JS route() 실행 대기
      await page.waitForTimeout(3000);

      // 해당 섹션이 보이는지 확인
      const section = page.locator(`#${p.sectionId}`);
      await expect(section).toBeVisible({ timeout: 10000 });

      // d-none 클래스가 없어야 함
      const classes = await section.getAttribute('class') || '';
      expect(classes).not.toContain('d-none');
    });
  }
});

test.describe('SNS별 URL 직접 접근', () => {

  // SNS 슬러그 → 한글명 매핑
  const snsRoutes = [
    { slug: 'weibo', korean: '웨이보' },
    { slug: 'bilibili', korean: '빌리빌리' },
    { slug: 'qqmusic', korean: 'QQ뮤직' },
    { slug: 'twitter', korean: 'X(트위터)' },
    { slug: 'youtube', korean: '유튜브' },
    { slug: 'spotify', korean: '스포티파이' },
    { slug: 'chaohua', korean: '차오화' },
  ];

  for (const sns of snsRoutes) {
    test(`/ranking/${sns.slug} 접근 시 ${sns.korean} 데이터가 로드되어야 함`, async ({ page }) => {
      await page.goto(`/ranking/${sns.slug}`, { waitUntil: 'load' });
      await page.waitForTimeout(3000);

      // SNS 랭킹 섹션이 보여야 함
      const section = page.locator('#page-home');
      await expect(section).toBeVisible({ timeout: 10000 });

      // SNS 드롭다운 버튼 텍스트가 해당 SNS명을 포함하는지 확인
      const snsDropdown = page.locator('#snsDropdown');
      const dropdownText = await snsDropdown.textContent();
      // 슈퍼챗은 '웨이보(슈퍼챗)'으로 표시됨
      if (sns.slug === 'chaohua') {
        expect(dropdownText?.trim()).toContain('웨이보(슈퍼챗)');
      } else {
        expect(dropdownText?.trim()).toContain(sns.korean);
      }
    });
  }
});

test.describe('네비게이션 후 URL 변경', () => {

  test('탭 클릭 시 URL이 변경되어야 함', async ({ page }) => {
    await page.goto('/', { waitUntil: 'load' });
    await page.waitForTimeout(500);

    // 엔터뉴스 클릭
    await page.getByRole('link', { name: '엔터뉴스' }).first().click();
    await page.waitForTimeout(500);

    // URL이 /news로 변경되었는지 확인
    expect(page.url()).toContain('/news');

    // 채용정보 클릭
    await page.getByRole('link', { name: '채용정보' }).first().click();
    await page.waitForTimeout(500);

    // URL이 /jobs로 변경되었는지 확인
    expect(page.url()).toContain('/jobs');
  });

  test('뒤로가기 시 이전 페이지로 돌아가야 함', async ({ page }) => {
    await page.goto('/', { waitUntil: 'load' });
    await page.waitForTimeout(1000);

    // 엔터뉴스 → 채용정보 순서로 이동
    await page.getByRole('link', { name: '엔터뉴스' }).first().click();
    await page.waitForTimeout(500);
    await page.getByRole('link', { name: '채용정보' }).first().click();
    await page.waitForTimeout(500);

    // 뒤로가기
    await page.goBack();
    await page.waitForTimeout(1000);

    // 엔터뉴스 섹션이 다시 보여야 함
    const newsSection = page.locator('#page-news');
    await expect(newsSection).toBeVisible({ timeout: 5000 });
  });
});
