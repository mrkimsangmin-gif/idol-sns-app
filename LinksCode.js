// ========================================
// 🔗 K-POP 링크 모음 API (Links)
// ========================================
//
// 구글 시트에서 링크 데이터를 읽어 JSON API로 제공
//
// 시트 구조:
// A: category | B: subcategory | C: name | D: description
// E: url | F: app_url | G: icon | H: order
// ========================================

// 시트 설정 상수
const LINKS_SHEET_NAME = 'links'; // 시트 이름
const LINKS_CACHE_KEY = 'LINKS_DATA_CACHE'; // 캐시 키
const LINKS_CACHE_DURATION = 6 * 60 * 60; // 6시간 (21600초)

/**
 * K-POP 링크 데이터 가져오기 (캐시 적용)
 * @returns {Object} - { status, data, updatedAt }
 */
function getLinksData() {
  // 캐시 확인
  const cache = CacheService.getScriptCache();
  const cached = cache.get(LINKS_CACHE_KEY);

  if (cached) {
    console.log('✅ 링크 캐시 히트');
    return JSON.parse(cached);
  }

  console.log('📡 링크 데이터 시트에서 로드');

  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName(LINKS_SHEET_NAME);

    if (!sheet) {
      return { status: 'error', message: 'links 시트를 찾을 수 없습니다.' };
    }

    const lastRow = sheet.getLastRow();
    if (lastRow < 2) {
      return {
        status: 'success',
        data: {},
        updatedAt: new Date().toISOString()
      };
    }

    // 전체 데이터 읽기 (헤더 포함, H열=order까지)
    const data = sheet.getRange(1, 1, lastRow, 8).getValues();
    const headers = data[0];

    // 카테고리별 order 추적 (첫 행의 order를 카테고리 order로 사용)
    const categoryOrderMap = {};
    // { category: { order, subcategories: { subcategory: [links] } } } 구조로 변환
    const linksMap = {};

    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      const category = (row[0] || '').toString().trim();
      const subcategory = (row[1] || '').toString().trim();
      const name = (row[2] || '').toString().trim();

      // 카테고리와 이름은 필수
      if (!category || !name) continue;

      // 카테고리 초기화
      if (!linksMap[category]) {
        linksMap[category] = {
          order: Object.keys(linksMap).length + 1, // 등장 순서 기준
          subcategories: {}
        };
      }

      // order 컬럼에 숫자가 있으면 카테고리 order 갱신
      const orderVal = parseInt(row[7]);
      if (!isNaN(orderVal) && !categoryOrderMap[category]) {
        linksMap[category].order = orderVal;
        categoryOrderMap[category] = true;
      }

      // 서브카테고리 초기화 (빈 문자열이면 '기타'로 처리)
      const subcat = subcategory || '기타';
      if (!linksMap[category].subcategories[subcat]) {
        linksMap[category].subcategories[subcat] = [];
      }

      // 링크 항목 추가
      const link = {
        name: name,
        description: (row[3] || '').toString().trim(),
        url: (row[4] || '').toString().trim(),
        app_url: (row[5] || '').toString().trim(),
        icon: (row[6] || '').toString().trim()
      };

      // 빈 문자열 제거 (프론트엔드에서 falsy 체크 용이하게)
      if (!link.app_url) delete link.app_url;
      if (!link.icon) delete link.icon;

      linksMap[category].subcategories[subcat].push(link);
    }

    const result = {
      status: 'success',
      data: linksMap,
      updatedAt: new Date().toISOString()
    };

    // 캐시 저장 (100KB 제한 주의)
    try {
      const jsonStr = JSON.stringify(result);
      if (jsonStr.length < 100000) {
        cache.put(LINKS_CACHE_KEY, jsonStr, LINKS_CACHE_DURATION);
        console.log(`✅ 링크 캐시 저장 완료 (${jsonStr.length} bytes)`);
      } else {
        console.warn(`⚠️ 링크 데이터 ${jsonStr.length} bytes - 캐시 크기 초과, 캐시 미저장`);
      }
    } catch (cacheError) {
      console.warn('⚠️ 링크 캐시 저장 실패:', cacheError);
    }

    return result;

  } catch (error) {
    console.error('❌ 링크 데이터 로드 실패:', error);
    return { status: 'error', message: error.toString() };
  }
}

/**
 * 링크 캐시 수동 갱신
 */
function refreshLinksCache() {
  const cache = CacheService.getScriptCache();
  cache.remove(LINKS_CACHE_KEY);
  console.log('🗑️ 링크 캐시 삭제');

  const result = getLinksData();
  console.log(`✅ 링크 캐시 갱신 완료 - ${Object.keys(result.data || {}).length}개 카테고리`);
  return result;
}
