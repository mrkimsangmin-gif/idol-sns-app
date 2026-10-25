import sys
from pathlib import Path

sys.stdout.reconfigure(encoding='utf-8')

p = Path(r"G:\내 드라이브\01.Work\04.AI.M.Contents\00.pumit\04.aimcontents.com\idol-sns-app\namu-smart-search.js")
content = p.read_text(encoding='utf-8')

# 1. Update dismissSmartAnswer
old_dismiss = """// 스마트 답변 닫기 → 검색 뷰 복원 + 진행 중인 검색 취소
function dismissSmartAnswer() {
    // 진행 중인 검색 요청 취소 (progress 찌꺼기 방지)
    if (currentSearchAbortController) {
        currentSearchAbortController.abort();
        currentSearchAbortController = null;
    }
    var container = document.getElementById('namuSmartAnswer');
    if (container) {
        container.style.display = 'none';
        container.innerHTML = '';
    }
    // 검색 뷰 복원
    var sv = document.getElementById('namuSearchView');
    if (sv) sv.style.display = 'block';
    // 추천 질문 칩 다시 표시
    if (typeof showRecommendedChips === 'function') showRecommendedChips();
}"""

new_dismiss = """// 스마트 답변 닫기 → 검색 뷰 복원 + 진행 중인 검색 취소
function dismissSmartAnswer(options) {
    options = options || {};

    // 진행 중인 검색 요청 취소 (progress 찌꺼기 및 뒤로가기 직후 좀비 렌더링 방지)
    if (currentSearchAbortController) {
        currentSearchAbortController.abort();
        currentSearchAbortController = null;
    }
    var container = document.getElementById('namuSmartAnswer');
    if (container) {
        container.style.display = 'none';
        container.innerHTML = '';
    }
    // 검색 뷰 복원
    var sv = document.getElementById('namuSearchView');
    if (sv) sv.style.display = 'block';
    // 추천 질문 칩 다시 표시
    if (typeof showRecommendedChips === 'function') showRecommendedChips();

    // UI 닫기 버튼 직접 클릭 시 URL에서 ?q= 파라미터 안전하게 정리
    if (!options.fromPopState && typeof window !== 'undefined' && window.history) {
        try {
            var currentUrl = new URL(window.location.href);
            if (currentUrl.searchParams.has('q')) {
                currentUrl.searchParams.delete('q');
                var baseState = Object.assign({}, window.history.state || {}, {
                    namuView: 'searchList',
                    q: null
                });
                window.history.replaceState(baseState, '', currentUrl.toString());
            }
        } catch (e) {
            console.warn('[namuSmartSearch] URL cleanup failed:', e);
        }
    }
}"""

if old_dismiss in content:
    content = content.replace(old_dismiss, new_dismiss)
    print("✓ Successfully replaced dismissSmartAnswer")
else:
    # Try normalizing CRLF
    old_crlf = old_dismiss.replace('\n', '\r\n')
    if old_crlf in content:
        content = content.replace(old_crlf, new_dismiss.replace('\n', '\r\n'))
        print("✓ Successfully replaced dismissSmartAnswer (CRLF)")
    else:
        print("✗ Could not find old_dismiss!")

# 2. Update handleSmartSearch
old_handle_head = """async function handleSmartSearch(query) {
    // 이전 검색 요청 취소 (UI 상태 오염 방지)
    if (currentSearchAbortController) {
        currentSearchAbortController.abort();
    }
    currentSearchAbortController = new AbortController();
    var searchSignal = currentSearchAbortController.signal;

    var searchStartTime = Date.now(); // 응답 시간 측정 시작

    // 재검색 신호 기록 (2분 내 재검색 시)
    // 직전 쿼리가 새 쿼리에 포함되면 'drill_down'(심화 탐색), 아니면 'resear ch'(동일 의도 반복)
    if (currentSearchMeta && (Date.now() - currentSearchMeta.timestamp) < 120000) {
        var _prevQ = currentSearchMeta.query.toLowerCase().replace(/\\s+/g, '');
        var _newQ  = query.toLowerCase().replace(/\\s+/g, '');
        var _signal = (_prevQ.length > 0 && _newQ.includes(_prevQ)) ? 'drill_down' : 'resear ch';
        logFeedbackToGAS(_signal);
    }

    var container = document.getElementById('namuSmartAnswer');
    if (!container) return;

    // 이전 답변 완전 초기화
    container.style.display = 'none';
    container.innerHTML = '';

    // 추천 칩 숨기기 (검색 실행 시)
    var chipsContainer = document.getElementById('namuRecommendedChips');
    if (chipsContainer) chipsContainer.style.display = 'none';

    // 검색 뷰 숨기고 상세 뷰도 숨기기 (null-safe)
    var namuSearchView = document.getElementById('namuSearchView');
    var namuRankingView = document.getElementById('namuRankingView');
    var namuGroupDetail = document.getElementById('namuGroupDetail');
    if (namuSearchView) namuSearchView.style.display = 'none';
    if (namuRankingView) namuRankingView.style.display = 'none';
    if (namuGroupDetail) namuGroupDetail.style.display = 'none';

    // Method A: 패턴매칭 시도
    var intent = parseSmartQuery(query);

    if (intent) {
        // navigate 계열은 그룹 상세로 바로 이동 (답변 카드 불필요)
        if (intent.type === 'navigate' || intent.type === 'navigate_member') {
            // 검색 뷰 복원 (navigate는 loadNamuGroupBySlug이 처리)
            if (namuSearchView) namuSearchView.style.display = 'block';
            await executeIntent(intent);
            trackEvent('namu_smart_search', { query: query, method: 'pattern', intent: intent.type });
            // 검색 로그: navigate 패턴
            logSearchToGAS({ query: query, group: intent.group ? intent.group.name : '', intent_type: intent.type, response_method: 'pattern', response_time_ms: Date.now() - searchStartTime, success: true });
            return;
        }"""

new_handle_head = """async function handleSmartSearch(query, options) {
    options = options || {};
    var normalizedQuery = (query || '').trim();
    if (!normalizedQuery) return;

    // 이전 검색 요청 취소 (UI 상태 오염 방지)
    if (currentSearchAbortController) {
        currentSearchAbortController.abort();
    }
    currentSearchAbortController = new AbortController();
    var searchSignal = currentSearchAbortController.signal;

    var searchStartTime = Date.now(); // 응답 시간 측정 시작

    // 재검색 신호 기록 (2분 내 재검색 시)
    // 직전 쿼리가 새 쿼리에 포함되면 'drill_down'(심화 탐색), 아니면 'research'(동일 의도 반복)
    if (currentSearchMeta && (Date.now() - currentSearchMeta.timestamp) < 120000) {
        var _prevQ = currentSearchMeta.query.toLowerCase().replace(/\\s+/g, '');
        var _newQ  = normalizedQuery.toLowerCase().replace(/\\s+/g, '');
        var _signal = (_prevQ.length > 0 && _newQ.includes(_prevQ)) ? 'drill_down' : 'research';
        logFeedbackToGAS(_signal);
    }

    var container = document.getElementById('namuSmartAnswer');
    if (!container) return;

    // Method A: 패턴매칭 시도 (navigate 계열은 그룹 상세로 바로 이동)
    var intent = parseSmartQuery(normalizedQuery);

    if (intent && (intent.type === 'navigate' || intent.type === 'navigate_member')) {
        var namuSearchView = document.getElementById('namuSearchView');
        if (namuSearchView) namuSearchView.style.display = 'block';
        await executeIntent(intent);
        trackEvent('namu_smart_search', { query: normalizedQuery, method: 'pattern', intent: intent.type });
        logSearchToGAS({ query: normalizedQuery, group: intent.group ? intent.group.name : '', intent_type: intent.type, response_method: 'pattern', response_time_ms: Date.now() - searchStartTime, success: true });
        return;
    }

    // === SPA 브라우저 히스토리(pushState) 및 URL ?q= 파라미터 동기화 ===
    if (!options.skipHistory && typeof window !== 'undefined' && window.history) {
        try {
            var currentUrl = new URL(window.location.href);
            var prevUrlQuery = currentUrl.searchParams.get('q');
            currentUrl.searchParams.set('q', normalizedQuery);
            var nextState = Object.assign({}, window.history.state || {}, {
                namuView: 'smartAnswer',
                q: normalizedQuery
            });
            // 동일 검색어 재실행 시 히스토리 스택 중복 방지 (replaceState)
            if (prevUrlQuery === normalizedQuery) {
                window.history.replaceState(nextState, '', currentUrl.toString());
            } else {
                window.history.pushState(nextState, '', currentUrl.toString());
            }
        } catch (e) {
            console.warn('[namuSmartSearch] History API update failed:', e);
        }
    }

    // 이전 답변 완전 초기화
    container.style.display = 'none';
    container.innerHTML = '';

    // 추천 칩 숨기기 (검색 실행 시)
    var chipsContainer = document.getElementById('namuRecommendedChips');
    if (chipsContainer) chipsContainer.style.display = 'none';

    // 검색 뷰 숨기고 상세 뷰도 숨기기 (null-safe)
    var namuSearchView = document.getElementById('namuSearchView');
    var namuRankingView = document.getElementById('namuRankingView');
    var namuGroupDetail = document.getElementById('namuGroupDetail');
    if (namuSearchView) namuSearchView.style.display = 'none';
    if (namuRankingView) namuRankingView.style.display = 'none';
    if (namuGroupDetail) namuGroupDetail.style.display = 'none';

    query = normalizedQuery;"""

if old_handle_head in content:
    content = content.replace(old_handle_head, new_handle_head)
    print("✓ Successfully replaced handleSmartSearch head")
else:
    old_handle_crlf = old_handle_head.replace('\n', '\r\n')
    if old_handle_crlf in content:
        content = content.replace(old_handle_crlf, new_handle_head.replace('\n', '\r\n'))
        print("✓ Successfully replaced handleSmartSearch head (CRLF)")
    else:
        print("✗ Could not find old_handle_head!")

# 3. Add global history listener at the end of namu-smart-search.js
history_listener_code = """

// ============================================================
// 브라우저 뒤로가기/앞으로가기(popstate) 및 ?q= 딥링크 바인딩
// ============================================================
if (typeof window !== 'undefined' && !window.__namuSmartSearchHistoryBound) {
    window.__namuSmartSearchHistoryBound = true;

    window.addEventListener('popstate', function (event) {
        var currentUrl = new URL(window.location.href);
        var urlQuery = (event.state && event.state.q) || currentUrl.searchParams.get('q');

        // 1) 히스토리 상태나 URL에 검색어(q)가 있으면 해당 검색 결과 복원 (skipHistory: true)
        if (urlQuery && urlQuery.trim().length > 0) {
            var searchInput = document.getElementById('namuSearchInput');
            if (searchInput) searchInput.value = urlQuery.trim();
            handleSmartSearch(urlQuery.trim(), { skipHistory: true });
            return;
        }

        // 2) 검색어가 없는데 현재 스마트 답변창이 열려 있다면 닫고 이전 목록 뷰로 복귀
        var container = document.getElementById('namuSmartAnswer');
        var isAnswerVisible = container && (container.style.display !== 'none' && container.innerHTML !== '');
        if (isAnswerVisible) {
            dismissSmartAnswer({ fromPopState: true });
        }
    });

    // 공유된 링크(?q=2024년+데뷔+걸그룹+초동+순위)로 직접 진입 시 자동 실행
    document.addEventListener('DOMContentLoaded', function () {
        var initialUrl = new URL(window.location.href);
        var initialQuery = initialUrl.searchParams.get('q');
        if (initialQuery && initialQuery.trim().length > 0) {
            var cleanUrl = new URL(window.location.href);
            cleanUrl.searchParams.delete('q');
            window.history.replaceState({ namuView: 'searchList', q: null }, '', cleanUrl.toString());

            var searchInput = document.getElementById('namuSearchInput');
            if (searchInput) searchInput.value = initialQuery.trim();
            handleSmartSearch(initialQuery.trim(), { skipHistory: false });
        }
    });
}
"""

if "window.__namuSmartSearchHistoryBound" not in content:
    content += history_listener_code
    print("✓ Successfully appended history listener code")

p.write_text(content, encoding='utf-8')
print("Saved modified namu-smart-search.js!")
