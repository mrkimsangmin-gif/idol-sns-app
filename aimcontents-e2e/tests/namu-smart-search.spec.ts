import { test, expect } from '@playwright/test';

/**
 * 나무위키 스마트 검색 — 자연어 질의 테스트
 * 로컬 서버(http://127.0.0.1:8765) 기준
 *
 * Fix A: FIELD_ALIASES에 있지만 멤버 JSON에 없는 필드 → raw_text 폴백
 * Fix B: executeMemberRawSearch 다중 단어 분리 폴백
 * Fix C: Pattern 4 regex 조사(가/를/은/는) 지원 ("이" 제외 — "멤버이름" 보호)
 * Fix D: normalizeQuery 마침표 제거, "누구인지" suffix 추가
 */

const BASE_URL = 'http://127.0.0.1:8765';

// 나무위키 탭으로 이동 + 인덱스 로딩 대기
async function navigateToNamu(page) {
    const indexLoaded = new Promise<void>(resolve => {
        page.on('console', msg => {
            if (msg.text().includes('나무위키 인덱스 로드 완료')) resolve();
        });
    });

    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
    await page.click('a.nav-link[href="/namu"]');
    await page.waitForSelector('#namuSearchInput', { state: 'visible', timeout: 15000 });
    await Promise.race([indexLoaded, page.waitForTimeout(15000)]);
    await page.waitForTimeout(500);
}

// 스마트 검색 실행: 입력 → Enter → 결과 대기
async function smartSearch(page, query: string) {
    const input = page.locator('#namuSearchInput');
    await input.fill('');
    await input.fill(query);
    await input.press('Enter');
    // 실제 결과에만 존재하는 .namu-smart-answer-header 또는 .gemini-answer를 기준으로 대기
    await page.waitForSelector('#namuSmartAnswer .namu-smart-answer-header, #namuSmartAnswer .gemini-answer', { timeout: 20000 });
}

// ============================================================
// 우아(WOOAH) 질의 테스트
// ============================================================
test.describe('우아(WOOAH) 질의 테스트', () => {

    test.beforeEach(async ({ page }) => {
        await navigateToNamu(page);
    });

    test('Q1: 우아 멤버 mbti → raw_text 폴백', async ({ page }) => {
        await smartSearch(page, '우아 멤버 mbti');
        const text = await page.locator('#namuSmartAnswer').textContent();
        expect(text).toContain('MBTI');
        expect(text).toContain('ENFP');
        expect(await page.locator('#namuSmartAnswer table').count()).toBe(0);
    });

    test('Q2: 우아 멤버 혈액형 → raw_text 폴백', async ({ page }) => {
        await smartSearch(page, '우아 멤버 혈액형');
        const text = await page.locator('#namuSmartAnswer').textContent();
        expect(text).toContain('혈액형');
        expect(text).toMatch(/A형|B형/);
        expect(await page.locator('#namuSmartAnswer table').count()).toBe(0);
    });

    test('Q3: 우아 멤버 고향 → 출신지 테이블', async ({ page }) => {
        await smartSearch(page, '우아 멤버 고향');
        const answer = page.locator('#namuSmartAnswer');
        await expect(answer.locator('table')).toBeVisible();
        const text = await answer.textContent();
        expect(text).toContain('나나');
        expect(text).toContain('서울');
        expect(text).toContain('후쿠오카');
    });

    test('Q4: 우아 멤버 숙소 상황 → 숙소 raw_text', async ({ page }) => {
        await smartSearch(page, '우아 멤버 숙소 상황');
        const text = await page.locator('#namuSmartAnswer').textContent();
        expect(text).toContain('숙소');
        expect(text).toMatch(/나나|우연|루시|소라|민서/);
    });

    test('Q5: 우아 멤버가 좋아하는 차 → 조사 처리', async ({ page }) => {
        await smartSearch(page, '우아 멤버가 좋아하는 차');
        const text = await page.locator('#namuSmartAnswer').textContent();
        expect(text).toContain('우아');
    });

    test('Q6: 우아 멤버 보컬 실력 → raw_text', async ({ page }) => {
        await smartSearch(page, '우아 멤버 보컬 실력');
        const text = await page.locator('#namuSmartAnswer').textContent();
        expect(text).toContain('보컬');
        expect(text).toContain('실력');
    });
});

// ============================================================
// 힛지스(HITGS) 질의 테스트
// ============================================================
test.describe('힛지스(HITGS) 질의 테스트', () => {

    test.beforeEach(async ({ page }) => {
        await navigateToNamu(page);
    });

    // 1. "힛지스 멤버이름과 생년월일" — 복합 필드 + "멤버이름" 보호
    test('H1: 힛지스 멤버이름과 생년월일 → 본명+생년월일 테이블', async ({ page }) => {
        await smartSearch(page, '힛지스 멤버이름과 생년월일');
        const answer = page.locator('#namuSmartAnswer');
        await expect(answer.locator('table')).toBeVisible();
        const text = await answer.textContent();
        // 멤버 확인
        expect(text).toContain('비비');
        expect(text).toContain('서진');
        expect(text).toContain('이유');
        // 생년월일 데이터
        expect(text).toMatch(/2006|2008|2009|2010/);
    });

    // 2. "힛지스 멤버 국적" — 출신지 테이블
    test('H2: 힛지스 멤버 국적 → 출신지 테이블', async ({ page }) => {
        await smartSearch(page, '힛지스 멤버 국적');
        const answer = page.locator('#namuSmartAnswer');
        await expect(answer.locator('table')).toBeVisible();
        const text = await answer.textContent();
        expect(text).toContain('중국');
        expect(text).toContain('대한민국');
    });

    // 3. "힛지스 숙소 상황" — raw_text에 없으므로 Gemini 폴백
    test('H3: 힛지스 숙소 상황 → Gemini 폴백 또는 안내', async ({ page }) => {
        await smartSearch(page, '힛지스 숙소 상황');
        const answer = page.locator('#namuSmartAnswer');
        await expect(answer).toBeVisible();
        const text = await answer.textContent();
        // Gemini 결과든 "정보를 찾을 수 없습니다"든 그룹명은 표시
        expect(text).toMatch(/힛지스|HITGS|숙소/);
    });

    // 4. "힛지스 막내는 누구인지?" — suffix "누구인지" 제거 → "힛지스 막내는"
    test('H4: 힛지스 막내는 누구인지? → 막내 정보', async ({ page }) => {
        await smartSearch(page, '힛지스 막내는 누구인지?');
        const answer = page.locator('#namuSmartAnswer');
        await expect(answer).toBeVisible();
        const text = await answer.textContent();
        // "막내" 관련 답변 또는 Gemini 결과
        expect(text).toMatch(/힛지스|HITGS|막내|이유/);
    });

    // 5. "힛지스 멤버들의 별명을 알려주세요." — 마침표 제거 + suffix 제거 → "힛지스 멤버들 별명"
    test('H5: 힛지스 멤버들의 별명을 알려주세요. → 별명 검색', async ({ page }) => {
        await smartSearch(page, '힛지스 멤버들의 별명을 알려주세요.');
        const answer = page.locator('#namuSmartAnswer');
        await expect(answer).toBeVisible();
        const text = await answer.textContent();
        // "별명" 관련 답변 또는 Gemini
        expect(text).toMatch(/힛지스|HITGS|별명/);
    });

    // 6. "힛지스 그룹명 뜻" — info 필드 직접 매칭 ("그룹명뜻")
    test('H6: 힛지스 그룹명 뜻 → info 필드 매칭', async ({ page }) => {
        await smartSearch(page, '힛지스 그룹명 뜻');
        const answer = page.locator('#namuSmartAnswer');
        const text = await answer.textContent();
        // info["그룹명뜻"]의 값
        expect(text).toContain('Hip');
        expect(text).toContain('Innocent');
        expect(text).toContain('Story');
    });
});
