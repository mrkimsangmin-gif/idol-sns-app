// ========================================
// 🏢 업체정보 API (Vendors)
// ========================================
//
// 구글 시트에서 업체 데이터를 읽어 JSON API로 제공
//
// 시트 구조:
// A: 대분류 | B: 소분류 | C: 업체명 | D: 담당자
// E: 휴대폰 | F: 일반전화 | G: 이메일 | H: 홈페이지
// I: SNS | J: 비고 | K: 포트폴리오
// ========================================

// 시트 설정 상수
const VENDORS_SHEET_NAME = 'vendors'; // 시트 이름
const VENDORS_CACHE_KEY = 'VENDORS_DATA_CACHE'; // 캐시 키
const VENDORS_CACHE_DURATION = 6 * 60 * 60; // 6시간 (21600초)

// 카테고리 정의 (대분류 > 소분류)
const VENDOR_CATEGORIES = {
  '영상제작': ['뮤직비디오', '유튜브', '기타 영상', '스튜디오'],
  '헤/메/스': ['헤어/메이크업', '스타일리스트', '해외'],
  '앨범제작': ['피지컬 앨범', '플랫폼(QR, 포카 등) 앨범', '앨범디자인'],
  '자켓촬영': ['종합', '작가 (포토그래퍼)', '디렉터', '미술팀', '리터칭', '스튜디오'],
  '마케팅': ['SNS 마케팅', '바이럴 마케팅', '언론홍보'],
  '쇼케이스': ['대관', '진행업체', '기자섭외', '연출', 'MC'],
  '포카/굿즈': ['포토북', '포토카드', '기타 굿즈'],
  '프로듀싱': ['음원제작', '녹음/편집/믹스', '마스터링', '녹음실', '코러스', '저작권'],
  '안무': ['안무 창작', '안무 영상', '퍼포먼스 디렉팅'],
  '기타': ['법률/회계', '통역/번역', '케이터링', '운송/물류', '보험']
};

/**
 * 업체정보 데이터 가져오기 (캐시 적용)
 * @returns {Object} - { status, data, categories, lastUpdated }
 */
function getVendorsData() {
  // 캐시 확인
  const cache = CacheService.getScriptCache();
  const cached = cache.get(VENDORS_CACHE_KEY);

  if (cached) {
    console.log('✅ 업체정보 캐시 히트');
    return JSON.parse(cached);
  }

  console.log('📡 업체정보 시트에서 로드');

  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName(VENDORS_SHEET_NAME);

    if (!sheet) {
      return { status: 'error', message: 'vendors 시트를 찾을 수 없습니다.' };
    }

    const lastRow = sheet.getLastRow();
    if (lastRow < 2) {
      return {
        status: 'success',
        data: [],
        categories: VENDOR_CATEGORIES,
        lastUpdated: new Date().toISOString()
      };
    }

    // 전체 데이터 읽기 (헤더 포함, K열=포트폴리오까지)
    const data = sheet.getRange(1, 1, lastRow, 11).getValues();

    const vendors = [];

    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      // 대분류와 업체명이 필수
      if (!row[0] || !row[2]) continue;

      vendors.push({
        category: row[0].toString().trim(),    // 대분류
        subcategory: row[1].toString().trim(),  // 소분류
        company: row[2].toString().trim(),      // 업체명
        contact: row[3].toString().trim(),      // 담당자
        mobile: row[4].toString().trim(),       // 휴대폰
        phone: row[5].toString().trim(),        // 일반전화
        email: row[6].toString().trim(),        // 이메일
        website: row[7].toString().trim(),      // 홈페이지
        sns: row[8].toString().trim(),          // SNS
        note: row[9].toString().trim(),         // 비고
        portfolio: row[10] ? row[10].toString().trim() : '' // 포트폴리오
      });
    }

    const result = {
      status: 'success',
      data: vendors,
      categories: VENDOR_CATEGORIES,
      lastUpdated: new Date().toISOString()
    };

    // 캐시 저장 (100KB 제한 확인)
    const jsonStr = JSON.stringify(result);
    if (jsonStr.length < 100000) {
      cache.put(VENDORS_CACHE_KEY, jsonStr, VENDORS_CACHE_DURATION);
      console.log(`✅ 업체정보 캐시 저장 (${jsonStr.length}자)`);
    } else {
      console.log(`⚠️ 업체정보 데이터가 100KB 초과 (${jsonStr.length}자), 캐시 미사용`);
    }

    return result;

  } catch (error) {
    console.error('업체정보 데이터 로드 오류:', error);
    return { status: 'error', message: error.toString() };
  }
}

/**
 * 업체정보 캐시 갱신 (시트 수정 후 수동 실행)
 */
function updateVendorsCache() {
  // 기존 캐시 삭제
  clearVendorsCache();
  // 새 데이터로 캐시 재생성
  const result = getVendorsData();
  console.log(`✅ 업체정보 캐시 갱신 완료 (${result.data ? result.data.length : 0}개 업체)`);
  return result;
}

/**
 * 업체정보 캐시 초기화
 */
function clearVendorsCache() {
  const cache = CacheService.getScriptCache();
  cache.remove(VENDORS_CACHE_KEY);
  console.log('✅ 업체정보 캐시 초기화 완료');
}

/**
 * vendors 시트 초기화 (헤더만 생성)
 */
function initVendorsSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(VENDORS_SHEET_NAME);

  if (sheet) {
    console.log('⚠️ vendors 시트가 이미 존재합니다.');
    return;
  }

  sheet = ss.insertSheet(VENDORS_SHEET_NAME);
  const headers = ['대분류', '소분류', '업체명', '담당자', '휴대폰', '일반전화', '이메일', '홈페이지', 'SNS', '비고', '포트폴리오'];
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);

  // 열 너비 조정
  sheet.setColumnWidth(1, 100);  // 대분류
  sheet.setColumnWidth(2, 150);  // 소분류
  sheet.setColumnWidth(3, 150);  // 업체명
  sheet.setColumnWidth(4, 80);   // 담당자
  sheet.setColumnWidth(5, 130);  // 휴대폰
  sheet.setColumnWidth(6, 130);  // 일반전화
  sheet.setColumnWidth(7, 200);  // 이메일
  sheet.setColumnWidth(8, 250);  // 홈페이지
  sheet.setColumnWidth(9, 250);  // SNS
  sheet.setColumnWidth(10, 200); // 비고
  sheet.setColumnWidth(11, 300); // 포트폴리오

  // 대분류 드롭다운 설정
  const categoryRule = SpreadsheetApp.newDataValidation()
    .requireValueInList(Object.keys(VENDOR_CATEGORIES))
    .build();
  sheet.getRange('A2:A500').setDataValidation(categoryRule);

  // 헤더 스타일
  const headerRange = sheet.getRange(1, 1, 1, headers.length);
  headerRange.setFontWeight('bold');
  headerRange.setBackground('#4285f4');
  headerRange.setFontColor('#ffffff');

  // 행 고정 (헤더)
  sheet.setFrozenRows(1);

  console.log('✅ vendors 시트 초기화 완료');
}

/**
 * 업체 등록/수정 요청 이메일 발송
 * @param {Object} params - 요청 데이터
 * @returns {Object} - { status, message }
 */
function sendVendorEmail(params) {
  const TO_EMAIL = 'contents.ai.m@gmail.com'; // 수신 이메일
  const isNew = params.type === 'new'; // 신규 등록 여부
  const typeLabel = isNew ? '[신규업체 등록 요청]' : '[정보수정 요청]';

  const subject = `${typeLabel} ${params.company} - AimContents`;
  const body = [
    'AimContents 사이트에서 요청이 접수되었습니다.',
    '',
    `■ 구분: ${typeLabel}`,
    `■ 업체명: ${params.company || '-'}`,
    `■ 카테고리: ${params.category || '-'}`,
    `■ 신청자/담당자: ${params.contact_name || '-'}`,
    `■ 연락처: ${params.contact_info || '-'}`,
    '',
    '■ 상세 내용:',
    params.details || '(없음)',
    '',
    '────────────────────────',
    `요청 시각: ${new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}`
  ].join('\n');

  try {
    MailApp.sendEmail({
      to: TO_EMAIL,
      subject: subject,
      body: body
    });
    console.log(`✅ 업체 요청 이메일 발송 완료: ${params.company}`);
    return { status: 'success' };
  } catch (e) {
    console.error('❌ 이메일 발송 실패:', e);
    return { status: 'error', message: e.toString() };
  }
}
