// 외부 시트 ID 매핑
const SHEET_IDS = {
  'SNS_DATA_GIRLBAND': '10c1IRqOcrjfSG-V3pTJg_x07UJx1GcBYZaVgSXVpcNI',
  'SNS_DATA_BOYBAND': '1610z9la__ozzeVSHhj1ljDyVKB5xK30Ewe38r6NHZZU',
  'idol_sns_master_database': '1L9xc8YLltr7IRxzCwZh5NdMpjbrsyoaG0etXdsd7NiY'
};

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
        .setMimeType(ContentService.MimeType.JSON)
        .setHeader('Access-Control-Allow-Origin', '*');
    }

    // 전체 메타데이터 조회 (프리페칭용)
    if (p.action === 'allMetadata') {
      const gender = p.gender || '남자';
      const result = getAllIdolMetadata(gender);
      return ContentService.createTextOutput(JSON.stringify(result))
        .setMimeType(ContentService.MimeType.JSON)
        .setHeader('Access-Control-Allow-Origin', '*');
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
      .setMimeType(ContentService.MimeType.JSON)
      .setHeader('Access-Control-Allow-Origin', '*');  // CORS 허용

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
    .setMimeType(ContentService.MimeType.JSON)
    .setHeader('Access-Control-Allow-Origin', '*');  // CORS 허용
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