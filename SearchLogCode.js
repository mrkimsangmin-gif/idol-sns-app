// ============================================================
// 📊 검색 로그 수집 API
// ============================================================
// doGet/doPost는 Code.js에서 라우팅하므로 여기에는 없음
// 시트: "검색로그" (idol_sns_master_database 스프레드시트 내)
// ============================================================

const SEARCH_LOG_SHEET_NAME = '검색로그';  // 시트명

/**
 * 검색로그 시트 가져오기 (없으면 자동 생성 + 헤더 설정)
 */
function getSearchLogSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SEARCH_LOG_SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SEARCH_LOG_SHEET_NAME);
    // 헤더 설정
    sheet.getRange(1, 1, 1, 7).setValues([[
      'timestamp', 'query', 'group', 'intent_type',
      'response_method', 'response_time_ms', 'success'
    ]]);
    sheet.getRange(1, 1, 1, 7).setFontWeight('bold');
    sheet.setFrozenRows(1); // 헤더 행 고정
  }
  return sheet;
}

/**
 * 검색 쿼리 로그 기록
 * @param {Object} params - { query, group, intent_type, response_method, response_time_ms, success }
 * @returns {Object} - { status: 'success' }
 */
function logSearchQuery(params) {
  const sheet = getSearchLogSheet();
  sheet.appendRow([
    new Date().toISOString(),                // timestamp (UTC ISO)
    params.query || '',                      // 검색어
    params.group || '',                      // 매칭된 그룹명
    params.intent_type || '',                // 인텐트 타입 (member_field, gemini_fallback 등)
    params.response_method || '',            // 응답 방식 (pattern, gemini, cache 등)
    parseInt(params.response_time_ms) || 0,  // 응답 시간 (ms)
    params.success === true || params.success === 'true' // 성공 여부
  ]);
  return { status: 'success' };
}

// ============================================================
// 📧 일일 검색 로그 리포트 (매일 자정 자동 발송)
// ============================================================

const REPORT_RECIPIENT = 'mr.kimsangmin@gmail.com';

/**
 * 전일(어제) 검색 로그를 요약 + 전체 로그 형태로 이메일 발송
 * - 수동 실행: GAS 에디터에서 직접 실행 가능
 * - 자동 실행: setupDailySearchLogTrigger()로 매일 자정 트리거
 */
function sendDailySearchLogReport() {
  const sheet = getSearchLogSheet();
  const data = sheet.getDataRange().getValues();
  if (data.length <= 1) {                       // 헤더만 있으면 빈 시트
    _sendEmptyReport();
    return;
  }

  // --- 어제 날짜 범위 (KST 기준) ---
  const now = new Date();
  const kstOffset = 9 * 60 * 60 * 1000;        // UTC+9
  const kstNow = new Date(now.getTime() + kstOffset);
  const yesterdayKST = new Date(kstNow);
  yesterdayKST.setDate(yesterdayKST.getDate() - 1);

  const yYear = yesterdayKST.getFullYear();     // 어제 연도
  const yMonth = yesterdayKST.getMonth();       // 어제 월 (0-indexed)
  const yDate = yesterdayKST.getDate();         // 어제 일

  // 어제 00:00:00 ~ 23:59:59 KST → UTC 범위로 변환
  const startUTC = new Date(Date.UTC(yYear, yMonth, yDate, 0, 0, 0) - kstOffset);
  const endUTC = new Date(Date.UTC(yYear, yMonth, yDate, 23, 59, 59, 999) - kstOffset);

  // --- 어제 로그 필터링 ---
  const headers = data[0];                      // ['timestamp', 'query', ...]
  const rows = data.slice(1);                   // 데이터 행만
  const yesterdayRows = rows.filter(row => {
    const ts = new Date(row[0]);                // timestamp (ISO string → Date)
    return ts >= startUTC && ts <= endUTC;
  });

  // 날짜 포맷 (YYYY-MM-DD)
  const dateStr = yYear + '-' +
    String(yMonth + 1).padStart(2, '0') + '-' +
    String(yDate).padStart(2, '0');

  if (yesterdayRows.length === 0) {
    _sendEmptyReport(dateStr);
    return;
  }

  // --- 통계 계산 ---
  const total = yesterdayRows.length;
  const successCount = yesterdayRows.filter(r => r[6] === true || r[6] === 'true').length;
  const successRate = ((successCount / total) * 100).toFixed(1);
  const avgResponseTime = Math.round(
    yesterdayRows.reduce((sum, r) => sum + (Number(r[5]) || 0), 0) / total
  );

  // 인기 검색어 TOP 10
  const queryCounts = {};                       // { query: count }
  yesterdayRows.forEach(r => {
    const q = String(r[1]).trim();
    if (q) queryCounts[q] = (queryCounts[q] || 0) + 1;
  });
  const topQueries = Object.entries(queryCounts)
    .sort((a, b) => b[1] - a[1])               // 빈도 내림차순
    .slice(0, 10);

  // 응답 방식 분포
  const methodCounts = {};                      // { method: count }
  yesterdayRows.forEach(r => {
    const m = String(r[4]).trim() || '(없음)';
    methodCounts[m] = (methodCounts[m] || 0) + 1;
  });
  const methodEntries = Object.entries(methodCounts)
    .sort((a, b) => b[1] - a[1]);              // 빈도 내림차순

  // --- HTML 이메일 생성 ---
  const html = _buildReportHtml(dateStr, total, successRate, avgResponseTime,
    topQueries, methodEntries, yesterdayRows);

  // --- 발송 ---
  MailApp.sendEmail({
    to: REPORT_RECIPIENT,
    subject: '[K-POP 나무위키] 일일 검색 리포트 — ' + dateStr,
    body: '이 이메일은 HTML 형식입니다. HTML을 지원하는 메일 클라이언트에서 확인하세요.',
    htmlBody: html
  });
}

/**
 * 검색 로그 0건일 때 간단 이메일 발송
 */
function _sendEmptyReport(dateStr) {
  dateStr = dateStr || _getYesterdayDateStr();
  MailApp.sendEmail({
    to: REPORT_RECIPIENT,
    subject: '[K-POP 나무위키] 일일 검색 리포트 — ' + dateStr,
    body: dateStr + ' 검색 기록이 없습니다.'
  });
}

/**
 * 어제 날짜 문자열 반환 (YYYY-MM-DD, KST)
 */
function _getYesterdayDateStr() {
  const now = new Date();
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  kst.setDate(kst.getDate() - 1);
  return kst.getFullYear() + '-' +
    String(kst.getMonth() + 1).padStart(2, '0') + '-' +
    String(kst.getDate()).padStart(2, '0');
}

/**
 * HTML 리포트 본문 생성
 */
function _buildReportHtml(dateStr, total, successRate, avgResponseTime,
  topQueries, methodEntries, rows) {

  // 공통 스타일
  var style = [
    'body { font-family: "Apple SD Gothic Neo", "Malgun Gothic", sans-serif; color: #333; max-width: 800px; margin: 0 auto; padding: 16px; }',
    'h2 { color: #1a73e8; border-bottom: 2px solid #1a73e8; padding-bottom: 8px; }',
    '.summary-box { background: #f8f9fa; border-radius: 8px; padding: 16px; margin: 12px 0; }',
    '.summary-box span { font-size: 24px; font-weight: bold; color: #1a73e8; }',
    'table { border-collapse: collapse; width: 100%; margin: 12px 0; font-size: 13px; }',
    'th { background: #1a73e8; color: white; padding: 8px 10px; text-align: left; }',
    'td { border-bottom: 1px solid #e0e0e0; padding: 6px 10px; }',
    'tr:nth-child(even) { background: #f8f9fa; }',
    '.tag { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 12px; }',
    '.tag-pattern { background: #e8f5e9; color: #2e7d32; }',
    '.tag-gemini { background: #e3f2fd; color: #1565c0; }',
    '.tag-cache { background: #fff3e0; color: #e65100; }',
    '.tag-other { background: #f3e5f5; color: #7b1fa2; }',
    '.success { color: #2e7d32; }',
    '.fail { color: #c62828; }'
  ].join('\n');

  var html = '<!DOCTYPE html><html><head><meta charset="utf-8"><style>' + style + '</style></head><body>';

  // 제목
  html += '<h2>📊 일일 검색 리포트 — ' + dateStr + '</h2>';

  // 요약 박스
  html += '<div class="summary-box">';
  html += '총 검색: <span>' + total + '</span>건 &nbsp;&nbsp;|&nbsp;&nbsp; ';
  html += '성공률: <span>' + successRate + '%</span> &nbsp;&nbsp;|&nbsp;&nbsp; ';
  html += '평균 응답: <span>' + avgResponseTime + '</span>ms';
  html += '</div>';

  // 인기 검색어 TOP 10
  html += '<h2>🔥 인기 검색어 TOP 10</h2>';
  if (topQueries.length === 0) {
    html += '<p>검색어 데이터 없음</p>';
  } else {
    html += '<table><tr><th>#</th><th>검색어</th><th>횟수</th></tr>';
    topQueries.forEach(function(item, i) {
      html += '<tr><td>' + (i + 1) + '</td><td>' + _escapeHtml(item[0]) + '</td><td>' + item[1] + '회</td></tr>';
    });
    html += '</table>';
  }

  // 응답 방식 분포
  html += '<h2>📋 응답 방식 분포</h2>';
  html += '<table><tr><th>방식</th><th>건수</th><th>비율</th></tr>';
  methodEntries.forEach(function(item) {
    var pct = ((item[1] / total) * 100).toFixed(1);
    var tagClass = 'tag-other';                 // 기본 태그 색상
    if (item[0] === 'pattern') tagClass = 'tag-pattern';
    else if (item[0] === 'gemini') tagClass = 'tag-gemini';
    else if (item[0] === 'cache') tagClass = 'tag-cache';
    html += '<tr><td><span class="tag ' + tagClass + '">' + _escapeHtml(item[0]) + '</span></td>';
    html += '<td>' + item[1] + '건</td><td>' + pct + '%</td></tr>';
  });
  html += '</table>';

  // 전체 로그 테이블
  html += '<h2>📝 전체 로그 (' + total + '건)</h2>';
  html += '<table><tr><th>시간(KST)</th><th>검색어</th><th>그룹</th><th>타입</th><th>방식</th><th>응답(ms)</th><th>성공</th></tr>';
  rows.forEach(function(row) {
    var ts = _formatKST(row[0]);                // UTC → KST 변환
    var query = _escapeHtml(String(row[1]));
    var group = _escapeHtml(String(row[2]));
    var intentType = _escapeHtml(String(row[3]));
    var method = String(row[4]).trim();
    var tagClass = 'tag-other';
    if (method === 'pattern') tagClass = 'tag-pattern';
    else if (method === 'gemini') tagClass = 'tag-gemini';
    else if (method === 'cache') tagClass = 'tag-cache';
    var responseTime = Number(row[5]) || 0;
    var success = (row[6] === true || row[6] === 'true');

    html += '<tr>';
    html += '<td style="white-space:nowrap">' + ts + '</td>';
    html += '<td>' + query + '</td>';
    html += '<td>' + group + '</td>';
    html += '<td>' + intentType + '</td>';
    html += '<td><span class="tag ' + tagClass + '">' + _escapeHtml(method) + '</span></td>';
    html += '<td style="text-align:right">' + responseTime + '</td>';
    html += '<td>' + (success ? '<span class="success">✓</span>' : '<span class="fail">✗</span>') + '</td>';
    html += '</tr>';
  });
  html += '</table>';

  html += '<hr><p style="color:#999; font-size:12px;">이 리포트는 GAS 트리거에 의해 자동 생성되었습니다.</p>';
  html += '</body></html>';
  return html;
}

/**
 * UTC 타임스탬프 → KST HH:mm:ss 문자열 변환
 */
function _formatKST(timestamp) {
  var d = new Date(timestamp);
  var kst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
  return String(kst.getUTCHours()).padStart(2, '0') + ':' +
    String(kst.getUTCMinutes()).padStart(2, '0') + ':' +
    String(kst.getUTCSeconds()).padStart(2, '0');
}

/**
 * HTML 특수문자 이스케이프 (XSS 방지)
 */
function _escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ============================================================
// 👍👎 피드백 로그
// ============================================================

const FEEDBACK_LOG_SHEET_NAME = '피드백로그';

/**
 * 피드백 로그 시트 가져오기 (없으면 자동 생성 + 헤더 설정)
 */
function getFeedbackLogSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(FEEDBACK_LOG_SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(FEEDBACK_LOG_SHEET_NAME);
    sheet.getRange(1, 1, 1, 7).setValues([[
      'timestamp', 'query', 'group', 'intent_type',
      'response_method', 'feedback', 'session_id'
    ]]);
    sheet.getRange(1, 1, 1, 7).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
  return sheet;
}

/**
 * 피드백 기록 (👍 'good' / 👎 'bad' / 재검색 'implicit_fail')
 * @param {Object} params - { query, group, intent_type, response_method, feedback, session_id }
 * @returns {Object} - { status: 'success' }
 */
function logFeedback(params) {
  const sheet = getFeedbackLogSheet();
  sheet.appendRow([
    new Date().toISOString(),      // timestamp (UTC ISO)
    params.query || '',            // 검색어
    params.group || '',            // 매칭된 그룹명
    params.intent_type || '',      // 인텐트 타입
    params.response_method || '',  // 응답 방식
    params.feedback || '',         // 'good' | 'bad' | 'implicit_fail'
    params.session_id || ''        // 탭 단위 세션 ID
  ]);
  return { status: 'success' };
}

// ============================================================
// ⏰ 트리거 설정 (GAS 에디터에서 1회 수동 실행)
// ============================================================

/**
 * 매일 자정(KST)에 sendDailySearchLogReport 실행하는 트리거 등록
 * - 중복 방지: 기존 동일 함수 트리거 삭제 후 재생성
 * - GAS 에디터에서 이 함수를 1회 실행하면 트리거가 영구 등록됨
 */
function setupDailySearchLogTrigger() {
  // 기존 트리거 삭제 (중복 방지)
  var triggers = ScriptApp.getProjectTriggers();
  triggers.forEach(function(trigger) {
    if (trigger.getHandlerFunction() === 'sendDailySearchLogReport') {
      ScriptApp.deleteTrigger(trigger);
    }
  });

  // 새 트리거 생성: 매일 자정~1시 사이 실행
  ScriptApp.newTrigger('sendDailySearchLogReport')
    .timeBased()
    .atHour(0)                                  // 자정 (프로젝트 타임존 기준)
    .everyDays(1)                               // 매일
    .create();
}
