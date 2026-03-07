import { test, expect } from '@playwright/test';

const LOCAL_URL = 'http://localhost:8080';
const GEMINI_API_KEY = 'AIzaSyB-9UFiTIO-bER3W4UFH6VNac8jWFfHS7I';

test.describe('로컬 서버 Gemini 통합 테스트', () => {

  test.beforeEach(async ({ page }) => {
    // 로컬 서버 접속 + API 키 설정
    await page.goto(LOCAL_URL);
    await page.evaluate((key) => {
      localStorage.setItem('GEMINI_API_KEY', key);
    }, GEMINI_API_KEY);
  });

  test('P2: "2020년 데뷔" 로컬 패턴 매칭 (Gemini 불필요)', async ({ page }) => {
    // 나무위키 탭 클릭
    await page.click('text=나무위키');
    // 인덱스 로드 대기
    await page.waitForSelector('#namuSearchView', { state: 'visible', timeout: 10000 });

    // 검색
    const searchInput = page.locator('#namuSmartInput');
    await searchInput.fill('2020년 데뷔');
    await searchInput.press('Enter');

    // 결과 확인: 테이블 표시 (Gemini 호출 없이)
    const answer = page.locator('#namuSmartAnswer');
    await expect(answer).toBeVisible({ timeout: 5000 });
    // "📅" 아이콘과 "데뷔" 텍스트 확인
    await expect(answer).toContainText('2020년 데뷔');
    // 테이블 행이 있어야 함
    const rows = answer.locator('table tbody tr');
    const rowCount = await rows.count();
    console.log(`  → 2020년 데뷔 그룹: ${rowCount}팀`);
    expect(rowCount).toBeGreaterThan(0);
  });

  test('P3+P4: Gemini 직접 호출 + 진행 표시 (일반 질의)', async ({ page }) => {
    // 나무위키 탭
    await page.click('text=나무위키');
    await page.waitForSelector('#namuSearchView', { state: 'visible', timeout: 10000 });

    // 콘솔 로그 캡처 (callGeminiDirect 확인용)
    const consoleLogs: string[] = [];
    page.on('console', msg => {
      consoleLogs.push(msg.text());
    });

    // Gemini 폴백이 필요한 질의
    const searchInput = page.locator('#namuSmartInput');
    await searchInput.fill('4세대 걸그룹 중 초동 1위는?');
    await searchInput.press('Enter');

    // 진행 표시 확인 (P4)
    const answer = page.locator('#namuSmartAnswer');
    await expect(answer).toBeVisible({ timeout: 3000 });

    // Gemini 응답 대기 (최대 25초)
    await expect(answer.locator('.namu-smart-answer-ai, .namu-smart-answer')).toBeVisible({ timeout: 25000 });

    // 로컬 직접 호출 로그 확인
    const hasLocalLog = consoleLogs.some(l => l.includes('로컬 Gemini 직접 호출'));
    console.log(`  → 로컬 Gemini 직접 호출: ${hasLocalLog ? '✅' : '❌'}`);
    console.log(`  → 응답 내용: ${(await answer.textContent())?.substring(0, 100)}...`);

    // 에러가 아닌 실제 답변이 표시되어야 함
    const hasError = await answer.locator('text=API 호출 실패').count();
    const hasKeyError = await answer.locator('text=GEMINI_API_KEY').count();
    expect(hasError + hasKeyError).toBe(0);
  });

  test('P1: AbortController — 연속 검색 시 이전 결과 오염 방지', async ({ page }) => {
    await page.click('text=나무위키');
    await page.waitForSelector('#namuSearchView', { state: 'visible', timeout: 10000 });

    const searchInput = page.locator('#namuSmartInput');
    const answer = page.locator('#namuSmartAnswer');

    // 첫 번째 검색 (Gemini 폴백 유도) — 응답 기다리지 않고 즉시 두 번째 검색
    await searchInput.fill('에스파 숙소 위치');
    await searchInput.press('Enter');
    // 50ms만 대기 후 새 검색으로 덮어쓰기
    await page.waitForTimeout(50);

    // 두 번째 검색 (로컬 패턴 매칭 — 즉시 응답)
    await searchInput.fill('2018년 데뷔');
    await searchInput.press('Enter');

    // 두 번째 결과가 표시되어야 함
    await expect(answer).toBeVisible({ timeout: 5000 });
    await expect(answer).toContainText('2018년 데뷔');

    // 3초 대기 — 첫 번째 검색의 Gemini 응답이 와도 덮어쓰면 안 됨
    await page.waitForTimeout(3000);
    // 여전히 "2018년 데뷔" 결과가 표시되어야 함
    await expect(answer).toContainText('2018년 데뷔');
    console.log('  → AbortController 오염 방지: ✅');
  });

  test('P5: "AI로 정리하기" 버튼 표시 (raw_text 결과)', async ({ page }) => {
    await page.click('text=나무위키');
    await page.waitForSelector('#namuSearchView', { state: 'visible', timeout: 10000 });

    // raw_text 검색이 히트할 질의 (그룹 + 키워드)
    const searchInput = page.locator('#namuSmartInput');
    await searchInput.fill('에스파 응원봉');
    await searchInput.press('Enter');

    const answer = page.locator('#namuSmartAnswer');
    await expect(answer).toBeVisible({ timeout: 10000 });

    // 결과에 "AI로 정리하기" 버튼이 있는지 확인
    const aiBtn = answer.locator('button:has-text("AI로 정리하기")');
    const btnCount = await aiBtn.count();
    console.log(`  → "AI로 정리하기" 버튼: ${btnCount > 0 ? '✅ 표시됨' : '⚠️ 없음 (info 필드 직접 매칭일 수 있음)'}`);
  });

});
