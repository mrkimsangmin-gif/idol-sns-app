// 외부 시트 ID 매핑
const SHEET_IDS = {
  'SNS_DATA_GIRLBAND': '10c1IRqOcrjfSG-V3pTJg_x07UJx1GcBYZaVgSXVpcNI',
  'SNS_DATA_BOYBAND': '1610z9la__ozzeVSHhj1ljDyVKB5xK30Ewe38r6NHZZU',
  'idol_sns_master_database': '1L9xc8YLltr7IRxzCwZh5NdMpjbrsyoaG0etXdsd7NiY'
};

/**
 * OPTIONS 요청 처리 (CORS 프리플라이트)
 */
function doOptions(e) {
  return ContentService.createTextOutput('')
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * HTTP POST 요청 처리 (업체 등록/수정 요청 이메일 발송용)
 */
function doPost(e) {
  try {
    const params = JSON.parse(e.postData.contents); // POST 데이터 파싱

    // 업체 등록/수정 요청 이메일 발송
    if (params.action === 'sendVendorEmail') {
      const result = sendVendorEmail(params);
      return ContentService.createTextOutput(JSON.stringify(result))
        .setMimeType(ContentService.MimeType.JSON);
    }

    // 검색 로그 기록
    if (params.action === 'logSearch') {
      const result = logSearchQuery(params);
      return ContentService.createTextOutput(JSON.stringify(result))
        .setMimeType(ContentService.MimeType.JSON);
    }

    // 피드백 로그 기록 (👍/👎/재검색)
    if (params.action === 'logFeedback') {
      const result = logFeedback(params);
      return ContentService.createTextOutput(JSON.stringify(result))
        .setMimeType(ContentService.MimeType.JSON);
    }

    // Gemini 프록시 (나무위키 스마트 검색용)
    if (params.action === 'geminiProxy') {
      const result = handleGeminiProxy(params);
      return ContentService.createTextOutput(JSON.stringify(result))
        .setMimeType(ContentService.MimeType.JSON);
    }

    // 도우인 챌린지 데이터 저장 (ADB 크롤러 → GAS)
    if (params.action === 'saveDouyinChallenges') {
      const challenges = (params.data && params.data.challenges) || params.challenges || [];
      if (challenges.length === 0) {
        return ContentService.createTextOutput(JSON.stringify({
          success: false, message: 'No challenges data'
        })).setMimeType(ContentService.MimeType.JSON);
      }
      // saveChallenges: Gemini 요약 + 시트 저장 + 캐시 무효화
      const result = saveChallenges(challenges);
      return ContentService.createTextOutput(JSON.stringify({
        success: true, ...result
      })).setMimeType(ContentService.MimeType.JSON);
    }

    // 인사이트 CMS 쓰기 (create, update, delete, publish)
    const insightPostActions = ['create', 'update', 'delete', 'publish'];
    if (insightPostActions.includes(params.action)) {
      const result = handleInsightPost(params);
      return ContentService.createTextOutput(JSON.stringify(result))
        .setMimeType(ContentService.MimeType.JSON);
    }

    return ContentService.createTextOutput(JSON.stringify({
      status: 'error', message: 'Unknown action'
    })).setMimeType(ContentService.MimeType.JSON);

  } catch (error) {
    console.error('POST 요청 처리 오류:', error);
    return ContentService.createTextOutput(JSON.stringify({
      status: 'error', message: error.toString()
    })).setMimeType(ContentService.MimeType.JSON);
  }
}

/**
 * Gemini 프록시 핸들러 (나무위키 스마트 검색용)
 * - 클라이언트의 API 키 노출 방지
 * - 6시간 서버사이드 캐시 (CacheService)
 * - Script Properties에 GEMINI_API_KEY 설정 필요
 */
function handleGeminiProxy(data) {
  try {
    const query = data.query || '';
    const context = data.context || '';

    if (!query) {
      return { _error: true, message: '쿼리가 비어 있습니다.' };
    }

    // 캐시 키 생성 (MD5 해시)
    const digest = Utilities.computeDigest(
      Utilities.DigestAlgorithm.MD5,
      query + context.substring(0, 500) // 컨텍스트 앞부분만 캐시 키에 포함
    );
    const cacheKey = 'gemini_' + digest.map(function(b) {
      return ('0' + (b & 0xff).toString(16)).slice(-2);
    }).join('');

    // 캐시 확인 (6시간)
    const cache = CacheService.getScriptCache();
    const cached = cache.get(cacheKey);
    if (cached) {
      try {
        const parsed = JSON.parse(cached);
        parsed._cached = true;
        return parsed;
      } catch (e) {
        // 캐시 파싱 실패 시 무시하고 새로 호출
      }
    }

    // Gemini API 키 확인
    const apiKey = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');
    if (!apiKey) {
      return { _error: true, message: 'GEMINI_API_KEY가 설정되지 않았습니다.' };
    }

    // 시스템 프롬프트 구성 (플래그에 따라 3분기)
    const isCompound = data.compound === true;
    const isNamuSynthesis = data.namu_synthesis === true;
    // 오늘 날짜 주입 (나이 계산 정확도 보장)
    const todayStr = Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd');
    const dateContext = '오늘 날짜: ' + todayStr + '\n나이를 언급할 때는 반드시 오늘 날짜 기준으로 만 나이를 계산하세요.\n';
    const systemPrompt = isNamuSynthesis
      ? ('당신은 K-POP 아이돌 전문 데이터 분석가입니다.\n' +
        dateContext + '\n' +
        '제공된 [나무위키 원문] 전체를 철저히 읽고, 사용자의 질문에 답변하세요.\n\n' +
        '규칙:\n' +
        '1. 문서 전체에서 질문과 관련된 모든 언급을 빠짐없이 찾으세요. 여러 섹션에 흩어져 있을 수 있습니다.\n' +
        '2. 구체적 사실을 근거로 답변하세요: 날짜, 수치, 차트 순위, 수상 내역, 앨범명 등 원문에 있는 팩트를 반드시 포함하세요.\n' +
        '3. 답변을 마크다운 소제목(### )과 번호 목록으로 구조화하세요.\n' +
        '4. "이유/왜/어떻게/의미" 같은 분석형 질문에는 여러 측면(음악적, 상업적, 문화적, 수상 기록 등)을 각각 소제목으로 나누어 종합적으로 답변하세요.\n' +
        '5. 시간순 데이터는 마크다운 표를 사용하세요.\n' +
        '6. 나무위키 문법 잔재(각주 [1], 편집 링크, 목차 번호)는 제거하세요.\n' +
        '7. 원문을 그대로 복사하지 말고, 핵심 사실을 인용하면서 자연스러운 문장으로 재작성하세요.\n' +
        '8. 질문 핵심과 직접 관련 없는 내용은 포함하지 마세요.\n\n' +
        '답변은 반드시 JSON 형식으로 반환하세요: {"title": "답변 제목", "content": "답변 내용 (마크다운 소제목/표/리스트 포함)"}\n' +
        '반드시 JSON만 반환하고 다른 텍스트는 포함하지 마세요.')
      : isCompound
      ? ('당신은 K-POP 아이돌 데이터 분석가입니다.\n' +
        dateContext +
        '사용자가 제공한 데이터를 바탕으로 아래 규칙에 따라 답변하세요.\n\n' +
        '규칙:\n' +
        '1. 순위나 비교가 필요하면 반드시 마크다운 표(| 순위 | 그룹명 | ... |) 형식으로 정리하세요.\n' +
        '2. 표에는 순위, 그룹명, 성별, 데뷔연도, 판매량(수치), 해당 앨범명을 포함하세요.\n' +
        '3. 판매량 데이터가 없는 그룹은 표 하단에 "데이터 없음"으로 묶어 표시하세요.\n' +
        '4. 표 아래에 **핵심 요약**이라는 제목으로 1위 그룹, 걸그룹/보이그룹 1위, 주요 트렌드 등을 3줄 이내로 요약하세요.\n' +
        '5. 데이터에 없는 내용을 지어내지 마세요.\n' +
        '6. 판매량 수치에 ** 마스킹이 있으면 ~표시와 함께 추정치로 표기하세요 (예: 2,344,7** → ~2,344,700).\n\n' +
        '답변은 JSON 형식으로 반환하세요: {"title": "답변 제목", "content": "답변 내용 (마크다운 표 포함)"}\n' +
        '반드시 JSON만 반환하고 다른 텍스트는 포함하지 마세요.')
      : ('당신은 K-POP 아이돌 전문가입니다.\n' +
        dateContext +
        '아래 데이터베이스 정보를 우선 참고하되, 데이터베이스에 없는 정보는 당신의 지식을 활용하여 답변하세요.\n' +
        '데이터베이스 기반 답변과 자체 지식 기반 답변을 구분하지 않아도 됩니다.\n' +
        '구체적 사실(날짜, 수치, 차트 순위, 수상 내역)을 근거로 답변하고, 마크다운 소제목(### )과 번호 목록으로 구조화하세요.\n' +
        '"이유/왜/어떻게" 같은 분석형 질문에는 여러 측면을 종합적으로 답변하세요.\n' +
        '답변은 JSON 형식으로 반환하세요: {"title": "답변 제목", "content": "답변 내용 (마크다운 가능)"}\n' +
        '반드시 JSON만 반환하고 다른 텍스트는 포함하지 마세요.');

    // namu_synthesis: 8192 토큰 (전체 문서 분석), compound: 2048, 일반: 8192
    const maxTokens = isCompound ? 2048 : 8192;

    // Gemini API 호출
    const contextLabel = isNamuSynthesis ? '=== 나무위키 원문 ===' : (isCompound ? '=== 제공된 데이터 ===' : '=== 데이터베이스 ===');
    const payload = {
      contents: [{
        parts: [{ text: systemPrompt + '\n\n' + contextLabel + '\n' + context + '\n\n질문: ' + query }]
      }],
      generationConfig: {
        temperature: 0.1,
        maxOutputTokens: maxTokens
      }
    };

    const response = UrlFetchApp.fetch(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent?key=' + apiKey,
      {
        method: 'post',
        contentType: 'application/json',
        payload: JSON.stringify(payload),
        muteHttpExceptions: true
      }
    );

    const statusCode = response.getResponseCode();
    if (statusCode !== 200) {
      console.error('Gemini API 오류:', statusCode, response.getContentText().substring(0, 200));
      return { _error: true, message: 'Gemini API 오류 (' + statusCode + ')' };
    }

    const result = JSON.parse(response.getContentText());
    const text = result.candidates[0].content.parts[0].text;

    // JSON 파싱 시도 (Gemini 응답이 JSON 형식일 때)
    let parsed;
    try {
      // ```json ... ``` 래핑 제거
      const cleaned = text.replace(/^```json\s*/, '').replace(/\s*```$/, '').trim();
      parsed = JSON.parse(cleaned);
    } catch (e) {
      // JSON 파싱 실패 → 텍스트 그대로 반환
      parsed = { title: '검색 결과', content: text };
    }

    // 캐시 저장 (6시간 = 21600초, 100KB 제한 주의)
    const output = JSON.stringify(parsed);
    if (output.length < 90000) { // CacheService 100KB 제한 안전 마진
      try {
        cache.put(cacheKey, output, 21600);
      } catch (e) {
        // 캐시 저장 실패 무시 (크기 초과 등)
      }
    }

    return parsed;

  } catch (error) {
    console.error('handleGeminiProxy 오류:', error);
    return { _error: true, message: error.toString() };
  }
}

/**
 * HTTP GET 요청 처리 (웹사이트용 API) - 월별 캐싱 전략
 */
function doGet(e) {
  try {
    const p = e.parameter;

    // 메타데이터 조회 요청 (단일)
    if (p.action === 'metadata') {
      const name = p.name;
      const gender = p.gender || '여자';
      const result = getIdolMetadata(name, gender);
      return ContentService.createTextOutput(JSON.stringify(result))
        .setMimeType(ContentService.MimeType.JSON);
    }

    // 전체 메타데이터 조회 (프리페칭용)
    if (p.action === 'allMetadata') {
      const gender = p.gender || '남자';
      const result = getAllIdolMetadata(gender);
      return ContentService.createTextOutput(JSON.stringify(result))
        .setMimeType(ContentService.MimeType.JSON);
    }

    // K-POP 링크 모음 조회
    if (p.action === 'getLinks') {
      const result = getLinksData();
      return ContentService.createTextOutput(JSON.stringify(result))
        .setMimeType(ContentService.MimeType.JSON);
    }

    // 채용정보 조회
    if (p.action === 'getJobs') {
      const result = getJobsData();
      return ContentService.createTextOutput(JSON.stringify(result))
        .setMimeType(ContentService.MimeType.JSON);
    }

    // 도우인 챌린지 조회
    if (p.action === 'getDouyinChallenges') {
      const result = getDouyinChallenges();
      return ContentService.createTextOutput(JSON.stringify(result))
        .setMimeType(ContentService.MimeType.JSON);
    }

    // 업체정보 조회
    if (p.action === 'getVendors') {
      const result = getVendorsData();
      return ContentService.createTextOutput(JSON.stringify(result))
        .setMimeType(ContentService.MimeType.JSON);
    }

    // 엔터뉴스 조회
    if (p.action === 'getNews') {
      const result = getEnterNews();
      return ContentService.createTextOutput(JSON.stringify(result))
        .setMimeType(ContentService.MimeType.JSON);
    }

    // 캘린더 이벤트 조회 (컴백일정)
    if (p.action === 'getCalendarEvents') {
      const result = getCalendarEvents(p.group || '', p.months || '3');
      return ContentService.createTextOutput(JSON.stringify(result))
        .setMimeType(ContentService.MimeType.JSON);
    }

    // 인사이트 CMS 조회 (list, get, view, listAll, categories)
    const insightActions = ['list', 'get', 'view', 'listAll', 'categories',
                            'insightList', 'insightGet', 'insightView', 'insightListAll', 'insightCategories'];
    if (insightActions.includes(p.action)) {
      const result = handleInsightGet(p);
      return ContentService.createTextOutput(JSON.stringify(result))
        .setMimeType(ContentService.MimeType.JSON);
    }

    // 기존 SNS 데이터 조회
    const targetGender = p.gender || "남자";
    const targetSns = p.sns || "웨이보";
    const isInit = p.init === 'true';
    const targetMonth = p.month; // 특정 월 요청

    const cache = CacheService.getScriptCache();

    // 1. 메타데이터(월 목록) 가져오기
    const metaKey = `meta_${targetGender}_${targetSns}`;
    let allMonths;

    const cachedMeta = cache.get(metaKey);
    if (cachedMeta) {
      allMonths = JSON.parse(cachedMeta);
      Logger.log(`Meta HIT: ${metaKey}`);
    } else {
      allMonths = getAllMonthsFromSheet(targetGender, targetSns);
      cache.put(metaKey, JSON.stringify(allMonths), 21600); // 6시간
      Logger.log(`Meta MISS: ${metaKey}`);
    }

    // 2. 필요한 월 결정
    let requestedMonths;
    if (targetMonth) {
      // 특정 월 + 전월만 요청
      const monthIndex = allMonths.indexOf(targetMonth);
      if (monthIndex > 0) {
        requestedMonths = [allMonths[monthIndex - 1], targetMonth];
      } else if (monthIndex === 0) {
        requestedMonths = [targetMonth];
      } else {
        // 요청한 월이 존재하지 않으면 빈 배열
        requestedMonths = [];
      }
      Logger.log(`Specific month request: ${targetMonth}, loading: ${requestedMonths.join(', ')}`);
    } else if (isInit) {
      // 초기 로딩: 최근 2개월
      requestedMonths = allMonths.slice(-2);
    } else {
      // 기본: 모든 월 (하위 호환성)
      requestedMonths = allMonths;
    }

    // 3. 각 월별로 캐시에서 조회/로드
    const allData = [];

    for (const month of requestedMonths) {
      const monthKey = `data_${targetGender}_${targetSns}_${month}`;
      const cachedMonth = cache.get(monthKey);

      if (cachedMonth) {
        Logger.log(`Month HIT: ${monthKey}`);
        allData.push(...JSON.parse(cachedMonth));
      } else {
        Logger.log(`Month MISS: ${monthKey}`);
        const monthData = loadMonthDataFromSheet(targetGender, targetSns, month);

        try {
          cache.put(monthKey, JSON.stringify(monthData), 86400); // 24시간
          Logger.log(`Cached: ${monthKey}`);
        } catch (e) {
          Logger.log(`Cache failed: ${monthKey} - ${e.message}`);
        }

        allData.push(...monthData);
      }
    }

    // 4. 정렬 및 제한
    let responseData = allData;

    // ✅ 요청한 월 데이터 기준으로 정렬 (개선)
    if (p.sortByCount === 'true' && allData.length > 0) {
      // 정렬 기준 월: targetMonth가 있으면 그것, 없으면 최신 월
      const sortMonth = targetMonth || allMonths[allMonths.length - 1];

      // sortMonth의 count 기준으로 내림차순 정렬
      responseData = allData.sort((a, b) => {
        // 정렬 월 데이터만 비교 (없으면 0)
        const aCount = a.date === sortMonth ? a.count : 0;
        const bCount = b.date === sortMonth ? b.count : 0;
        return bCount - aCount;
      });

      Logger.log(`Sorted by ${sortMonth} count`);
    }








    // limit 파라미터가 있으면 각 월별로 상위 N개씩 반환 (증감률 계산을 위해)
    if (p.limit) {
      const limit = parseInt(p.limit);
      if (!isNaN(limit) && limit > 0) {
        // ✅ 각 월별로 상위 limit개씩 추출
        const limitedByMonth = {};

        responseData.forEach(item => {
          if (!limitedByMonth[item.date]) {
            limitedByMonth[item.date] = [];
          }
          if (limitedByMonth[item.date].length < limit) {
            limitedByMonth[item.date].push(item);
          }
        });

        // 모든 월 데이터 합치기
        responseData = [];
        Object.values(limitedByMonth).forEach(monthData => {
          responseData.push(...monthData);
        });

        Logger.log(`Limiting to ${limit} records per month, total: ${responseData.length}`);
      }
    }

    // 5. 응답
    return ContentService.createTextOutput(JSON.stringify({
      status: 'success',
      meta: {
        allMonths,
        total: allData.length,      // 전체 레코드 수
        returned: responseData.length  // 실제 반환된 레코드 수
      },
      data: responseData
    }))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (error) {
    return createErrorResponse(error.message);
  }
}

/**
 * 월 목록만 조회 (메타데이터)
 */
function getAllMonthsFromSheet(targetGender, targetSns) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('sns_data');
  if (!sheet) throw new Error("sns_data 시트를 찾을 수 없습니다.");

  const data = sheet.getDataRange().getValues();
  data.shift();

  const formatDate = (d) => {
    try {
      if (!d) return "";
      let dateStr = String(d);
      if (Object.prototype.toString.call(d) === '[object Date]') {
        return Utilities.formatDate(d, "GMT+9", "yyyy-MM");
      }
      const match = dateStr.match(/(\d{4})[\.\/-](\d{1,2})/);
      if (match) {
        return `${match[1]}-${match[2].padStart(2, '0')}`;
      }
      if (dateStr.length >= 7) return dateStr.substring(0, 7);
      return dateStr;
    } catch (e) {
      return String(d);
    }
  };

  const monthsSet = new Set();
  data.forEach(r => {
    if (r[2] === targetGender && r[3] === targetSns) {
      const month = formatDate(r[4]);
      if (month && month.match(/^\d{4}-\d{2}$/)) {
        monthsSet.add(month);
      }
    }
  });

  return [...monthsSet].sort();
}

/**
 * 특정 월의 데이터만 로드
 */
function loadMonthDataFromSheet(targetGender, targetSns, targetMonth) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('sns_data');
  if (!sheet) throw new Error("sns_data 시트를 찾을 수 없습니다.");

  const data = sheet.getDataRange().getValues();
  data.shift();

  const formatDate = (d) => {
    try {
      if (!d) return "";
      let dateStr = String(d);
      if (Object.prototype.toString.call(d) === '[object Date]') {
        return Utilities.formatDate(d, "GMT+9", "yyyy-MM");
      }
      const match = dateStr.match(/(\d{4})[\.\/-](\d{1,2})/);
      if (match) {
        return `${match[1]}-${match[2].padStart(2, '0')}`;
      }
      if (dateStr.length >= 7) return dateStr.substring(0, 7);
      return dateStr;
    } catch (e) {
      return String(d);
    }
  };

  const parseNumber = (val) => {
    if (!val) return 0;
    const numStr = String(val).replace(/,/g, '');
    const num = Number(numStr);
    return isNaN(num) ? 0 : num;
  };

  const monthData = [];
  data.forEach(r => {
    const rDate = formatDate(r[4]);
    if (r[2] === targetGender && r[3] === targetSns && rDate === targetMonth) {
      monthData.push({
        name: r[0],
        group: r[1],
        date: rDate,
        count: parseNumber(r[5])
      });
    }
  });

  return monthData;
}

function createErrorResponse(message) {
  return ContentService.createTextOutput(JSON.stringify({
    status: 'error',
    message: message
  }))
    .setMimeType(ContentService.MimeType.JSON);
}

// ========================================
// 📦 초기 데이터 정적 JSON 생성 (월간 업데이트용)
// ========================================

/**
 * 초기 화면용 정적 데이터 생성 (남자/웨이보/최신월/Top30)
 * 월말 데이터 업데이트 후 실행하여 JSON 생성
 * @returns {Object} - 정적 데이터 객체
 */
function generateInitialDataJSON() {
  const gender = '남자';
  const sns = '웨이보';

  // 전체 월 목록 가져오기
  const allMonths = getAllMonthsFromSheet(gender, sns);
  const latestMonth = allMonths[allMonths.length - 1];
  const prevMonth = allMonths.length > 1 ? allMonths[allMonths.length - 2] : latestMonth;

  // 최신 2개월 데이터 로드
  const latestData = loadMonthDataFromSheet(gender, sns, latestMonth);
  const prevData = loadMonthDataFromSheet(gender, sns, prevMonth);

  // count 기준 정렬 후 상위 30개
  const sortedLatest = latestData.sort((a, b) => b.count - a.count);
  const top30 = sortedLatest.slice(0, 30);

  // 전월 데이터에서 Top 30 아이돌의 데이터 추출
  const top30Names = new Set(top30.map(d => d.name));
  const prevTop30 = prevData.filter(d => top30Names.has(d.name));

  const result = {
    generated: new Date().toISOString(),
    meta: {
      gender,
      sns,
      latestMonth,
      prevMonth,
      allMonths
    },
    data: [...top30, ...prevTop30]
  };

  // 결과 로그 출력 (복사 가능)
  Logger.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  Logger.log('📦 초기 데이터 JSON 생성 완료');
  Logger.log(`📅 최신 월: ${latestMonth}`);
  Logger.log(`📊 Top 10: ${top30.slice(0, 10).map(d => d.name).join(', ')}`);
  Logger.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  Logger.log('아래 JSON을 data/initial-data.json에 저장하세요:');
  Logger.log(JSON.stringify(result, null, 2));

  return result;
}

/**
 * 전체 성별/SNS 조합의 초기 데이터 생성 (시트 1회 읽기 최적화)
 * 14개 조합(2성별 × 7SNS)의 최신 2개월 Top30 데이터를 한 번에 생성
 * @returns {Object} - version 2 형식의 전체 초기 데이터
 */
function generateAllInitialDataJSON() {
  const snsList = ['웨이보', '차오화', '빌리빌리', 'QQ뮤직', 'X(트위터)', '유튜브', '스포티파이'];
  const genders = ['남자', '여자'];

  // 시트 데이터 1회만 읽기 (성능 최적화)
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('sns_data');
  if (!sheet) throw new Error('sns_data 시트를 찾을 수 없습니다.');

  const allRows = sheet.getDataRange().getValues();
  allRows.shift(); // 헤더 제거

  // 날짜 포맷 캐시 (중복 변환 방지)
  const dateFormatCache = new Map();
  const formatDate = (d) => {
    const key = String(d);
    if (dateFormatCache.has(key)) return dateFormatCache.get(key);

    let result = '';
    if (!d) {
      result = '';
    } else if (Object.prototype.toString.call(d) === '[object Date]') {
      result = Utilities.formatDate(d, 'GMT+9', 'yyyy-MM');
    } else {
      const match = String(d).match(/(\d{4})[\.\/\-](\d{1,2})/);
      if (match) result = `${match[1]}-${match[2].padStart(2, '0')}`;
      else result = String(d).length >= 7 ? String(d).substring(0, 7) : String(d);
    }

    dateFormatCache.set(key, result);
    return result;
  };

  const parseNumber = (val) => {
    if (!val) return 0;
    const num = Number(String(val).replace(/,/g, ''));
    return isNaN(num) ? 0 : num;
  };

  // 전체 데이터를 성별_SNS_월 기준으로 그룹핑
  // grouped[gender][sns][month] = [{name, group, date, count}, ...]
  const grouped = {};
  // months[gender][sns] = Set(['2024-03', '2024-04', ...])
  const monthsSets = {};

  allRows.forEach(r => {
    const gender = r[2];
    const sns = r[3];
    const date = formatDate(r[4]);

    // 유효한 날짜 형식만 처리
    if (!date || !date.match(/^\d{4}-\d{2}$/)) return;
    // 지원하는 성별/SNS만 처리
    if (!genders.includes(gender) || !snsList.includes(sns)) return;

    // 그룹핑 구조 초기화
    if (!grouped[gender]) grouped[gender] = {};
    if (!grouped[gender][sns]) grouped[gender][sns] = {};
    if (!grouped[gender][sns][date]) grouped[gender][sns][date] = [];

    if (!monthsSets[gender]) monthsSets[gender] = {};
    if (!monthsSets[gender][sns]) monthsSets[gender][sns] = new Set();

    monthsSets[gender][sns].add(date);
    grouped[gender][sns][date].push({
      name: r[0],
      group: r[1],
      date: date,
      count: parseNumber(r[5])
    });
  });

  // 각 조합별 초기 데이터 구성
  const combinations = {};
  let totalRecords = 0;

  genders.forEach(gender => {
    snsList.forEach(sns => {
      const key = `${gender}_${sns}`;

      // 월 목록 정렬
      const monthsSet = monthsSets[gender] && monthsSets[gender][sns];
      if (!monthsSet || monthsSet.size === 0) {
        Logger.log(`⚠️ ${key}: 데이터 없음, 건너뜀`);
        return;
      }

      const allMonths = [...monthsSet].sort();
      const latestMonth = allMonths[allMonths.length - 1];
      const prevMonth = allMonths.length > 1 ? allMonths[allMonths.length - 2] : latestMonth;

      // 최신월 데이터 → count 기준 정렬 → Top 30
      const latestData = (grouped[gender][sns][latestMonth] || [])
        .sort((a, b) => b.count - a.count);
      const top30 = latestData.slice(0, 30);

      // 전월 데이터에서 Top 30 아이돌의 데이터 추출 (증감률 계산용)
      const top30Names = new Set(top30.map(d => d.name));
      const prevData = (grouped[gender][sns][prevMonth] || [])
        .filter(d => top30Names.has(d.name));

      const comboData = [...top30, ...prevData];
      totalRecords += comboData.length;

      combinations[key] = {
        meta: {
          latestMonth,
          prevMonth,
          allMonths
        },
        data: comboData
      };

      Logger.log(`✅ ${key}: ${top30.length}개 아이돌, ${latestMonth}/${prevMonth}`);
    });
  });

  const result = {
    generated: new Date().toISOString(),
    version: 2,
    combinations
  };

  // 통계 로그
  Logger.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  Logger.log('📦 전체 초기 데이터 JSON 생성 완료');
  Logger.log(`📊 조합 수: ${Object.keys(combinations).length}개`);
  Logger.log(`📊 총 레코드: ${totalRecords}개`);
  Logger.log(`📏 JSON 크기: ${JSON.stringify(result).length.toLocaleString()} bytes`);
  Logger.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  return result;
}

/**
 * 월간 데이터 업데이트 알림 이메일 발송
 * 트리거: 매월 1일 새벽 4시 (수동 설정 필요)
 */
function sendInitialDataUpdateEmail() {
  const result = generateInitialDataJSON();
  const json = JSON.stringify(result, null, 2);

  MailApp.sendEmail({
    to: 'mr.kimsangmin@gmail.com',
    subject: '[KPOP SNS] 월간 초기 데이터 업데이트 알림',
    body: `새로운 월간 데이터가 생성되었습니다.

아래 JSON을 data/initial-data.json 파일에 저장하세요.

=== JSON 시작 ===
${json}
=== JSON 끝 ===

생성 시간: ${new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}
최신 월: ${result.meta.latestMonth}
Top 10: ${result.data.filter(d => d.date === result.meta.latestMonth).slice(0, 10).map(d => d.name).join(', ')}

GitHub 저장소에서 data/initial-data.json 파일을 업데이트 해주세요:
https://github.com/mrkimsangmin-gif/idol-sns-app/
`
  });

  Logger.log('✅ 월간 업데이트 이메일 발송 완료');
}

/**
 * 전체 조합 초기 데이터를 이메일 첨부 파일로 발송
 * 파일이 크므로(~100KB) 이메일 본문 대신 첨부 파일 사용
 * 실행: Apps Script 에디터에서 emailAllInitialData 선택 후 실행
 */
function emailAllInitialData() {
  const result = generateAllInitialDataJSON();
  const json = JSON.stringify(result, null, 2);

  // 조합별 요약 생성
  const summary = Object.entries(result.combinations).map(([key, combo]) => {
    const top3 = combo.data
      .filter(d => d.date === combo.meta.latestMonth)
      .slice(0, 3)
      .map(d => d.name)
      .join(', ');
    return `  ${key}: ${combo.meta.latestMonth} / Top3: ${top3}`;
  }).join('\n');

  // JSON 파일을 이메일 첨부로 발송
  MailApp.sendEmail({
    to: 'mr.kimsangmin@gmail.com',
    subject: '[KPOP SNS] 전체 초기 데이터 JSON 생성 완료 (v2)',
    body: `전체 조합 초기 데이터 JSON이 생성되었습니다.\n\n` +
          `조합 수: ${Object.keys(result.combinations).length}개\n` +
          `JSON 크기: ${json.length.toLocaleString()} bytes\n\n` +
          `=== 조합별 요약 ===\n${summary}\n\n` +
          `첨부된 initial-data.json 파일을 data/ 폴더에 업로드하세요.\n` +
          `GitHub: https://github.com/mrkimsangmin-gif/idol-sns-app/\n`,
    attachments: [
      Utilities.newBlob(json, 'application/json', 'initial-data.json')
    ]
  });

  Logger.log('✅ 전체 초기 데이터 이메일 발송 완료');
}

// ========================================
// 🔄 캐시 관리
// ========================================

function refreshCacheManually() {
  const ui = SpreadsheetApp.getUi();

  try {
    // refreshCacheAll() 사용
    refreshCacheAll();

    ui.alert(
      '✅ 캐시 갱신 완료',
      '모든 SNS의 전체 월 데이터 캐싱 완료',
      ui.ButtonSet.OK
    );
  } catch (e) {
    ui.alert('오류', `캐시 갱신 실패: ${e.message}`, ui.ButtonSet.OK);
  }
}

/**
 * 특정 SNS의 캐시 갱신 (범용 함수)
 * @param {Array} snsList - 캐싱할 SNS 목록
 */
function refreshCacheBySns(snsList) {
  const cache = CacheService.getScriptCache();
  const genders = ['여자', '남자'];

  let cachedCount = 0;
  genders.forEach(gender => {
    snsList.forEach(sns => {
      try {
        const allMonths = getAllMonthsFromSheet(gender, sns);
        const recentMonths = allMonths; // 전체 월 캐싱 (이전: allMonths.slice(-2))
        cache.put(`meta_${gender}_${sns}`, JSON.stringify(allMonths), 21600);
        cachedCount++;
        recentMonths.forEach(month => {
          const monthData = loadMonthDataFromSheet(gender, sns, month);
          cache.put(`data_${gender}_${sns}_${month}`, JSON.stringify(monthData), 86400);
          cachedCount++;
        });
      } catch (e) {
        Logger.log(`[Auto] Failed: ${gender}/${sns} - ${e.message}`);
      }
    });
  });
  Logger.log(`[${snsList.join(', ')}] Cached ${cachedCount} items at ${new Date()}`);
}

/**
 * 특정 SNS 및 성별의 캐시 갱신 (범용 함수 - 최적화됨)
 * @param {Array} snsList - 캐싱할 SNS 목록
 * @param {Array} genderList - 캐싱할 성별 목록
 * 
 * 최적화 요소:
 * - 시트 데이터 1회만 읽기
 * - 메모리 내 병렬 처리
 * - 날짜 포맷 결과 캐싱
 */



/**
 * 연도별 캐시 갱신 함수 (시간 초과 방지)
 * @param {Array} snsList - SNS 목록
 * @param {Array} genderList - 성별 목록
 * @param {string} targetYear - 대상 연도 (예: "2024", "2025")
 */
function refreshCacheBySnsGenderAndYear(snsList, genderList, targetYear) {
  const startTime = new Date();
  const MAX_EXECUTION_TIME = 300000; // 5분 (Apps Script 6분 제한 고려)
  const cache = CacheService.getScriptCache();

  // 시간 체크 함수
  const isTimeLimitReached = () => {
    return (new Date() - startTime) > MAX_EXECUTION_TIME;
  };

  // ✅ 시트 데이터를 딱 한 번만 읽음
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('sns_data');
  if (!sheet) {
    const errorMsg = '❌ sns_data 시트를 찾을 수 없습니다.';
    Logger.log(errorMsg);
    throw new Error(errorMsg);
  }

  const allData = sheet.getDataRange().getValues();
  const header = allData.shift(); // 헤더 제거
  const sheetReadTime = (new Date() - startTime) / 1000;
  Logger.log(`📖 시트 읽기 완료: ${sheetReadTime.toFixed(2)}초 (${allData.length} rows)`);

  // 날짜 포맷 캐시 (성능 최적화)
  const dateFormatCache = new Map();

  const formatDate = (d) => {
    const cacheKey = String(d);
    if (dateFormatCache.has(cacheKey)) {
      return dateFormatCache.get(cacheKey);
    }

    try {
      if (!d) return "";
      let dateStr = String(d);
      let result;

      if (Object.prototype.toString.call(d) === '[object Date]') {
        result = Utilities.formatDate(d, "GMT+9", "yyyy-MM");
      } else {
        const match = dateStr.match(/(\d{4})[\.\/\-](\d{1,2})/);
        if (match) {
          result = `${match[1]}-${match[2].padStart(2, '0')}`;
        } else if (dateStr.length >= 7) {
          result = dateStr.substring(0, 7);
        } else {
          result = dateStr;
        }
      }

      dateFormatCache.set(cacheKey, result);
      return result;
    } catch (e) {
      return String(d);
    }
  };

  const parseNumber = (val) => {
    if (!val) return 0;
    const numStr = String(val).replace(/,/g, '');
    const num = Number(numStr);
    return isNaN(num) ? 0 : num;
  };

  let cachedCount = 0;
  let totalProcessed = 0;

  genderList.forEach(gender => {
    snsList.forEach(sns => {
      // 시간 제한 체크
      if (isTimeLimitReached()) {
        Logger.log(`⏰ 시간 제한 도달, ${gender}/${sns} 스킵`);
        return;
      }

      const taskStartTime = new Date();

      try {
        // ✅ 해당 성별/SNS 데이터만 미리 필터링 (메모리 내 처리)
        const filteredData = allData.filter(r => r[2] === gender && r[3] === sns);

        // 월 목록 추출 (연도 필터 적용)
        const monthsSet = new Set();
        filteredData.forEach(r => {
          const month = formatDate(r[4]);
          if (month && month.match(/^\d{4}-\d{2}$/)) {
            // targetYear가 지정된 경우 해당 연도만 처리
            if (!targetYear || month.startsWith(targetYear)) {
              monthsSet.add(month);
            }
          }
        });

        const allMonths = [...monthsSet].sort();

        if (allMonths.length === 0) {
          Logger.log(`⚠️ ${gender}/${sns}/${targetYear || 'ALL'}: 데이터 없음`);
          return;
        }

        // ✅ 메타데이터: 전체 월 목록 캐싱 (연도와 무관하게 전체 저장)
        if (!targetYear) {
          cache.put(`meta_${gender}_${sns}`, JSON.stringify(allMonths), 21600);
          cachedCount++;
        }

        // ✅ 데이터: 해당 연도의 월만 캐싱
        allMonths.forEach(month => {
          // 시간 제한 체크
          if (isTimeLimitReached()) {
            Logger.log(`⏰ 시간 제한 도달, ${month} 스킵`);
            return;
          }

          // 이미 필터링된 데이터에서 월별로만 추가 필터링
          const monthData = filteredData
            .filter(r => formatDate(r[4]) === month)
            .map(r => ({
              name: r[0],
              group: r[1],
              date: month,
              count: parseNumber(r[5])
            }));

          const jsonData = JSON.stringify(monthData);

          // ✅ 100KB 체크
          if (jsonData.length < 100000) {
            cache.put(`data_${gender}_${sns}_${month}`, jsonData, 86400);
            cachedCount++;
            totalProcessed += monthData.length;
          } else {
            Logger.log(`⚠️ 용량 초과로 캐싱 건너뜀: ${gender}_${sns}_${month} (${jsonData.length} bytes)`);
          }
        });

        const taskDuration = (new Date() - taskStartTime) / 1000;
        Logger.log(`✅ ${gender}/${sns}/${targetYear || 'ALL'}: ${allMonths.length}개월, ${filteredData.length}개 항목 (${taskDuration.toFixed(2)}초)`);

      } catch (e) {
        Logger.log(`❌ ${gender}/${sns} 실패: ${e.message}`);
        throw e; // 에러를 상위로 전파
      }
    });
  });

  const totalDuration = (new Date() - startTime) / 1000;
  const avgTimePerItem = totalProcessed > 0 ? (totalDuration / totalProcessed * 1000).toFixed(2) : 0;

  Logger.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  Logger.log(`✅ 캐시 갱신 완료`);
  Logger.log(`  - 성별/SNS/연도: ${genderList.join(', ')} / ${snsList.join(', ')} / ${targetYear || 'ALL'}`);
  Logger.log(`  - 캐시 항목: ${cachedCount}개`);
  Logger.log(`  - 처리 데이터: ${totalProcessed}개`);
  Logger.log(`  - 총 소요 시간: ${totalDuration.toFixed(2)}초`);
  Logger.log(`  - 항목당 평균: ${avgTimePerItem}ms`);
  Logger.log(`  - 시트 읽기: ${sheetReadTime.toFixed(2)}초 (${((sheetReadTime / totalDuration) * 100).toFixed(1)}%)`);
  Logger.log(`  - 처리 시간: ${(totalDuration - sheetReadTime).toFixed(2)}초`);
  Logger.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
}

/**
 * 기존 함수 호환성 유지 (연도 지정 없음)
 */
function refreshCacheBySnsAndGender(snsList, genderList) {
  return refreshCacheBySnsGenderAndYear(snsList, genderList, null);
}

/**
 * 공통 에러 핸들링 및 이메일 발송
 */
function sendErrorEmail(functionName, error) {
  const ALERT_EMAIL = 'mr.kimsangmin@gmail.com';

  Logger.log(`❌ ${functionName} 실패: ${error.message}`);

  const subject = `[SNS 캐시 시스템] ${functionName} 실패 알림`;
  const body = `
===========================================
⚠️ 캐시 갱신 트리거 실패 알림
===========================================

🔴 실패한 작업: ${functionName}
📅 실행 시간: ${new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}
❌ 오류 내용: ${error.message}

📋 스택 트레이스:
${error.stack || '스택 정보 없음'}

🔧 조치 필요 사항:
1. Apps Script 에디터 > 실행 로그 확인
2. sns_data 시트 상태 확인
3. 필요시 수동 캐시 갱신 실행
4. 연도별 분할 트리거 설정 고려

---
Google Apps Script 자동 알림
  `.trim();

  try {
    MailApp.sendEmail(ALERT_EMAIL, subject, body);
    Logger.log(`📧 실패 알림 이메일 발송 완료: ${ALERT_EMAIL}`);
  } catch (mailError) {
    Logger.log(`📧 이메일 발송 실패: ${mailError.message}`);
  }
}





// ========================================
// 🎯 성별+SNS별 캐시 갱신 함수 (트리거용, 14개)
// 실행 시간 분산: 각 함수 3분 이내 완료
// ========================================





/**
 * 웨이보 남자 캐시 갱신 (트리거: 매일 3:00)
 */
function refreshCacheWeiboMale() {
  const ALERT_EMAIL = 'mr.kimsangmin@gmail.com';
  const functionName = '웨이보 남자 캐시 갱신';

  try {
    Logger.log('Starting Weibo Male cache refresh...');
    refreshCacheBySnsAndGender(['웨이보'], ['남자']);
    Logger.log('✅ Weibo Male cache refresh completed successfully');
  } catch (error) {
    Logger.log(`❌ ${functionName} 실패: ${error.message}`);

    // 이메일 발송
    const subject = `[SNS 캐시 시스템] ${functionName} 실패 알림`;
    const body = `
===========================================
⚠️ 캐시 갱신 트리거 실패 알림
===========================================

🔴 실패한 작업: ${functionName}
📅 실행 시간: ${new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}
❌ 오류 내용: ${error.message}

📋 스택 트레이스:
${error.stack || '스택 정보 없음'}

🔧 조치 필요 사항:
1. Apps Script 에디터 > 실행 로그 확인
2. sns_data 시트 상태 확인
3. 필요시 수동 캐시 갱신 실행

---
Google Apps Script 자동 알림
    `.trim();

    try {
      MailApp.sendEmail(ALERT_EMAIL, subject, body);
      Logger.log(`📧 실패 알림 이메일 발송 완료: ${ALERT_EMAIL}`);
    } catch (mailError) {
      Logger.log(`📧 이메일 발송 실패: ${mailError.message}`);
    }

    // 에러 재발생 (트리거 실행 기록에 실패로 표시)
    throw error;
  }
}






/**
 * 웨이보 여자 캐시 갱신 (트리거: 매일 3:05)
 */
function refreshCacheWeiboFemale() {
  const ALERT_EMAIL = 'mr.kimsangmin@gmail.com';
  const functionName = '웨이보 여자 캐시 갱신';

  try {
    Logger.log('Starting Weibo Female cache refresh...');
    refreshCacheBySnsAndGender(['웨이보'], ['여자']);
    Logger.log('✅ Weibo Female cache refresh completed successfully');
  } catch (error) {
    Logger.log(`❌ ${functionName} 실패: ${error.message}`);

    const subject = `[SNS 캐시 시스템] ${functionName} 실패 알림`;
    const body = `
===========================================
⚠️ 캐시 갱신 트리거 실패 알림
===========================================

🔴 실패한 작업: ${functionName}
📅 실행 시간: ${new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}
❌ 오류 내용: ${error.message}

📋 스택 트레이스:
${error.stack || '스택 정보 없음'}

🔧 조치 필요 사항:
1. Apps Script 에디터 > 실행 로그 확인
2. sns_data 시트 상태 확인
3. 필요시 수동 캐시 갱신 실행

---
Google Apps Script 자동 알림
    `.trim();

    try {
      MailApp.sendEmail(ALERT_EMAIL, subject, body);
      Logger.log(`📧 실패 알림 이메일 발송 완료: ${ALERT_EMAIL}`);
    } catch (mailError) {
      Logger.log(`📧 이메일 발송 실패: ${mailError.message}`);
    }

    throw error;
  }
}

/**
 * 차오화 남자 캐시 갱신 (트리거: 매일 3:10)
 */
function refreshCacheChaouaMale() {
  const ALERT_EMAIL = 'mr.kimsangmin@gmail.com';
  const functionName = '차오화 남자 캐시 갱신';

  try {
    Logger.log('Starting Chaohua Male cache refresh...');
    refreshCacheBySnsAndGender(['차오화'], ['남자']);
    Logger.log('✅ Chaohua Male cache refresh completed successfully');
  } catch (error) {
    Logger.log(`❌ ${functionName} 실패: ${error.message}`);

    const subject = `[SNS 캐시 시스템] ${functionName} 실패 알림`;
    const body = `
===========================================
⚠️ 캐시 갱신 트리거 실패 알림
===========================================

🔴 실패한 작업: ${functionName}
📅 실행 시간: ${new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}
❌ 오류 내용: ${error.message}

📋 스택 트레이스:
${error.stack || '스택 정보 없음'}

🔧 조치 필요 사항:
1. Apps Script 에디터 > 실행 로그 확인
2. sns_data 시트 상태 확인
3. 필요시 수동 캐시 갱신 실행

---
Google Apps Script 자동 알림
    `.trim();

    try {
      MailApp.sendEmail(ALERT_EMAIL, subject, body);
      Logger.log(`📧 실패 알림 이메일 발송 완료: ${ALERT_EMAIL}`);
    } catch (mailError) {
      Logger.log(`📧 이메일 발송 실패: ${mailError.message}`);
    }

    throw error;
  }
}

/**
 * 차오화 여자 캐시 갱신 (트리거: 매일 3:15)
 */
function refreshCacheChaouaFemale() {
  const ALERT_EMAIL = 'mr.kimsangmin@gmail.com';
  const functionName = '차오화 여자 캐시 갱신';

  try {
    Logger.log('Starting Chaohua Female cache refresh...');
    refreshCacheBySnsAndGender(['차오화'], ['여자']);
    Logger.log('✅ Chaohua Female cache refresh completed successfully');
  } catch (error) {
    Logger.log(`❌ ${functionName} 실패: ${error.message}`);

    const subject = `[SNS 캐시 시스템] ${functionName} 실패 알림`;
    const body = `
===========================================
⚠️ 캐시 갱신 트리거 실패 알림
===========================================

🔴 실패한 작업: ${functionName}
📅 실행 시간: ${new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}
❌ 오류 내용: ${error.message}

📋 스택 트레이스:
${error.stack || '스택 정보 없음'}

🔧 조치 필요 사항:
1. Apps Script 에디터 > 실행 로그 확인
2. sns_data 시트 상태 확인
3. 필요시 수동 캐시 갱신 실행

---
Google Apps Script 자동 알림
    `.trim();

    try {
      MailApp.sendEmail(ALERT_EMAIL, subject, body);
      Logger.log(`📧 실패 알림 이메일 발송 완료: ${ALERT_EMAIL}`);
    } catch (mailError) {
      Logger.log(`📧 이메일 발송 실패: ${mailError.message}`);
    }

    throw error;
  }
}

/**
 * X(트위터) 남자 캐시 갱신 (트리거: 매일 3:20)
 */
function refreshCacheTwitterMale() {
  const ALERT_EMAIL = 'mr.kimsangmin@gmail.com';
  const functionName = 'X(트위터) 남자 캐시 갱신';

  try {
    Logger.log('Starting Twitter Male cache refresh...');
    refreshCacheBySnsAndGender(['X(트위터)'], ['남자']);
    Logger.log('✅ Twitter Male cache refresh completed successfully');
  } catch (error) {
    Logger.log(`❌ ${functionName} 실패: ${error.message}`);

    const subject = `[SNS 캐시 시스템] ${functionName} 실패 알림`;
    const body = `
===========================================
⚠️ 캐시 갱신 트리거 실패 알림
===========================================

🔴 실패한 작업: ${functionName}
📅 실행 시간: ${new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}
❌ 오류 내용: ${error.message}

📋 스택 트레이스:
${error.stack || '스택 정보 없음'}

🔧 조치 필요 사항:
1. Apps Script 에디터 > 실행 로그 확인
2. sns_data 시트 상태 확인
3. 필요시 수동 캐시 갱신 실행

---
Google Apps Script 자동 알림
    `.trim();

    try {
      MailApp.sendEmail(ALERT_EMAIL, subject, body);
      Logger.log(`📧 실패 알림 이메일 발송 완료: ${ALERT_EMAIL}`);
    } catch (mailError) {
      Logger.log(`📧 이메일 발송 실패: ${mailError.message}`);
    }

    throw error;
  }
}

/**
 * X(트위터) 여자 캐시 갱신 (트리거: 매일 3:25)
 */
function refreshCacheTwitterFemale() {
  const ALERT_EMAIL = 'mr.kimsangmin@gmail.com';
  const functionName = 'X(트위터) 여자 캐시 갱신';

  try {
    Logger.log('Starting Twitter Female cache refresh...');
    refreshCacheBySnsAndGender(['X(트위터)'], ['여자']);
    Logger.log('✅ Twitter Female cache refresh completed successfully');
  } catch (error) {
    Logger.log(`❌ ${functionName} 실패: ${error.message}`);

    const subject = `[SNS 캐시 시스템] ${functionName} 실패 알림`;
    const body = `
===========================================
⚠️ 캐시 갱신 트리거 실패 알림
===========================================

🔴 실패한 작업: ${functionName}
📅 실행 시간: ${new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}
❌ 오류 내용: ${error.message}

📋 스택 트레이스:
${error.stack || '스택 정보 없음'}

🔧 조치 필요 사항:
1. Apps Script 에디터 > 실행 로그 확인
2. sns_data 시트 상태 확인
3. 필요시 수동 캐시 갱신 실행

---
Google Apps Script 자동 알림
    `.trim();

    try {
      MailApp.sendEmail(ALERT_EMAIL, subject, body);
      Logger.log(`📧 실패 알림 이메일 발송 완료: ${ALERT_EMAIL}`);
    } catch (mailError) {
      Logger.log(`📧 이메일 발송 실패: ${mailError.message}`);
    }

    throw error;
  }
}

/**
 * 유튜브 남자 2024 캐시 갱신 (트리거: 매일 3:30)
 */
function refreshCacheYoutubeMale2024() {
  const functionName = '유튜브 남자 2024 캐시 갱신';

  try {
    Logger.log('Starting YouTube Male 2024 cache refresh...');
    refreshCacheBySnsGenderAndYear(['유튜브'], ['남자'], '2024');
    Logger.log('✅ YouTube Male 2024 cache refresh completed successfully');
  } catch (error) {
    sendErrorEmail(functionName, error);
    throw error;
  }
}

/**
 * 유튜브 남자 2025/2026 캐시 갱신 (트리거: 매일 3:32)
 */
function refreshCacheYoutubeMale2025_2026() {
  const functionName = '유튜브 남자 2025/2026 캐시 갱신';

  try {
    Logger.log('Starting YouTube Male 2025/2026 cache refresh...');
    // 2025년 처리
    refreshCacheBySnsGenderAndYear(['유튜브'], ['남자'], '2025');
    // 2026년 처리
    refreshCacheBySnsGenderAndYear(['유튜브'], ['남자'], '2026');
    Logger.log('✅ YouTube Male 2025/2026 cache refresh completed successfully');
  } catch (error) {
    sendErrorEmail(functionName, error);
    throw error;
  }
}

/**
 * 유튜브 여자 2024 캐시 갱신 (트리거: 매일 3:36)
 */
function refreshCacheYoutubeFemale2024() {
  const functionName = '유튜브 여자 2024 캐시 갱신';

  try {
    Logger.log('Starting YouTube Female 2024 cache refresh...');
    refreshCacheBySnsGenderAndYear(['유튜브'], ['여자'], '2024');
    Logger.log('✅ YouTube Female 2024 cache refresh completed successfully');
  } catch (error) {
    sendErrorEmail(functionName, error);
    throw error;
  }
}

/**
 * 유튜브 여자 2025/2026 캐시 갱신 (트리거: 매일 3:34)
 */
function refreshCacheYoutubeFemale2025_2026() {
  const functionName = '유튜브 여자 2025/2026 캐시 갱신';

  try {
    Logger.log('Starting YouTube Female 2025/2026 cache refresh...');
    // 2025년 처리
    refreshCacheBySnsGenderAndYear(['유튜브'], ['여자'], '2025');
    // 2026년 처리
    refreshCacheBySnsGenderAndYear(['유튜브'], ['여자'], '2026');
    Logger.log('✅ YouTube Female 2025/2026 cache refresh completed successfully');
  } catch (error) {
    sendErrorEmail(functionName, error);
    throw error;
  }
}

/**
 * QQ뮤직 남자 캐시 갱신 (트리거: 매일 3:40)
 */
function refreshCacheQQMusicMale() {
  const ALERT_EMAIL = 'mr.kimsangmin@gmail.com';
  const functionName = 'QQ뮤직 남자 캐시 갱신';

  try {
    Logger.log('Starting QQ Music Male cache refresh...');
    refreshCacheBySnsAndGender(['QQ뮤직'], ['남자']);
    Logger.log('✅ QQ Music Male cache refresh completed successfully');
  } catch (error) {
    Logger.log(`❌ ${functionName} 실패: ${error.message}`);

    const subject = `[SNS 캐시 시스템] ${functionName} 실패 알림`;
    const body = `
===========================================
⚠️ 캐시 갱신 트리거 실패 알림
===========================================

🔴 실패한 작업: ${functionName}
📅 실행 시간: ${new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}
❌ 오류 내용: ${error.message}

📋 스택 트레이스:
${error.stack || '스택 정보 없음'}

🔧 조치 필요 사항:
1. Apps Script 에디터 > 실행 로그 확인
2. sns_data 시트 상태 확인
3. 필요시 수동 캐시 갱신 실행

---
Google Apps Script 자동 알림
    `.trim();

    try {
      MailApp.sendEmail(ALERT_EMAIL, subject, body);
      Logger.log(`📧 실패 알림 이메일 발송 완료: ${ALERT_EMAIL}`);
    } catch (mailError) {
      Logger.log(`📧 이메일 발송 실패: ${mailError.message}`);
    }

    throw error;
  }
}

/**
 * QQ뮤직 여자 캐시 갱신 (트리거: 매일 3:45)
 */
function refreshCacheQQMusicFemale() {
  const ALERT_EMAIL = 'mr.kimsangmin@gmail.com';
  const functionName = 'QQ뮤직 여자 캐시 갱신';

  try {
    Logger.log('Starting QQ Music Female cache refresh...');
    refreshCacheBySnsAndGender(['QQ뮤직'], ['여자']);
    Logger.log('✅ QQ Music Female cache refresh completed successfully');
  } catch (error) {
    Logger.log(`❌ ${functionName} 실패: ${error.message}`);

    const subject = `[SNS 캐시 시스템] ${functionName} 실패 알림`;
    const body = `
===========================================
⚠️ 캐시 갱신 트리거 실패 알림
===========================================

🔴 실패한 작업: ${functionName}
📅 실행 시간: ${new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}
❌ 오류 내용: ${error.message}

📋 스택 트레이스:
${error.stack || '스택 정보 없음'}

🔧 조치 필요 사항:
1. Apps Script 에디터 > 실행 로그 확인
2. sns_data 시트 상태 확인
3. 필요시 수동 캐시 갱신 실행

---
Google Apps Script 자동 알림
    `.trim();

    try {
      MailApp.sendEmail(ALERT_EMAIL, subject, body);
      Logger.log(`📧 실패 알림 이메일 발송 완료: ${ALERT_EMAIL}`);
    } catch (mailError) {
      Logger.log(`📧 이메일 발송 실패: ${mailError.message}`);
    }

    throw error;
  }
}

/**
 * 스포티파이 남자 2024 캐시 갱신 (트리거: 매일 3:50)
 */
function refreshCacheSpotifyMale2024() {
  const functionName = '스포티파이 남자 2024 캐시 갱신';

  try {
    Logger.log('Starting Spotify Male 2024 cache refresh...');
    refreshCacheBySnsGenderAndYear(['스포티파이'], ['남자'], '2024');
    Logger.log('✅ Spotify Male 2024 cache refresh completed successfully');
  } catch (error) {
    sendErrorEmail(functionName, error);
    throw error;
  }
}

/**
 * 스포티파이 남자 2025/2026 캐시 갱신 (트리거: 매일 3:52)
 */
function refreshCacheSpotifyMale2025_2026() {
  const functionName = '스포티파이 남자 2025/2026 캐시 갱신';

  try {
    Logger.log('Starting Spotify Male 2025/2026 cache refresh...');
    // 2025년 처리
    refreshCacheBySnsGenderAndYear(['스포티파이'], ['남자'], '2025');
    // 2026년 처리
    refreshCacheBySnsGenderAndYear(['스포티파이'], ['남자'], '2026');
    Logger.log('✅ Spotify Male 2025/2026 cache refresh completed successfully');
  } catch (error) {
    sendErrorEmail(functionName, error);
    throw error;
  }
}

/**
 * 스포티파이 여자 캐시 갱신 (전체 연도 통합, 트리거: 매일 3:54)
 */
function refreshCacheSpotifyFemale() {
  const functionName = '스포티파이 여자 캐시 갱신';

  try {
    Logger.log('Starting Spotify Female cache refresh...');
    refreshCacheBySnsAndGender(['스포티파이'], ['여자']);
    Logger.log('✅ Spotify Female cache refresh completed successfully');
  } catch (error) {
    sendErrorEmail(functionName, error);
    throw error;
  }
}

/**
 * 빌리빌리 남자 캐시 갱신 (트리거: 매일 4:00)
 */
function refreshCacheBilibiliMale() {
  const ALERT_EMAIL = 'mr.kimsangmin@gmail.com';
  const functionName = '빌리빌리 남자 캐시 갱신';

  try {
    Logger.log('Starting Bilibili Male cache refresh...');
    refreshCacheBySnsAndGender(['빌리빌리'], ['남자']);
    Logger.log('✅ Bilibili Male cache refresh completed successfully');
  } catch (error) {
    Logger.log(`❌ ${functionName} 실패: ${error.message}`);

    const subject = `[SNS 캐시 시스템] ${functionName} 실패 알림`;
    const body = `
===========================================
⚠️ 캐시 갱신 트리거 실패 알림
===========================================

🔴 실패한 작업: ${functionName}
📅 실행 시간: ${new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}
❌ 오류 내용: ${error.message}

📋 스택 트레이스:
${error.stack || '스택 정보 없음'}

🔧 조치 필요 사항:
1. Apps Script 에디터 > 실행 로그 확인
2. sns_data 시트 상태 확인
3. 필요시 수동 캐시 갱신 실행

---
Google Apps Script 자동 알림
    `.trim();

    try {
      MailApp.sendEmail(ALERT_EMAIL, subject, body);
      Logger.log(`📧 실패 알림 이메일 발송 완료: ${ALERT_EMAIL}`);
    } catch (mailError) {
      Logger.log(`📧 이메일 발송 실패: ${mailError.message}`);
    }

    throw error;
  }
}

/**
 * 빌리빌리 여자 캐시 갱신 (트리거: 매일 4:05)
 */
function refreshCacheBilibiliFemale() {
  const ALERT_EMAIL = 'mr.kimsangmin@gmail.com';
  const functionName = '빌리빌리 여자 캐시 갱신';

  try {
    Logger.log('Starting Bilibili Female cache refresh...');
    refreshCacheBySnsAndGender(['빌리빌리'], ['여자']);
    Logger.log('✅ Bilibili Female cache refresh completed successfully');
  } catch (error) {
    Logger.log(`❌ ${functionName} 실패: ${error.message}`);

    const subject = `[SNS 캐시 시스템] ${functionName} 실패 알림`;
    const body = `
===========================================
⚠️ 캐시 갱신 트리거 실패 알림
===========================================

🔴 실패한 작업: ${functionName}
📅 실행 시간: ${new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}
❌ 오류 내용: ${error.message}

📋 스택 트레이스:
${error.stack || '스택 정보 없음'}

🔧 조치 필요 사항:
1. Apps Script 에디터 > 실행 로그 확인
2. sns_data 시트 상태 확인
3. 필요시 수동 캐시 갱신 실행

---
Google Apps Script 자동 알림
    `.trim();

    try {
      MailApp.sendEmail(ALERT_EMAIL, subject, body);
      Logger.log(`📧 실패 알림 이메일 발송 완료: ${ALERT_EMAIL}`);
    } catch (mailError) {
      Logger.log(`📧 이메일 발송 실패: ${mailError.message}`);
    }

    throw error;
  }
}






/**
 * 모든 SNS 캐시 갱신 (수동 실행용)
 * 주의: 6분 실행 제한으로 실패할 수 있음
 */
function refreshCacheAll() {
  Logger.log('Starting ALL SNS cache refresh...');
  refreshCacheBySns([
    '웨이보',
    '차오화',
    'X(트위터)',
    '유튜브',
    'QQ뮤직',
    '스포티파이',
    '빌리빌리'
  ]);
}

/**
 * 전체 캐시 순차 갱신 (수동 실행용, 안전)
 * 14개 성별+SNS를 하나씩 순차 실행
 * 주의: 전체 실행 시간 약 42분 (14개 × 3분)
 */
function refreshCacheAllSequential() {
  Logger.log('🚀 Starting sequential cache refresh for all gender+SNS combinations...');

  const functions = [
    { name: 'refreshCacheWeiboMale', label: '웨이보 남' },
    { name: 'refreshCacheWeiboFemale', label: '웨이보 여' },
    { name: 'refreshCacheChaouaMale', label: '차오화 남' },
    { name: 'refreshCacheChaouaFemale', label: '차오화 여' },
    { name: 'refreshCacheTwitterMale', label: 'X(트위터) 남' },
    { name: 'refreshCacheTwitterFemale', label: 'X(트위터) 여' },
    { name: 'refreshCacheYoutubeMale', label: '유튜브 남' },
    { name: 'refreshCacheYoutubeFemale', label: '유튜브 여' },
    { name: 'refreshCacheQQMusicMale', label: 'QQ뮤직 남' },
    { name: 'refreshCacheQQMusicFemale', label: 'QQ뮤직 여' },
    { name: 'refreshCacheSpotifyMale', label: '스포티파이 남' },
    { name: 'refreshCacheSpotifyFemale', label: '스포티파이 여' },
    { name: 'refreshCacheBilibiliMale', label: '빌리빌리 남' },
    { name: 'refreshCacheBilibiliFemale', label: '빌리빌리 여' }
  ];

  let successCount = 0;
  let failCount = 0;

  functions.forEach((func, index) => {
    try {
      Logger.log(`[${index + 1}/14] ${func.label} 캐싱 시작...`);

      // 함수 동적 호출
      if (typeof this[func.name] === 'function') {
        this[func.name]();
        successCount++;
        Logger.log(`✅ [${index + 1}/14] ${func.label} 완료`);
      } else {
        Logger.log(`⚠️ [${index + 1}/14] ${func.name} 함수를 찾을 수 없습니다`);
        failCount++;
      }
    } catch (e) {
      Logger.log(`❌ [${index + 1}/14] ${func.label} 실패: ${e.message}`);
      failCount++;
    }
  });

  Logger.log('');
  Logger.log('📊 순차 캐싱 완료');
  Logger.log(`✅ 성공: ${successCount}개`);
  Logger.log(`❌ 실패: ${failCount}개`);
}

/**
 * 캐시 워밍업 자동 트리거 설정 (성별+SNS별 분할)
 * 14개 성별+SNS 트리거를 10분 간격으로 실행하여 실행 시간 제한 회피
 */
function setupCacheWarmupTrigger() {
  const ui = SpreadsheetApp.getUi();

  try {
    // 기존 캐시 관련 트리거 모두 삭제 (중복 방지)
    const triggers = ScriptApp.getProjectTriggers();
    const cacheRelatedFunctions = [
      'refreshCacheDaily',
      'refreshCacheWeibo', 'refreshCacheWeiboMale', 'refreshCacheWeiboFemale',
      'refreshCacheChaohua', 'refreshCacheChaouaMale', 'refreshCacheChaouaFemale',
      'refreshCacheTwitter', 'refreshCacheTwitterMale', 'refreshCacheTwitterFemale',
      'refreshCacheInstagram',
      'refreshCacheYoutube', 'refreshCacheYoutubeMale', 'refreshCacheYoutubeFemale',
      'refreshCacheQQMusic', 'refreshCacheQQMusicMale', 'refreshCacheQQMusicFemale',
      'refreshCacheSpotify', 'refreshCacheSpotifyMale', 'refreshCacheSpotifyFemale',
      'refreshCacheBilibili', 'refreshCacheBilibiliMale', 'refreshCacheBilibiliFemale'
    ];

    triggers.forEach(trigger => {
      if (cacheRelatedFunctions.includes(trigger.getHandlerFunction())) {
        ScriptApp.deleteTrigger(trigger);
        Logger.log(`Deleted existing trigger: ${trigger.getHandlerFunction()}`);
      }
    });

    // 14개 성별+SNS별 트리거 생성


    const triggerConfigs = [
      { func: 'refreshCacheWeiboMale', hour: 3, minute: 0, label: '웨이보 남' },
      { func: 'refreshCacheWeiboFemale', hour: 3, minute: 5, label: '웨이보 여' },
      { func: 'refreshCacheChaouaMale', hour: 3, minute: 10, label: '차오화 남' },
      { func: 'refreshCacheChaouaFemale', hour: 3, minute: 15, label: '차오화 여' },
      { func: 'refreshCacheTwitterMale', hour: 3, minute: 20, label: 'X(트위터) 남' },
      { func: 'refreshCacheTwitterFemale', hour: 3, minute: 25, label: 'X(트위터) 여' },

      // 유튜브 연도별 분할
      { func: 'refreshCacheYoutubeMale2024', hour: 3, minute: 30, label: '유튜브 남 2024' },
      { func: 'refreshCacheYoutubeMale2025', hour: 3, minute: 32, label: '유튜브 남 2025' },
      { func: 'refreshCacheYoutubeMale2026', hour: 3, minute: 34, label: '유튜브 남 2026' },
      { func: 'refreshCacheYoutubeFemale2024', hour: 3, minute: 36, label: '유튜브 여 2024' },
      { func: 'refreshCacheYoutubeFemale2025', hour: 3, minute: 38, label: '유튜브 여 2025' },
      { func: 'refreshCacheYoutubeFemale2026', hour: 3, minute: 40, label: '유튜브 여 2026' },

      { func: 'refreshCacheQQMusicMale', hour: 3, minute: 42, label: 'QQ뮤직 남' },
      { func: 'refreshCacheQQMusicFemale', hour: 3, minute: 45, label: 'QQ뮤직 여' },

      // 스포티파이 연도별 분할
      { func: 'refreshCacheSpotifyMale2024', hour: 3, minute: 50, label: '스포티파이 남 2024' },
      { func: 'refreshCacheSpotifyMale2025', hour: 3, minute: 52, label: '스포티파이 남 2025' },
      { func: 'refreshCacheSpotifyMale2026', hour: 3, minute: 54, label: '스포티파이 남 2026' },
      { func: 'refreshCacheSpotifyFemale2024', hour: 3, minute: 56, label: '스포티파이 여 2024' },
      { func: 'refreshCacheSpotifyFemale2025', hour: 3, minute: 58, label: '스포티파이 여 2025' },
      { func: 'refreshCacheSpotifyFemale2026', hour: 4, minute: 0, label: '스포티파이 여 2026' },

      { func: 'refreshCacheBilibiliMale', hour: 4, minute: 2, label: '빌리빌리 남' },
      { func: 'refreshCacheBilibiliFemale', hour: 4, minute: 5, label: '빌리빌리 여' }
    ];



    triggerConfigs.forEach(config => {
      ScriptApp.newTrigger(config.func)
        .timeBased()
        .atHour(config.hour)
        .nearMinute(config.minute)
        .everyDays(1)
        .create();

      Logger.log(`✅ Created trigger: ${config.label} at ${config.hour}:${String(config.minute).padStart(2, '0')}`);
    });

    Logger.log('✅ All 17 cache warmup triggers created');



    ui.alert(
      '✅ 트리거 설정 완료',
      '14개 성별+SNS별 캐시 갱신 트리거가 생성되었습니다:\\n\\n' +
      '• 3:00/3:05: 웨이보 남/여\\n' +
      '• 3:10/3:15: 차오화 남/여\\n' +
      '• 3:20/3:25: X(트위터) 남/여\\n' +
      '• 3:30/3:35: 유튜브 남/여\\n' +
      '• 3:40/3:45: QQ뮤직 남/여\\n' +
      '• 3:50/3:55: 스포티파이 남/여\\n' +
      '• 4:00/4:05: 빌리빌리 남/여\\n\\n' +
      '(5분 간격으로 분산 실행)\\n\\n' +
      '확인 방법:\\n' +
      'Apps Script 에디터 > 왼쪽 메뉴 > ⏰ 트리거',
      ui.ButtonSet.OK
    );





  } catch (e) {
    Logger.log(`Error setting up trigger: ${e.message}`);
    ui.alert('오류', `트리거 설정 실패: ${e.message}`, ui.ButtonSet.OK);
  }
}

/**
 * 캐시 워밍업 초기 설정 (원클릭)
 * 1. 즉시 캐시 생성
 * 2. 자동 트리거 설정
 */
function setupCacheWarmup() {
  const ui = SpreadsheetApp.getUi();

  const response = ui.alert(
    '🚀 캐시 워밍업 초기 설정',
    '다음 작업이 진행됩니다:\n\n' +
    '1. 즉시 캐시 생성 (전체 SNS, 약 5-6분 소요)\n' +
    '2. SNS별 자동 갱신 트리거 설정 (8개)\n' +
    '   - 3:00~4:10 사이 10분 간격\n\n' +
    '계속하시겠습니까?',
    ui.ButtonSet.YES_NO
  );

  if (response !== ui.Button.YES) {
    ui.alert('취소됨', '설정이 취소되었습니다.', ui.ButtonSet.OK);
    return;
  }

  try {
    // 1. 즉시 캐시 생성
    ui.alert(
      '진행 중',
      '전체 SNS 캐시를 생성하고 있습니다.\\n잠시만 기다려주세요...\\n(약 5-6분 소요)',
      ui.ButtonSet.OK
    );

    refreshCacheManually();

    // 2. 자동 트리거 설정
    setupCacheWarmupTrigger();

    Logger.log('✅ Cache warmup setup complete');
  } catch (e) {
    Logger.log(`Error in setupCacheWarmup: ${e.message}`);
    ui.alert('오류', `설정 중 오류 발생: ${e.message}`, ui.ButtonSet.OK);
  }
}

// ========================================
// ✨ 중복 관리 시스템
// ========================================

function checkDuplicates() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('sns_data');
  if (!sheet) {
    SpreadsheetApp.getUi().alert('오류', 'sns_data 시트를 찾을 수 없습니다.', SpreadsheetApp.getUi().ButtonSet.OK);
    return;
  }

  const duplicateInfo = findDuplicatesDetailed(sheet);

  if (duplicateInfo.length === 0) {
    SpreadsheetApp.getUi().alert('✅ 중복 없음', 'sns_data 시트에 중복 데이터가 없습니다.', SpreadsheetApp.getUi().ButtonSet.OK);
    return;
  }

  let message = `⚠️ 총 ${duplicateInfo.length}개의 중복 데이터가 발견되었습니다.\\n\\n`;
  message += '=== 중복 항목 (최대 15개) ===\\n\\n';

  duplicateInfo.slice(0, 15).forEach((item, idx) => {
    message += `${idx + 1}. ${item.name} (${item.group})\\n`;
    message += `   SNS: ${item.sns} | 날짜: ${item.date}\\n`;
    message += `   중복 수: ${item.duplicateCount}개\\n`;
    message += `   값 범위: ${item.minValue.toLocaleString()} ~ ${item.maxValue.toLocaleString()}\\n\\n`;
  });

  if (duplicateInfo.length > 15) {
    message += `... 외 ${duplicateInfo.length - 15}개 항목\\n\\n`;
  }

  message += '━━━━━━━━━━━━━━━━━━━━\\n💡 중복 제거: 📊 데이터 관리 > 🧹 중복 데이터 제거';

  SpreadsheetApp.getUi().alert('🔍 중복 항목 발견', message, SpreadsheetApp.getUi().ButtonSet.OK);
}

function removeDuplicatesManual() {
  const ui = SpreadsheetApp.getUi();
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('sns_data');

  if (!sheet) {
    ui.alert('오류', 'sns_data 시트를 찾을 수 없습니다.', ui.ButtonSet.OK);
    return;
  }

  const beforeCount = sheet.getLastRow() - 1;
  const duplicateInfo = findDuplicatesDetailed(sheet);

  if (duplicateInfo.length === 0) {
    ui.alert('✅ 중복 없음', '중복 데이터가 없습니다.', ui.ButtonSet.OK);
    return;
  }

  let confirmMsg = `⚠️ 중복 데이터 제거를 시작합니다.\\n\\n📊 현재: ${beforeCount.toLocaleString()}개\\n🔧 중복: ${duplicateInfo.length}개\\n\\n계속하시겠습니까?`;

  const response1 = ui.alert('🧹 중복 제거 확인', confirmMsg, ui.ButtonSet.YES_NO);
  if (response1 !== ui.Button.YES) {
    ui.alert('취소됨', '중복 제거가 취소되었습니다.', ui.ButtonSet.OK);
    return;
  }

  try {
    const backupSheet = createBackup(sheet);
    const response2 = ui.alert('⚠️ 최종 확인', `백업: ${backupSheet.getName()}\\n\\n정말 삭제하시겠습니까?`, ui.ButtonSet.YES_NO);

    if (response2 !== ui.Button.YES) {
      SpreadsheetApp.getActiveSpreadsheet().deleteSheet(backupSheet);
      ui.alert('취소됨', '백업 시트도 삭제되었습니다.', ui.ButtonSet.OK);
      return;
    }
  } catch (e) {
    ui.alert('오류', `백업 실패: ${e.message}`, ui.ButtonSet.OK);
    return;
  }

  const removeResult = removeDuplicates(sheet);
  if (!removeResult) {
    ui.alert('오류', '중복 제거 실행 중 오류 발생', ui.ButtonSet.OK);
    return;
  }

  const afterCount = sheet.getLastRow() - 1;
  const removed = beforeCount - afterCount;

  ui.alert('✅ 완료', `제거 전: ${beforeCount}개\\n제거 후: ${afterCount}개\\n삭제됨: ${removed}개`, ui.ButtonSet.OK);
}

function createBackup(sheet) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const timestamp = Utilities.formatDate(new Date(), "GMT+9", "yyyyMMdd_HHmmss");
  const backupName = `sns_data_backup_${timestamp}`;

  const existingBackup = ss.getSheetByName(backupName);
  if (existingBackup) ss.deleteSheet(existingBackup);

  const backup = sheet.copyTo(ss);
  backup.setName(backupName);
  ss.moveActiveSheet(ss.getSheets().length);

  Logger.log(`Backup: ${backupName}`);
  return backup;
}

function findDuplicatesDetailed(sheet) {
  if (!sheet) {
    sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("sns_data");
    if (!sheet) return [];
  }

  const data = sheet.getDataRange().getValues();
  if (!data || data.length <= 1) return [];

  const headers = data[0];
  const nameIdx = headers.indexOf("name");
  const groupIdx = headers.indexOf("group");
  const snsIdx = headers.indexOf("sns");
  const dateIdx = headers.indexOf("date");
  const countIdx = headers.indexOf("count");

  if (nameIdx === -1 || snsIdx === -1 || dateIdx === -1 || countIdx === -1) return [];

  const seen = {};
  const duplicates = [];

  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const key = `${row[nameIdx]}_${row[snsIdx]}_${row[dateIdx]}`;

    const parseNumber = (val) => {
      if (!val) return 0;
      const num = Number(String(val).replace(/,/g, ''));
      return isNaN(num) ? 0 : num;
    };

    const currentValue = parseNumber(row[countIdx]);

    if (seen[key]) {
      seen[key].duplicateCount++;
      seen[key].rows.push(i + 1);
      if (currentValue < seen[key].minValue) seen[key].minValue = currentValue;
      if (currentValue > seen[key].maxValue) seen[key].maxValue = currentValue;
    } else {
      seen[key] = {
        name: row[nameIdx],
        group: groupIdx !== -1 ? row[groupIdx] : "",
        sns: row[snsIdx],
        date: row[dateIdx],
        duplicateCount: 1,
        rows: [i + 1],
        minValue: currentValue,
        maxValue: currentValue
      };
    }
  }

  for (const key in seen) {
    if (seen[key].duplicateCount > 1) {
      duplicates.push(seen[key]);
    }
  }

  return duplicates;
}

function removeDuplicates(sheet) {
  if (!sheet) sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('sns_data');
  if (!sheet) return null;

  const data = sheet.getDataRange().getValues();
  if (data.length <= 1) return null;

  const header = data.shift();
  const seen = new Set();
  const unique = [];

  data.forEach(row => {
    const key = `${row[0]}_${row[3]}_${row[4]}`;
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(row);
    }
  });

  if (data.length === unique.length) return null;

  sheet.clear();
  sheet.getRange(1, 1, 1, header.length).setValues([header]);
  if (unique.length > 0) {
    sheet.getRange(2, 1, unique.length, header.length).setValues(unique);
  }

  return {
    removed: data.length - unique.length,
    backupName: sheet.getName() + "_backup_" + Utilities.formatDate(new Date(), "GMT+9", "yyyyMMdd")
  };
}

function validateData() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('sns_data');
  if (!sheet) {
    SpreadsheetApp.getUi().alert('오류', 'sns_data 시트를 찾을 수 없습니다.', SpreadsheetApp.getUi().ButtonSet.OK);
    return;
  }

  const data = sheet.getDataRange().getValues();
  if (data.length <= 1) {
    SpreadsheetApp.getUi().alert('알림', 'sns_data 시트에 데이터가 없습니다.', SpreadsheetApp.getUi().ButtonSet.OK);
    return;
  }

  data.shift();

  const stats = {
    total: data.length,
    months: [...new Set(data.map(r => r[4]))].length,
    idols: [...new Set(data.map(r => r[0]))].length,
    duplicates: 0,
    anomalies: 0
  };

  const seen = new Set();
  data.forEach(row => {
    const key = `${row[0]}_${row[3]}_${row[4]}`;
    if (seen.has(key)) stats.duplicates++;
    seen.add(key);
    if (row[5] > 100000000) stats.anomalies++;
  });

  const alertMsg =
    `📊 데이터 검증 결과\\n\\n` +
    `총 데이터: ${stats.total.toLocaleString()}개\\n` +
    `아이돌 수: ${stats.idols}명\\n` +
    `데이터 월: ${stats.months}개월\\n` +
    `중복 데이터: ${stats.duplicates}개 ${stats.duplicates > 0 ? '⚠️' : '✅'}\\n` +
    `이상치: ${stats.anomalies}개 ${stats.anomalies > 0 ? '⚠️' : '✅'}`;

  SpreadsheetApp.getUi().alert('데이터 검증 결과', alertMsg, SpreadsheetApp.getUi().ButtonSet.OK);
}

// ========================================
// 🐛 디버깅 함수
// ========================================

function debugSheetData() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('sns_data');
  if (!sheet) {
    Logger.log('❌ sns_data 시트를 찾을 수 없습니다.');
    return;
  }

  const data = sheet.getDataRange().getValues();
  Logger.log('=== Sheet Data Debug ===');
  Logger.log(`총 행 수: ${data.length}`);
  Logger.log('헤더: ' + JSON.stringify(data[0]));

  // 처음 5행 샘플 (헤더 제외)
  Logger.log('\n=== 데이터 샘플 (처음 5행) ===');
  for (let i = 1; i <= Math.min(5, data.length - 1); i++) {
    Logger.log(`Row ${i}: name="${data[i][0]}", group="${data[i][1]}", gender="${data[i][2]}", sns="${data[i][3]}", date="${data[i][4]}", count="${data[i][5]}"`);
  }

  // 유니크 값 확인
  const genders = [...new Set(data.slice(1).map(r => r[2]))];
  const snsList = [...new Set(data.slice(1).map(r => r[3]))];

  Logger.log('\n=== 유니크 값 ===');
  Logger.log('Unique genders: ' + JSON.stringify(genders));
  Logger.log('Unique sns: ' + JSON.stringify(snsList));

  // 남자 + 웨이보 데이터 확인
  Logger.log('\n=== 남자 + 웨이보 데이터 확인 ===');
  const maleWeibo = data.slice(1).filter(r => r[2] === '남자' && r[3] === '웨이보');
  Logger.log(`남자 + 웨이보 데이터 수: ${maleWeibo.length}`);
  if (maleWeibo.length > 0) {
    Logger.log('샘플:');
    maleWeibo.slice(0, 3).forEach((row, idx) => {
      Logger.log(`  ${idx + 1}. ${row[0]} (${row[1]}) - ${row[4]}: ${row[5]}`);
    });
  }

  SpreadsheetApp.getUi().alert('디버깅 완료', '실행 로그를 확인하세요:\n\n도구 > 스크립트 편집기 > 실행 로그', SpreadsheetApp.getUi().ButtonSet.OK);
}

/**
 * 특정 아이돌의 메타데이터 조회
 * @param {string} name - 아이돌 이름
 * @param {string} gender - 성별 ("여자" 또는 "남자")
 * @returns {object} { status, data/message }
 */
function getIdolMetadata(name, gender) {
  try {
    // gender에 따라 시트 선택
    const sheetKey = gender === "여자" ? 'SNS_DATA_GIRLBAND' : 'SNS_DATA_BOYBAND';
    const sheetId = SHEET_IDS[sheetKey];

    if (!sheetId) {
      return { status: 'error', message: `시트 ID를 찾을 수 없습니다: ${sheetKey}` };
    }

    // 외부 스프레드시트 열기
    const parentSheet = SpreadsheetApp.openById(sheetId);
    const metaSheet = parentSheet.getSheetByName("idol_metadata");

    if (!metaSheet) {
      return { status: 'error', message: `idol_metadata 시트를 찾을 수 없습니다 (${sheetKey})` };
    }

    const data = metaSheet.getDataRange().getValues();

    if (data.length < 2) {
      return { status: 'error', message: 'idol_metadata 시트에 데이터가 없습니다' };
    }

    const headers = data[0];

    // name과 gender가 일치하는 행 찾기
    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      const rowName = String(row[0]).trim();
      const rowGender = String(row[2]).trim();

      if (rowName === name && rowGender === gender) {
        // 객체로 변환
        const metadata = {};
        headers.forEach((h, idx) => {
          metadata[h] = row[idx] || "";
        });

        Logger.log(`Metadata found for ${name} (${gender})`);
        return { status: 'success', data: metadata };
      }
    }

    return { status: 'error', message: `'${name}' 아이돌을 찾을 수 없습니다` };

  } catch (error) {
    Logger.log(`Error in getIdolMetadata: ${error.message}`);
    return { status: 'error', message: error.message };
  }
}

/**
 * 특정 성별의 전체 아이돌 메타데이터 조회 (프리페칭용)
 * @param {string} gender - 성별 ("여자" 또는 "남자")
 * @returns {object} { status, data: [{name, ...}, ...] }
 */
function getAllIdolMetadata(gender) {
  try {
    const cache = CacheService.getScriptCache();
    const cacheKey = `all_metadata_${gender}`;
    const cached = cache.get(cacheKey);

    if (cached) {
      Logger.log(`Metadata Cache HIT: ${cacheKey}`);
      return { status: 'success', data: JSON.parse(cached) };
    }

    const sheetKey = gender === "여자" ? 'SNS_DATA_GIRLBAND' : 'SNS_DATA_BOYBAND';
    const sheetId = SHEET_IDS[sheetKey];

    if (!sheetId) {
      return { status: 'error', message: `시트 ID를 찾을 수 없습니다: ${sheetKey}` };
    }

    const parentSheet = SpreadsheetApp.openById(sheetId);
    const metaSheet = parentSheet.getSheetByName("idol_metadata");

    if (!metaSheet) {
      return { status: 'error', message: `idol_metadata 시트를 찾을 수 없습니다 (${sheetKey})` };
    }

    const data = metaSheet.getDataRange().getValues();

    if (data.length < 2) {
      return { status: 'success', data: [] }; // 빈 배열 반환
    }

    const headers = data[0];
    const metadataList = [];

    // 모든 행을 객체로 변환
    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      const rowGender = String(row[2]).trim();

      // 해당 성별만 필터링
      if (rowGender === gender) {
        const metadata = {};
        headers.forEach((h, idx) => {
          metadata[h] = row[idx] || "";
        });
        metadataList.push(metadata);
      }
    }

    // 캐싱 (6시간)
    try {
      cache.put(cacheKey, JSON.stringify(metadataList), 21600);
      Logger.log(`Metadata Cache PUT: ${cacheKey} (${metadataList.length} items)`);
    } catch (e) {
      Logger.log(`Metadata Cache PUT Failed: ${e.message}`);
    }

    return { status: 'success', data: metadataList };

  } catch (error) {
    Logger.log(`Error in getAllIdolMetadata: ${error.message}`);
    return { status: 'error', message: error.message };
  }
}

// ========================================
// 📦 아카이브 데이터 JSON 생성 (과거 데이터 정적 파일화)
// ========================================

/**
 * 특정 성별의 과거 데이터(~2025-12) 아카이브 JSON 생성
 * Apps Script 에디터에서 직접 실행 → 로그에서 JSON 확인 (이메일 발송 권장)
 * @param {string} targetGender - '남자' 또는 '여자'
 * @returns {Object} 아카이브 데이터 객체 (SNS별 그룹핑)
 */
function generateArchiveJSON(targetGender) {
  const ARCHIVE_CUTOFF = '2025-12'; // 이 월까지 아카이브 대상
  const snsList = ['웨이보', '차오화', '빌리빌리', 'QQ뮤직', 'X(트위터)', '유튜브', '스포티파이'];

  // 시트 데이터 1회만 읽기 (성능 최적화)
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('sns_data');
  if (!sheet) throw new Error('sns_data 시트를 찾을 수 없습니다.');

  const allData = sheet.getDataRange().getValues();
  allData.shift(); // 헤더 제거

  // 날짜 포맷 캐시 (중복 변환 방지)
  const dateFormatCache = new Map();
  const formatDate = (d) => {
    const key = String(d);
    if (dateFormatCache.has(key)) return dateFormatCache.get(key);

    let result = '';
    if (!d) {
      result = '';
    } else if (Object.prototype.toString.call(d) === '[object Date]') {
      result = Utilities.formatDate(d, 'GMT+9', 'yyyy-MM');
    } else {
      const match = String(d).match(/(\d{4})[\.\/\-](\d{1,2})/);
      if (match) result = `${match[1]}-${match[2].padStart(2, '0')}`;
      else result = String(d).length >= 7 ? String(d).substring(0, 7) : String(d);
    }

    dateFormatCache.set(key, result);
    return result;
  };

  const parseNumber = (val) => {
    if (!val) return 0;
    const num = Number(String(val).replace(/,/g, ''));
    return isNaN(num) ? 0 : num;
  };

  // 해당 성별 데이터만 필터링
  const genderData = allData.filter(r => r[2] === targetGender);

  // SNS별 그룹핑 + 아카이브 범위 필터링
  const archiveData = {};

  snsList.forEach(sns => {
    const snsRecords = [];
    const monthsSet = new Set();

    genderData
      .filter(r => r[3] === sns)
      .forEach(r => {
        const date = formatDate(r[4]);
        // 아카이브 커트오프(2025-12) 이하 데이터만 포함
        if (date && date.match(/^\d{4}-\d{2}$/) && date <= ARCHIVE_CUTOFF) {
          monthsSet.add(date);
          snsRecords.push({
            name: r[0],
            group: r[1],
            date: date,
            count: parseNumber(r[5])
          });
        }
      });

    archiveData[sns] = {
      months: [...monthsSet].sort(), // 월 목록 (오름차순)
      records: snsRecords             // 전체 레코드
    };
  });

  const result = {
    generated: new Date().toISOString(),
    archiveCutoff: ARCHIVE_CUTOFF,
    gender: targetGender,
    data: archiveData
  };

  // 통계 로그 출력
  let totalRecords = 0;
  Logger.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  Logger.log(`📦 아카이브 JSON 생성 완료 (${targetGender})`);
  Logger.log(`📅 아카이브 범위: ~${ARCHIVE_CUTOFF}`);
  Object.entries(archiveData).forEach(([sns, data]) => {
    totalRecords += data.records.length;
    Logger.log(`  ${sns}: ${data.months.length}개월, ${data.records.length}개 레코드`);
  });
  Logger.log(`📊 총 레코드: ${totalRecords}개`);
  Logger.log(`📏 JSON 크기: ${JSON.stringify(result).length.toLocaleString()} bytes`);
  Logger.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  return result;
}

/**
 * 남자/여자 아카이브 JSON을 이메일로 발송 (첨부 파일)
 * Logger에 출력하면 잘리므로 이메일 첨부로 전송
 * 실행: Apps Script 에디터에서 emailArchiveJSONs 선택 후 실행
 */
function emailArchiveJSONs() {
  const maleArchive = generateArchiveJSON('남자');
  const femaleArchive = generateArchiveJSON('여자');

  const maleJson = JSON.stringify(maleArchive, null, 2);
  const femaleJson = JSON.stringify(femaleArchive, null, 2);

  // JSON 파일을 이메일 첨부로 발송
  MailApp.sendEmail({
    to: 'mr.kimsangmin@gmail.com',
    subject: '[KPOP SNS] 아카이브 데이터 JSON 생성 완료',
    body: `아카이브 데이터 JSON이 생성되었습니다.\n\n` +
      `첨부된 JSON 파일을 data/ 폴더에 저장하세요:\n` +
      `- archive-male.json (${maleJson.length.toLocaleString()} bytes)\n` +
      `- archive-female.json (${femaleJson.length.toLocaleString()} bytes)\n\n` +
      `아카이브 범위: ~${maleArchive.archiveCutoff}\n` +
      `생성 시간: ${new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}\n\n` +
      `GitHub 저장소에서 data/ 폴더에 업로드 해주세요:\n` +
      `https://github.com/mrkimsangmin-gif/idol-sns-app/`,
    attachments: [
      Utilities.newBlob(maleJson, 'application/json', 'archive-male.json'),
      Utilities.newBlob(femaleJson, 'application/json', 'archive-female.json')
    ]
  });

  Logger.log('✅ 아카이브 JSON 이메일 발송 완료');
  Logger.log(`  남자: ${maleJson.length.toLocaleString()} bytes`);
  Logger.log(`  여자: ${femaleJson.length.toLocaleString()} bytes`);
}

function onOpen() {
  const ui = SpreadsheetApp.getUi();
  ui.createMenu('📊 데이터 관리')
    .addItem('✅ 데이터 검증', 'validateData')
    .addItem('🔍 중복 항목 확인만', 'checkDuplicates')
    .addItem('🧹 중복 데이터 제거', 'removeDuplicatesManual')
    .addSeparator()
    .addItem('🔄 캐시 갱신', 'refreshCacheManually')
    .addItem('🚀 캐시 워밍업 설정', 'setupCacheWarmup')  // 캐시 워밍업 원클릭 설정
    .addItem('🐛 디버그 데이터 확인', 'debugSheetData')
    .addToUi();
}

// ========================================
// 🔧 UI 없는 실행 함수 (Apps Script 에디터용)
// ========================================

/**
 * UI 없이 캐시 워밍업 설정 (Apps Script 에디터에서 직접 실행용)
 * Google Sheets 메뉴가 표시되지 않을 때 사용
 */
function setupCacheWarmupNoUI() {
  Logger.log('🚀 캐시 워밍업 설정 시작...');

  try {
    // 17개 트리거 설정 (연도별 최적화)
    Logger.log('Step 1: 트리거 설정 중...');
    setupCacheWarmupTriggerNoUI();

    Logger.log('✅ 완료! 트리거 메뉴에서 17개 트리거를 확인하세요.');
    Logger.log('📋 트리거 목록 (성별+SNS+연도):');
    Logger.log('  - 3:00/3:05: 웨이보 남/여');
    Logger.log('  - 3:10/3:15: 차오화 남/여');
    Logger.log('  - 3:20/3:25: X(트위터) 남/여');
    Logger.log('  - 3:30~3:36: 유튜브 남/여 (2024, 2025+2026)');
    Logger.log('  - 3:40/3:43: QQ뮤직 남/여');
    Logger.log('  - 3:48~3:56: 스포티파이 (남 2024, 남 2025+2026, 여)');
    Logger.log('  - 4:00/4:03: 빌리빌리 남/여');
    Logger.log('');
    Logger.log('💡 다음 단계:');
    Logger.log('1. Apps Script 에디터 > 왼쪽 메뉴 > ⏰ 트리거 메뉴 확인');
    Logger.log('2. 개별 함수 테스트 (예: refreshCacheYoutubeMale2024 - 2분 이내 완료)');
  } catch (e) {
    Logger.log(`❌ 오류: ${e.message}`);
  }
}

/**
 * UI 없는 트리거 설정 함수 (17개 연도별 트리거, 20개 제한 준수)
 */
function setupCacheWarmupTriggerNoUI() {
  // 기존 캐시 관련 트리거 모두 삭제
  const triggers = ScriptApp.getProjectTriggers();
  const cacheRelatedFunctions = [
    'refreshCacheDaily',
    'refreshCacheWeibo', 'refreshCacheWeiboMale', 'refreshCacheWeiboFemale',
    'refreshCacheChaohua', 'refreshCacheChaouaMale', 'refreshCacheChaouaFemale',
    'refreshCacheTwitter', 'refreshCacheTwitterMale', 'refreshCacheTwitterFemale',
    'refreshCacheInstagram',
    'refreshCacheYoutube', 'refreshCacheYoutubeMale', 'refreshCacheYoutubeFemale',
    'refreshCacheYoutubeMale2024', 'refreshCacheYoutubeMale2025', 'refreshCacheYoutubeMale2026', 'refreshCacheYoutubeMale2025_2026',
    'refreshCacheYoutubeFemale2024', 'refreshCacheYoutubeFemale2025', 'refreshCacheYoutubeFemale2026', 'refreshCacheYoutubeFemale2025_2026',
    'refreshCacheQQMusic', 'refreshCacheQQMusicMale', 'refreshCacheQQMusicFemale',
    'refreshCacheSpotify', 'refreshCacheSpotifyMale', 'refreshCacheSpotifyFemale',
    'refreshCacheSpotifyMale2024', 'refreshCacheSpotifyMale2025', 'refreshCacheSpotifyMale2026', 'refreshCacheSpotifyMale2025_2026',
    'refreshCacheSpotifyFemale2024', 'refreshCacheSpotifyFemale2025', 'refreshCacheSpotifyFemale2026',
    'refreshCacheBilibili', 'refreshCacheBilibiliMale', 'refreshCacheBilibiliFemale'
  ];

  triggers.forEach(trigger => {
    if (cacheRelatedFunctions.includes(trigger.getHandlerFunction())) {
      ScriptApp.deleteTrigger(trigger);
      Logger.log(`🗑️ 기존 트리거 삭제: ${trigger.getHandlerFunction()}`);
    }
  });

  // 24개 연도별 트리거 생성
  const triggerConfigs = [
    { func: 'refreshCacheWeiboMale', hour: 3, minute: 0, label: '웨이보 남' },
    { func: 'refreshCacheWeiboFemale', hour: 3, minute: 5, label: '웨이보 여' },
    { func: 'refreshCacheChaouaMale', hour: 3, minute: 10, label: '차오화 남' },
    { func: 'refreshCacheChaouaFemale', hour: 3, minute: 15, label: '차오화 여' },
    { func: 'refreshCacheTwitterMale', hour: 3, minute: 20, label: 'X(트위터) 남' },
    { func: 'refreshCacheTwitterFemale', hour: 3, minute: 25, label: 'X(트위터) 여' },

    // 유튜브: 2024, 2025+2026 분할
    { func: 'refreshCacheYoutubeMale2024', hour: 3, minute: 30, label: '유튜브 남 2024' },
    { func: 'refreshCacheYoutubeMale2025_2026', hour: 3, minute: 32, label: '유튜브 남 2025+2026' },
    { func: 'refreshCacheYoutubeFemale2024', hour: 3, minute: 34, label: '유튜브 여 2024' },
    { func: 'refreshCacheYoutubeFemale2025_2026', hour: 3, minute: 36, label: '유튜브 여 2025+2026' },

    { func: 'refreshCacheQQMusicMale', hour: 3, minute: 40, label: 'QQ뮤직 남' },
    { func: 'refreshCacheQQMusicFemale', hour: 3, minute: 43, label: 'QQ뮤직 여' },

    // 스포티파이: 남자만 연도별, 여자는 통합
    { func: 'refreshCacheSpotifyMale2024', hour: 3, minute: 48, label: '스포티파이 남 2024' },
    { func: 'refreshCacheSpotifyMale2025_2026', hour: 3, minute: 52, label: '스포티파이 남 2025+2026' },
    { func: 'refreshCacheSpotifyFemale', hour: 3, minute: 56, label: '스포티파이 여' },

    { func: 'refreshCacheBilibiliMale', hour: 4, minute: 0, label: '빌리빌리 남' },
    { func: 'refreshCacheBilibiliFemale', hour: 4, minute: 3, label: '빌리빌리 여' }
  ];





  triggerConfigs.forEach(config => {
    ScriptApp.newTrigger(config.func)
      .timeBased()
      .atHour(config.hour)
      .nearMinute(config.minute)
      .everyDays(1)
      .create();

    Logger.log(`✅ 트리거 생성: ${config.label} (${config.hour}:${String(config.minute).padStart(2, '0')})`);
  });

  Logger.log(`✅ 총 ${triggerConfigs.length}개 트리거 생성 완료`);
}


// ============================================================
// 캘린더 이벤트 조회 (컴백일정)
// ============================================================

/**
 * 구글 캘린더에서 컴백일정 이벤트를 가져온다.
 * @param {string} groupFilter - 그룹명 필터 (빈 문자열이면 전체)
 * @param {string} monthsStr - 조회 기간 (개월, 기본 3)
 * @returns {{ events: Array, cached: boolean }}
 */
function getCalendarEvents(groupFilter, monthsStr) {
  try {
    // 캐시 키 생성
    const months = parseInt(monthsStr) || 3;
    const cacheKey = 'cal_events_' + (groupFilter || 'all') + '_' + months;
    const cache = CacheService.getScriptCache();

    // 캐시 확인 (1시간 = 3600초)
    const cached = cache.get(cacheKey);
    if (cached) {
      try {
        const parsed = JSON.parse(cached);
        return { events: parsed, cached: true };
      } catch (e) {
        // 캐시 파싱 실패 시 무시
      }
    }

    // 2개 캘린더 ID
    const calendarIds = [
      '2f47846077df13dd16e51aed01222df79b809105acca22fa7a7b56f050661abf@group.calendar.google.com',
      '58f8b93d722dc9175aae4c14e685918cdf7f5b2f5056c479ebf49b72dc2c73c5@group.calendar.google.com'
    ];

    // 기간 설정: 오늘 ~ N개월 후
    const now = new Date();
    const end = new Date();
    end.setMonth(end.getMonth() + months);

    const allEvents = [];

    for (const calId of calendarIds) {
      try {
        const cal = CalendarApp.getCalendarById(calId);
        if (!cal) continue; // 캘린더 접근 불가 시 스킵

        const events = cal.getEvents(now, end);
        for (const ev of events) {
          const title = ev.getTitle() || '';

          // 그룹 필터: 필터가 있으면 제목에 그룹명 포함 여부 확인
          if (groupFilter && title.indexOf(groupFilter) === -1) continue;

          allEvents.push({
            title: title,
            date: Utilities.formatDate(ev.getStartTime(), 'Asia/Seoul', 'yyyy-MM-dd'),
            endDate: Utilities.formatDate(ev.getEndTime(), 'Asia/Seoul', 'yyyy-MM-dd'),
            description: (ev.getDescription() || '').substring(0, 200) // 200자 제한
          });
        }
      } catch (calErr) {
        Logger.log('캘린더 접근 오류 (' + calId.substring(0, 8) + '): ' + calErr.toString());
      }
    }

    // 날짜순 정렬
    allEvents.sort(function(a, b) {
      return a.date.localeCompare(b.date);
    });

    // 캐시 저장 (1시간)
    try {
      const jsonStr = JSON.stringify(allEvents);
      if (jsonStr.length < 100000) { // 100KB 제한 내에서만 캐싱
        cache.put(cacheKey, jsonStr, 3600);
      }
    } catch (cacheErr) {
      Logger.log('캘린더 캐시 저장 실패: ' + cacheErr.toString());
    }

    return { events: allEvents, cached: false };

  } catch (error) {
    Logger.log('getCalendarEvents 오류: ' + error.toString());
    return { events: [], cached: false, error: error.toString() };
  }
}

/**
 * 엔터뉴스 수집 — Naver News API + Google News RSS 기반
 * Naver News API 우선 사용, 실패 시 Google News RSS 폴백
 * fetchAll()로 병렬 수집 → 중복 제거 → 최신순 정렬 → 상위 30개 반환
 * CacheService 30분 캐싱 + Google Sheets 누적 저장
 *
 * 설정: 스크립트 속성(Script Properties)에 아래 값 등록 필요
 *   NAVER_CLIENT_ID, NAVER_CLIENT_SECRET
 */
function getEnterNews() {
  const cache = CacheService.getScriptCache();
  const cacheKey = 'enter_news_v2';

  // 캐시 확인 (30분)
  const cached = cache.get(cacheKey);
  if (cached) {
    Logger.log('엔터뉴스 캐시 히트');
    var cachedData = JSON.parse(cached);
    try { archiveNewsToSheet(cachedData); } catch(e) { Logger.log('아카이브 실패: ' + e.message); }
    return cachedData;
  }

  const keywords = ['K-POP 아이돌', 'HYBE', 'SM엔터테인먼트', 'JYP엔터', 'YG엔터', '걸그룹 컴백'];
  const collectTime = new Date().toISOString();

  // Naver API 자격증명 확인
  var props = PropertiesService.getScriptProperties();
  var naverClientId = props.getProperty('NAVER_CLIENT_ID');
  var naverClientSecret = props.getProperty('NAVER_CLIENT_SECRET');
  var useNaver = naverClientId && naverClientSecret;

  var allNews = [];
  var seen = new Set();

  if (useNaver) {
    // Naver News API로 수집
    Logger.log('네이버 뉴스 API로 수집 시작');
    allNews = fetchNaverNews(keywords, naverClientId, naverClientSecret, collectTime, seen);
  }

  // Naver 결과가 부족하면 Google RSS로 보충
  if (allNews.length < 10) {
    if (useNaver) {
      Logger.log('네이버 뉴스 부족 (' + allNews.length + '건), Google RSS로 보충');
    }
    var rssNews = fetchGoogleRssNews(keywords, collectTime, seen);
    allNews = allNews.concat(rssNews);
  }

  // 최신순 정렬 → 상위 30개
  allNews.sort(function(a, b) { return new Date(b.pubDate) - new Date(a.pubDate); });
  var result = allNews.slice(0, 30);

  // 캐시 저장 (30분)
  try {
    var jsonStr = JSON.stringify(result);
    if (jsonStr.length < 100000) {
      cache.put(cacheKey, jsonStr, 1800);
      Logger.log('엔터뉴스 캐시 저장 (' + result.length + '건)');
    }
  } catch (e) {
    Logger.log('엔터뉴스 캐시 저장 실패: ' + e.message);
  }

  // Google Sheets 누적 저장 (백그라운드)
  try {
    archiveNewsToSheet(result);
  } catch (e) {
    Logger.log('뉴스 아카이브 저장 실패: ' + e.message);
  }

  return result;
}


/**
 * Naver News Search API로 뉴스 수집
 * https://developers.naver.com/docs/serviceapi/search/news/news.md
 */
function fetchNaverNews(keywords, clientId, clientSecret, collectTime, seen) {
  var results = [];

  var requests = keywords.map(function(kw) {
    return {
      url: 'https://openapi.naver.com/v1/search/news.json?query=' + encodeURIComponent(kw) + '&display=8&sort=date',
      headers: {
        'X-Naver-Client-Id': clientId,
        'X-Naver-Client-Secret': clientSecret
      },
      muteHttpExceptions: true
    };
  });

  var responses = UrlFetchApp.fetchAll(requests);

  responses.forEach(function(response, idx) {
    var keyword = keywords[idx];
    try {
      if (response.getResponseCode() !== 200) {
        Logger.log('네이버 뉴스 API 오류 (' + keyword + '): ' + response.getResponseCode());
        return;
      }

      var data = JSON.parse(response.getContentText());
      var items = data.items || [];

      items.forEach(function(item) {
        var link = item.originallink || item.link || '';
        if (seen.has(link)) return;
        seen.add(link);

        results.push({
          keyword: keyword.replace(/엔터테인먼트|엔터/g, '').trim(),
          title: (item.title || '').replace(/<[^>]*>/g, '').replace(/&quot;/g, '"').replace(/&amp;/g, '&').trim(),
          description: (item.description || '').replace(/<[^>]*>/g, '').replace(/&quot;/g, '"').replace(/&amp;/g, '&').trim(),
          link: link,
          pubDate: item.pubDate || '',
          collectTime: collectTime,
          source: 'naver'
        });
      });
    } catch (e) {
      Logger.log('네이버 뉴스 수집 실패 (' + keyword + '): ' + e.message);
    }
  });

  Logger.log('네이버 뉴스 수집: ' + results.length + '건');
  return results;
}


/**
 * Google News RSS로 뉴스 수집 (기존 방식, 폴백용)
 */
function fetchGoogleRssNews(keywords, collectTime, seen) {
  var results = [];

  var requests = keywords.map(function(kw) {
    return {
      url: 'https://news.google.com/rss/search?q=' + encodeURIComponent(kw) + '&hl=ko&gl=KR&ceid=KR:ko',
      muteHttpExceptions: true
    };
  });
  var responses = UrlFetchApp.fetchAll(requests);

  responses.forEach(function(response, idx) {
    var keyword = keywords[idx];
    try {
      if (response.getResponseCode() !== 200) {
        Logger.log('뉴스 RSS 응답 오류 (' + keyword + '): ' + response.getResponseCode());
        return;
      }

      var doc = XmlService.parse(response.getContentText());
      var items = doc.getRootElement().getChild('channel').getChildren('item');

      var count = 0;
      for (var i = 0; i < items.length && count < 8; i++) {
        var item = items[i];
        var link = item.getChildText('link') || '';
        if (seen.has(link)) continue;
        seen.add(link);

        results.push({
          keyword: keyword.replace(/엔터테인먼트|엔터/g, '').trim(),
          title: item.getChildText('title') || '',
          description: (item.getChildText('description') || '').replace(/<[^>]*>/g, '').trim(),
          link: link,
          pubDate: item.getChildText('pubDate') || '',
          collectTime: collectTime,
          source: 'google'
        });
        count++;
      }
    } catch (e) {
      Logger.log('뉴스 수집 실패 (' + keyword + '): ' + e.message);
    }
  });

  Logger.log('Google RSS 뉴스 수집: ' + results.length + '건');
  return results;
}

/**
 * 뉴스를 Google Sheets '뉴스아카이브' 시트에 누적 저장
 * URL 중복 체크 후 새 뉴스만 append
 */
function archiveNewsToSheet(newsList) {
  var ss = SpreadsheetApp.openById(SHEET_IDS['idol_sns_master_database']);
  var sheet = ss.getSheetByName('뉴스아카이브');

  // 시트 없으면 생성 + 헤더
  if (!sheet) {
    sheet = ss.insertSheet('뉴스아카이브');
    sheet.appendRow(['수집일시', '키워드', '제목', '설명', '링크', '발행일']);
    sheet.getRange(1, 1, 1, 6).setFontWeight('bold');
    Logger.log('뉴스아카이브 시트 생성');
  }

  // 기존 URL 목록 (최근 500행만 체크 — 성능 최적화)
  var lastRow = sheet.getLastRow();
  var existingUrls = new Set();
  if (lastRow > 1) {
    var startRow = Math.max(2, lastRow - 499);
    var urlRange = sheet.getRange(startRow, 5, lastRow - startRow + 1, 1).getValues();
    urlRange.forEach(function(row) { existingUrls.add(row[0]); });
  }

  // 새 뉴스만 필터링
  var newRows = [];
  newsList.forEach(function(news) {
    if (!existingUrls.has(news.link)) {
      newRows.push([news.collectTime, news.keyword, news.title, news.description, news.link, news.pubDate]);
    }
  });

  // 일괄 append
  if (newRows.length > 0) {
    sheet.getRange(lastRow + 1, 1, newRows.length, 6).setValues(newRows);
    Logger.log('뉴스 아카이브: ' + newRows.length + '건 신규 저장 (기존 ' + existingUrls.size + '건 중복 제외)');
  } else {
    Logger.log('뉴스 아카이브: 신규 뉴스 없음');
  }
}