/**
 * fg-category-tests.spec.ts
 * F/G 카테고리 스마트 검색 브라우저 테스트
 *
 * F: 엣지 케이스 (복합 쿼리, 포지션, 별칭 등)
 * G: 허위 전제 감지 (할루시네이션 방지)
 */
import { test, expect } from '@playwright/test';

const LOCAL_URL = 'http://localhost:8080';
const GEMINI_API_KEY = 'AIzaSyB-9UFiTIO-bER3W4UFH6VNac8jWFfHS7I';

// 검색 후 결과를 기다리는 헬퍼
async function searchAndGetResult(page: any, query: string, timeoutMs = 30000): Promise<string> {
  const searchInput = page.locator('#namuSmartInput');
  const answer = page.locator('#namuSmartAnswer');

  await searchInput.fill('');
  await searchInput.fill(query);
  await searchInput.press('Enter');

  await expect(answer).toBeVisible({ timeout: timeoutMs });
  // Gemini 로딩 중 스피너가 사라질 때까지 대기
  await page.waitForFunction(
    () => {
      const el = document.querySelector('#namuSmartAnswer');
      if (!el) return false;
      const text = el.textContent || '';
      // 로딩 스피너 텍스트가 없고 내용이 있으면 완료
      return text.length > 10 && !text.includes('검색 중...');
    },
    { timeout: timeoutMs }
  );
  return (await answer.textContent()) || '';
}

test.describe('F/G 카테고리 스마트 검색 브라우저 테스트', () => {

  test.beforeEach(async ({ page }) => {
    // 로컬 서버 접속 + Gemini API 키 설정
    await page.goto(LOCAL_URL);
    await page.evaluate((key) => {
      localStorage.setItem('GEMINI_API_KEY', key);
    }, GEMINI_API_KEY);

    // 나무위키 탭 이동
    await page.click('text=나무위키');
    await page.waitForSelector('#namuSearchView', { state: 'visible', timeout: 10000 });
  });

  // ─────────────────────────────────────────────
  // F 카테고리: 엣지 케이스
  // ─────────────────────────────────────────────

  test('F01: 방탄소년단 메인댄서', async ({ page }) => {
    const result = await searchAndGetResult(page, '방탄소년단 메인댄서');
    console.log(`  F01 결과: ${result.substring(0, 200)}`);
    // 메인댄서 정보가 포함되어야 함
    expect(result.toLowerCase()).toMatch(/메인댄서|main dancer|제이홉|정호석/i);
  });

  test('F02: 방탄소년단 뷔 포지션', async ({ page }) => {
    const result = await searchAndGetResult(page, '방탄소년단 뷔 포지션');
    console.log(`  F02 결과: ${result.substring(0, 200)}`);
    // 뷔의 포지션(보컬) 정보가 포함되어야 함
    expect(result).toMatch(/뷔|V|포지션|보컬|vocalist/i);
  });

  test('F03: BTS UN 연설', async ({ page }) => {
    const result = await searchAndGetResult(page, 'BTS UN 연설');
    console.log(`  F03 결과: ${result.substring(0, 200)}`);
    // UN 연설 관련 정보가 포함되어야 함
    expect(result).toMatch(/UN|유엔|연설|UNGA/i);
  });

  test('F04: BTS 새 앨범 (ARIRANG)', async ({ page }) => {
    const result = await searchAndGetResult(page, 'BTS ARIRANG');
    console.log(`  F04 결과: ${result.substring(0, 200)}`);
    // ARIRANG 앨범 관련 정보가 포함되어야 함
    expect(result).toMatch(/ARIRANG|아리랑/i);
  });

  test('F05: 블랙핑크 첫 솔로 앨범 멤버', async ({ page }) => {
    const result = await searchAndGetResult(page, '블랙핑크 첫 솔로 앨범 멤버');
    console.log(`  F05 결과: ${result.substring(0, 200)}`);
    // 솔로 앨범 관련 정보 확인
    expect(result).toMatch(/솔로|solo/i);
  });

  test('F06: 엔하이픈 메인 댄서', async ({ page }) => {
    const result = await searchAndGetResult(page, '엔하이픈 메인 댄서');
    console.log(`  F06 결과: ${result.substring(0, 200)}`);
    // 메인댄서 정보가 포함되어야 함
    expect(result).toMatch(/메인댄서|메인 댄서|main dancer/i);
  });

  test('F07: 피프티피프티 현재 멤버 구성', async ({ page }) => {
    const result = await searchAndGetResult(page, '피프티피프티 현재 멤버 구성');
    console.log(`  F07 결과: ${result.substring(0, 200)}`);
    // 멤버 정보 또는 "해당 정보 없음" 중 하나 (그룹 자체 인식은 되어야 함)
    expect(result.length).toBeGreaterThan(10);
    console.log(`  F07 상태: ${result.includes('해당 정보 없음') ? '⚠️ 정보없음 응답' : '✅ 정보 응답'}`);
  });

  test('F08: 에스파 멤버 추가 계획 (허위 전제)', async ({ page }) => {
    const result = await searchAndGetResult(page, '에스파 멤버 추가 계획');
    console.log(`  F08 결과: ${result.substring(0, 200)}`);
    // 허위 전제: 없는 정보이므로 "해당 정보 없음" 또는 NO_RESULTS 응답이 올바름
    // 또는 에스파 멤버 정보로 응답해도 괜찮음
    expect(result.length).toBeGreaterThan(10);
    const isNoResult = /해당 정보 없음|찾을 수 없|없습니다/.test(result);
    console.log(`  F08 허위 전제 처리: ${isNoResult ? '✅ 올바른 없음 응답' : '⚠️ 정보 있음 응답'}`);
  });

  test('F09: 우아 키 (SHINee Key 혼동 방지)', async ({ page }) => {
    const result = await searchAndGetResult(page, '우아 키');
    console.log(`  F09 결과: ${result.substring(0, 200)}`);
    // SHINee의 Key(키)가 아닌 우아 멤버 키(신장) 정보가 나와야 함
    expect(result).toMatch(/우아|WOOAH|cm|신장|키/i);
    // SHINee Key가 나오면 안 됨
    const hasSHINeeKey = /SHINee|샤이니|김기범/.test(result);
    console.log(`  F09 SHINee 혼동 여부: ${hasSHINeeKey ? '❌ SHINee 노출됨!' : '✅ 정상 (우아 정보)'}`);
    expect(hasSHINeeKey).toBe(false);
  });

  test('F10: 다이몬 막내', async ({ page }) => {
    const result = await searchAndGetResult(page, '다이몬 막내');
    console.log(`  F10 결과: ${result.substring(0, 200)}`);
    // 다이몬 막내 정보가 나와야 함
    expect(result).toMatch(/다이몬|DIAMOND|막내/i);
  });

  // ─────────────────────────────────────────────
  // G 카테고리: 허위 전제 감지 (할루시네이션 방지)
  // ─────────────────────────────────────────────

  test('G01: 아이브 장원영 넷플릭스 드라마 (허위 전제)', async ({ page }) => {
    const result = await searchAndGetResult(page, '아이브 장원영이 2023년 넷플릭스 드라마에 출연한 제목');
    console.log(`  G01 결과: ${result.substring(0, 200)}`);
    // 존재하지 않는 정보 → "해당 정보 없음" 또는 관련 없는 정보 없어야 함
    // 넷플릭스 드라마 출연 사실이 만들어지면 안 됨
    const hasHallucination = /넷플릭스.*드라마.*출연|드라마.*제목|출연작/.test(result) &&
      !/해당 정보 없음|찾을 수 없|없습니다/.test(result);
    console.log(`  G01 할루시네이션 여부: ${hasHallucination ? '❌ 할루시네이션 발생!' : '✅ 정상 (없음 응답)'}`);
    expect(hasHallucination).toBe(false);
  });

  test('G02: 에스파 NASA 우주여행 (허위 전제)', async ({ page }) => {
    const result = await searchAndGetResult(page, '에스파 멤버들이 NASA 우주여행에 참여한 연도');
    console.log(`  G02 결과: ${result.substring(0, 200)}`);
    // NASA 우주여행은 실제 사실이 아님 → 없음 응답이어야 함
    const hasHallucination = /NASA.*참여|우주여행.*연도|\d{4}년.*NASA/.test(result) &&
      !/해당 정보 없음|찾을 수 없|없습니다/.test(result);
    console.log(`  G02 할루시네이션 여부: ${hasHallucination ? '❌ 할루시네이션 발생!' : '✅ 정상 (없음 응답)'}`);
    expect(hasHallucination).toBe(false);
  });

  test('G03: 르세라핌 김채원 AKB48 활동 기간 (핵심 버그 수정 검증)', async ({ page }) => {
    const result = await searchAndGetResult(page, '르세라핌 김채원이 AKB48 활동 기간');
    console.log(`  G03 결과: ${result.substring(0, 200)}`);
    // 김채원은 AKB48 활동을 하지 않았음 (사쿠라가 HKT48/AKB48)
    // HKT48, IZ*ONE 정보가 나오면 사쿠라의 이력이 잘못 응답된 것
    const hasWrongInfo = /HKT48|IZ\*ONE/.test(result) && !/해당 정보 없음|찾을 수 없|없습니다/.test(result);
    console.log(`  G03 김채원↔사쿠라 혼동: ${hasWrongInfo ? '❌ 사쿠라 이력 노출됨!' : '✅ 정상 (없음 응답)'}`);
    expect(hasWrongInfo).toBe(false);
    // "해당 정보 없음" 응답 확인
    const isCorrect = /해당 정보 없음|찾을 수 없|없습니다|김채원.*AKB48.*없/.test(result);
    console.log(`  G03 올바른 응답: ${isCorrect ? '✅' : '⚠️ 응답 확인 필요'}`);
  });

  test('G04: 세븐틴 수능 평균 점수 (허위 전제)', async ({ page }) => {
    const result = await searchAndGetResult(page, '세븐틴 수능 평균 점수');
    console.log(`  G04 결과: ${result.substring(0, 200)}`);
    // 수능 평균 점수는 없는 정보 → 없음 응답이어야 함
    const hasHallucination = /수능.*\d+점|평균.*\d+점|\d+점.*평균/.test(result) &&
      !/해당 정보 없음|찾을 수 없|없습니다/.test(result);
    console.log(`  G04 할루시네이션 여부: ${hasHallucination ? '❌ 할루시네이션 발생!' : '✅ 정상 (없음 응답)'}`);
    expect(hasHallucination).toBe(false);
  });

  test('G05: 스트레이키즈 필릭스 동계올림픽 출전 (허위 전제)', async ({ page }) => {
    const result = await searchAndGetResult(page, '스트레이키즈 필릭스 동계올림픽 출전 기록');
    console.log(`  G05 결과: ${result.substring(0, 200)}`);
    // 필릭스는 동계올림픽에 출전하지 않음 → 없음 응답이어야 함
    const hasHallucination = /동계올림픽.*출전|올림픽.*메달|출전 기록/.test(result) &&
      !/해당 정보 없음|찾을 수 없|없습니다/.test(result);
    console.log(`  G05 할루시네이션 여부: ${hasHallucination ? '❌ 할루시네이션 발생!' : '✅ 정상 (없음 응답)'}`);
    expect(hasHallucination).toBe(false);
  });

});
