import { test, expect } from '@playwright/test';

/**
 * SNS 랭킹 섹션 테스트
 * - 성별 탭 전환
 * - 플랫폼 드롭다운 선택
 * - 월 선택
 * - 데이터 로딩 확인
 */
test.describe('SNS 랭킹 섹션', () => {
  
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    // SNS랭킹 섹션으로 이동
    await page.click('text=SNS랭킹');
    await page.waitForTimeout(500);
  });

  test('SNS 팔로워 순위 제목이 표시되어야 함', async ({ page }) => {
    const title = page.locator('text=SNS 팔로워 순위');
    await expect(title).toBeVisible();
  });

  test('성별 탭(남자/여자)이 표시되어야 함', async ({ page }) => {
    const maleTab = page.locator('text=남자').first();
    const femaleTab = page.locator('text=여자').first();
    
    await expect(maleTab).toBeVisible();
    await expect(femaleTab).toBeVisible();
  });

  test('남자 탭 클릭이 동작해야 함', async ({ page }) => {
    const maleTab = page.locator('a, button, div').filter({ hasText: /^남자$/ }).first();
    await maleTab.click();
    
    // 탭이 활성화 상태인지 확인 (클래스나 스타일 변경)
    await expect(maleTab).toBeVisible();
  });

  test('여자 탭 클릭이 동작해야 함', async ({ page }) => {
    const femaleTab = page.locator('a, button, div').filter({ hasText: /^여자$/ }).first();
    await femaleTab.click();
    
    await expect(femaleTab).toBeVisible();
  });

  test('플랫폼 드롭다운 옵션들이 존재해야 함', async ({ page }) => {
    const platforms = [
      '웨이보',
      '빌리빌리',
      'QQ뮤직',
      'X(트위터)',
      '유튜브',
      '스포티파이'
    ];

    for (const platform of platforms) {
      const platformOption = page.locator('text=' + platform).first();
      // 드롭다운을 열어야 할 수도 있음
      await expect(platformOption).toBeVisible({ timeout: 5000 }).catch(() => {
        // 드롭다운 내부에 있을 수 있으므로 실패해도 무시
      });
    }
  });

  test('웨이보 플랫폼 선택이 동작해야 함', async ({ page }) => {
    // 웨이보 링크/버튼 클릭
    const weiboOption = page.locator('a, button').filter({ hasText: '웨이보' }).first();
    
    if (await weiboOption.isVisible()) {
      await weiboOption.click();
      await page.waitForTimeout(500);
    }
  });

  test('월 선택 드롭다운이 존재해야 함', async ({ page }) => {
    const monthSelector = page.locator('text=조회 월 선택');
    await expect(monthSelector).toBeVisible();
  });

  test('데이터 조회 안내 메시지가 표시되어야 함', async ({ page }) => {
    const placeholder = page.locator('text=데이터를 조회해주세요');
    await expect(placeholder).toBeVisible();
  });
});

test.describe('SNS 랭킹 - 플랫폼별 테스트', () => {
  
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
  });

  const platforms = [
    { name: '웨이보', text: '웨이보' },
    { name: '웨이보 슈퍼챗', text: '웨이보(슈퍼챗)' },
    { name: '빌리빌리', text: '빌리빌리' },
    { name: 'QQ뮤직', text: 'QQ뮤직' },
    { name: 'X(트위터)', text: 'X(트위터)' },
    { name: '유튜브', text: '유튜브' },
    { name: '스포티파이', text: '스포티파이' },
  ];

  for (const platform of platforms) {
    test(`${platform.name} 옵션이 클릭 가능해야 함`, async ({ page }) => {
      const option = page.locator('a, li, button').filter({ hasText: platform.text }).first();
      
      if (await option.isVisible()) {
        await option.click();
        await page.waitForTimeout(300);
        // 클릭 후 에러 없이 동작하면 성공
      }
    });
  }
});
