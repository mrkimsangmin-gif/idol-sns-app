import { test, expect } from '@playwright/test';

/**
 * SEO 요소 점검 테스트
 * - meta 태그 (title, description, canonical, OG, Twitter Card)
 * - Schema.org 구조화 데이터
 * - robots.txt / sitemap.xml
 * - 페이지 전환 시 동적 meta 업데이트
 */
test.describe('SEO 기본 요소', () => {

  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
  });

  test('title 태그가 키워드를 포함해야 함', async ({ page }) => {
    const title = await page.title();
    // 핵심 키워드 포함 확인
    expect(title).toContain('아이돌');
    expect(title).toContain('SNS');
    expect(title).toContain('아이엠콘텐츠');
    expect(title.length).toBeGreaterThan(20);
    expect(title.length).toBeLessThan(70); // 구글 권장 60자 이내
  });

  test('meta description이 적절해야 함', async ({ page }) => {
    const desc = await page.$eval(
      'meta[name="description"]',
      el => el.getAttribute('content') || ''
    );
    expect(desc.length).toBeGreaterThan(50);
    expect(desc.length).toBeLessThan(160); // 구글 권장 160자 이내
    expect(desc).toContain('K-POP');
  });

  test('canonical URL이 설정되어야 함', async ({ page }) => {
    const canonical = await page.$eval(
      'link[rel="canonical"]',
      el => el.getAttribute('href') || ''
    );
    expect(canonical).toContain('aimcontents.com');
  });

  test('Open Graph 태그가 완비되어야 함', async ({ page }) => {
    // 필수 OG 태그 확인
    const ogTags = ['og:title', 'og:description', 'og:url', 'og:image', 'og:type'];

    for (const tag of ogTags) {
      const content = await page.$eval(
        `meta[property="${tag}"]`,
        el => el.getAttribute('content') || ''
      ).catch(() => '');

      expect(content.length, `${tag}이 비어있음`).toBeGreaterThan(0);
    }
  });

  test('Twitter Card 태그가 설정되어야 함', async ({ page }) => {
    const twitterCard = await page.$eval(
      'meta[name="twitter:card"]',
      el => el.getAttribute('content') || ''
    ).catch(() => '');

    expect(twitterCard).toBeTruthy();
  });

  test('h1 태그가 정확히 1개여야 함', async ({ page }) => {
    const h1Count = await page.locator('h1').count();
    expect(h1Count).toBe(1);

    // h1 내용에 핵심 키워드 포함 확인
    const h1Text = await page.locator('h1').first().textContent();
    expect(h1Text).toContain('SNS');
  });
});

test.describe('Schema.org 구조화 데이터', () => {

  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
  });

  test('Organization 스키마가 존재해야 함', async ({ page }) => {
    const schemas = await page.$$eval(
      'script[type="application/ld+json"]',
      els => els.map(el => {
        try { return JSON.parse(el.textContent || ''); }
        catch { return null; }
      })
    );

    const org = schemas.find(s => s && s['@type'] === 'Organization');
    expect(org).toBeTruthy();
    expect(org.name).toBeTruthy();
    expect(org.url).toContain('aimcontents.com');
  });

  test('WebSite 스키마가 존재해야 함', async ({ page }) => {
    const schemas = await page.$$eval(
      'script[type="application/ld+json"]',
      els => els.map(el => {
        try { return JSON.parse(el.textContent || ''); }
        catch { return null; }
      })
    );

    const website = schemas.find(s => s && s['@type'] === 'WebSite');
    expect(website).toBeTruthy();
    expect(website.url).toContain('aimcontents.com');
  });

  test('Dataset 스키마가 존재해야 함', async ({ page }) => {
    const schemas = await page.$$eval(
      'script[type="application/ld+json"]',
      els => els.map(el => {
        try { return JSON.parse(el.textContent || ''); }
        catch { return null; }
      })
    );

    const dataset = schemas.find(s => s && s['@type'] === 'Dataset');
    expect(dataset).toBeTruthy();
    expect(dataset.keywords).toBeTruthy();
    expect(dataset.keywords.length).toBeGreaterThan(3);
  });

  test('Schema.org JSON-LD가 유효한 JSON이어야 함', async ({ page }) => {
    const results = await page.$$eval(
      'script[type="application/ld+json"]',
      els => els.map(el => {
        try {
          JSON.parse(el.textContent || '');
          return { valid: true };
        } catch (e) {
          return { valid: false, error: (e as Error).message };
        }
      })
    );

    // 최소 3개 이상의 JSON-LD 존재
    expect(results.length).toBeGreaterThanOrEqual(3);

    // 모든 JSON-LD가 유효해야 함
    for (const r of results) {
      expect(r.valid, `JSON-LD 파싱 오류: ${(r as any).error}`).toBe(true);
    }
  });
});

test.describe('robots.txt & sitemap.xml', () => {

  test('robots.txt가 접근 가능하고 Sitemap을 포함해야 함', async ({ page }) => {
    const response = await page.goto('/robots.txt');
    expect(response?.status()).toBe(200);

    const text = await response?.text() || '';
    expect(text).toContain('User-agent');
    expect(text).toContain('Sitemap');
    expect(text).toContain('aimcontents.com');
  });

  test('sitemap.xml이 접근 가능하고 URL을 포함해야 함', async ({ page }) => {
    const response = await page.goto('/sitemap.xml');
    expect(response?.status()).toBe(200);

    const text = await response?.text() || '';
    expect(text).toContain('<urlset');
    expect(text).toContain('<loc>');

    // 주요 섹션 URL 포함 확인
    // 주의: /news·/comeback·/douyin 등 SPA 전용 라우트는 정적 200 페이지가 없어
    //       update_sitemap.py가 의도적으로 제외함(sitemap 404 방지). 따라서 실제 정적
    //       페이지로 서빙되는 섹션(/ranking, /jobs)만 검증한다.
    const requiredUrls = ['/ranking', '/jobs'];
    for (const url of requiredUrls) {
      expect(text, `sitemap에 ${url} 누락`).toContain(url);
    }

    // SNS별 랭킹 URL 포함 확인
    // 실제 sitemap 형식: /ranking/YYYY-MM/{sns}-{gender}/ (예: /ranking/2026-05/weibo-boys/)
    const snsUrls = ['/weibo-', '/bilibili-', '/youtube-'];
    for (const url of snsUrls) {
      expect(text, `sitemap에 ${url} 랭킹 누락`).toContain(url);
    }
  });
});

test.describe('페이지 전환 시 동적 meta 업데이트', () => {

  test('탭 전환 시 meta description이 변경되어야 함', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // 초기 description 저장
    const initialDesc = await page.$eval(
      'meta[name="description"]',
      el => el.getAttribute('content') || ''
    );

    // 엔터뉴스 탭 클릭
    await page.getByRole('link', { name: '엔터뉴스' }).first().click();
    await page.waitForTimeout(500);

    // description이 변경되었는지 확인
    const newsDesc = await page.$eval(
      'meta[name="description"]',
      el => el.getAttribute('content') || ''
    );

    expect(newsDesc).not.toBe(initialDesc);
    expect(newsDesc).toContain('뉴스');
  });

  test('탭 전환 시 title이 변경되어야 함', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const initialTitle = await page.title();

    // 채용정보 탭 클릭
    await page.getByRole('link', { name: '채용정보' }).first().click();
    await page.waitForTimeout(500);

    const jobsTitle = await page.title();
    expect(jobsTitle).not.toBe(initialTitle);
    expect(jobsTitle).toContain('채용');
  });
});

test.describe('SEO 정적 콘텐츠', () => {

  test('크롤러용 정적 콘텐츠가 HTML에 존재해야 함', async ({ page }) => {
    // JS 실행 전 HTML에 정적 콘텐츠가 포함되어 있는지 확인
    const response = await page.goto('/');
    const html = await response?.text() || '';

    // seo-static-content 영역 존재
    expect(html).toContain('seo-static-content');
    // 섹션 링크 존재
    expect(html).toContain('href="/ranking"');
    expect(html).toContain('href="/news"');
    expect(html).toContain('href="/jobs"');
  });
});
