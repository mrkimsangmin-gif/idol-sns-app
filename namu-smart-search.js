// ========================================
// 🔍 나무위키 스마트 검색 시스템
// Method A: 클라이언트 패턴매칭 (비용 $0)
// Method B: Gemini Flash API 폴백 (무료 티어)
// ========================================

// ============================================================
// Gemini 응답 캐시 (localStorage) + 검색 로그 전송
// ============================================================

var GEMINI_CACHE_PREFIX = 'gemini_v2_'; // 프롬프트 변경 시 버전업 → 기존 캐시 무효화
var GEMINI_CACHE_TTL = 7 * 24 * 60 * 60 * 1000; // 7일 (ms)

/**
 * djb2 해시 → base36 문자열 (캐시 키 생성용)
 */
function simpleHash(str) {
    var hash = 5381;
    for (var i = 0; i < str.length; i++) {
        hash = ((hash << 5) + hash) + str.charCodeAt(i); // hash * 33 + c
        hash = hash & hash; // 32비트 정수 변환
    }
    return Math.abs(hash).toString(36);
}

/**
 * 쿼리 → 캐시 키 생성 (정규화 후 해시)
 */
function geminiCacheKey(query) {
    var normalized = query.toLowerCase().replace(/\s+/g, ' ').trim();
    return GEMINI_CACHE_PREFIX + simpleHash(normalized);
}

/**
 * Gemini 캐시 조회 (TTL 만료 시 삭제 후 null 반환)
 */
function getGeminiCache(query) {
    try {
        var key = geminiCacheKey(query);
        var raw = localStorage.getItem(key);
        if (!raw) return null;
        var entry = JSON.parse(raw);
        // TTL 만료 체크
        if (Date.now() - entry.ts > GEMINI_CACHE_TTL) {
            localStorage.removeItem(key);
            return null;
        }
        return entry.data;
    } catch (e) {
        return null; // 파싱 실패 시 무시
    }
}

/**
 * Gemini 캐시 저장 (localStorage 용량 초과 시 무시)
 */
function setGeminiCache(query, data) {
    try {
        var key = geminiCacheKey(query);
        localStorage.setItem(key, JSON.stringify({ ts: Date.now(), data: data }));
    } catch (e) {
        // QuotaExceededError 등 무시
    }
}

/**
 * 만료된 Gemini 캐시 일괄 제거 (idle 시 호출)
 */
function cleanupGeminiCache() {
    try {
        var keysToRemove = [];
        for (var i = 0; i < localStorage.length; i++) {
            var key = localStorage.key(i);
            // 현재 버전 캐시: TTL 만료 시 제거
            if (key && key.indexOf(GEMINI_CACHE_PREFIX) === 0) {
                try {
                    var entry = JSON.parse(localStorage.getItem(key));
                    if (Date.now() - entry.ts > GEMINI_CACHE_TTL) {
                        keysToRemove.push(key);
                    }
                } catch (e) {
                    keysToRemove.push(key); // 파싱 실패 항목도 제거
                }
            }
            // 이전 버전 캐시 (gemini_cache_) 일괄 제거
            else if (key && key.indexOf('gemini_cache_') === 0) {
                keysToRemove.push(key);
            }
        }
        for (var j = 0; j < keysToRemove.length; j++) {
            localStorage.removeItem(keysToRemove[j]);
        }
        if (keysToRemove.length > 0) {
            console.log('[캐시 정리] 만료된 Gemini 캐시 ' + keysToRemove.length + '개 제거');
        }
    } catch (e) {
        // localStorage 접근 불가 시 무시
    }
}

/**
 * 검색 로그를 GAS 백엔드로 전송 (fire-and-forget, UX 비차단)
 * @param {Object} params - { query, group, intent_type, response_method, response_time_ms, success }
 */
function logSearchToGAS(params) {
    var gasUrl = window.GAS_WEBAPP_URL || (typeof API_URL !== 'undefined' ? API_URL : '');
    if (!gasUrl) return;

    var payload = JSON.stringify({
        action: 'logSearch',
        query: params.query || '',
        group: params.group || '',
        intent_type: params.intent_type || '',
        response_method: params.response_method || '',
        response_time_ms: params.response_time_ms || 0,
        success: params.success || false
    });

    // sendBeacon 우선 (페이지 이탈 시에도 전송 보장)
    if (navigator.sendBeacon) {
        navigator.sendBeacon(gasUrl, payload);
    } else {
        // 폴백: fetch fire-and-forget
        fetch(gasUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain' },
            body: payload
        }).catch(function() {}); // 실패 무시
    }

    // 현재 검색 컨텍스트 업데이트 (피드백 버튼용 — 실패 로그 제외)
    if (params.success !== false) {
        currentSearchMeta = {
            query: params.query || '',
            group: params.group || '',
            intent_type: params.intent_type || '',
            response_method: params.response_method || '',
            timestamp: Date.now()
        };
    }
}

// ============================================================
// 👍👎 피드백 시스템
// ============================================================

var currentSearchMeta = null;        // 직전 검색 컨텍스트 (피드백 전송에 활용)
var _feedbackSessionId = Math.random().toString(36).slice(2, 10); // 탭 단위 세션 ID

/**
 * 피드백(👍/👎 또는 암묵적 재검색 실패)을 GAS에 전송
 * @param {string} feedback - 'good' | 'bad' | 'implicit_fail'
 */
function logFeedbackToGAS(feedback) {
    if (!currentSearchMeta) return;
    var gasUrl = window.GAS_WEBAPP_URL || (typeof API_URL !== 'undefined' ? API_URL : '');
    if (!gasUrl) return;

    var payload = JSON.stringify({
        action: 'logFeedback',
        query: currentSearchMeta.query || '',
        group: currentSearchMeta.group || '',
        intent_type: currentSearchMeta.intent_type || '',
        response_method: currentSearchMeta.response_method || '',
        feedback: feedback,
        session_id: _feedbackSessionId
    });

    if (navigator.sendBeacon) {
        navigator.sendBeacon(gasUrl, payload);
    } else {
        fetch(gasUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain' },
            body: payload
        }).catch(function() {});
    }
}

/**
 * AI 답변 컨테이너 하단에 👍/👎 피드백 버튼 추가
 * @param {HTMLElement} container - 답변이 렌더링된 DOM 요소
 */
/**
 * AI 답변 하단에 👍/👎 피드백 버튼 추가
 * - LocalStorage로 탭 새로고침 후에도 중복 방지
 */
function appendFeedbackButtons(container) {
    var bar = document.createElement('div');
    bar.className = 'feedback-bar';

    // 쿼리 기반 LS 키 생성 (어뷰징 방지 + 중복 방지)
    var lsKey = currentSearchMeta ? 'namu_fb_' + _feedbackHash(currentSearchMeta.query) : null;

    if (lsKey && _lsGet(lsKey)) {
        // 이미 피드백을 남긴 질문 → 완료 상태로 즉시 표시
        bar.innerHTML = '<span class="feedback-done" style="color:#bbb;font-size:0.75rem;">✓ 피드백 완료</span>';
    } else {
        bar.dataset.lsKey = lsKey || '';
        bar.innerHTML =
            '<span class="feedback-label">이 답변이 도움이 됐나요?</span>' +
            '<button class="feedback-btn feedback-good" onclick="handleFeedback(this,\'good\')" title="도움이 됐어요">👍</button>' +
            '<button class="feedback-btn feedback-bad" onclick="handleFeedback(this,\'bad\')" title="아쉬워요">👎</button>';
    }
    container.appendChild(bar);
}

/** 간단한 문자열 해시 (LocalStorage 키용) */
function _feedbackHash(str) {
    var h = 0;
    for (var i = 0; i < str.length; i++) {
        h = Math.imul(31, h) + str.charCodeAt(i) | 0;
    }
    return Math.abs(h).toString(36);
}

/** LocalStorage 읽기 (예외 안전) */
function _lsGet(key) {
    try { return localStorage.getItem(key); } catch(e) { return null; }
}

/** LocalStorage 쓰기 (예외 안전) */
function _lsSet(key, val) {
    try { localStorage.setItem(key, val); } catch(e) {}
}

/**
 * 👍 클릭: 즉시 완료 처리
 * 👎 클릭: 마이크로 태그 3개 표시 후 이유 선택 대기
 */
function handleFeedback(btn, type) {
    var bar = btn.closest('.feedback-bar');
    if (!bar || bar.dataset.voted) return; // DOM 레벨 중복 방지
    bar.dataset.voted = '1';

    if (type === 'good') {
        _completeFeedback(bar, 'good');
    } else {
        // 👎 → 마이크로 태그 칩 표시 (이유 세분화)
        bar.innerHTML =
            '<span class="feedback-label" style="font-size:0.78rem;flex:none;">어떤 점이 아쉬웠나요?</span>' +
            '<button class="feedback-chip" onclick="handleFeedbackTag(this,\'bad:wrong\')">데이터가 틀림</button>' +
            '<button class="feedback-chip" onclick="handleFeedbackTag(this,\'bad:lacking\')">내용이 부족함</button>' +
            '<button class="feedback-chip" onclick="handleFeedbackTag(this,\'bad:irrelevant\')">엉뚱한 대답</button>';
    }
}

/** 마이크로 태그 선택 처리 */
function handleFeedbackTag(btn, tag) {
    var bar = btn.closest('.feedback-bar');
    if (!bar) return;
    _completeFeedback(bar, tag);
}

/**
 * 피드백 완료 공통 처리 — GAS 로깅 + LS 저장 + UI 확정
 * @param {HTMLElement} bar - .feedback-bar 엘리먼트
 * @param {string} feedbackType - 'good' | 'bad:wrong' | 'bad:lacking' | 'bad:irrelevant'
 */
function _completeFeedback(bar, feedbackType) {
    logFeedbackToGAS(feedbackType);

    var lsKey = bar.dataset.lsKey;
    if (lsKey) _lsSet(lsKey, '1');

    bar.innerHTML = feedbackType === 'good'
        ? '<span class="feedback-done feedback-done-good">👍 감사합니다!</span>'
        : '<span class="feedback-done feedback-done-bad">👎 접수됐어요. 개선에 활용할게요!</span>';

    trackEvent('namu_feedback', {
        feedback: feedbackType,
        query: currentSearchMeta ? currentSearchMeta.query : '',
        response_method: currentSearchMeta ? currentSearchMeta.response_method : '',
        event_category: 'engagement'
    });
}


// === 멤버 → 그룹 역인덱스 ===
let memberGroupIndex = {};  // { "카리나": [{ group_name, slug, ... }] }

// === 그룹 상세 캐시 ===
const smartSearchGroupCache = {};  // { slug: groupDetail }

// === 검색 요청 취소용 AbortController (UI 상태 오염 방지) ===
var currentSearchAbortController = null;

// ============================================================
// 추천 질문 칩 시스템 (Phase 0: 시드 질문 / Phase 2: 인기 검색어)
// ============================================================

// Phase 0 시드 질문 — 서비스 역량을 과시하는 고품질 예시
var SEED_QUESTIONS = [
    { icon: '🔥', text: '2024년 데뷔 걸그룹 초동 순위' },
    { icon: '✨', text: '에스파 멤버 나이순으로 알려줘' },
    { icon: '🏢', text: '하이브 소속 아이돌 누가 있어?' },
    { icon: '💿', text: '역대 초동 1위 앨범은?' },
    { icon: '👥', text: '뉴진스 멤버 프로필' }
];

// 금칙어 블랙리스트 — 인기 검색어 노출 시 필터링용
var BLOCKED_KEYWORDS = [
    '씨발', '시발', 'ㅅㅂ', '개새끼', 'ㄱㅅㄲ',
    '병신', 'ㅂㅅ', '지랄', 'ㅈㄹ',
    '미친년', '미친놈', '꺼져', '닥쳐', '죽어',
    '야동', '섹스', '포르노', '몸매',
    '가슴', '엉덩이', '노출',
    '은꼴', '직캠 레전드', '팬티', '브라',
    '한남', '한녀', '김치녀', '된장녀', '맘충',
    '느금마', '재기', '자살', '테러',
    '집주소', '전화번호', '사생', '몰카', '도촬', '열애',
    '안티', '까', '망해라', '탈퇴해', '퇴출'
];
var BLOCKED_REGEX = new RegExp(BLOCKED_KEYWORDS.join('|'), 'i');

// 질문이 금칙어를 포함하는지 검사 (true면 차단)
function isBlockedQuery(query) {
    return BLOCKED_REGEX.test(query);
}

// 추천 질문 칩 렌더링 (Phase 0: 시드 / Phase 2: 외부 데이터)
function renderRecommendedChips(questions) {
    var container = document.getElementById('namuRecommendedChips');
    if (!container) return;
    var chipData = questions || SEED_QUESTIONS;
    // 외부 데이터일 때만 금칙어 필터링 적용
    if (questions) {
        chipData = chipData.filter(function(q) {
            var text = typeof q === 'string' ? q : q.text;
            return !isBlockedQuery(text);
        });
    }
    if (!chipData || chipData.length === 0) {
        container.innerHTML = '';
        return;
    }
    var html = '<span class="namu-chips-label">이런 질문을 해보세요</span>';
    chipData.forEach(function(item) {
        var icon = item.icon || '💬';
        var text = typeof item === 'string' ? item : item.text;
        var safeText = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
        html += '<button class="namu-chip" data-query="' + safeText + '">'
              + '<span class="namu-chip-icon">' + icon + '</span>'
              + safeText + '</button>';
    });
    container.innerHTML = html;
    // 클릭 이벤트 위임
    container.onclick = function(e) {
        var chip = e.target.closest('.namu-chip');
        if (!chip) return;
        var query = chip.getAttribute('data-query');
        if (!query) return;
        var searchInput = document.getElementById('namuSearchInput');
        if (searchInput) { searchInput.value = query; searchInput.focus(); }
        container.style.display = 'none';
        if (typeof handleSmartSearch === 'function') handleSmartSearch(query);
    };
}

// Phase 2: GAS API에서 인기 검색어 로드 (향후 활성화)
function loadPopularQueries() {
    var gasUrl = window.GAS_WEBAPP_URL || (typeof API_URL !== 'undefined' ? API_URL : '');
    if (!gasUrl) return;
    fetch(gasUrl + '?action=getPopularQueries')
        .then(function(res) { return res.json(); })
        .then(function(data) {
            if (data && data.queries && data.queries.length >= 3) {
                renderRecommendedChips(data.queries);
            }
        })
        .catch(function() {});
}

// 스마트 검색 결과 닫기 시 칩 다시 표시
function showRecommendedChips() {
    var container = document.getElementById('namuRecommendedChips');
    if (container) container.style.display = '';
}

// ============================================================
// 채팅 UI 헬퍼
// ============================================================

// AI 반짝이 아이콘 SVG (Gemini 스타일 4점 별)
var CHAT_AI_ICON_SVG = '<svg width="22" height="22" viewBox="0 0 28 28" fill="none"><path d="M14 0C14 7.732 6.268 14 0 14c6.268 0 14 6.268 14 14 0-7.732 7.732-14 14-14-6.268 0-14-6.268-14-14z" fill="url(#aiStarGrad)"/><defs><linearGradient id="aiStarGrad" x1="0" y1="0" x2="28" y2="28"><stop stop-color="#7c3aed"/><stop offset="1" stop-color="#2563eb"/></linearGradient></defs></svg>';

// 마크다운 → HTML 변환 (marked.js 우선, 자체 파서 폴백)
function renderMarkdown(text) {
    if (!text) return '';
    if (typeof marked !== 'undefined' && marked.parse) {
        try {
            var html = marked.parse(text, { breaks: true, gfm: true });
            // marked.js가 생성한 <table>에 Bootstrap + 커스텀 클래스 추가 (스타일 통일)
            html = html.replace(/<table>/g,
                '<div class="table-responsive"><table class="table table-sm namu-smart-table">');
            html = html.replace(/<\/table>/g, '</table></div>');
            return html;
        } catch (e) {
            return markdownToHtml(text);
        }
    }
    return markdownToHtml(text);
}

// 채팅 레이아웃 초기화: 사용자 말풍선 + AI 로딩 영역 생성
// 반환값: chatAiBody 엘리먼트 (AI 답변이 렌더링될 대상)
function initChatLayout(container, query) {
    container.innerHTML =
        '<div class="chat-bubble-user">' + escapeHtml(query) + '</div>' +
        '<div class="chat-bubble-ai">' +
            '<div class="chat-ai-icon">' + CHAT_AI_ICON_SVG + '</div>' +
            '<div id="chatAiBody" class="chat-ai-body">' +
                '<div class="chat-ai-loading">' +
                    '<span>AI가 데이터를 분석 중입니다</span>' +
                    '<div class="dot-pulse"><span></span><span></span><span></span></div>' +
                '</div>' +
            '</div>' +
        '</div>';
    container.style.display = 'flex';
    return document.getElementById('chatAiBody');
}

// AI 답변 영역(chatAiBody) 반환 헬퍼
function getChatAiBody() {
    return document.getElementById('chatAiBody');
}

// === 세대 구분 맵 ===
const GENERATION_MAP = {
    '1세대': [1996, 2002],
    '2세대': [2003, 2011],
    '3세대': [2012, 2017],
    '4세대': [2018, 2021],
    '5세대': [2022, 2030]
};

// === 소속사 별칭 맵 ===
const AGENCY_ALIASES = {
    'SM': ['SM엔터테인먼트', 'SM Entertainment'],
    'JYP': ['JYP엔터테인먼트', 'JYP Entertainment'],
    'YG': ['YG엔터테인먼트', 'YG Entertainment'],
    'HYBE': ['하이브', 'HYBE', '빅히트', '빅히트 뮤직', '쏘스뮤직', '플레디스', '어도어', 'ADOR', 'KOZ', 'BELIFT LAB', '빌리프랩'],
    '하이브': ['하이브', 'HYBE', '빅히트', '빅히트 뮤직', '쏘스뮤직', '플레디스', '어도어', 'ADOR', 'KOZ', 'BELIFT LAB', '빌리프랩'],
    'CJ': ['CJ ENM', '웨이크원', 'Fantagio'],
    '카카오': ['카카오엔터테인먼트', 'IST엔터테인먼트', '스타쉽엔터테인먼트', '이담엔터테인먼트'],
    '큐브': ['큐브엔터테인먼트', 'CUBE Entertainment', 'Cube'],
    '스타쉽': ['스타쉽엔터테인먼트', 'Starship Entertainment'],
    '웨이크원': ['웨이크원'],
    'FNC': ['FNC엔터테인먼트', 'FNC Entertainment'],
    'IST': ['IST엔터테인먼트'],
    'WM': ['WM엔터테인먼트', 'WM Entertainment'],
    'RBW': ['RBW', 'RBW Inc.'],
    '울림': ['울림엔터테인먼트', 'Woollim Entertainment'],
    'DSP': ['DSP미디어', 'DSP Media'],
    '빅플래닛': ['빅플래닛메이드엔터', 'Big Planet Made']
};

// === 필드명 별칭 맵 ===
const FIELD_ALIASES = {
    '소속사': '소속사', '기획사': '소속사', '회사': '소속사', '엔터': '소속사',
    '데뷔': '데뷔일', '데뷔일': '데뷔일', '데뷔년도': '데뷔일',
    '팬덤': '팬덤명', '팬덤명': '팬덤명', '팬클럽': '팬덤명', '팬 이름': '팬덤명',
    '고향': '출신지', '출신': '출신지', '출신지': '출신지', '국적': '출신지',
    '생일': '생년월일', '생년월일': '생년월일', '나이': '생년월일',
    '역할': '역할', '포지션': '역할',
    '본명': '본명', '이름': '본명', '실명': '본명', '진짜이름': '본명', '진짜 이름': '본명',
    '초동': '초동_써클', '판매량': '초동_써클', '앨범판매': '초동_써클',
    '멤버수': '멤버수', '인원': '멤버수',
    '유통사': '유통사', '레이블': '레이블',
    '키': '키', '신장': '키', 'height': '키',
    'MBTI': 'MBTI', 'mbti': 'MBTI', '엠비티아이': 'MBTI',
    '혈액형': '혈액형', '피형': '혈액형',
    '특징': 'info', '소개': 'info', '성격': 'info',
    '별명': 'info', '닉네임': 'info', '애칭': 'info', '프로필': 'info'
};

// === SNS 플랫폼 동의어 사전 (사용자 입력 → 정규화된 snsList 키) ===
// null 값: 현재 추적하지 않는 플랫폼 (안내 메시지 출력용)
var SNS_PLATFORM_ALIASES = {
    '웨이보': '웨이보', 'weibo': '웨이보',
    '트위터': 'X(트위터)', 'twitter': 'X(트위터)', 'x': 'X(트위터)', '엑스': 'X(트위터)', '틔터': 'X(트위터)',
    '유튜브': '유튜브', 'youtube': '유튜브', '유투브': '유튜브', '유튭': '유튜브',
    '빌리빌리': '빌리빌리', 'bilibili': '빌리빌리', '비리비리': '빌리빌리',
    '스포티파이': '스포티파이', 'spotify': '스포티파이', '스포': '스포티파이',
    '차오화': '차오화', '슈퍼챗': '차오화', 'chaohua': '차오화', '슈퍼챠트': '차오화',
    'qq뮤직': 'QQ뮤직', 'qqmusic': 'QQ뮤직', 'qq': 'QQ뮤직',
    '인스타': '인스타그램', '인스타그램': '인스타그램', 'instagram': '인스타그램', 'ig': '인스타그램',
    '틱톡': null, 'tiktok': null
};

// SNS 플랫폼 정규식 (긴 것 우선 매칭)
var SNS_PLATFORM_REGEX_STR = Object.keys(SNS_PLATFORM_ALIASES)
    .sort(function(a, b) { return b.length - a.length; })
    .join('|');

// === SNS 링크 필드 → 표시 정보 매핑 (metadata JSON 키 기준) ===
var SNS_LINK_FIELDS = {
    'weibo_link':           { label: '웨이보', snsKey: '웨이보' },
    'weibo_superchat_link': { label: '차오화(슈퍼챗)', snsKey: '차오화' },
    'x_link':               { label: 'X(트위터)', snsKey: 'X(트위터)' },
    'bilibili_link':        { label: '빌리빌리', snsKey: '빌리빌리' },
    'youtube_link':         { label: '유튜브', snsKey: '유튜브' },
    'qqmusic_link':         { label: 'QQ뮤직', snsKey: 'QQ뮤직' },
    'spotify_link':         { label: '스포티파이', snsKey: '스포티파이' },
    'instagram_link':       { label: '인스타그램', snsKey: '인스타그램' }
};

// === 필드 표시명 맵 (테이블 헤더용) ===
const FIELD_DISPLAY_NAMES = {
    'info': '특징/소개',
    '초동_써클': '초동(써클)',
    '누적_써클': '누적(써클)'
};

// === 흔한 오타 보정 맵 ===
var TYPO_CORRECTIONS = {
    'mbit': 'mbti', 'mbti': 'mbti',
    '앰비티아이': 'mbti', '엠비티아이': 'mbti',
    '키': '키', '혈애형': '혈액형'
};

// === 나이/서열 관련 키워드 → 멤버 생년월일 자동 계산용 ===
var AGE_KEYWORDS = {
    '막내': 'youngest',   // 가장 어린 멤버
    '최연소': 'youngest',
    '맏언니': 'oldest',   // 가장 나이 많은 멤버 (여그룹)
    '맏형': 'oldest',     // 가장 나이 많은 멤버 (남그룹)
    '최연장': 'oldest',
    '맏이': 'oldest',
    '첫째': 'oldest'
};

// === 자연어 꼬리 표현 (길이 내림차순 정렬하여 긴 것 우선 매칭) ===
var QUERY_SUFFIXES = [
    '추천해 주세요', '추천해주세요', '좀 추천해줘',
    '을 알려주세요', '를 알려주세요', '좀 알려주세요',
    '알려주세요', '알려줘요', '알고 싶어요', '알고싶어요',
    '추천해줘', '알려줘', '알려쥬', '해주세요', '해줘요',
    '뭐야', '뭐에요', '뭐예요', '해줘',
    '언제야', '언제예요', '어디야', '어디예요',
    '누구야', '누구예요', '누구인지', '누구인가요',
    '이 무엇인가요', '이 뭔가요', '이 뭐야',
    '인가요', '인가', '인지',
    '무엇', '뭔지', '뭘까',
    // 존재/목록 질문 꼬리 표현
    '누가 있나요', '뭐가 있나요', '누가 있어요', '뭐가 있어요',
    '누가 있어', '뭐가 있어', '알고 싶어', '있는지',
    // 서술형 종결 꼬리
    '이에요', '이야', '인데', '인가',
    '좀요', '좀', '요'
].sort(function(a, b) { return b.length - a.length; });

// === 복합 질의 감지용 키워드 (목록 인텐트 + 분석/비교 요구 동시 존재 시) ===
var COMPOUND_KEYWORDS = [
    '최고', '최대', '최저', '최소', '1위', '순위', '비교',
    '가장', '제일', '많은', '적은', '높은', '낮은', '평균',
    '판매량', '초동', '누적', '몇', '얼마', '합계', '총'
];
// 복합 질의 대상이 되는 목록형 인텐트 타입
var LIST_INTENT_TYPES = ['debut_year_filter', 'generation_filter', 'agency_filter'];

// 복합 질의 여부 판별: 목록형 인텐트인데 분석/비교 키워드가 포함된 경우
function isCompoundQuery(query, intentType) {
    if (LIST_INTENT_TYPES.indexOf(intentType) === -1) return false;
    var q = query.toLowerCase();
    for (var i = 0; i < COMPOUND_KEYWORDS.length; i++) {
        if (q.indexOf(COMPOUND_KEYWORDS[i]) !== -1) return true;
    }
    return false;
}

// 자연어 꼬리 표현 제거 → 핵심 쿼리만 추출
function normalizeQuery(query) {
    var q = query.trim();
    // 물음표/느낌표/마침표 먼저 제거 후 suffix 재매칭 (예: "인가요?" → "?" 제거 → "인가요" 제거)
    q = q.replace(/[?？!！.。,，~]+$/, '').trim();
    for (var i = 0; i < QUERY_SUFFIXES.length; i++) {
        var suffix = QUERY_SUFFIXES[i];
        if (q.length > suffix.length && q.endsWith(suffix)) {
            q = q.slice(0, -suffix.length).trim();
            break; // 가장 긴 매칭 하나만 제거
        }
    }
    // "을/를/이/가/은/는/의" 조사 제거 (마지막 단어가 2글자 이하면 오제거 방지)
    // "나이" → 보존 ("나"+"이" 1글자 잔여) / "소속사는" → "소속사" ("소속사" 3글자 잔여)
    q = q.replace(/(\S{2,})[을를이가은는의]$/, '$1').trim();
    // 흔한 오타 보정 (단어 단위)
    q = q.replace(/\b\S+\b/g, function(w) {
        return TYPO_CORRECTIONS[w.toLowerCase()] || w;
    });
    // 한글 오타도 보정 (단어 경계 없는 한글)
    for (var typo in TYPO_CORRECTIONS) {
        if (q.indexOf(typo) !== -1) {
            q = q.replace(typo, TYPO_CORRECTIONS[typo]);
        }
    }
    return q;
}

// 복합 필드 분리: "이름과 생일" → {fields: ['본명', '생년월일'], unmatched: []}
// "생년월일, 별명, 특징 등" → {fields: ['생년월일', 'info'], unmatched: []}
function extractFields(text) {
    if (!text || !text.trim()) return null;
    // 접속사로 분리: 과/와/이랑/하고/,/및
    var parts = text.split(/[과와]|이랑|하고|,|및/).map(function(s) { return s.trim(); }).filter(Boolean);
    var fields = [];
    var unmatched = [];
    for (var i = 0; i < parts.length; i++) {
        // "특징 등" → "특징", "별명들" → "별명" 정리
        var cleaned = parts[i].replace(/\s*등$/, '').replace(/들$/, '').trim();
        if (!cleaned) continue;
        var mapped = FIELD_ALIASES[cleaned];
        if (mapped) {
            if (fields.indexOf(mapped) === -1) fields.push(mapped); // 중복 제거 (별명+특징 둘 다 info)
        } else {
            unmatched.push(cleaned);
        }
    }
    if (fields.length === 0 && unmatched.length === 0) return null;
    return { fields: fields.length > 0 ? fields : null, unmatched: unmatched };
}


// ============================================================
// 멤버-그룹 역인덱스 구축
// ============================================================

function buildMemberGroupIndex() {
    if (!namuIndexData) return;
    memberGroupIndex = {};

    for (var i = 0; i < namuIndexData.length; i++) {
        var g = namuIndexData[i];
        var members = g.members || [];
        for (var j = 0; j < members.length; j++) {
            var name = members[j];
            if (!name) continue;
            // 중복 멤버명 → 배열로 저장
            if (!memberGroupIndex[name]) {
                memberGroupIndex[name] = [];
            }
            memberGroupIndex[name].push({
                group_name: g.name,
                group_name_en: g.name_en,
                slug: g.slug,
                gender: g.gender,
                agency: g.agency
            });
        }
    }
    console.log('🔍 멤버-그룹 인덱스 구축 완료 (' + Object.keys(memberGroupIndex).length + '명)');
}


// ============================================================
// 그룹 상세 데이터 로드 (캐시 활용)
// ============================================================

async function fetchGroupDetail(slug) {
    // 캐시 확인
    if (smartSearchGroupCache[slug]) {
        return smartSearchGroupCache[slug];
    }
    try {
        var response = await fetch('/data/namu-groups/' + slug + '.json?v=' + NAMU_DATA_VERSION);
        if (!response.ok) return null;
        var data = await response.json();
        smartSearchGroupCache[slug] = data;
        return data;
    } catch (e) {
        console.error('그룹 상세 로드 실패:', slug, e);
        return null;
    }
}


// ============================================================
// 별칭 해석 (Phase 1)
// ============================================================

/**
 * 별칭을 정규 그룹명으로 해석 (동기, 이미 로드된 groupAliasData 사용)
 * @param {string} query - 별칭 또는 약어 (예: "방탄", "SVT", "스키즈")
 * @returns {string|null} 정규 그룹명 (예: "방탄소년단") 또는 null
 */
function resolveGroupAlias(query) {
    if (!groupAliasData || !groupAliasData.groups) return null;
    var term = query.trim().toLowerCase().replace(/\s/g, '');
    // 모든 그룹의 별칭을 순회
    var groups = groupAliasData.groups;
    for (var groupName in groups) {
        var entry = groups[groupName];
        var aliases = entry.aliases || [];
        for (var i = 0; i < aliases.length; i++) {
            if (aliases[i].toLowerCase().replace(/\s/g, '') === term) {
                return groupName;
            }
        }
        // 팬덤명도 그룹 해석에 사용
        if (entry.fandom && entry.fandom.toLowerCase() === term) {
            return groupName;
        }
    }
    return null;
}

/**
 * 별칭을 정규 멤버명으로 해석
 * @param {string} query - 멤버 별칭 (예: "유지민", "Karina", "랩몬")
 * @returns {{ name: string, group: string }|null}
 */
function resolveMemberAlias(query) {
    if (!groupAliasData || !groupAliasData.members) return null;
    var term = query.trim().toLowerCase().replace(/\s/g, '');
    var members = groupAliasData.members;
    for (var memberName in members) {
        var entry = members[memberName];
        var aliases = entry.aliases || [];
        for (var i = 0; i < aliases.length; i++) {
            if (aliases[i].toLowerCase().replace(/\s/g, '') === term) {
                return { name: memberName, group: entry.group };
            }
        }
    }
    return null;
}

// ============================================================
// 그룹/멤버 검색 헬퍼
// ============================================================

// 그룹명(한글/영문)으로 인덱스에서 찾기, 별칭 폴백 + 부분 매칭 포함
function findGroupByName(name) {
    if (!namuIndexData) return null;
    var term = name.trim().toLowerCase().replace(/\s/g, '');
    // 1단계: 정확 매칭 (name / name_en)
    for (var i = 0; i < namuIndexData.length; i++) {
        var g = namuIndexData[i];
        if (g.name.toLowerCase().replace(/\s/g, '') === term ||
            g.name_en.toLowerCase().replace(/\s/g, '') === term) {
            return g;
        }
    }
    // 2단계: 별칭 매칭
    var resolvedName = resolveGroupAlias(name);
    if (resolvedName) {
        for (var j = 0; j < namuIndexData.length; j++) {
            if (namuIndexData[j].name === resolvedName) return namuIndexData[j];
        }
    }
    // 3단계: 부분 매칭 (입력이 3자 이상일 때만, 오매칭 방지)
    if (term.length >= 3) {
        for (var k = 0; k < namuIndexData.length; k++) {
            var gk = namuIndexData[k];
            if (gk.name.toLowerCase().replace(/\s/g, '').includes(term) ||
                gk.name_en.toLowerCase().replace(/\s/g, '').includes(term)) {
                return gk;
            }
        }
    }
    return null;
}

// 멤버명으로 소속 그룹 찾기 (정확 매칭 → 별칭 매칭 → 접미사 매칭)
function findMemberGroups(name) {
    // 1. 정확 매칭 우선
    if (memberGroupIndex[name]) return memberGroupIndex[name];
    // 2. 별칭 매칭
    var resolved = resolveMemberAlias(name);
    if (resolved && memberGroupIndex[resolved.name]) {
        return memberGroupIndex[resolved.name];
    }
    // 3. 접미사 매칭: "하오" → "장하오" (2글자 이상만)
    if (name.length >= 2) {
        for (var key in memberGroupIndex) {
            if (key.length > name.length && key.endsWith(name)) {
                return memberGroupIndex[key];
            }
        }
    }
    return [];
}


// ============================================================
// SNS 랭킹 질의 파서 (플랫폼 순위/1위/TOP N 등)
// ============================================================

/**
 * SNS 랭킹 질의 감지:
 *   "웨이보 1위", "2026년 2월 웨이보 팔로워 1위는 누구야"
 *   "인스타그램 팔로워 순위", "유튜브 구독자 많은 남자 아이돌"
 *   "팔로워 많은 걸그룹", "SNS 순위"
 * @returns {Object|null} {type:'sns_ranking', platform, gender, month, topN}
 */
function parseSnsRankingQuery(q) {
    // SNS 플랫폼 키워드 감지
    var platform = null;
    var platformKeys = Object.keys(SNS_PLATFORM_ALIASES).sort(function(a, b) { return b.length - a.length; });
    for (var i = 0; i < platformKeys.length; i++) {
        if (q.indexOf(platformKeys[i]) !== -1) {
            platform = SNS_PLATFORM_ALIASES[platformKeys[i]];
            break;
        }
    }

    // 랭킹 키워드 감지 (순위/1위/TOP/많은/높은/랭킹)
    var rankingKeywords = /(?:(\d+)\s*위|순위|랭킹|ranking|top\s*(\d+)?|많은|높은)/i;
    var rankMatch = q.match(rankingKeywords);
    if (!rankMatch && !platform) return null; // 둘 다 없으면 SNS 랭킹 아님
    // 플랫폼만 있고 랭킹 키워드 없으면 → group_sns일 수 있으므로 무시
    if (platform && !rankMatch) return null;
    // 랭킹 키워드만 있고 플랫폼 없으면 → SNS 관련어(팔로워/구독자/sns) 필요
    if (!platform && rankMatch) {
        if (!/팔로워|구독자|sns|SNS/i.test(q)) return null;
    }

    // 그룹명이 포함된 경우 → group_sns 인텐트로 처리 (이 파서에서 제외)
    // 단, "에스파 웨이보 순위" 같은 건 여전히 sns_ranking으로 처리 가능하지만
    // 기존 group_sns와 충돌 방지를 위해 그룹명 포함 시 null 반환
    if (typeof findGroupByName === 'function') {
        // 플랫폼 키워드와 랭킹 키워드 제거 후 그룹명 검색
        var stripped = q;
        if (platform) {
            for (var pi = 0; pi < platformKeys.length; pi++) {
                stripped = stripped.replace(new RegExp(platformKeys[pi].replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), '');
            }
        }
        stripped = stripped.replace(rankingKeywords, '').replace(/팔로워|구독자|sns|아이돌|걸그룹|보이그룹|남자|여자|남돌|여돌/gi, '').trim();
        if (stripped.length >= 2) {
            var foundGroup = findGroupByName(stripped);
            if (foundGroup) return null; // 그룹명 포함 → group_sns로 처리
        }
    }

    // 성별 감지
    var gender = null;
    if (/여자|걸그룹|여돌|girl/i.test(q)) gender = '여자';
    else if (/남자|보이그룹|남돌|boy/i.test(q)) gender = '남자';

    // 월 감지: "2026년 2월" or "2026-02" or "2월"
    var month = null;
    var monthMatch = q.match(/(\d{4})\s*년?\s*(\d{1,2})\s*월/);
    if (monthMatch) {
        month = monthMatch[1] + '-' + monthMatch[2].padStart(2, '0');
    } else {
        var monthMatch2 = q.match(/(\d{4})-(\d{2})/);
        if (monthMatch2) month = monthMatch2[1] + '-' + monthMatch2[2];
    }

    // TOP N 감지
    var topN = 10; // 기본값
    if (rankMatch) {
        if (rankMatch[1]) topN = Math.min(parseInt(rankMatch[1]), 30); // "N위" → TOP N
        if (rankMatch[2]) topN = Math.min(parseInt(rankMatch[2]), 30); // "TOP N"
        if (rankMatch[1] && parseInt(rankMatch[1]) === 1) topN = 10; // "1위" → TOP 10 보여주되 1위 강조
    }

    // 세대 감지: "4세대", "5세대" 등
    var generation = null;
    var genMatch = q.match(/(\d)세대/);
    if (genMatch) {
        var genKey = genMatch[1] + '세대';
        if (GENERATION_MAP[genKey]) generation = genKey;
    }

    return { type: 'sns_ranking', platform: platform, gender: gender, month: month, topN: topN, generation: generation };
}


// ============================================================
// 패턴매칭 엔진 (Method A)
// ============================================================

function parseSmartQuery(query) {
    var q = normalizeQuery(query);

    // 0. SNS 랭킹 질의: "웨이보 1위", "2026년 2월 인스타그램 순위", "팔로워 많은 남자 아이돌"
    var snsRankingResult = parseSnsRankingQuery(q);
    if (snsRankingResult) return snsRankingResult;

    // 1. 그룹 비교: "{그룹} vs {그룹}" 또는 "{그룹} 비교 {그룹}"
    //    후미에 SNS/팔로워 키워드 → sns_comparison 분기
    var vsMatch = q.match(/^(.+?)\s*(?:vs|VS|비교|대)\s+(.+)$/);
    if (vsMatch) {
        // 후미 SNS 키워드 분리: "르세라핌 웨이보 팔로워 비교" → platform + 팔로워 + 비교
        var snsSuffix = vsMatch[2].match(/^(.+?)\s+(팔로워|sns|SNS|구독자|팔로워수)\s*(?:비교)?\s*$/i);
        var g2raw = snsSuffix ? snsSuffix[1].trim() : vsMatch[2].trim();
        // g2raw에서 플랫폼 분리: "르세라핌 웨이보" → group="르세라핌", platform="웨이보"
        var compPlatform = undefined;
        if (snsSuffix) {
            var platRegex = new RegExp('(.+?)\\s+(' + SNS_PLATFORM_REGEX_STR + ')\\s*$', 'i');
            var platMatch = g2raw.match(platRegex);
            if (platMatch) {
                g2raw = platMatch[1].trim();
                compPlatform = SNS_PLATFORM_ALIASES[platMatch[2].toLowerCase()];
            }
        }
        // "비교"가 끝에 붙어 그룹명 인식 실패 시, "비교" 제거 후 재시도
        var g1 = findGroupByName(vsMatch[1]);
        var g2 = findGroupByName(g2raw);
        if (!g2 && !snsSuffix) {
            var cleanedG2 = g2raw.replace(/\s*비교\s*$/, '').trim();
            if (cleanedG2 !== g2raw) g2 = findGroupByName(cleanedG2);
        }
        if (g1 && g2 && snsSuffix) {
            return { type: 'sns_comparison', groups: [g1, g2], platform: compPlatform };
        }
        if (g1 && g2) {
            return { type: 'comparison', groups: [g1, g2] };
        }
    }

    // 2. 연도+초동 필터: "2024년 초동 100만" 또는 "초동 100만 이상 걸그룹"
    var rankMatch = q.match(/(?:(\d{4})년?\s*)?초동\s*(\d+)\s*만\s*(이상|이하|넘은|넘는)?\s*(걸그룹|보이그룹|여자|남자|그룹|아이돌)?/);
    if (rankMatch) {
        var rkGender = null;
        var rkGenderTerm = rankMatch[4] || '';
        if (rkGenderTerm === '걸그룹' || rkGenderTerm === '여자') rkGender = '여자';
        if (rkGenderTerm === '보이그룹' || rkGenderTerm === '남자') rkGender = '남자';
        return {
            type: 'ranking_filter',
            year: rankMatch[1] || null,
            threshold: parseInt(rankMatch[2]) * 10000,
            direction: (rankMatch[3] === '이하') ? 'lte' : 'gte',
            gender: rkGender
        };
    }

    // 2-b. 역대 초동 랭킹: "역대 초동 1위", "초동 TOP 10", "초동 순위", "초동 랭킹"
    var topRankMatch = q.match(/(?:역대\s*)?(?:(\d{4})년?\s*)?초동\s*(?:(\d+)\s*위|(?:top|TOP)\s*(\d+)|랭킹|순위|1위)\s*(걸그룹|보이그룹|여자|남자|아이돌|앨범)?/);
    if (!topRankMatch) {
        topRankMatch = q.match(/역대\s*초동\s*(?:(\d+)\s*위|1위|순위|랭킹)\s*(앨범|걸그룹|보이그룹|여자|남자|아이돌)?/);
        if (topRankMatch) {
            topRankMatch = [topRankMatch[0], null, topRankMatch[1] || '1', null, topRankMatch[2] || null];
        }
    }
    if (topRankMatch) {
        var trYear = topRankMatch[1] || null;
        var trCount = parseInt(topRankMatch[2] || topRankMatch[3] || '10');
        if (trCount <= 0) trCount = 10;
        if (trCount > 50) trCount = 50;
        var trGender = null;
        var trGenderTerm = (topRankMatch[4] || '').trim();
        if (trGenderTerm === '걸그룹' || trGenderTerm === '여자') trGender = '여자';
        if (trGenderTerm === '보이그룹' || trGenderTerm === '남자') trGender = '남자';
        return {
            type: 'album_sales_ranking',
            year: trYear,
            topN: trCount,
            gender: trGender
        };
    }

    // 2-a. 소속사 단독 필터: "SM 소속 그룹", "하이브 산하 그룹 목록", "큐브 소속 아이돌"
    var agencyOnlyMatch = q.match(/^(.+?)\s*(?:소속|산하)\s*(?:걸그룹|보이그룹|그룹|아이돌|가수)?\s*(?:목록|리스트)?\s*$/i);
    if (agencyOnlyMatch) {
        var aoTerm = agencyOnlyMatch[1].trim();
        // 소속사 확인 (별칭 또는 인덱스 기반 검색)
        if (AGENCY_ALIASES[aoTerm] || findGroupsByAgency(aoTerm).length > 0) {
            var aoGender = null;
            if (/걸그룹/.test(q)) aoGender = '여자';
            if (/보이그룹/.test(q)) aoGender = '남자';
            return {
                type: 'agency_filter',
                agency: aoTerm,
                gender: aoGender,
                generation: null
            };
        }
    }

    // 3. 소속사+세대/성별 필터: "SM 4세대", "SM 소속 4세대 걸그룹", "하이브 걸그룹"
    var agencyGenMatch = q.match(/^(.+?)(?:\s*소속)?\s*([\d]세대|걸그룹|보이그룹|여자|남자)\s*(.*)$/);
    if (agencyGenMatch) {
        var agencyTerm = agencyGenMatch[1].trim();
        var genTerm = agencyGenMatch[2].trim();
        var restTerm = agencyGenMatch[3] || '';
        // 소속사 확인
        if (AGENCY_ALIASES[agencyTerm] || findGroupsByAgency(agencyTerm).length > 0) {
            // genTerm과 restTerm 양쪽에서 성별/세대 추출
            var gender = null;
            var generation = null;
            var allTerms = genTerm + ' ' + restTerm;
            if (/걸그룹|여자/.test(allTerms)) gender = '여자';
            if (/보이그룹|남자/.test(allTerms)) gender = '남자';
            if (GENERATION_MAP[genTerm]) generation = genTerm;
            // restTerm에서 세대 추출 (예: "SM 걸그룹 4세대")
            var restGenMatch = restTerm.match(/([\d]세대)/);
            if (restGenMatch && GENERATION_MAP[restGenMatch[1]]) generation = restGenMatch[1];
            return {
                type: 'agency_filter',
                agency: agencyTerm,
                generation: generation,
                gender: gender
            };
        }
    }

    // 3-0b. "YYYY년 데뷔" 크로스그룹 필터: "2020년 데뷔 아이돌", "2018년 데뷔 걸그룹"
    var debutYearMatch = q.match(/(\d{4})년\s*데뷔\s*(걸그룹|보이그룹|여자|남자|아이돌|그룹)?\s*(목록|리스트|누구)?/);
    if (debutYearMatch) {
        var dyGender = null;
        var dyGenderTerm = debutYearMatch[2] || '';
        if (dyGenderTerm === '걸그룹' || dyGenderTerm === '여자') dyGender = '여자';
        if (dyGenderTerm === '보이그룹' || dyGenderTerm === '남자') dyGender = '남자';
        return {
            type: 'debut_year_filter',
            year: parseInt(debutYearMatch[1]),
            gender: dyGender
        };
    }

    // 3-1. 세대/성별 단독 필터: "4세대 걸그룹", "5세대", "걸그룹 목록"
    var genOnlyMatch = q.match(/^(\d세대)\s*(걸그룹|보이그룹|여자|남자|그룹|아이돌)?\s*(목록|리스트|누구|추천)?$/);
    if (genOnlyMatch) {
        var genGender = null;
        var genGenderTerm = genOnlyMatch[2] || '';
        if (genGenderTerm === '걸그룹' || genGenderTerm === '여자') genGender = '여자';
        if (genGenderTerm === '보이그룹' || genGenderTerm === '남자') genGender = '남자';
        return {
            type: 'generation_filter',
            generation: genOnlyMatch[1],
            gender: genGender
        };
    }

    // 3-1a. 세대+성별+집계 쿼리: "4세대 걸그룹 평균 멤버수", "5세대 보이그룹 초동 1위"
    // → Gemini 폴백으로 처리 (세대/성별 필터된 컨텍스트 제공)
    var genAggMatch = q.match(/^(\d세대)\s*(걸그룹|보이그룹|여자|남자)?\s+(.+)$/);
    if (genAggMatch) {
        var gaGen = genAggMatch[1];
        var gaGender = null;
        var gaGenderTerm = genAggMatch[2] || '';
        if (gaGenderTerm === '걸그룹' || gaGenderTerm === '여자') gaGender = '여자';
        if (gaGenderTerm === '보이그룹' || gaGenderTerm === '남자') gaGender = '남자';
        var gaKeyword = genAggMatch[3].trim();
        // 단순 목록/리스트 요청은 기존 generation_filter로 처리
        if (gaKeyword && !/^(목록|리스트|누구)$/.test(gaKeyword)) {
            return {
                type: 'cross_group_search',
                generation: gaGen,
                gender: gaGender,
                keyword: gaKeyword
            };
        }
    }

    // 3-2. "{그룹} 몇명" / "{그룹} 멤버 몇명/몇 명" / "{그룹} 인원" / "{그룹} 멤버 수"
    var countMatch = q.match(/^(.+?)\s*(?:멤버\s*)?(?:몇\s*명|몇명|인원수?|멤버\s*수)\s*[?？]?$/);
    if (countMatch) {
        var gCount = findGroupByName(countMatch[1].trim());
        if (gCount) {
            return { type: 'group_field', group: gCount, field: '멤버수' };
        }
    }

    // 3-2a. 크로스그룹 멤버수/앨범수 필터: "멤버 10명 이상 그룹", "앨범 30개 이상 그룹"
    var memberCountMatch = q.match(/^멤버\s*(\d+)\s*명\s*(이상|이하|인)\s*(?:그룹|아이돌)?\s*$/);
    if (memberCountMatch) {
        return {
            type: 'member_count_filter',
            count: parseInt(memberCountMatch[1]),
            direction: memberCountMatch[2] === '이하' ? 'lte' : 'gte'
        };
    }
    var albumCountMatch = q.match(/^앨범\s*(\d+)\s*개\s*(이상|이하)\s*(?:그룹|아이돌)?\s*$/);
    if (albumCountMatch) {
        return {
            type: 'album_count_filter',
            count: parseInt(albumCountMatch[1]),
            direction: albumCountMatch[2] === '이하' ? 'lte' : 'gte'
        };
    }

    // 3-3. "{그룹} 최근/최신 앨범" / "{그룹} 신보" / "{그룹} 최근 컴백일자"
    // "새 앨범", "최신 앨범", "신보", "컴백", "컴백일", "컴백일자" 등 최근 앨범 조회
    var recentAlbumMatch = q.match(/^(.+?)\s*(?:최근|최신|신보|새|마지막|latest)\s*(?:앨범|컴백일자?|컴백|활동)?\s*$/i);
    if (!recentAlbumMatch) {
        // "컴백일자", "컴백일", "컴백 일정" 단독 키워드도 매칭
        recentAlbumMatch = q.match(/^(.+?)\s*컴백\s*(?:일자?|날짜|일정)?\s*$/i);
    }
    if (recentAlbumMatch) {
        var gRecent = findGroupByName(recentAlbumMatch[1].trim());
        if (gRecent) {
            return { type: 'recent_album', group: gRecent };
        }
    }

    // 3-3a. 그룹 없는 캘린더 일정 조회: "컴백 일정", "이번달 컴백", "다음달 컴백", "컴백 스케줄"
    var calendarScheduleMatch = q.match(/^(?:이번\s*달|다음\s*달|이달|다음달|금월|차월)?\s*(?:컴백\s*(?:일정|스케줄|달력|캘린더)|아이돌\s*컴백|컴백\s*예정|예정\s*컴백)\s*$/i);
    if (calendarScheduleMatch) {
        // "다음달" 키워드 → 2개월 조회, 그 외 기본 3개월
        var calMonths = /다음\s*달|다음달|차월/.test(q) ? 2 : 3;
        return { type: 'calendar_schedule', months: calMonths };
    }

    // 3-3b. "{그룹} {플랫폼} 팔로워/구독자" → group_sns (특정 플랫폼)
    var snsPlatformRegex = new RegExp('^(.+?)\\s+(' + SNS_PLATFORM_REGEX_STR + ')\\s*(팔로워|구독자|링크|채널)?\\s*$', 'i');
    var snsPlatMatch = q.match(snsPlatformRegex);
    if (snsPlatMatch) {
        var gSnsP = findGroupByName(snsPlatMatch[1].trim());
        if (gSnsP) {
            var platKey = snsPlatMatch[2].toLowerCase();
            var resolved = SNS_PLATFORM_ALIASES[platKey];
            // resolved === undefined → 키 없음(매칭 오류), null → 미추적 플랫폼
            return { type: 'group_sns', group: gSnsP, platform: resolved, platformInput: snsPlatMatch[2] };
        }
    }

    // 3-3c. "{그룹} SNS/팔로워/팔로워수" → group_sns (전체 플랫폼)
    var snsAllMatch = q.match(/^(.+?)\s*(sns|SNS|팔로워|구독자|팔로워수)\s*$/);
    if (snsAllMatch) {
        var gSnsA = findGroupByName(snsAllMatch[1].trim());
        if (gSnsA) {
            return { type: 'group_sns', group: gSnsA, platform: undefined };
        }
    }

    // 3-4. "{그룹} 디스코그래피" / "{그룹} 앨범 목록" / "{그룹} 전체 앨범"
    // 앨범 전체 목록을 정형 테이블로 렌더링 (raw_text 아닌 구조화 데이터 사용)
    var discographyMatch = q.match(/^(.+?)\s*(?:디스코그래피|discography|앨범\s*(?:목록|리스트|전체|일람)|전체\s*앨범|음반\s*(?:목록|리스트)|발매\s*목록)\s*$/i);
    if (discographyMatch) {
        var gDisco = findGroupByName(discographyMatch[1].trim());
        if (gDisco) {
            return { type: 'discography', group: gDisco };
        }
    }

    // 3-5. "{그룹} 멤버 나이순" / "{그룹} 서열" / "{그룹} 연장자순"
    // 생년월일 데이터 기반 나이순 테이블 렌더링 (비정형 경로 방지)
    // 주의: "나이" 단독은 FIELD_ALIASES에서 "생년월일"로 매핑되므로 제외
    var memberAgeOrderMatch = q.match(/^(.+?)\s*(?:멤버들?\s*)?(?:나이순(?:으로)?|나이\s*순서|서열|연장자순|나이대)\s*$/i);
    if (memberAgeOrderMatch) {
        var gAge = findGroupByName(memberAgeOrderMatch[1].trim());
        if (gAge) {
            return { type: 'member_age_order', group: gAge };
        }
    }

    // 3-6. "{그룹} 최연소/막내/맏형" — 나이 극값 질의 (AGE_KEYWORDS 기반 결정론적 처리)
    for (var ageKey in AGE_KEYWORDS) {
        if (q.endsWith(ageKey) || q.endsWith(' ' + ageKey)) {
            var ageGroupPart = q.replace(new RegExp('\\s*(?:멤버\\s*)?' + escapeRegex(ageKey) + '$'), '').trim();
            var gAgeKw = findGroupByName(ageGroupPart);
            if (gAgeKw) {
                return {
                    type: 'member_age_extreme',
                    group: gAgeKw,
                    mode: AGE_KEYWORDS[ageKey] // 'youngest' or 'oldest'
                };
            }
        }
    }

    // 3-7. "{그룹} 외국인 멤버" — 출신지 기반 외국인 멤버 필터
    var foreignMatch = q.match(/^(.+?)\s*(?:외국인|해외|외국)\s*멤버\s*$/i);
    if (foreignMatch) {
        var gForeign = findGroupByName(foreignMatch[1].trim());
        if (gForeign) {
            return { type: 'foreign_member', group: gForeign };
        }
    }

    // 3-8. "{그룹} 정규앨범/미니앨범 몇 개/몇 장" — 앨범 유형별 카운트
    var albumTypeCountMatch = q.match(/^(.+?)\s*(정규앨범|미니앨범|싱글|리패키지|스페셜)\s*(?:몇\s*(?:개|장)|몇개|몇장|갯수|개수|수)\s*[?？]?\s*$/i);
    if (albumTypeCountMatch) {
        var gATC = findGroupByName(albumTypeCountMatch[1].trim());
        if (gATC) {
            return {
                type: 'album_type_count',
                group: gATC,
                albumType: albumTypeCountMatch[2]
            };
        }
    }

    // 4. 그룹 멤버 필드 테이블: "{그룹} 멤버 {필드}" (자연어 대응)
    // "멤버", "멤버들", "멤버의", "멤버들의", "멤버가", "멤버를", "맴버"(오타) 변형 처리
    // 주의: "이"는 제외 — "멤버이름"에서 "이"가 조사로 오소비되는 것을 방지
    //       ("멤버" 받침 없어 조사 "이"는 문법적으로 사용 안 됨 → "가"를 사용)
    var memberTableMatch = q.match(/^(.+?)\s*(?:멤버들?[의가를은는]?|맴버들?[의가를은는]?)\s*(.*)$/);
    if (memberTableMatch) {
        var gMT = findGroupByName(memberTableMatch[1]);
        if (gMT) {
            var fieldText = (memberTableMatch[2] || '').trim();
            // "몇 명/몇명/인원/인원수" → 멤버 수 응답
            if (/^(몇\s*명|인원|인원수|총\s*인원|몇\s*인)$/.test(fieldText)) {
                return {
                    type: 'member_count',
                    group: gMT
                };
            }
            // "프로필/정보/소개" → 전체 멤버 프로필 테이블 (주요 필드 모두 표시)
            if (/^(프로필|정보|소개|인적사항|전체|목록|리스트)$/.test(fieldText)) {
                return {
                    type: 'group_member_table',
                    group: gMT,
                    field: null,
                    fields: ['생년월일', '출신지', '키', '역할'],
                    isProfile: true,  // 프로필 모드: 빈 컬럼 자동 제거
                    unmatchedFields: []
                };
            }
            // 잔여 텍스트에서 복합 필드 추출 시도
            var parsed = extractFields(fieldText);
            var parsedFields = parsed ? parsed.fields : null;
            var unmatchedFields = parsed ? parsed.unmatched : [];
            // 단일 필드 폴백 (하위호환) — "등"/"들" 제거 후 조회
            var cleanedFieldText = fieldText ? fieldText.replace(/\s*등$/, '').replace(/들$/, '').trim() : '';
            var singleField = cleanedFieldText ? (FIELD_ALIASES[cleanedFieldText] || null) : null;
            // 필드 텍스트가 있지만 인식 불가 → 집계 / raw_text 검색
            // (예: "합류 순서" 등 비정형 질의)
            if (fieldText && !parsedFields && !singleField) {
                // 집계 키워드 감지: "평균키", "평균키는 얼마", "최대 키" 등
                var aggMatch = fieldText.match(/^(평균|최대|최소)\s*(.+)$/);
                if (aggMatch) {
                    // 잔여 표현 정리: "키는 얼마" → "키", "키 얼마" → "키", "나이가 몇" → "나이"
                    var aggField = aggMatch[2].replace(/[는은이가]?\s*(얼마|몇|어떻게|어떤|얼마나).*$/, '').trim();
                    if (aggField) {
                        return {
                            type: 'member_aggregate',
                            group: gMT,
                            operation: aggMatch[1],
                            fieldText: aggField
                        };
                    }
                }
                // 비정형 필드 → raw_text에서 키워드 검색 (Gemini 폴백 전 시도)
                return {
                    type: 'member_raw_search',
                    group: gMT,
                    fieldText: fieldText.replace(/[는은이가]?\s*(얼마|몇|어떻게|어떤|얼마나).*$/, '').trim()
                };
            } else {
                return {
                    type: 'group_member_table',
                    group: gMT,
                    field: singleField,           // 하위호환 유지
                    fields: parsedFields,          // 복합 필드 배열 (우선 사용)
                    unmatchedFields: unmatchedFields // 미인식 필드 (보조 raw_text 검색용)
                };
            }
        }
    }

    // 5. 그룹 앨범 초동: "{그룹} {N}집 초동" 또는 "{그룹} 앨범 초동"
    var albumSalesMatch = q.match(/^(.+?)\s*(?:(\d+)집|앨범)\s*초동\s*$/);
    if (albumSalesMatch) {
        var gAS = findGroupByName(albumSalesMatch[1]);
        if (gAS) {
            return {
                type: 'album_sales',
                group: gAS,
                albumNum: albumSalesMatch[2] ? parseInt(albumSalesMatch[2]) : null
            };
        }
    }

    // 5-a. "{그룹} 초동" / "{그룹} 앨범 판매량" / "{그룹} 초동 순위" — 전체 앨범 판매량 조회
    // FIELD_ALIASES '초동' → group_field 로 빠지는 것을 방지 (앨범 목록이 더 유용)
    var salesListMatch = q.match(/^(.+?)\s*(?:앨범\s*)?(?:초동|판매량|앨범판매)\s*(?:목록|리스트|순위)?\s*$/);
    if (salesListMatch) {
        var gSL = findGroupByName(salesListMatch[1].trim());
        if (gSL) {
            return { type: 'album_sales', group: gSL, albumNum: null };
        }
    }

    // 5-a2. "{그룹} 초동 판매량 가장 높은/많은 앨범", "{그룹} 앨범 초동 1위" 등 자연어 패턴
    // 긴 복합어 우선 매칭: "초동 판매량" → "초동"만 잡히면 그룹명에 "초동" 포함되는 버그 방지
    var salesNaturalMatch = q.match(/^(.+?)\s+(?:초동\s*판매량?|앨범\s*판매량?|초동|판매량|앨범\s*판매)\s+(?:가장\s+|제일\s+)?(?:높은|많은|좋은|잘\s*팔린|1위|제일)\s*(?:앨범|음반)?\s*$/);
    if (salesNaturalMatch) {
        var gSN = findGroupByName(salesNaturalMatch[1].trim());
        if (gSN) {
            return { type: 'album_sales', group: gSN, albumNum: null };
        }
    }

    // 5-b. "{그룹} {앨범명} 초동/발매일/누적" — 특정 앨범 조회
    var specificAlbumMatch = q.match(/^(.+?)\s+(.+?)\s+(초동|발매일|누적\s*판매량?|판매량)\s*$/);
    if (specificAlbumMatch) {
        var gSA = findGroupByName(specificAlbumMatch[1].trim());
        if (gSA) {
            return {
                type: 'specific_album_lookup',
                group: gSA,
                albumQuery: specificAlbumMatch[2].trim(),
                infoType: specificAlbumMatch[3].trim()
            };
        }
    }

    // 5-c. 복합 필드 쿼리: "{그룹} {필드1}와/과 {필드2}" 패턴
    //   예: "아이브 소속사와 데뷔일", "에스파 팬덤명이랑 소속사"
    var _mfText = q.replace(/[?？]$/, '').trim();
    var _mfParts = _mfText.split(/\s*(?:와|과|이랑|하고|및|,)\s*/);
    if (_mfParts.length >= 2) {
        // 첫 파트에서 그룹명 + 필드1 분리 (오른쪽에서부터 단어 조합 시도)
        var _firstWords = _mfParts[0].trim().split(/\s+/);
        var _mfGroup = null, _mfFields = [];
        for (var _fw = _firstWords.length - 1; _fw >= 1; _fw--) {
            var _gCand  = _firstWords.slice(0, _fw).join(' ');
            var _f1Cand = _firstWords.slice(_fw).join(' ');
            var _gCheck = findGroupByName(_gCand);
            if (_gCheck && FIELD_ALIASES[_f1Cand]) {
                _mfGroup = _gCheck;
                _mfFields.push(FIELD_ALIASES[_f1Cand]);
                break;
            }
        }
        if (_mfGroup) {
            var _mfValid = true;
            for (var _mp = 1; _mp < _mfParts.length; _mp++) {
                var _fStr = _mfParts[_mp].trim();
                if (FIELD_ALIASES[_fStr]) {
                    _mfFields.push(FIELD_ALIASES[_fStr]);
                } else {
                    _mfValid = false;
                    break;
                }
            }
            if (_mfValid && _mfFields.length >= 2) {
                return { type: 'group_multi_field', group: _mfGroup, fields: _mfFields };
            }
        }
    }

    // 6. 멤버 필드: "{멤버} {필드}" (멤버명 먼저 확인)
    for (var fieldKey in FIELD_ALIASES) {
        var fieldPattern = new RegExp('^(.+?)\\s*' + escapeRegex(fieldKey) + '\\s*[은는이가]?\\s*[?？]?$');
        var fieldMatch = q.match(fieldPattern);
        if (fieldMatch) {
            var memberName = fieldMatch[1].trim();
            var memberGroups = findMemberGroups(memberName);
            if (memberGroups.length > 0) {
                return {
                    type: 'member_field',
                    member: memberName,
                    field: FIELD_ALIASES[fieldKey],
                    groups: memberGroups
                };
            }
            // 그룹 필드도 시도
            var gField = findGroupByName(memberName);
            if (gField) {
                return {
                    type: 'group_field',
                    group: gField,
                    field: FIELD_ALIASES[fieldKey]
                };
            }
            // "{그룹} {멤버} {필드}" 패턴: "방탄소년단 뷔 포지션" → 그룹+멤버 분리
            var nameParts = memberName.split(/\s+/);
            for (var np = 1; np < nameParts.length; np++) {
                var gpForMem = nameParts.slice(0, np).join(' ');
                var memCandidate = nameParts.slice(np).join(' ');
                var gForMem = findGroupByName(gpForMem);
                if (gForMem) {
                    var memGroups = findMemberGroups(memCandidate);
                    if (memGroups.length > 0) {
                        return {
                            type: 'member_field',
                            member: memCandidate,
                            field: FIELD_ALIASES[fieldKey],
                            groups: memGroups
                        };
                    }
                }
            }
        }
    }

    // 6-1. "{그룹} {비정형키워드}" — FIELD_ALIASES에 없지만 그룹명으로 시작하는 쿼리
    //      "우아 mbti", "에스파 숙소", "르세라핌 논란" 등 → raw_text 검색
    var groupKeywordMatch = q.match(/^(.+?)\s+(\S+)$/);
    if (groupKeywordMatch) {
        var gGK = findGroupByName(groupKeywordMatch[1].trim());
        if (gGK) {
            var kwGK = groupKeywordMatch[2].trim();
            // FIELD_ALIASES에 이미 있으면 6번에서 처리됐을 것이므로 여기선 비정형만
            // 1글자도 허용하되 조사(을/를/이/가 등)는 제외
            if (!FIELD_ALIASES[kwGK] && kwGK.length >= 1 && !/^[을를이가은는의와과에도만로서]$/.test(kwGK)) {
                return {
                    type: 'group_raw_search',
                    group: gGK,
                    keyword: kwGK
                };
            }
        }
    }

    // 6-2. 다중 단어 키워드: "BTS 빌보드 핫100 1위" → group + "빌보드 핫100 1위"
    // 패턴 6-1은 마지막 단어만 캡처하므로, 2단어 이상 키워드는 여기서 처리
    var qWords = q.split(/\s+/);
    if (qWords.length >= 3) {
        for (var wi = 1; wi < qWords.length; wi++) {
            var groupPart = qWords.slice(0, wi).join(' ');
            var gMW = findGroupByName(groupPart);
            if (gMW) {
                var kwMW = qWords.slice(wi).join(' ').trim();
                if (kwMW.length >= 2) {
                    return { type: 'group_raw_search', group: gMW, keyword: kwMW };
                }
                break;  // 그룹은 찾았지만 키워드가 너무 짧으면 중단
            }
        }
    }

    // 6-3a. "{멤버} 어느 그룹" / "{멤버} 그룹" / "{멤버} 소속"
    // 6-3 (멤버+다중 키워드)보다 먼저 체크 — "혜인 어느 그룹"이 raw_search로 빠지는 것 방지
    var memberGroupMatch = q.match(/^(.+?)\s*(?:어느\s*그룹|그룹|소속|몇\s*인조)\s*[?？]?\s*$/);
    if (memberGroupMatch) {
        var mgName = memberGroupMatch[1].trim();
        var mgGroups = findMemberGroups(mgName);
        if (mgGroups.length > 0) {
            return { type: 'member_field', member: mgName, field: '소속사', groups: mgGroups };
        }
    }

    // 6-3. 멤버명 + 다중 키워드: "카리나 보컬 실력", "하니 해외 활동"
    if (qWords.length >= 3) {
        for (var mi = 1; mi < qWords.length; mi++) {
            var memberPart = qWords.slice(0, mi).join(' ');
            var memGroups = findMemberGroups(memberPart);
            if (memGroups.length > 0) {
                var kwMem = qWords.slice(mi).join(' ').trim();
                if (kwMem.length >= 2) {
                    return { type: 'member_raw_search', group: memGroups[0], member: memberPart, fieldText: kwMem };
                }
                break;
            }
        }
    }

    // 8. 단순 그룹명 → navigate
    var directGroup = findGroupByName(q);
    if (directGroup) {
        return { type: 'navigate', group: directGroup };
    }

    // 9. 단순 멤버명 → navigate (그룹 상세로)
    var directMember = findMemberGroups(q);
    if (directMember.length === 1) {
        return { type: 'navigate_member', member: q, group: directMember[0] };
    }
    if (directMember.length > 1) {
        return { type: 'disambiguate_member', member: q, groups: directMember };
    }

    // 매칭 실패 → null
    return null;
}


// ============================================================
// 인텐트 실행
// ============================================================

async function executeIntent(intent) {
    // 채팅 UI: AI 답변 영역(chatAiBody)에 렌더링
    var container = getChatAiBody() || document.getElementById('namuSmartAnswer');

    switch (intent.type) {
        case 'navigate':
            // 그룹 상세 페이지로 이동
            loadNamuGroupBySlug(intent.group.slug);
            return;

        case 'navigate_member':
            // 멤버 소속 그룹 상세 → 멤버 탭
            loadNamuGroupBySlug(intent.group.slug);
            return;

        case 'disambiguate_member':
            // 동명 멤버 선택 UI
            showDisambiguationUI(container, intent.member, intent.groups);
            return;

        case 'group_multi_field':
            await executeGroupMultiField(container, intent);
            return;

        case 'group_field':
            await executeGroupField(container, intent);
            return;

        case 'member_field':
            await executeMemberField(container, intent);
            return;

        case 'group_member_table':
            await executeGroupMemberTable(container, intent);
            return;

        case 'member_count':
            executeMemberCount(container, intent);
            return;

        case 'member_aggregate':
            await executeMemberAggregate(container, intent);
            return;

        case 'member_raw_search':
            await executeMemberRawSearch(container, intent);
            return;

        case 'group_raw_search':
            await executeGroupRawSearch(container, intent);
            return;

        case 'album_sales':
            await executeAlbumSales(container, intent);
            return;

        case 'comparison':
            await executeComparison(container, intent);
            return;

        case 'group_sns':
            await executeGroupSns(container, intent);
            return;

        case 'sns_ranking':
            await executeSnsRanking(container, intent);
            return;

        case 'sns_comparison':
            await executeSnsComparison(container, intent);
            return;

        case 'ranking_filter':
            await executeRankingFilter(container, intent);
            return;

        case 'album_sales_ranking':
            await executeAlbumSalesRanking(container, intent);
            return;

        case 'agency_filter':
            await executeAgencyFilter(container, intent);
            return;

        case 'generation_filter':
            await executeGenerationFilter(container, intent);
            return;

        case 'debut_year_filter':
            await executeDebutYearFilter(container, intent);
            return;

        case 'recent_album':
            await executeRecentAlbum(container, intent);
            return;

        case 'discography':
            await executeDiscography(container, intent);
            return;

        case 'member_age_order':
            await executeMemberAgeOrder(container, intent);
            return;

        case 'cross_group_search':
            await executeCrossGroupSearch(container, intent);
            return;

        case 'member_age_extreme':
            await executeMemberAgeExtreme(container, intent);
            return;

        case 'foreign_member':
            await executeForeignMember(container, intent);
            return;

        case 'album_type_count':
            await executeAlbumTypeCount(container, intent);
            return;

        case 'member_count_filter':
            await executeMemberCountFilter(container, intent);
            return;

        case 'album_count_filter':
            await executeAlbumCountFilter(container, intent);
            return;

        case 'specific_album_lookup':
            await executeSpecificAlbumLookup(container, intent);
            return;

        case 'calendar_schedule':
            await executeCalendarSchedule(container, intent);
            return;
    }
}


// ============================================================
// 인텐트별 실행 함수들
// ============================================================

// --- 그룹 필드 조회 ---
async function executeGroupMultiField(container, intent) {
    var detail = await fetchGroupDetail(intent.group.slug);
    if (!detail) {
        showSmartAnswer(container, '데이터 로드 실패', intent.group.name + '의 정보를 불러올 수 없습니다.', 'error');
        return;
    }

    var rows = '';
    for (var i = 0; i < intent.fields.length; i++) {
        var field = intent.fields[i];
        var value;
        if (field === '멤버수') {
            value = (detail.members || []).length + '명';
        } else if (detail.info && detail.info[field]) {
            value = detail.info[field];
        } else {
            value = '정보 없음';
        }
        rows += '<li class="list-group-item px-0 py-1 d-flex gap-2">' +
            '<strong style="min-width:4em;">' + escapeHtml(field) + '</strong>' +
            '<span>' + escapeHtml(String(value)) + '</span></li>';
    }

    var html = '<div class="chat-ai-content">';
    html += '<p style="margin-bottom:8px;"><strong>💡 ' + escapeHtml(intent.group.name) + '</strong></p>';
    html += '<ul class="list-group list-group-flush mb-2">' + rows + '</ul>';
    html += '<div class="chat-ai-detail-link"><a href="javascript:void(0)" onclick="loadNamuGroupBySlug(\'' +
        escapeSingleQuote(intent.group.slug) + '\')">상세 보기 →</a></div>';
    html += '</div>';
    container.innerHTML = html;

    var chatContainer = document.getElementById('namuSmartAnswer');
    if (chatContainer) chatContainer.style.display = 'flex';
}

async function executeGroupField(container, intent) {
    var detail = await fetchGroupDetail(intent.group.slug);
    if (!detail) {
        showSmartAnswer(container, '데이터 로드 실패', intent.group.name + '의 상세 정보를 불러올 수 없습니다.', 'error');
        return;
    }

    var field = intent.field;
    var value = '';

    if (field === '멤버수') {
        value = (detail.members || []).length + '명';
    } else if (detail.info && detail.info[field]) {
        value = detail.info[field];
    } else {
        value = '정보 없음';
    }

    showSmartAnswer(container, intent.group.name + '의 ' + field, value, 'info', intent.group.slug);
}

// --- 멤버 필드 조회 ---
async function executeMemberField(container, intent) {
    // 중복 멤버 처리
    if (intent.groups.length > 1) {
        showDisambiguationUI(container, intent.member, intent.groups);
        return;
    }

    var groupInfo = intent.groups[0];
    var detail = await fetchGroupDetail(groupInfo.slug);
    if (!detail) {
        showSmartAnswer(container, '데이터 로드 실패', '상세 정보를 불러올 수 없습니다.', 'error');
        return;
    }

    // 멤버 데이터에서 해당 필드 찾기
    var members = detail.members || [];
    var memberData = null;
    for (var i = 0; i < members.length; i++) {
        if (members[i].name === intent.member) {
            memberData = members[i];
            break;
        }
    }

    if (!memberData) {
        showSmartAnswer(container, intent.member, '멤버 상세 정보를 찾을 수 없습니다.', 'warning');
        return;
    }

    var field = intent.field;
    var value = memberData[field] || '정보 없음';
    var title = groupInfo.group_name + ' ' + intent.member + '의 ' + field;

    showSmartAnswer(container, title, value, 'info', groupInfo.slug);
}

// --- 멤버 수 응답 ---
function executeMemberCount(container, intent) {
    var g = intent.group;
    var members = g.members || [];
    var count = members.length || g.member_count || 0;
    var nameList = members.length > 0 ? members.join(', ') : '';

    var body = '<strong>' + count + '명</strong>';
    if (nameList) body += '<br><span class="text-muted">' + escapeHtml(nameList) + '</span>';

    var html = '<div class="namu-smart-answer">' +
        '<div class="namu-smart-answer-header">' +
        '<span class="namu-smart-icon">👥</span>' +
        '<span class="namu-smart-title">' + escapeHtml(g.name) + ' 멤버 수</span>' +
        '<button class="namu-smart-close" onclick="dismissSmartAnswer()" title="닫기">&times;</button>' +
        '</div>' +
        '<div class="namu-smart-answer-body">' + body +
        '<div class="namu-smart-detail-link mt-2">' +
        '<a href="javascript:void(0)" onclick="loadNamuGroupBySlug(\'' + escapeSingleQuote(g.slug) + '\')">' + escapeHtml(g.name) + ' 상세 보기 →</a>' +
        '</div></div></div>';

    container.innerHTML = html;
    container.style.display = 'block';
}

// --- 그룹 멤버 테이블 ---
async function executeGroupMemberTable(container, intent) {
    var detail = await fetchGroupDetail(intent.group.slug);
    if (!detail) {
        showSmartAnswer(container, '데이터 로드 실패', '상세 정보를 불러올 수 없습니다.', 'error');
        return;
    }

    var members = detail.members || [];
    if (members.length === 0) {
        showSmartAnswer(container, intent.group.name + ' 멤버', '멤버 정보가 없습니다.', 'warning');
        return;
    }

    // 표시할 필드 결정 (fields 배열 우선, field 단일값 폴백)
    var fields;
    if (intent.fields && intent.fields.length > 0) {
        fields = intent.fields;
    } else if (intent.field) {
        fields = [intent.field];
    } else {
        fields = ['생년월일', '출신지', '역할'];  // 기본값
    }

    // 프로필 모드: 전원 "없음"/빈값인 컬럼 자동 제거
    if (intent.isProfile) {
        fields = fields.filter(function(fld) {
            for (var pc = 0; pc < members.length; pc++) {
                var v = members[pc][fld];
                if (v && v !== '없음' && v !== '-') return true;
            }
            return false;
        });
        // 모든 컬럼이 비어도 최소 생년월일은 유지
        if (fields.length === 0) fields = ['생년월일'];
    }

    // 요청 필드가 멤버 데이터에 실제로 존재하는지 확인
    // 전원 빈값이면 raw_text 검색으로 폴백 (MBTI, 혈액형, 키 등)
    var hasAnyData = false;
    for (var fc = 0; fc < fields.length; fc++) {
        for (var mc = 0; mc < members.length; mc++) {
            if (members[mc][fields[fc]]) { hasAnyData = true; break; }
        }
        if (hasAnyData) break;
    }
    if (!hasAnyData && fields.length > 0 && fields[0] !== '생년월일') {
        // 필드명을 키워드로 사용하여 raw_text 검색으로 전환
        var rawKeyword = fields.join(' ');
        await executeMemberRawSearch(container, {
            group: intent.group,
            fieldText: rawKeyword,
            member: ''
        });
        return;
    }

    var html = '<div class="namu-smart-answer">' +
        '<div class="namu-smart-answer-header">' +
        '<span class="namu-smart-icon">👥</span>' +
        '<span class="namu-smart-title">' + escapeHtml(intent.group.name) + ' 멤버 정보</span>' +
        '<button class="namu-smart-close" onclick="dismissSmartAnswer()" title="닫기">&times;</button>' +
        '</div>' +
        '<div class="namu-smart-answer-body">' +
        '<div class="table-responsive"><table class="table table-sm namu-smart-table">' +
        '<thead><tr><th>이름</th>';

    for (var f = 0; f < fields.length; f++) {
        html += '<th>' + (FIELD_DISPLAY_NAMES[fields[f]] || fields[f]) + '</th>';
    }
    html += '</tr></thead><tbody>';

    for (var i = 0; i < members.length; i++) {
        var m = members[i];
        html += '<tr><td class="fw-bold">' + (m.name || '-') + '</td>';
        for (var ff = 0; ff < fields.length; ff++) {
            var val = m[fields[ff]] || '-';
            // info 필드: 60자 초과 시 말줄임 처리
            if (fields[ff] === 'info' && val.length > 60) {
                val = val.substring(0, 60) + '…';
            }
            html += '<td>' + escapeHtml(val) + '</td>';
        }
        html += '</tr>';
    }

    html += '</tbody></table></div>';

    // unmatchedFields가 있으면 보조 raw_text 검색 영역 추가
    if (intent.unmatchedFields && intent.unmatchedFields.length > 0) {
        var suppId = 'namu-supplementary-' + Date.now();
        html += '<div id="' + suppId + '" class="mt-2"></div>';
    }

    html += '<div class="namu-smart-detail-link">' +
        '<a href="javascript:void(0)" onclick="loadNamuGroupBySlug(\'' + escapeSingleQuote(intent.group.slug) + '\')">' + escapeHtml(intent.group.name) + ' 상세 보기 →</a>' +
        '</div></div></div>';

    container.innerHTML = html;
    container.style.display = 'block';

    // 보조 raw_text 검색 비동기 실행 (미인식 필드용)
    if (intent.unmatchedFields && intent.unmatchedFields.length > 0) {
        var capturedSuppId = suppId; // 클로저 캡처
        setTimeout(function() {
            var suppContainer = document.getElementById(capturedSuppId);
            if (suppContainer) {
                executeMemberRawSearch(suppContainer, {
                    group: intent.group,
                    fieldText: intent.unmatchedFields.join(' '),
                    member: ''
                });
            }
        }, 100);
    }
}

// --- 멤버 집계 (평균/최대/최소) — raw_text에서 원문 검색 ---
async function executeMemberAggregate(container, intent) {
    var group = intent.group;
    var op = intent.operation;       // "평균", "최대", "최소"
    var field = intent.fieldText;    // "키", "나이" 등

    // 그룹 상세에서 namu_url 가져오기
    var detail = await fetchGroupDetail(group.slug);
    var namuUrl = (detail && detail.namu_url) || '';

    try {
        // raw_text에서 "평균 키는 163.6cm이다" 같은 문장 검색
        var rawResponse = await fetch('/data/namu-raw/' + group.slug + '.txt?v=' + NAMU_DATA_VERSION);
        if (rawResponse.ok) {
            var rawText = await rawResponse.text();
            // 종결어미(이다/입니다) 또는 줄바꿈으로 끝 감지 (소수점 오매칭 방지)
            var pattern = new RegExp(
                op + '\\s*' + escapeRegex(field) + '[는은이가]?\\s*(.+?)(?:이다|이에요|입니다|이며|。|\\n|$)',
                'i'
            );
            var match = rawText.match(pattern);
            if (match) {
                // 매칭 위치에서 줄 전체를 추출 (원문 문장)
                var matchIdx = rawText.indexOf(match[0]);
                var lineStart = rawText.lastIndexOf('\n', matchIdx) + 1;
                var lineEnd = rawText.indexOf('\n', matchIdx + match[0].length);
                if (lineEnd === -1) lineEnd = rawText.length;
                var fullSentence = rawText.substring(lineStart, lineEnd).trim();

                // 원문 문장 + 나무위키 출처 링크 렌더링
                var title = group.name + '(' + group.name_en + ') ' + op + ' ' + field;
                var html = '<div class="namu-smart-answer">' +
                    '<div class="namu-smart-answer-header">' +
                    '<span class="namu-smart-icon">📊</span>' +
                    '<span class="namu-smart-title">' + escapeHtml(title) + '</span>' +
                    '<button class="namu-smart-close" onclick="dismissSmartAnswer()" title="닫기">&times;</button>' +
                    '</div>' +
                    '<div class="namu-smart-answer-body">' +
                    '<div class="namu-smart-answer-text" style="font-size:1.1rem;">' + escapeHtml(fullSentence) + '</div>' +
                    '</div>';

                // 나무위키 출처 링크
                if (namuUrl) {
                    html += '<div class="namu-smart-detail-link">' +
                        '<a href="' + escapeHtml(namuUrl) + '" target="_blank" rel="noopener">📚 나무위키에서 보기 →</a>' +
                        '</div>';
                }

                html += '</div>';
                container.innerHTML = html;
                container.style.display = 'block';

                trackEvent('namu_smart_search', {
                    query: group.name + ' 멤버 ' + op + ' ' + field,
                    method: 'raw_text_aggregate'
                });
                return;
            }
        }
    } catch (e) {
        console.warn('raw_text 집계 검색 실패:', e);
    }

    // raw_text에서 못 찾으면 Gemini 폴백
    var fallbackQuery = group.name + ' 멤버 ' + op + ' ' + field;
    var geminiResult = await callGeminiFlash(fallbackQuery);
    if (geminiResult && geminiResult._aborted) return; // 새 검색으로 취소됨
    if (geminiResult && !geminiResult._error) {
        renderGeminiAnswer(container, geminiResult);
        trackEvent('namu_smart_search', { query: fallbackQuery, method: 'gemini' });
    } else {
        showSmartAnswer(container, group.name + ' 멤버 ' + op + ' ' + field,
            '해당 정보를 찾을 수 없습니다.', 'warning', group.slug);
    }
}

// --- 멤버 비정형 필드 — raw_text 키워드 검색 ---
// 노이즈 라인 필터용: 나무위키 보일러플레이트, 페이지 제목, 짧은 네비게이션
var RAW_TEXT_NOISE = /나무위키는|나무위키가 |^[A-Z\s/\-]+$|^[\.\s]*\[편집\]|자세한 내용은|문서를 참고하십시오|^\.\s/;
// 트랙리스트(작사|작곡|편곡 크레딧) 라인 필터
var RAW_TEXT_TRACKLIST = /[｜\|]{2,}|작사\s*작곡|트랙\s*곡명/;
// 다중 단어 키워드 분해 시 제외할 일반 수식어 (너무 흔해서 노이즈만 유발)
var RAW_TEXT_KW_STOPWORDS = /^(상황|경우|현황|정보|내용|관련|방법|이유|결과|현재|최근|지금|어떻게|뭐|무엇|어디|언제|왜|얼마|몇)$/;

function scoreRawLine(line, keyword) {
    var score = 0;
    // 노이즈 라인 제외 (보일러플레이트 + 트랙리스트)
    if (RAW_TEXT_NOISE.test(line)) return -1;
    if (RAW_TEXT_TRACKLIST.test(line)) return -1;
    // 키워드가 독립 단어로 등장 (앞글자가 한글/영문이 아닌 경우)
    // "평균 키는" → 앞이 공백 → OK / "나무위키" → 앞이 "위"(한글) → 제외
    var independentPattern = new RegExp('(?:^|[^가-힣a-zA-Z])' + escapeRegex(keyword), 'i');
    if (independentPattern.test(line)) score += 50;
    else return -1;  // "나무위키", "몽키즈" 등 단어 내부 매칭 제외
    // 숫자/단위 포함 (정량적 정보)
    if (/\d/.test(line)) score += 30;
    if (/cm|kg|세|명|만|억/.test(line)) score += 20;
    // "멤버" 관련 컨텍스트
    if (/멤버|평균|최대|최소|전원|모두/.test(line)) score += 20;
    // 적절한 길이 (너무 짧거나 너무 길면 감점)
    if (line.length >= 10 && line.length <= 200) score += 10;
    return score;
}

async function executeMemberRawSearch(container, intent) {
    var group = intent.group;
    var keyword = intent.fieldText;  // "키", "MBTI" 등
    var memberName = intent.member || '';  // "카리나" 등 (6-3 패턴에서 전달)
    var detail = await fetchGroupDetail(group.slug);
    var namuUrl = (detail && detail.namu_url) || '';

    // 멤버명+키워드 조합 검색어 구성
    var searchTerms = [keyword.toLowerCase()];
    if (memberName) {
        searchTerms.push(memberName.toLowerCase());
    }

    try {
        var rawResponse = await fetch('/data/namu-raw/' + group.slug + '.txt?v=' + NAMU_DATA_VERSION);
        if (rawResponse.ok) {
            var rawText = await rawResponse.text();
            var lines = rawText.split('\n');
            var scored = [];
            for (var i = 0; i < lines.length; i++) {
                var trimmed = lines[i].trim();
                if (trimmed.length <= 5) continue;
                var lineLower = trimmed.toLowerCase();
                // 멤버명이 있으면 멤버명+키워드 모두 포함된 라인 우선, 키워드만 포함도 허용
                var hasKeyword = lineLower.indexOf(keyword.toLowerCase()) !== -1;
                var hasMember = memberName ? lineLower.indexOf(memberName.toLowerCase()) !== -1 : false;
                if (!hasKeyword && !hasMember) continue;
                var s = scoreRawLine(trimmed, keyword);
                if (s <= 0) continue;
                // 멤버명+키워드 동시 매칭 시 보너스
                if (memberName && hasMember && hasKeyword) s += 40;
                else if (memberName && hasMember) s += 20;
                scored.push({ text: trimmed, score: s });
            }

            // 점수 내림차순 정렬
            scored.sort(function(a, b) { return b.score - a.score; });

            // 다중 단어 키워드: 정확 매칭 실패 시 개별 단어로 재검색
            if (scored.length === 0 && keyword.indexOf(' ') !== -1) {
                var subKws = keyword.split(/\s+/).filter(function(w) { return w.length >= 2 && !RAW_TEXT_KW_STOPWORDS.test(w); });
                if (subKws.length > 0) {
                    // ② -a. 근접 윈도우 우선: 모든 서브 키워드가 forward 500자 이내에 공존
                    if (subKws.length >= 2) {
                        var _mProxResult = _findProximityWindow(rawText, subKws, 500);
                        if (_mProxResult) {
                            scored = [{ text: _mProxResult, score: 75 }];
                        }
                    }
                }
                if (subKws.length > 0 && scored.length === 0) {
                    for (var si = 0; si < lines.length; si++) {
                        var sTrimmed = lines[si].trim();
                        if (sTrimmed.length <= 5) continue;
                        if (RAW_TEXT_NOISE.test(sTrimmed)) continue;
                        if (RAW_TEXT_TRACKLIST.test(sTrimmed)) continue;
                        var sLower = sTrimmed.toLowerCase();
                        // 멤버명 보너스 확인
                        var subHasMember = memberName ? sLower.indexOf(memberName.toLowerCase()) !== -1 : false;
                        // 개별 키워드 매칭 수 확인
                        var matchCnt = 0;
                        for (var sk = 0; sk < subKws.length; sk++) {
                            if (sLower.indexOf(subKws[sk].toLowerCase()) !== -1) matchCnt++;
                        }
                        if (matchCnt === 0 && !subHasMember) continue;
                        // 키워드 매칭 수에 비례하는 점수
                        var subScore = 30 * matchCnt;
                        if (/\d/.test(sTrimmed)) subScore += 20;
                        if (/cm|kg|세|명|만|억|위|주|회|개/.test(sTrimmed)) subScore += 15;
                        if (sTrimmed.length >= 10 && sTrimmed.length <= 200) subScore += 10;
                        if (subHasMember && matchCnt > 0) subScore += 40;
                        else if (subHasMember) subScore += 20;
                        if (subScore > 0) scored.push({ text: sTrimmed, score: subScore });
                    }
                    scored.sort(function(a, b) { return b.score - a.score; });
                }
            }

            // 라인 검색 모두 실패 시: 전체 텍스트 전수 스캔 → 숫자 밀도가 가장 높은 윈도우 선택
            // (나무위키 raw txt가 단어별 토큰화되어 있어 키워드가 짧은 단독 라인일 때 대응)
            if (scored.length === 0) {
                var _winKw = (keyword || '').toLowerCase();
                var _rawLower = rawText.toLowerCase();
                var _bestWinText = null;
                var _bestWinScore = -Infinity;
                var _scanPos = 0;
                while (_scanPos < rawText.length) {
                    var _wIdx = _rawLower.indexOf(_winKw, _scanPos);
                    if (_wIdx === -1) break;
                    // 앞 80자 + 뒤 150자 (300자이면 인접 섹션까지 포함되어 노이즈 발생)
                    var _wStart = Math.max(0, _wIdx - 80);
                    var _wEnd = Math.min(rawText.length, _wIdx + 150);
                    while (_wStart > 0 && rawText[_wStart - 1] !== '\n') _wStart--;
                    while (_wEnd < rawText.length && rawText[_wEnd] !== '\n') _wEnd++;
                    var _wCtx = rawText.slice(_wStart, _wEnd)
                        .replace(/\[편집\]/g, '')
                        .replace(/\[\d+\]/g, '')
                        .replace(/자세한 내용은[^\n]*/g, '')
                        .replace(/문서를 참고하십시오[^\n]*/g, '')
                        .replace(/\n+/g, ' ')
                        .replace(/\s{2,}/g, ' ')
                        .trim();
                    if (_wCtx.length < 15) { _scanPos = _wIdx + 1; continue; }
                    // 4자리 연도만 카운트 (섹션번호 10~15 같은 2자리 숫자까지 제외)
                    var _wDigits = (_wCtx.match(/\d{4}/g) || []).length;
                    // yyyy.mm 형식 날짜 패턴은 트랙리스트/앨범 목록 지표 → 패널티 적용
                    var _wDateEntries = (_wCtx.match(/\d{4}\.\s*\d{2}/g) || []).length;
                    // dots 패널티 제거 — 콘텐츠 내 마침표가 정상 텍스트도 불이익 주는 문제 방지
                    var _wQScore = _wDigits - _wDateEntries * 5;
                    if (_wQScore > _bestWinScore) {
                        _bestWinScore = _wQScore;
                        _bestWinText = _wCtx;
                    }
                    _scanPos = _wIdx + 1;
                }
                if (_bestWinText) {
                    scored.push({ text: _bestWinText, score: 45 });
                }
            }

            if (scored.length > 0) {
                // 1위 대비 점수 75% 이상인 결과만 표시 (노이즈 제거), 최대 3개
                var topScore = scored[0].score;
                var sentences = scored.filter(function(s) { return s.score >= topScore * 0.75; }).slice(0, 3);
                var synthesizeQuery = memberName
                    ? group.group_name + ' ' + memberName + ' ' + keyword
                    : group.name + ' 멤버 ' + keyword;

                // Multi-Hit Aggregation: 키워드 히트 주변 ±80줄 병합 (정보 누락 방지)
                var wideCtxM = buildWideContext(lines, keyword, 200);
                var rawCtx = wideCtxM || sentences.map(function(s) { return s.text; }).join('\n');

                // Gemini Synthesis Layer: raw text → 정제된 마크다운 답변 자동 생성
                updateSearchProgress(container, 3, 'AI가 답변을 정리하는 중...');
                var synthResult = await callGeminiNamuSynthesize(
                    synthesizeQuery, rawCtx,
                    currentSearchAbortController ? currentSearchAbortController.signal : null
                );
                if (synthResult && synthResult._aborted) return;
                if (synthResult && !synthResult._error) {
                    // 정제 성공 → 마크다운 답변 표시
                    renderGeminiAnswer(container, synthResult);
                    trackEvent('namu_smart_search', {
                        query: synthesizeQuery, method: 'raw_synthesized'
                    });
                    return;
                }

                // Gemini 실패/API 키 없음 → raw 텍스트로 폴백
                var title = group.name + '(' + group.name_en + ') ' + keyword;
                var html = '<div class="namu-smart-answer">' +
                    '<div class="namu-smart-answer-header">' +
                    '<span class="namu-smart-icon">📖</span>' +
                    '<span class="namu-smart-title">' + escapeHtml(title) + '</span>' +
                    '<button class="namu-smart-close" onclick="dismissSmartAnswer()" title="닫기">&times;</button>' +
                    '</div>' +
                    '<div class="namu-smart-answer-body">';

                for (var j = 0; j < sentences.length; j++) {
                    html += '<div class="namu-smart-answer-text' + (j > 0 ? ' mt-2 pt-2 border-top' : '') +
                        '" style="font-size:1.05rem;">' + escapeHtml(sentences[j].text) + '</div>';
                }
                html += '</div>';

                // "AI로 정리하기" 버튼 + 나무위키 링크
                html += '<div class="namu-smart-detail-link d-flex justify-content-between align-items-center">';
                html += '<button class="btn btn-sm btn-outline-primary" ' +
                    'onclick="synthesizeWithGemini(this, \'' + escapeSingleQuote(synthesizeQuery) + '\')" ' +
                    'data-raw-context="' + escapeHtml(rawCtx) + '">' +
                    '🤖 AI로 정리하기</button>';
                if (namuUrl) {
                    html += '<a href="' + escapeHtml(namuUrl) + '" target="_blank" rel="noopener">📚 나무위키에서 보기 →</a>';
                }
                html += '</div>';

                html += '</div>';
                container.innerHTML = html;
                container.style.display = 'block';

                trackEvent('namu_smart_search', {
                    query: group.name + ' 멤버 ' + keyword,
                    method: 'raw_text_search',
                    results: scored.length
                });
                return;
            }
        }
    } catch (e) {
        console.warn('raw_text 키워드 검색 실패:', e);
    }

    // raw_text에서 못 찾으면 Gemini 폴백
    var fallbackQuery = memberName
        ? group.group_name + ' ' + memberName + ' ' + keyword
        : group.name + ' 멤버 ' + keyword;
    var geminiResult = await callGeminiFlash(fallbackQuery);
    if (geminiResult && geminiResult._aborted) return; // 새 검색으로 취소됨
    if (geminiResult && !geminiResult._error) {
        renderGeminiAnswer(container, geminiResult);
        trackEvent('namu_smart_search', { query: fallbackQuery, method: 'gemini' });
    } else {
        showSmartAnswer(container, (memberName || group.name) + ' ' + keyword,
            '해당 정보를 찾을 수 없습니다.', 'warning', group.slug);
    }
}

// --- 막내/최연장 등 나이 관련 키워드 → 멤버 생년월일에서 자동 계산 폴백 ---
// raw_text에 "막내" 정보가 없을 때 멤버 생년월일 데이터로 직접 계산하여 답변
function tryMemberAgeFallback(container, group, detail, keyword, namuUrl) {
    var mode = AGE_KEYWORDS[keyword];
    if (!mode) return false; // 나이 관련 키워드 아님
    if (!detail || !detail.members || detail.members.length === 0) return false;

    // 생년월일 파싱 가능한 멤버만 필터링 (YYYY.MM.DD / YYYY-MM-DD 지원)
    var membersWithDate = [];
    for (var i = 0; i < detail.members.length; i++) {
        var m = detail.members[i];
        var bd = m['생년월일'] || '';
        var match = bd.match(/(\d{4})[.\-\/](\d{1,2})[.\-\/](\d{1,2})/);
        if (match) {
            membersWithDate.push({
                name: m.name,
                본명: m['본명'] || '',
                생년월일: bd,
                역할: m['역할'] || '',
                // Date 객체로 비교용
                date: new Date(parseInt(match[1]), parseInt(match[2]) - 1, parseInt(match[3]))
            });
        }
    }
    if (membersWithDate.length === 0) return false;

    // youngest: 가장 늦은 생년월일(큰 값), oldest: 가장 이른 생년월일(작은 값)
    membersWithDate.sort(function(a, b) {
        return mode === 'youngest' ? b.date - a.date : a.date - b.date;
    });
    var target = membersWithDate[0];
    var label = mode === 'youngest' ? '막내' : '최연장';

    // 만 나이 계산 헬퍼
    var today = new Date();
    function calcAge(d) {
        var age = today.getFullYear() - d.getFullYear();
        if (today.getMonth() < d.getMonth() ||
            (today.getMonth() === d.getMonth() && today.getDate() < d.getDate())) {
            age--;
        }
        return age;
    }

    var title = group.name + '(' + (group.name_en || '') + ') ' + label;
    var targetAge = calcAge(target.date);

    // 대표 답변 + 전체 멤버 생년월일 테이블 렌더링
    var html = '<div class="namu-smart-answer">' +
        '<div class="namu-smart-answer-header">' +
        '<span class="namu-smart-icon">🎂</span>' +
        '<span class="namu-smart-title">' + escapeHtml(title) + '</span>' +
        '<button class="namu-smart-close" onclick="dismissSmartAnswer()" title="닫기">&times;</button>' +
        '</div>' +
        '<div class="namu-smart-answer-body">' +
        '<div class="namu-smart-answer-text" style="font-size:1.05rem; margin-bottom:10px;">' +
        '<strong>' + escapeHtml(target.name) + '</strong>' +
        (target.본명 && target.본명 !== target.name ? ' (' + escapeHtml(target.본명) + ')' : '') +
        ' — ' + escapeHtml(target.생년월일) + ' (만 ' + targetAge + '세)' +
        (target.역할 ? ' / ' + escapeHtml(target.역할) : '') +
        '</div>';

    // 전체 멤버 테이블 (연장자 순)
    var allByAge = membersWithDate.slice().sort(function(a, b) { return a.date - b.date; });
    html += '<table class="table table-sm table-bordered mt-2" style="font-size:0.9rem;">' +
        '<thead><tr><th>멤버</th><th>생년월일</th><th>나이</th></tr></thead><tbody>';
    for (var j = 0; j < allByAge.length; j++) {
        var mem = allByAge[j];
        var mAge = calcAge(mem.date);
        var isTarget = (mem.name === target.name);
        html += '<tr' + (isTarget ? ' style="background-color:#fff3cd;"' : '') + '>' +
            '<td>' + escapeHtml(mem.name) + (isTarget ? ' ⭐' : '') + '</td>' +
            '<td>' + escapeHtml(mem.생년월일) + '</td>' +
            '<td>만 ' + mAge + '세</td></tr>';
    }
    html += '</tbody></table></div>';

    if (namuUrl) {
        html += '<div class="namu-smart-detail-link">' +
            '<a href="' + escapeHtml(namuUrl) + '" target="_blank" rel="noopener">📚 나무위키에서 보기 →</a>' +
            '</div>';
    }
    html += '</div>';

    container.innerHTML = html;
    container.style.display = 'block';
    trackEvent('namu_smart_search', {
        query: group.name + ' ' + keyword, method: 'member_age_calc', result: target.name
    });
    return true;
}

// --- 멀티 키워드 근접 윈도우 헬퍼 ---
// tokenized 텍스트에서 "UN 연설"처럼 각 단어가 별도 라인에 있을 때,
// 첫 번째 서브 키워드 이후 forwardSpan 내에 나머지 키워드가 모두 등장하는 최적 구간 반환.
function _findProximityWindow(rawText, subKws, forwardSpan) {
    if (!subKws || subKws.length < 2) return null;
    var rawLower = rawText.toLowerCase();
    var anchor = subKws[0].toLowerCase();
    var others = subKws.slice(1).map(function(kw) { return kw.toLowerCase(); });
    var bestText = null, bestScore = -Infinity;
    var pos = 0;
    while (pos < rawText.length) {
        var idx = rawLower.indexOf(anchor, pos);
        if (idx === -1) break;
        // anchor 이후 forwardSpan 범위에서만 나머지 키워드 탐색 (전방향)
        var fwdEnd = Math.min(rawText.length, idx + forwardSpan);
        var fwd = rawLower.slice(idx, fwdEnd);
        var allFound = others.every(function(kw) { return fwd.indexOf(kw) !== -1; });
        if (allFound) {
            var start = Math.max(0, idx - 80);
            while (start > 0 && rawText[start - 1] !== '\n') start--;
            var end = Math.min(rawText.length, idx + 200); // 200자: 루이비통 등 연속 콘텐츠 누락 방지
            while (end < rawText.length && rawText[end] !== '\n') end++;
            var ctx = rawText.slice(start, end)
                .replace(/\[편집\]/g, '')
                .replace(/\[\d+\]/g, '')
                .replace(/자세한 내용은[^\n]*/g, '')
                .replace(/문서를 참고하십시오[^\n]*/g, '')
                .replace(/\n+/g, ' ')
                .replace(/\s{2,}/g, ' ')
                .trim();
            if (ctx.length < 15) { pos = idx + 1; continue; }
            // 추출된 window 내에도 모든 키워드가 실제로 있는지 재확인
            // (qualify는 500자 기준이지만 window는 150자 → 불일치 방지)
            var ctxLower = ctx.toLowerCase();
            var allInCtx = [anchor].concat(others).every(function(kw) { return ctxLower.indexOf(kw) !== -1; });
            if (!allInCtx) { pos = idx + 1; continue; }
            var digits = (ctx.match(/\d{4}/g) || []).length;
            var dateEntries = (ctx.match(/\d{4}\.\s*\d{2}/g) || []).length;
            var q = digits - dateEntries * 5 + 5; // 근접 보너스 +5
            if (q > bestScore) { bestScore = q; bestText = ctx; }
        }
        pos = idx + 1;
    }
    return bestText;
}

// --- 그룹 비정형 키워드 — raw_text 검색 ("우아 mbti", "에스파 숙소") ---
async function executeGroupRawSearch(container, intent) {
    var group = intent.group;
    var keyword = intent.keyword;
    var detail = await fetchGroupDetail(group.slug);
    var namuUrl = (detail && detail.namu_url) || '';

    // info 필드 키 직접 매칭 (공백 제거 후 비교)
    // "훈장"→info["훈장"], "그룹명 뜻"→info["그룹명뜻"], "응원봉"→info["응원봉"]
    if (detail && detail.info) {
        var kwNorm = keyword.replace(/\s/g, '').toLowerCase();
        for (var infoKey in detail.info) {
            if (infoKey.replace(/\s/g, '').toLowerCase() === kwNorm) {
                var infoVal = detail.info[infoKey];
                if (infoVal) {
                    showSmartAnswer(container, group.name + ' ' + keyword, infoVal, 'info', group.slug);
                    trackEvent('namu_smart_search', {
                        query: group.name + ' ' + keyword, method: 'info_field'
                    });
                    return;
                }
            }
        }
    }

    try {
        // 진행 표시: 원문 탐색
        updateSearchProgress(container, 2, '원문 데이터에서 관련 내용 탐색 중...');
        var rawResponse = await fetch('/data/namu-raw/' + group.slug + '.txt?v=' + NAMU_DATA_VERSION);
        if (rawResponse.ok) {
            var rawText = await rawResponse.text();
            var lines = rawText.split('\n');
            // 불용어 제거한 핵심 검색어 (예: "숙소 상황" → "숙소")
            var _kwCore = keyword.split(/\s+/).filter(function(w) {
                return w.length >= 2 && !RAW_TEXT_KW_STOPWORDS.test(w);
            }).join(' ').trim();
            var _kwSearch = _kwCore || keyword;
            var scored = [];
            var _ctxAdded = {};  // 중복 라인 방지 (인덱스 → true)
            for (var i = 0; i < lines.length; i++) {
                var trimmed = lines[i].trim();
                if (trimmed.length <= 5) continue;
                // 핵심 키워드로 검색 (불용어 제거 후)
                if (trimmed.toLowerCase().indexOf(_kwSearch.toLowerCase()) === -1) continue;
                var s = scoreRawLine(trimmed, _kwSearch);
                if (s <= 0) continue;
                // 짧고 숫자 없는 라인 = 섹션 헤더 감지 (예: "광고 및 홍보대사")
                var _isHeader = trimmed.length < 25 && !/\d/.test(trimmed);
                if (!_ctxAdded[i]) {
                    // 섹션 헤더는 낮은 점수 (실제 내용 라인보다 후순위)
                    scored.push({ text: trimmed, score: _isHeader ? Math.round(s * 0.3) : s });
                    _ctxAdded[i] = true;
                }
                if (_isHeader) {
                    // 섹션 헤더 이후 5줄을 컨텍스트로 포함 (실제 목록/내용이 아래에 위치)
                    for (var _j = i + 1; _j < Math.min(i + 6, lines.length); _j++) {
                        if (_ctxAdded[_j]) continue;
                        var _ctx = lines[_j].trim();
                        if (_ctx.length <= 5) continue;
                        if (RAW_TEXT_NOISE.test(_ctx) || RAW_TEXT_TRACKLIST.test(_ctx)) continue;
                        _ctxAdded[_j] = true;
                        scored.push({ text: _ctx, score: Math.round(s * 0.7) });
                    }
                }
            }

            // 다중 단어 키워드: 핵심어 정확 매칭도 실패 시 개별 단어로 재검색
            if (scored.length === 0 && _kwSearch.indexOf(' ') !== -1) {
                var subKws = _kwSearch.split(/\s+/).filter(function(w) { return w.length >= 2 && !RAW_TEXT_KW_STOPWORDS.test(w); });
                if (subKws.length > 0) {
                    // ② -a. 근접 윈도우 우선: 모든 서브 키워드가 forward 500자 이내에 공존
                    // tokenized 텍스트에서 "UN 연설"처럼 각 단어가 별도 라인에 있을 때 대응
                    if (subKws.length >= 2) {
                        var _proxResult = _findProximityWindow(rawText, subKws, 500);
                        if (_proxResult) {
                            scored = [{ text: _proxResult, score: 75 }];
                        }
                    }
                }
                if (subKws.length > 0 && scored.length === 0) {
                    for (var si = 0; si < lines.length; si++) {
                        var sTrimmed = lines[si].trim();
                        if (sTrimmed.length <= 5) continue;
                        if (RAW_TEXT_NOISE.test(sTrimmed)) continue;
                        if (RAW_TEXT_TRACKLIST.test(sTrimmed)) continue;
                        // 개별 키워드 매칭 수 확인
                        var sLower = sTrimmed.toLowerCase();
                        var matchCnt = 0;
                        for (var sk = 0; sk < subKws.length; sk++) {
                            if (sLower.indexOf(subKws[sk].toLowerCase()) !== -1) matchCnt++;
                        }
                        if (matchCnt === 0) continue;
                        // 키워드 매칭 수에 비례하는 점수
                        var subScore = 30 * matchCnt;
                        if (/\d/.test(sTrimmed)) subScore += 20;
                        if (/cm|kg|세|명|만|억|위|주|회|개/.test(sTrimmed)) subScore += 15;
                        if (sTrimmed.length >= 10 && sTrimmed.length <= 200) subScore += 10;
                        scored.push({ text: sTrimmed, score: subScore });
                    }
                    scored.sort(function(a, b) { return b.score - a.score; });
                }
            }

            // 라인 검색 결과 없거나 품질 낮을 때: 전체 텍스트 전수 스캔 → 숫자 밀도가 가장 높은 윈도우 선택
            // topScore <= 35 = 헤더 파생 컨텍스트(score=round(header*0.7)≤35)만 있어 실제 내용이 없을 가능성
            scored.sort(function(a, b) { return b.score - a.score; });
            var _needsWin = scored.length === 0 || (scored.length > 0 && scored[0].score <= 35);
            if (_needsWin) {
                var _gWinKw = (_kwSearch || keyword).toLowerCase();
                var _gRawLower = rawText.toLowerCase();
                var _gBestWinText = null;
                var _gBestWinScore = -Infinity;
                var _gScanPos = 0;
                while (_gScanPos < rawText.length) {
                    var _gwIdx = _gRawLower.indexOf(_gWinKw, _gScanPos);
                    if (_gwIdx === -1) break;
                    var _gwStart = Math.max(0, _gwIdx - 80);
                    var _gwEnd = Math.min(rawText.length, _gwIdx + 200); // 200자: 루이비통 등 연속 콘텐츠 누락 방지
                    while (_gwStart > 0 && rawText[_gwStart - 1] !== '\n') _gwStart--;
                    while (_gwEnd < rawText.length && rawText[_gwEnd] !== '\n') _gwEnd++;
                    var _gwCtx = rawText.slice(_gwStart, _gwEnd)
                        .replace(/\[편집\]/g, '')
                        .replace(/\[\d+\]/g, '')
                        .replace(/자세한 내용은[^\n]*/g, '')
                        .replace(/문서를 참고하십시오[^\n]*/g, '')
                        .replace(/\n+/g, ' ')
                        .replace(/\s{2,}/g, ' ')
                        .trim();
                    if (_gwCtx.length < 15) { _gScanPos = _gwIdx + 1; continue; }
                    // 4자리 연도만 카운트 (섹션번호 10~15 같은 2자리 숫자까지 제외)
                    var _gwDigits = (_gwCtx.match(/\d{4}/g) || []).length;
                    // yyyy.mm 형식 날짜 패턴은 트랙리스트/앨범 목록 지표 → 패널티 적용
                    var _gwDateEntries = (_gwCtx.match(/\d{4}\.\s*\d{2}/g) || []).length;
                    // dots 패널티 제거 — 콘텐츠 내 마침표가 정상 텍스트도 불이익 주는 문제 방지
                    var _gwQScore = _gwDigits - _gwDateEntries * 5;
                    if (_gwQScore > _gBestWinScore) {
                        _gBestWinScore = _gwQScore;
                        _gBestWinText = _gwCtx;
                    }
                    _gScanPos = _gwIdx + 1;
                }
                if (_gBestWinText) {
                    // 헤더 파생 저품질 결과를 window로 교체
                    if (_needsWin && scored.length > 0 && scored[0].score <= 35) {
                        scored = [{ text: _gBestWinText, score: 50 }];
                    } else {
                        scored.push({ text: _gBestWinText, score: 50 });
                    }
                    scored.sort(function(a, b) { return b.score - a.score; });
                }
            }

            if (scored.length > 0) {
                var topScore = scored[0].score;
                var sentences = scored.filter(function(s) { return s.score >= topScore * 0.6; }).slice(0, 5);
                var fullQuery = group.name + ' ' + keyword;

                // Multi-Hit Aggregation: 키워드 히트 주변 ±80줄 병합 (정보 누락 방지)
                var wideCtx = buildWideContext(lines, _kwSearch || keyword, 200);
                var rawContext = wideCtx || sentences.map(function(s) { return s.text; }).join('\n');

                // Gemini Synthesis Layer: raw text → 정제된 마크다운 답변 자동 생성
                updateSearchProgress(container, 3, 'AI가 답변을 정리하는 중...');
                var synthResult = await callGeminiNamuSynthesize(
                    fullQuery, rawContext,
                    currentSearchAbortController ? currentSearchAbortController.signal : null
                );
                if (synthResult && synthResult._aborted) return;
                if (synthResult && !synthResult._error) {
                    // 정제 성공 → 마크다운 답변 표시
                    renderGeminiAnswer(container, synthResult);
                    trackEvent('namu_smart_search', {
                        query: fullQuery, method: 'raw_synthesized'
                    });
                    return;
                }

                // Gemini 실패/API 키 없음 → raw 텍스트로 폴백
                var title = group.name + '(' + group.name_en + ') ' + keyword;
                var html = '<div class="namu-smart-answer">' +
                    '<div class="namu-smart-answer-header">' +
                    '<span class="namu-smart-icon">📖</span>' +
                    '<span class="namu-smart-title">' + escapeHtml(title) + '</span>' +
                    '<button class="namu-smart-close" onclick="dismissSmartAnswer()" title="닫기">&times;</button>' +
                    '</div>' +
                    '<div class="namu-smart-answer-body">';

                for (var j = 0; j < sentences.length; j++) {
                    html += '<div class="namu-smart-answer-text' + (j > 0 ? ' mt-2 pt-2 border-top' : '') +
                        '" style="font-size:1.05rem;">' + escapeHtml(sentences[j].text) + '</div>';
                }
                html += '</div>';

                // "AI로 정리하기" 버튼 + 나무위키 링크
                html += '<div class="namu-smart-detail-link d-flex justify-content-between align-items-center">';
                html += '<button class="btn btn-sm btn-outline-primary" ' +
                    'onclick="synthesizeWithGemini(this, \'' + escapeSingleQuote(fullQuery) + '\')" ' +
                    'data-raw-context="' + escapeHtml(rawContext) + '">' +
                    '🤖 AI로 정리하기</button>';
                if (namuUrl) {
                    html += '<a href="' + escapeHtml(namuUrl) + '" target="_blank" rel="noopener">📚 나무위키에서 보기 →</a>';
                }
                html += '</div>';

                html += '</div>';
                container.innerHTML = html;
                container.style.display = 'block';

                trackEvent('namu_smart_search', {
                    query: fullQuery,
                    method: 'raw_text_search',
                    results: scored.length
                });
                return;
            }
        }
    } catch (e) {
        console.warn('raw_text 키워드 검색 실패:', e);
    }

    // 막내/최연장 등 나이 관련 키워드 → 멤버 생년월일에서 자동 계산 폴백
    if (tryMemberAgeFallback(container, group, detail, keyword, namuUrl)) {
        return;
    }

    // raw_text에서 못 찾으면 Gemini 폴백
    updateSearchProgress(container, 3, 'AI가 답변을 정리하는 중...');
    var fallbackQuery = group.name + ' ' + keyword;
    var geminiResult = await callGeminiFlash(fallbackQuery);
    if (geminiResult && geminiResult._aborted) return; // 새 검색으로 취소됨
    if (geminiResult && geminiResult._error) {
        showSmartAnswer(container, '검색 실패', geminiResult.message, 'warning', group.slug);
    } else if (geminiResult && !geminiResult._error) {
        renderGeminiAnswer(container, geminiResult);
        trackEvent('namu_smart_search', { query: fallbackQuery, method: 'gemini' });
    } else {
        showSmartAnswer(container, group.name + ' ' + keyword,
            '해당 정보를 찾을 수 없습니다.', 'warning', group.slug);
    }
}

// --- 앨범 초동 조회 ---
async function executeAlbumSales(container, intent) {
    var detail = await fetchGroupDetail(intent.group.slug);
    if (!detail) {
        showSmartAnswer(container, '데이터 로드 실패', '상세 정보를 불러올 수 없습니다.', 'error');
        return;
    }

    var albums = detail.albums || [];
    if (albums.length === 0) {
        showSmartAnswer(container, intent.group.name, '앨범 정보가 없습니다.', 'warning');
        return;
    }

    // N집 필터링 (있는 경우)
    var filtered = albums;
    if (intent.albumNum) {
        var typePattern = intent.albumNum + '집';
        filtered = albums.filter(function(a) {
            return (a.type || '').includes(typePattern);
        });
        if (filtered.length === 0) {
            showSmartAnswer(container, intent.group.name + ' ' + typePattern, '해당 앨범을 찾을 수 없습니다.', 'warning');
            return;
        }
    }

    // 판매량 있는 앨범만 필터링하고 초동 내림차순 정렬
    var salesAlbums = filtered.filter(function(a) {
        return (a['초동_써클'] && a['초동_써클'] !== '-') || (a['초동_한터'] && a['초동_한터'] !== '-');
    }).sort(function(a, b) {
        var aVal = parseInt((a['초동_한터'] || a['초동_써클'] || '0').replace(/[,*]/g, '')) || 0;
        var bVal = parseInt((b['초동_한터'] || b['초동_써클'] || '0').replace(/[,*]/g, '')) || 0;
        return bVal - aVal;
    });

    if (salesAlbums.length === 0) {
        showSmartAnswer(container, intent.group.name, '판매량 데이터가 없습니다.', 'warning');
        return;
    }

    var html = '<div class="namu-smart-answer">' +
        '<div class="namu-smart-answer-header">' +
        '<span class="namu-smart-icon">💿</span>' +
        '<span class="namu-smart-title">' + escapeHtml(intent.group.name) + ' 앨범 초동</span>' +
        '<button class="namu-smart-close" onclick="dismissSmartAnswer()" title="닫기">&times;</button>' +
        '</div>' +
        '<div class="namu-smart-answer-body">' +
        '<div class="table-responsive"><table class="table table-sm namu-smart-table">' +
        '<thead><tr><th>앨범</th><th>유형</th><th>발매일</th><th class="text-end">초동(써클)</th><th class="text-end">초동(한터)</th></tr></thead>' +
        '<tbody>';

    for (var i = 0; i < salesAlbums.length; i++) {
        var a = salesAlbums[i];
        var circleVal = a['초동_써클'] || '-';
        var hanterVal = a['초동_한터'] || '-';
        html += '<tr>' +
            '<td class="fw-bold">' + (a.title || '-') + '</td>' +
            '<td><span class="badge bg-light text-dark">' + (a.type || '-') + '</span></td>' +
            '<td>' + (a['발매일'] || '-') + '</td>' +
            '<td class="text-end">' + circleVal + '</td>' +
            '<td class="text-end">' + hanterVal + '</td>' +
            '</tr>';
    }

    html += '</tbody></table></div>' +
        '<div class="namu-smart-detail-link">' +
        '<a href="javascript:void(0)" onclick="loadNamuGroupBySlug(\'' + escapeSingleQuote(intent.group.slug) + '\')">' + escapeHtml(intent.group.name) + ' 상세 보기 →</a>' +
        '</div></div></div>';

    container.innerHTML = html;
    container.style.display = 'block';
}

// --- 역대 초동 랭킹 (크로스그룹) ---
async function executeAlbumSalesRanking(container, intent) {
    await ensureRankingDataLoaded();
    if (!namuRankingData || namuRankingData.length === 0) {
        showSmartAnswer(container, '랭킹 로드 실패', '랭킹 데이터를 불러올 수 없습니다.', 'error');
        return;
    }

    var filtered = namuRankingData.slice();

    // 연도 필터
    if (intent.year) {
        filtered = filtered.filter(function(a) {
            return (a.release_date || '').startsWith(intent.year);
        });
    }

    // 성별 필터
    if (intent.gender && namuIndexData) {
        var genderSlugs = {};
        namuIndexData.forEach(function(g) {
            if (g.gender === intent.gender) genderSlugs[g.slug] = true;
        });
        filtered = filtered.filter(function(a) {
            return genderSlugs[a.group_slug || a.slug];
        });
    }

    // 초동 내림차순 정렬 (한터 우선 → 써클 폴백)
    filtered.sort(function(a, b) { return (b['초동_best_numeric'] || b['초동_써클_numeric'] || 0) - (a['초동_best_numeric'] || a['초동_써클_numeric'] || 0); });

    // 0인 항목 제거
    filtered = filtered.filter(function(a) { return (a['초동_best_numeric'] || a['초동_써클_numeric'] || 0) > 0; });

    var topN = intent.topN || 10;
    var display = filtered.slice(0, topN);

    var yearText = intent.year ? intent.year + '년 ' : '역대 ';
    var genderText = intent.gender ? (intent.gender === '여자' ? ' 걸그룹' : ' 보이그룹') : '';
    var title = yearText + '초동 TOP ' + topN + genderText + ' (' + display.length + '개)';

    if (display.length === 0) {
        showSmartAnswer(container, title, '해당 조건의 앨범이 없습니다.', 'info');
        return;
    }

    var html = '<div class="namu-smart-answer">' +
        '<div class="namu-smart-answer-header">' +
        '<span class="namu-smart-icon">🏆</span>' +
        '<span class="namu-smart-title">' + escapeHtml(title) + '</span>' +
        '<button class="namu-smart-close" onclick="dismissSmartAnswer()" title="닫기">&times;</button>' +
        '</div>' +
        '<div class="namu-smart-answer-body">' +
        '<div class="table-responsive"><table class="table table-sm namu-smart-table">' +
        '<thead><tr><th>#</th><th>그룹</th><th>앨범</th><th>유형</th><th>발매일</th><th class="text-end">초동</th></tr></thead><tbody>';

    for (var i = 0; i < display.length; i++) {
        var a = display[i];
        // 정확한 수치 표시 (한터 우선, 없으면 써클)
        var exactVal = a['초동_한터'] && a['초동_한터'] !== '-' ? a['초동_한터'] : (a['초동_써클'] || '-');
        html += '<tr>' +
            '<td class="fw-bold">' + (i + 1) + '</td>' +
            '<td>' + escapeHtml(a.group_name || a.group || '') + '</td>' +
            '<td class="fw-bold">' + escapeHtml(a.album_title || a.title || '') + '</td>' +
            '<td><span class="badge bg-light text-dark">' + escapeHtml(a.album_type || a.type || '-') + '</span></td>' +
            '<td>' + (a.release_date || '-') + '</td>' +
            '<td class="text-end">' + escapeHtml(exactVal) + '</td>' +
            '</tr>';
    }

    html += '</tbody></table></div>' +
        '<div class="text-muted small mt-1">나무위키 기반 초동 판매량 (한터차트 수치 우선)</div>' +
        '</div></div>';

    container.innerHTML = html;
    container.style.display = 'block';
}

// --- 그룹 비교 ---
async function executeComparison(container, intent) {
    var g1 = intent.groups[0];
    var g2 = intent.groups[1];

    // 두 그룹 상세 병렬 로드
    var results = await Promise.all([
        fetchGroupDetail(g1.slug),
        fetchGroupDetail(g2.slug)
    ]);
    var d1 = results[0];
    var d2 = results[1];

    if (!d1 || !d2) {
        showSmartAnswer(container, '비교 실패', '그룹 상세 정보를 불러올 수 없습니다.', 'error');
        return;
    }

    // 비교 테이블 생성
    var compFields = [
        { label: '소속사', fn: function(d) { return (d.info || {})['소속사'] || '-'; } },
        { label: '데뷔일', fn: function(d) { return (d.info || {})['데뷔일'] || '-'; } },
        { label: '멤버수', fn: function(d) { return (d.members || []).length + '명'; } },
        { label: '팬덤명', fn: function(d) { return (d.info || {})['팬덤명'] || '-'; } },
        { label: '앨범 수', fn: function(d) { return (d.albums || []).length + '개'; } },
        { label: '최고 초동', fn: function(d) { return getMaxSales(d); } }
    ];

    var html = '<div class="namu-smart-answer namu-smart-comparison">' +
        '<div class="namu-smart-answer-header">' +
        '<span class="namu-smart-icon">⚔️</span>' +
        '<span class="namu-smart-title">' + escapeHtml(g1.name) + ' vs ' + escapeHtml(g2.name) + '</span>' +
        '<button class="namu-smart-close" onclick="dismissSmartAnswer()" title="닫기">&times;</button>' +
        '</div>' +
        '<div class="namu-smart-answer-body">' +
        '<table class="table namu-comparison-table">' +
        '<thead><tr><th></th><th class="text-center">' + d1.name + '</th><th class="text-center">' + d2.name + '</th></tr></thead>' +
        '<tbody>';

    for (var i = 0; i < compFields.length; i++) {
        var cf = compFields[i];
        html += '<tr><td class="fw-bold">' + cf.label + '</td>' +
            '<td class="text-center">' + cf.fn(d1) + '</td>' +
            '<td class="text-center">' + cf.fn(d2) + '</td></tr>';
    }

    html += '</tbody></table>';

    // 초동 비교 차트 컨테이너
    html += '<canvas id="smartCompareChart" style="max-height:300px;"></canvas>';

    html += '<div class="namu-smart-detail-link d-flex gap-3">' +
        '<a href="javascript:void(0)" onclick="loadNamuGroupBySlug(\'' + escapeSingleQuote(g1.slug) + '\')">' + escapeHtml(g1.name) + ' 상세 →</a>' +
        '<a href="javascript:void(0)" onclick="loadNamuGroupBySlug(\'' + escapeSingleQuote(g2.slug) + '\')">' + escapeHtml(g2.name) + ' 상세 →</a>' +
        '</div></div></div>';

    container.innerHTML = html;
    container.style.display = 'block';

    // 비교 차트 렌더링
    renderComparisonChart(d1, d2);
}

// --- 초동 랭킹 필터 ---
async function executeRankingFilter(container, intent) {
    // 랭킹 데이터 lazy load
    await ensureRankingDataLoaded();
    if (!namuRankingData) {
        showSmartAnswer(container, '랭킹 로드 실패', '랭킹 데이터를 불러올 수 없습니다.', 'error');
        return;
    }

    var filtered = namuRankingData.slice();

    // 연도 필터
    if (intent.year) {
        filtered = filtered.filter(function(a) {
            return (a.release_date || '').startsWith(intent.year);
        });
    }

    // 성별 필터 (Q43: "초동 200만 이상 보이그룹" 대응)
    if (intent.gender && namuIndexData) {
        var genderSlugs = {};
        namuIndexData.forEach(function(g) {
            if (g.gender === intent.gender) genderSlugs[g.slug] = true;
        });
        filtered = filtered.filter(function(a) {
            return genderSlugs[a.group_slug];
        });
    }

    // 초동 임계값 필터 (한터 우선 → 써클 폴백)
    var threshold = intent.threshold || 0;
    if (intent.direction === 'lte') {
        filtered = filtered.filter(function(a) { return (a['초동_best_numeric'] || a['초동_써클_numeric'] || 0) <= threshold; });
    } else {
        filtered = filtered.filter(function(a) { return (a['초동_best_numeric'] || a['초동_써클_numeric'] || 0) >= threshold; });
    }

    // 초동 내림차순 정렬 (한터 우선)
    filtered.sort(function(a, b) { return (b['초동_best_numeric'] || b['초동_써클_numeric'] || 0) - (a['초동_best_numeric'] || a['초동_써클_numeric'] || 0); });

    var yearText = intent.year ? intent.year + '년 ' : '';
    var thresholdText = (threshold / 10000) + '만';
    var dirText = intent.direction === 'lte' ? '이하' : '이상';
    var genderText = intent.gender ? (intent.gender === '여자' ? ' 걸그룹' : ' 보이그룹') : '';
    var title = yearText + '초동 ' + thresholdText + ' ' + dirText + genderText + ' 앨범 (' + filtered.length + '개)';

    if (filtered.length === 0) {
        showSmartAnswer(container, title, '해당 조건의 앨범이 없습니다.', 'info');
        return;
    }

    var limit = Math.min(filtered.length, 30);
    var html = '<div class="namu-smart-answer">' +
        '<div class="namu-smart-answer-header">' +
        '<span class="namu-smart-icon">🏆</span>' +
        '<span class="namu-smart-title">' + escapeHtml(title) + '</span>' +
        '<button class="namu-smart-close" onclick="dismissSmartAnswer()" title="닫기">&times;</button>' +
        '</div>' +
        '<div class="namu-smart-answer-body">' +
        '<div class="table-responsive"><table class="table table-sm namu-smart-table">' +
        '<thead><tr><th>#</th><th>그룹</th><th>앨범</th><th>발매일</th><th class="text-end">초동</th></tr></thead>' +
        '<tbody>';

    for (var i = 0; i < limit; i++) {
        var a = filtered[i];
        var bestNum = a['초동_best_numeric'] || a['초동_써클_numeric'] || 0;
        var salesClass = bestNum >= 1000000 ? 'fw-bold text-danger' : '';
        var salesDisplay = a['초동_한터'] && a['초동_한터'] !== '-' ? a['초동_한터'] : (a['초동_써클'] || '-');
        html += '<tr onclick="loadNamuGroupBySlug(\'' + escapeSingleQuote(a.group_slug) + '\')" style="cursor:pointer;">' +
            '<td class="fw-bold text-primary">' + (i + 1) + '</td>' +
            '<td>' + escapeHtml(a.group_name) + '</td>' +
            '<td>' + escapeHtml(a.album_title) + '</td>' +
            '<td>' + escapeHtml(a.release_date || '-') + '</td>' +
            '<td class="text-end ' + salesClass + '">' + escapeHtml(salesDisplay) + '</td>' +
            '</tr>';
    }

    html += '</tbody></table></div>';
    if (filtered.length > limit) {
        html += '<div class="text-muted small text-center mt-2">상위 ' + limit + '개만 표시 (전체 ' + filtered.length + '개)</div>';
    }
    html += '</div></div>';

    container.innerHTML = html;
    container.style.display = 'block';
}

// --- 소속사 필터 (async → 공유 렌더러) ---
async function executeAgencyFilter(container, intent) {
    if (!namuIndexData) return;

    // 소속사 별칭 확장
    var agencyNames = AGENCY_ALIASES[intent.agency] || [intent.agency];

    var filtered = namuIndexData.filter(function(g) {
        var agency = (g.agency || '').toLowerCase();
        for (var i = 0; i < agencyNames.length; i++) {
            if (agency.includes(agencyNames[i].toLowerCase())) return true;
        }
        return false;
    });

    // 성별 필터
    if (intent.gender) {
        filtered = filtered.filter(function(g) { return g.gender === intent.gender; });
    }

    // 세대 필터
    if (intent.generation && GENERATION_MAP[intent.generation]) {
        var range = GENERATION_MAP[intent.generation];
        filtered = filtered.filter(function(g) {
            var year = parseInt(g.debut_year);
            return year >= range[0] && year <= range[1];
        });
    }

    var titleParts = [intent.agency];
    if (intent.gender) titleParts.push(intent.gender === '여자' ? '걸그룹' : '보이그룹');
    if (intent.generation) titleParts.push(intent.generation);

    await renderEnhancedGroupList(container, filtered, {
        title: titleParts.join(' '),
        icon: '🏢',
        sortBy: 'debut_date',
        showDebutDate: true,
        emptyMessage: '해당 조건의 그룹이 없습니다.'
    });
}

// --- 세대/성별 단독 필터 (async → 공유 렌더러) ---
async function executeGenerationFilter(container, intent) {
    if (!namuIndexData) return;

    var range = GENERATION_MAP[intent.generation];
    if (!range) return;

    var filtered = namuIndexData.filter(function(g) {
        var year = parseInt(g.debut_year);
        return year >= range[0] && year <= range[1];
    });

    // 성별 필터
    if (intent.gender) {
        filtered = filtered.filter(function(g) { return g.gender === intent.gender; });
    }

    var genderText = intent.gender ? (intent.gender === '여자' ? ' 걸그룹' : ' 보이그룹') : ' 아이돌';

    await renderEnhancedGroupList(container, filtered, {
        title: intent.generation + genderText,
        icon: '📅',
        sortBy: 'debut_date',
        showDebutDate: true,
        emptyMessage: '해당 조건의 그룹이 없습니다.'
    });
}

// --- 데뷔 연도 필터 (async → 공유 렌더러) ---
async function executeDebutYearFilter(container, intent) {
    if (!namuIndexData) return;

    var filtered = namuIndexData.filter(function(g) {
        return parseInt(g.debut_year) === intent.year;
    });

    // 성별 필터
    if (intent.gender) {
        filtered = filtered.filter(function(g) { return g.gender === intent.gender; });
    }

    var genderText = intent.gender ? (intent.gender === '여자' ? ' 걸그룹' : ' 보이그룹') : ' 아이돌 그룹';

    await renderEnhancedGroupList(container, filtered, {
        title: intent.year + '년 데뷔' + genderText,
        icon: '📅',
        sortBy: 'debut_date',
        showDebutDate: true,
        emptyMessage: '해당 연도에 데뷔한 그룹이 없습니다.'
    });
}

// --- 세대+성별+키워드 크로스 검색 (raw_text → AI 합성 → 통합 뷰) ---
async function executeCrossGroupSearch(container, intent) {
    if (!namuIndexData) return;

    // 세대/성별로 그룹 필터
    var range = GENERATION_MAP[intent.generation];
    if (!range) return;
    var filtered = namuIndexData.filter(function(g) {
        var year = parseInt(g.debut_year);
        return year >= range[0] && year <= range[1];
    });
    if (intent.gender) {
        filtered = filtered.filter(function(g) { return g.gender === intent.gender; });
    }

    var genderText = intent.gender ? (intent.gender === '여자' ? '걸그룹' : '보이그룹') : '아이돌';
    var fullQuery = intent.generation + ' ' + genderText + ' ' + intent.keyword;

    // raw_text 키워드 검색 시도 (필터된 그룹만 대상)
    var keywords = extractCrossGroupKeywords(intent.keyword);
    if (keywords.length > 0) {
        var filterSlugs = {};
        for (var fi = 0; fi < filtered.length; fi++) {
            filterSlugs[filtered[fi].slug] = true;
        }

        updateSearchProgress(container, 2, '필터된 그룹 원문 데이터 검색 중...');
        var rawResults = await searchAllGroupsRawText(keywords, null, null, filterSlugs);
        var validResults = rawResults.filter(function(r) { return r.score >= 50; });

        if (validResults.length > 0) {
            // raw context 구성 + AI 합성 + namu URL (병렬)
            var top5 = validResults.slice(0, 5);
            var rawContext = '';
            for (var ci = 0; ci < top5.length; ci++) {
                rawContext += '### ' + top5[ci].group.name + ' (' + top5[ci].group.name_en + ')\n';
                rawContext += top5[ci].snippets.join('\n') + '\n\n';
            }
            if (rawContext.length > 4000) rawContext = rawContext.substring(0, 4000);

            updateSearchProgress(container, 3, 'AI가 답변을 정리하는 중...');
            var synthesizeQ = '다음 나무위키 원문을 참고하여 "' + fullQuery + '"에 대해 깔끔하게 정리해주세요:\n\n' + rawContext;
            var top10 = validResults.slice(0, 10);

            var pResults = await Promise.all([
                callGeminiFlash(synthesizeQ),
                fetchNamuUrlsForGroups(top10)
            ]);

            var geminiSyn = pResults[0];
            var namuUrls = pResults[1];

            if (geminiSyn && !geminiSyn._error && !geminiSyn._aborted) {
                renderCrossGroupCombinedView(container, fullQuery, geminiSyn, validResults, keywords, namuUrls);
            } else {
                renderCrossGroupRawResults(container, fullQuery, validResults, keywords);
            }
            trackEvent('namu_smart_search', { query: fullQuery, method: 'cross_group_combined_filtered', result_count: validResults.length });
            return;
        }
    }

    // Gemini 폴백: 필터된 그룹 목록을 컨텍스트로 구성
    updateSearchProgress(container, 2, 'AI가 답변을 정리하는 중...');
    var groupContext = filtered.map(function(g) {
        return g.name + '(' + g.name_en + ') - 소속사:' + (g.agency || '?') +
            ', 데뷔:' + (g.debut_year || '?') + ', 멤버:' + g.member_count + '명, 앨범:' + g.album_count + '개';
    }).join('\n');

    var geminiResult = await callGeminiFlash(fullQuery);
    if (geminiResult && geminiResult._aborted) return;
    if (geminiResult && !geminiResult._error) {
        renderGeminiAnswer(container, geminiResult);
        trackEvent('namu_smart_search', { query: fullQuery, method: 'gemini_cross_group' });
    } else {
        showSmartAnswer(container, fullQuery, '해당 정보를 찾을 수 없습니다.', 'warning');
    }
}

// --- 캘린더 이벤트 조회 (컴백일정) ---

/**
 * GAS 프록시를 통해 캘린더 이벤트를 가져온다.
 * @param {string} groupName - 그룹명 (빈 문자열이면 전체)
 * @param {number} months - 조회 기간 (개월, 기본 3)
 * @returns {Promise<Array>} 이벤트 배열
 */
async function fetchCalendarEvents(groupName, months) {
    // 로컬 개발 환경에서는 빈 배열 반환 (GAS 프록시 사용 불가)
    if (isLocalDev()) {
        console.log('%c📅 로컬 환경: 캘린더 API 스킵', 'color:#FF9800');
        return [];
    }

    var gasUrl = window.GAS_WEBAPP_URL || (typeof API_URL !== 'undefined' ? API_URL : '');
    if (!gasUrl) return [];

    try {
        // GET 요청으로 캘린더 이벤트 조회
        var url = gasUrl + '?action=getCalendarEvents' +
            '&group=' + encodeURIComponent(groupName || '') +
            '&months=' + (months || 3);

        var response = await fetch(url);
        if (!response.ok) return [];

        var data = await response.json();
        return data.events || [];
    } catch (err) {
        console.warn('캘린더 이벤트 조회 실패:', err);
        return [];
    }
}

/**
 * 캘린더 이벤트를 HTML 테이블로 렌더링한다.
 * @param {Array} events - 이벤트 배열 [{title, date, endDate, description}]
 * @param {string} groupName - 그룹명 (표시용)
 * @returns {string} HTML 문자열
 */
function buildCalendarSection(events, groupName) {
    if (!events || events.length === 0) return '';

    var title = groupName
        ? escapeHtml(groupName) + ' 예정 일정 (캘린더)'
        : '전체 컴백 일정 (캘린더)';

    var html = '<div class="namu-smart-calendar-section" style="margin-top:12px;">' +
        '<div class="namu-smart-answer-header" style="border-top:1px solid #e0e0e0;padding-top:8px;">' +
        '<span class="namu-smart-icon">📅</span>' +
        '<span class="namu-smart-title">' + title + '</span>' +
        '</div>' +
        '<div class="namu-smart-answer-body">' +
        '<div class="table-responsive"><table class="table table-sm namu-smart-table">' +
        '<thead><tr><th>일정명</th><th>날짜</th><th>비고</th></tr></thead>' +
        '<tbody>';

    for (var i = 0; i < events.length; i++) {
        var ev = events[i];
        // 날짜 표시: 시작일만 또는 시작~종료 (다를 경우)
        var dateStr = escapeHtml(ev.date || '-');
        if (ev.endDate && ev.endDate !== ev.date) {
            dateStr += ' ~ ' + escapeHtml(ev.endDate);
        }
        html += '<tr>' +
            '<td class="fw-bold">' + escapeHtml(ev.title || '-') + '</td>' +
            '<td>' + dateStr + '</td>' +
            '<td class="text-muted" style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' +
                escapeHtml(ev.description || '') + '</td>' +
            '</tr>';
    }

    html += '</tbody></table></div></div></div>';
    return html;
}

// ============================================================
// SNS 팔로워 데이터 조회 함수
// ============================================================

// SNS 데이터 로드 플래그 (중복 호출 방지)
var _snsDataLoading = false;
// Lazy loader: namu-ranking.json 로드 + 초동_써클_numeric 보강
async function ensureRankingDataLoaded() {
    if (namuRankingData && namuRankingData.length > 0) return true;
    try {
        var response = await fetch('/data/namu-ranking.json?v=' + NAMU_DATA_VERSION);
        var rankingJson = await response.json();
        // plain array 또는 {albums: [...]} 모두 대응
        var rawAlbums = Array.isArray(rankingJson) ? rankingJson : (rankingJson.albums || []);
        // 초동_써클_numeric 필드 보강 (없으면 초동_한터에서 파싱)
        rawAlbums.forEach(function(a) {
            if (!a['초동_써클_numeric']) {
                // 초동_한터 "511,080" → 511080 (우선), 초동_써클 "276,8**" → 27600 (폴백)
                var src = a['초동_한터'] || a['초동_써클'] || '0';
                a['초동_써클_numeric'] = parseInt(src.replace(/[,*]/g, '')) || 0;
            }
            if (!a['group_slug']) a['group_slug'] = a['slug'] || '';
        });
        namuRankingData = rawAlbums;
        namuRankingLoaded = true;
        return true;
    } catch (e) {
        console.error('랭킹 데이터 로드 실패:', e);
        return false;
    }
}

var _snsDataLoaded = false;

// Lazy loader: script.js의 SNS/메타데이터 캐시를 병렬 로드
async function ensureSnsDataLoaded() {
    // 이미 로드 완료
    if (_snsDataLoaded) return true;
    // script.js 미로드 방어
    if (typeof loadFullSnsData !== 'function' || typeof loadStaticMetadataJSON !== 'function') {
        console.warn('[SNS] script.js 전역 함수 미발견');
        return false;
    }
    // 중복 호출 방지
    if (_snsDataLoading) {
        // 대기 (최대 10초)
        for (var i = 0; i < 100; i++) {
            await new Promise(function(r) { setTimeout(r, 100); });
            if (_snsDataLoaded) return true;
        }
        return false;
    }
    _snsDataLoading = true;
    try {
        // 양쪽 성별 병렬 로드
        await Promise.all([
            loadFullSnsData('여자'), loadFullSnsData('남자'),
            loadStaticMetadataJSON('여자'), loadStaticMetadataJSON('남자')
        ]);
        _snsDataLoaded = true;
        return true;
    } catch (e) {
        console.error('[SNS] 데이터 로드 실패:', e);
        return false;
    } finally {
        _snsDataLoading = false;
    }
}

// 단일 플랫폼 팔로워 조회: 최신 월 레코드 반환
function getSnsFollowerData(groupName, snsName) {
    var genders = ['여자', '남자'];
    for (var gi = 0; gi < genders.length; gi++) {
        var gender = genders[gi];
        var cache = typeof fullSnsCache !== 'undefined' ? fullSnsCache[gender] : null;
        if (!cache || !cache.data || !cache.data[snsName]) continue;
        var snsData = cache.data[snsName];
        var records = snsData.records || [];
        // 최신 월 우선 (records는 최신→과거 순 정렬 → 정방향 검색)
        for (var i = 0; i < records.length; i++) {
            if (records[i].name === groupName || records[i].group === groupName) {
                return { count: records[i].count, date: records[i].date, name: records[i].name };
            }
        }
    }
    return null;
}

// 전 플랫폼 팔로워 조회 (8개)
function getAllSnsFollowers(groupName) {
    var platforms = ['웨이보', '차오화', '빌리빌리', 'QQ뮤직', 'X(트위터)', '유튜브', '스포티파이', '인스타그램'];
    var results = [];
    for (var i = 0; i < platforms.length; i++) {
        var data = getSnsFollowerData(groupName, platforms[i]);
        results.push({
            platform: platforms[i],
            count: data ? data.count : null,
            date: data ? data.date : null
        });
    }
    return results;
}

// 메타데이터에서 SNS 공식 링크 추출
function getGroupMetadataLinks(groupName) {
    // namuIndexData에서 gender 확인
    var gender = null;
    if (typeof namuIndexData !== 'undefined') {
        for (var i = 0; i < namuIndexData.length; i++) {
            if (namuIndexData[i].name === groupName || namuIndexData[i].name_en === groupName) {
                gender = namuIndexData[i].gender;
                break;
            }
        }
    }
    if (!gender) gender = '여자'; // 폴백

    // metadataCache에서 링크 추출
    var key = groupName + '_' + gender;
    var meta = (typeof metadataCache !== 'undefined') ? metadataCache[key] : null;
    if (!meta) {
        // fullMetadataCache에서 직접 검색
        var genders = [gender, gender === '여자' ? '남자' : '여자'];
        for (var gi = 0; gi < genders.length; gi++) {
            var fmc = (typeof fullMetadataCache !== 'undefined') ? fullMetadataCache[genders[gi]] : null;
            if (fmc && fmc.data) {
                for (var j = 0; j < fmc.data.length; j++) {
                    if (fmc.data[j].name === groupName) {
                        meta = fmc.data[j];
                        break;
                    }
                }
            }
            if (meta) break;
        }
    }
    if (!meta) return [];

    var links = [];
    var fields = Object.keys(SNS_LINK_FIELDS);
    for (var fi = 0; fi < fields.length; fi++) {
        var fieldKey = fields[fi];
        var url = meta[fieldKey];
        if (url && url.trim()) {
            links.push({
                label: SNS_LINK_FIELDS[fieldKey].label,
                snsKey: SNS_LINK_FIELDS[fieldKey].snsKey,
                url: url.trim()
            });
        }
    }
    return links;
}

// 만 단위 포맷 (1234만, 5,802)
function formatFollowerCount(count) {
    if (count == null || count === 0) return '-';
    if (count >= 10000) {
        return Math.round(count / 10000) + '만';
    }
    return count.toLocaleString();
}

// --- SNS 전체/단일 플랫폼 조회 실행 ---
async function executeGroupSns(container, intent) {
    // 로딩 표시
    var groupName = intent.group.name;
    showSmartAnswer(container, groupName + ' SNS', 'SNS 데이터를 불러오는 중...', 'info');

    // 데이터 로드
    var loaded = await ensureSnsDataLoaded();
    if (!loaded) {
        showSmartAnswer(container, groupName + ' SNS', 'SNS 데이터를 불러올 수 없습니다. 잠시 후 다시 시도해 주세요.', 'error');
        return;
    }

    // 미추적 플랫폼 안내 (인스타, 틱톡 등)
    if (intent.platform === null) {
        var platformInput = intent.platformInput || '해당 플랫폼';
        showSmartAnswer(container, groupName + ' SNS',
            '<strong>' + escapeHtml(platformInput) + '</strong>은(는) 현재 추적하지 않는 플랫폼입니다.<br>' +
            '추적 중인 플랫폼: 웨이보, X(트위터), 유튜브, 빌리빌리, 스포티파이, 차오화, QQ뮤직', 'warning');
        return;
    }

    // 특정 플랫폼 지정 → 단일 카드
    if (intent.platform) {
        var snsData = getSnsFollowerData(groupName, intent.platform);
        var links = getGroupMetadataLinks(groupName);
        var matchLink = null;
        for (var li = 0; li < links.length; li++) {
            if (links[li].snsKey === intent.platform) { matchLink = links[li]; break; }
        }

        var countStr = snsData ? formatFollowerCount(snsData.count) : '데이터 없음';
        var dateStr = snsData ? snsData.date : '';
        var unitLabel = (intent.platform === '유튜브') ? '구독자' : '팔로워';

        var html = '<div class="namu-smart-answer">' +
            '<div class="namu-smart-answer-header">' +
            '<span class="namu-smart-icon">📊</span>' +
            '<span class="namu-smart-title">' + escapeHtml(groupName) + ' ' + escapeHtml(intent.platform) + '</span>' +
            '<button class="namu-smart-close" onclick="dismissSmartAnswer()" title="닫기">&times;</button>' +
            '</div>' +
            '<div class="namu-smart-answer-body">' +
            '<div style="font-size:1.1rem;margin-bottom:8px;">' +
            unitLabel + ': <strong style="color:var(--bs-primary,#0d6efd);">' + countStr + '</strong>';
        if (dateStr) html += ' <span class="text-muted small">(' + escapeHtml(dateStr) + ' 기준)</span>';
        html += '</div>';

        // 공식 링크 pill 버튼
        if (matchLink) {
            html += '<div style="margin:8px 0;">' +
                '<a href="' + escapeHtml(matchLink.url) + '" target="_blank" rel="noopener" ' +
                'style="display:inline-flex;align-items:center;gap:4px;padding:6px 14px;border-radius:20px;' +
                'background:#f5f5f5;border:1px solid #e0e0e0;color:#333;font-size:0.88rem;text-decoration:none;' +
                'transition:background 0.15s;" onmouseover="this.style.background=\'#e8e8e8\'" onmouseout="this.style.background=\'#f5f5f5\'">' +
                '🔗 ' + escapeHtml(groupName) + ' 공식 ' + escapeHtml(intent.platform) + ' →</a></div>';
        }

        // SNS랭킹 탭 크로스링크
        html += '<div class="namu-smart-detail-link" style="margin-top:8px;">' +
            '<a href="javascript:void(0)" onclick="if(typeof route===\'function\')route(\'home\')">📈 SNS랭킹 탭에서 상세 보기 →</a>' +
            '</div></div></div>';

        container.innerHTML = html;
        container.style.display = 'block';
        return;
    }

    // 전체 플랫폼 테이블
    var allData = getAllSnsFollowers(groupName);
    var links = getGroupMetadataLinks(groupName);
    // 기준 월 추출 (첫 번째 유효 데이터의 date)
    var refDate = '';
    for (var di = 0; di < allData.length; di++) {
        if (allData[di].date) { refDate = allData[di].date; break; }
    }

    var html = '<div class="namu-smart-answer">' +
        '<div class="namu-smart-answer-header">' +
        '<span class="namu-smart-icon">📊</span>' +
        '<span class="namu-smart-title">' + escapeHtml(groupName) + ' SNS 팔로워</span>' +
        '<button class="namu-smart-close" onclick="dismissSmartAnswer()" title="닫기">&times;</button>' +
        '</div>' +
        '<div class="namu-smart-answer-body">';
    if (refDate) html += '<div class="text-muted small" style="margin-bottom:6px;">' + escapeHtml(refDate) + ' 기준</div>';

    // 팔로워 테이블
    html += '<div class="table-responsive"><table class="table table-sm namu-smart-table">' +
        '<thead><tr><th>플랫폼</th><th class="text-end">팔로워 수</th></tr></thead><tbody>';
    for (var i = 0; i < allData.length; i++) {
        var d = allData[i];
        var countVal = (d.count != null) ? formatFollowerCount(d.count) : '-';
        html += '<tr><td>' + escapeHtml(d.platform) + '</td>' +
            '<td class="text-end' + (d.count ? ' fw-bold' : '') + '">' + countVal + '</td></tr>';
    }
    html += '</tbody></table></div>';

    // 공식 SNS 링크 칩
    if (links.length > 0) {
        html += '<div style="margin-top:10px;"><strong style="font-size:0.9rem;">🔗 공식 SNS</strong>' +
            '<div style="margin-top:6px;display:flex;flex-wrap:wrap;gap:6px;">';
        for (var li = 0; li < links.length; li++) {
            html += '<a href="' + escapeHtml(links[li].url) + '" target="_blank" rel="noopener" ' +
                'style="display:inline-flex;align-items:center;gap:4px;padding:5px 12px;border-radius:20px;' +
                'background:#f5f5f5;border:1px solid #e0e0e0;color:#333;font-size:0.82rem;text-decoration:none;' +
                'transition:background 0.15s;" onmouseover="this.style.background=\'#e8e8e8\'" onmouseout="this.style.background=\'#f5f5f5\'">' +
                escapeHtml(links[li].label) + '</a>';
        }
        html += '</div></div>';
    }

    // SNS랭킹 탭 크로스링크
    html += '<div class="namu-smart-detail-link" style="margin-top:10px;">' +
        '<a href="javascript:void(0)" onclick="if(typeof route===\'function\')route(\'home\')">📈 SNS랭킹 탭에서 상세 보기 →</a>' +
        '</div></div></div>';

    container.innerHTML = html;
    container.style.display = 'block';
}

// --- SNS 랭킹 실행 (플랫폼별 TOP N) ---
async function executeSnsRanking(container, intent) {
    var platform = intent.platform || '웨이보'; // 기본 플랫폼
    var topN = intent.topN || 10;
    var unitLabel = (platform === '유튜브') ? '구독자' : '팔로워';
    var titleText = platform + ' ' + unitLabel + ' 순위';

    // 로딩 표시
    showSmartAnswer(container, titleText, 'SNS 데이터를 불러오는 중...', 'info');

    // 데이터 로드
    var loaded = await ensureSnsDataLoaded();
    if (!loaded) {
        showSmartAnswer(container, titleText, 'SNS 데이터를 불러올 수 없습니다.', 'error');
        return;
    }

    // 양쪽 성별 데이터 수집
    var genders = intent.gender ? [intent.gender] : ['여자', '남자'];
    var allRecords = [];
    var availableMonth = intent.month || null;

    for (var gi = 0; gi < genders.length; gi++) {
        var gender = genders[gi];
        var cache = (typeof fullSnsCache !== 'undefined') ? fullSnsCache[gender] : null;
        if (!cache || !cache.data || !cache.data[platform]) continue;
        var snsData = cache.data[platform];

        // 월 결정: 지정 없으면 최신 월
        if (!availableMonth) {
            var months = snsData.months || [];
            if (months.length > 0) availableMonth = months[months.length - 1];
        }

        var records = snsData.records || [];
        for (var ri = 0; ri < records.length; ri++) {
            if (records[ri].date === availableMonth) {
                allRecords.push({ name: records[ri].name, group: records[ri].group, count: records[ri].count, gender: gender });
            }
        }
    }

    if (allRecords.length === 0) {
        var msg = availableMonth ? (availableMonth + ' ' + platform + ' 데이터가 없습니다.') : (platform + ' 데이터가 없습니다.');
        showSmartAnswer(container, titleText, msg, 'warning');
        return;
    }

    // 세대 필터: namuIndexData에서 데뷔 연도 기반 필터링
    if (intent.generation && GENERATION_MAP[intent.generation] && namuIndexData) {
        var genRange = GENERATION_MAP[intent.generation];
        // 그룹명 → 데뷔 연도 맵 생성
        var genGroupNames = {};
        namuIndexData.forEach(function(g) {
            var year = parseInt(g.debut_year);
            if (year >= genRange[0] && year <= genRange[1]) {
                genGroupNames[g.name] = true;
            }
        });
        allRecords = allRecords.filter(function(r) {
            return genGroupNames[r.name] || genGroupNames[r.group];
        });
    }

    // 내림차순 정렬
    allRecords.sort(function(a, b) { return b.count - a.count; });
    var displayRecords = allRecords.slice(0, topN);

    // 타이틀 업데이트
    var genLabel = intent.generation ? (' ' + intent.generation) : '';
    var genderLabel = intent.gender ? (' ' + intent.gender) : '';
    titleText = availableMonth + genLabel + genderLabel + ' ' + platform + ' ' + unitLabel + ' TOP ' + displayRecords.length;

    // HTML 렌더링
    var html = '<div class="namu-smart-answer">' +
        '<div class="namu-smart-answer-header">' +
        '<span class="namu-smart-icon">📊</span>' +
        '<span class="namu-smart-title">' + escapeHtml(titleText) + '</span>' +
        '<button class="namu-smart-close" onclick="dismissSmartAnswer()" title="닫기">&times;</button>' +
        '</div>' +
        '<div class="namu-smart-answer-body">';

    // 1위 강조
    html += '<div style="font-size:1.1rem;margin-bottom:10px;">🏆 1위: <strong style="color:var(--bs-primary,#0d6efd);">' +
        escapeHtml(displayRecords[0].name) + '</strong> — ' + displayRecords[0].count.toLocaleString() + '</div>';

    // 순위 테이블
    html += '<div class="table-responsive"><table class="table table-sm namu-smart-table">' +
        '<thead><tr><th style="width:40px">순위</th><th>그룹</th>';
    if (!intent.gender) html += '<th style="width:40px">성별</th>';
    html += '<th class="text-end">' + unitLabel + '</th></tr></thead><tbody>';

    for (var i = 0; i < displayRecords.length; i++) {
        var rec = displayRecords[i];
        var rankBadge = (i === 0) ? '🥇' : (i === 1) ? '🥈' : (i === 2) ? '🥉' : (i + 1);
        html += '<tr' + (i < 3 ? ' style="font-weight:600;"' : '') + '>' +
            '<td class="text-center">' + rankBadge + '</td>' +
            '<td>' + escapeHtml(rec.name) + '</td>';
        if (!intent.gender) html += '<td class="text-center">' + (rec.gender === '여자' ? '♀' : '♂') + '</td>';
        html += '<td class="text-end">' + rec.count.toLocaleString() + '</td></tr>';
    }
    html += '</tbody></table></div>';

    // SNS 랭킹 탭으로 이동 버튼
    var filterGender = intent.gender || '남자';
    html += '<div class="namu-smart-detail-link" style="margin-top:8px;">' +
        '<a href="javascript:void(0)" onclick="' +
        'if(typeof route===\'function\')route(\'home\');' +
        'setTimeout(function(){' +
        'if(typeof updateFilter===\'function\'){updateFilter(\'gender\',\'' + filterGender + '\');updateFilter(\'sns\',\'' + escapeHtml(platform) + '\');}' +
        '},200);">📈 SNS랭킹 탭에서 상세 보기 →</a>' +
        '</div></div></div>';

    container.innerHTML = html;
    container.style.display = 'block';
}

// --- SNS 비교 실행 (2그룹) ---
async function executeSnsComparison(container, intent) {
    var g1 = intent.groups[0];
    var g2 = intent.groups[1];
    var platLabel = intent.platform ? (' ' + intent.platform) : ' SNS';
    var title = g1.name + ' vs ' + g2.name + platLabel + ' 비교';

    showSmartAnswer(container, title, 'SNS 데이터를 불러오는 중...', 'info');

    var loaded = await ensureSnsDataLoaded();
    if (!loaded) {
        showSmartAnswer(container, title, 'SNS 데이터를 불러올 수 없습니다.', 'error');
        return;
    }

    // 특정 플랫폼 지정 시 해당 플랫폼만, 미지정 시 전체
    var data1, data2;
    if (intent.platform) {
        var d1 = getSnsFollowerData(g1.name, intent.platform);
        var d2 = getSnsFollowerData(g2.name, intent.platform);
        data1 = [{ platform: intent.platform, count: d1 ? d1.count : null, date: d1 ? d1.date : null }];
        data2 = [{ platform: intent.platform, count: d2 ? d2.count : null, date: d2 ? d2.date : null }];
    } else {
        data1 = getAllSnsFollowers(g1.name);
        data2 = getAllSnsFollowers(g2.name);
    }
    // 기준 월
    var refDate = '';
    for (var i = 0; i < data1.length; i++) {
        if (data1[i].date) { refDate = data1[i].date; break; }
    }

    var html = '<div class="namu-smart-answer">' +
        '<div class="namu-smart-answer-header">' +
        '<span class="namu-smart-icon">⚔️</span>' +
        '<span class="namu-smart-title">' + escapeHtml(title) + '</span>' +
        '<button class="namu-smart-close" onclick="dismissSmartAnswer()" title="닫기">&times;</button>' +
        '</div>' +
        '<div class="namu-smart-answer-body">';
    if (refDate) html += '<div class="text-muted small" style="margin-bottom:6px;">' + escapeHtml(refDate) + ' 기준</div>';

    // 비교 테이블
    html += '<div class="table-responsive"><table class="table table-sm namu-smart-table">' +
        '<thead><tr><th>플랫폼</th><th class="text-end">' + escapeHtml(g1.name) + '</th>' +
        '<th class="text-end">' + escapeHtml(g2.name) + '</th></tr></thead><tbody>';

    for (var i = 0; i < data1.length; i++) {
        var c1 = data1[i].count || 0;
        var c2 = data2[i] ? (data2[i].count || 0) : 0;
        var s1 = data1[i].count != null ? formatFollowerCount(data1[i].count) : '-';
        var s2 = (data2[i] && data2[i].count != null) ? formatFollowerCount(data2[i].count) : '-';
        // 승자 하이라이트
        var style1 = (c1 > c2 && c1 > 0) ? ' style="color:var(--bs-primary,#0d6efd);font-weight:bold;"' : '';
        var style2 = (c2 > c1 && c2 > 0) ? ' style="color:var(--bs-primary,#0d6efd);font-weight:bold;"' : '';
        html += '<tr><td>' + escapeHtml(data1[i].platform) + '</td>' +
            '<td class="text-end"' + style1 + '>' + s1 + '</td>' +
            '<td class="text-end"' + style2 + '>' + s2 + '</td></tr>';
    }
    html += '</tbody></table></div>';

    // 안내
    html += '<div class="text-muted small" style="margin-top:6px;">※ 3개 이상 그룹 비교는 SNS랭킹 탭을 이용해 주세요.</div>';

    // SNS랭킹 탭 크로스링크
    html += '<div class="namu-smart-detail-link" style="margin-top:8px;">' +
        '<a href="javascript:void(0)" onclick="if(typeof route===\'function\')route(\'home\')">📈 SNS랭킹 탭에서 상세 보기 →</a>' +
        '</div></div></div>';

    container.innerHTML = html;
    container.style.display = 'block';
}

// --- 캘린더 전체 일정 조회 (그룹 없는 일반 쿼리) ---
async function executeCalendarSchedule(container, intent) {
    var months = intent.months || 3;

    // 로딩 표시
    showSmartAnswer(container, '컴백 일정', '캘린더 일정을 불러오는 중...', 'info');

    var events = await fetchCalendarEvents('', months);

    if (!events || events.length === 0) {
        showSmartAnswer(container, '컴백 일정', '예정된 컴백 일정이 없습니다.', 'warning');
        return;
    }

    var html = '<div class="namu-smart-answer">' +
        '<div class="namu-smart-answer-header">' +
        '<span class="namu-smart-icon">📅</span>' +
        '<span class="namu-smart-title">컴백 일정 (향후 ' + months + '개월)</span>' +
        '<button class="namu-smart-close" onclick="dismissSmartAnswer()" title="닫기">&times;</button>' +
        '</div>' +
        '<div class="namu-smart-answer-body">' +
        '<div class="table-responsive"><table class="table table-sm namu-smart-table">' +
        '<thead><tr><th>일정명</th><th>날짜</th><th>비고</th></tr></thead>' +
        '<tbody>';

    for (var i = 0; i < events.length; i++) {
        var ev = events[i];
        var dateStr = escapeHtml(ev.date || '-');
        if (ev.endDate && ev.endDate !== ev.date) {
            dateStr += ' ~ ' + escapeHtml(ev.endDate);
        }
        html += '<tr>' +
            '<td class="fw-bold">' + escapeHtml(ev.title || '-') + '</td>' +
            '<td>' + dateStr + '</td>' +
            '<td class="text-muted" style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' +
                escapeHtml(ev.description || '') + '</td>' +
            '</tr>';
    }

    html += '</tbody></table></div>' +
        '<div class="text-muted small" style="margin-top:4px;">총 ' + events.length + '건</div>' +
        '</div></div>';

    container.innerHTML = html;
    container.style.display = 'block';
}

// --- 최근 앨범 조회 ---
async function executeRecentAlbum(container, intent) {
    var detail = await fetchGroupDetail(intent.group.slug);
    if (!detail) {
        showSmartAnswer(container, '데이터 로드 실패', '상세 정보를 불러올 수 없습니다.', 'error');
        return;
    }

    var albums = detail.albums || [];
    if (albums.length === 0) {
        showSmartAnswer(container, intent.group.name, '앨범 정보가 없습니다.', 'warning');
        return;
    }

    // 발매일 기준 최신순 정렬 → 상위 5개
    var sorted = albums.slice().sort(function(a, b) {
        return (b['발매일'] || '').localeCompare(a['발매일'] || '');
    });
    var recent = sorted.slice(0, 5);

    var html = '<div class="namu-smart-answer">' +
        '<div class="namu-smart-answer-header">' +
        '<span class="namu-smart-icon">💿</span>' +
        '<span class="namu-smart-title">' + escapeHtml(intent.group.name) + ' 최근 앨범</span>' +
        '<button class="namu-smart-close" onclick="dismissSmartAnswer()" title="닫기">&times;</button>' +
        '</div>' +
        '<div class="namu-smart-answer-body">' +
        '<div class="table-responsive"><table class="table table-sm namu-smart-table">' +
        '<thead><tr><th>앨범</th><th>유형</th><th>발매일</th><th class="text-end">초동</th></tr></thead>' +
        '<tbody>';

    for (var i = 0; i < recent.length; i++) {
        var a = recent[i];
        html += '<tr>' +
            '<td class="fw-bold">' + escapeHtml(a.title || '-') + '</td>' +
            '<td><span class="badge bg-light text-dark">' + escapeHtml(a.type || '-') + '</span></td>' +
            '<td>' + escapeHtml(a['발매일'] || '-') + '</td>' +
            '<td class="text-end">' + escapeHtml(a['초동_써클'] || a['초동_한터'] || '-') + '</td>' +
            '</tr>';
    }

    html += '</tbody></table></div>' +
        '<div class="namu-smart-detail-link">' +
        '<a href="javascript:void(0)" onclick="loadNamuGroupBySlug(\'' + escapeSingleQuote(intent.group.slug) + '\')">' + escapeHtml(intent.group.name) + ' 상세 보기 →</a>' +
        '</div>' +
        '<div id="calendarFallbackSection"></div>' + // 캘린더 이벤트 삽입 영역
        '</div></div>';

    container.innerHTML = html;
    container.style.display = 'block';

    // 미래 앨범 존재 여부 확인 → 없으면 캘린더 폴백 (비동기)
    var today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    var futureAlbums = albums.filter(function(a) {
        return (a['발매일'] || '') >= today;
    });

    if (futureAlbums.length === 0) {
        // 캘린더에서 해당 그룹 이벤트 조회 (비동기)
        fetchCalendarEvents(intent.group.name, 3).then(function(events) {
            if (events && events.length > 0) {
                var calSection = document.getElementById('calendarFallbackSection');
                if (calSection) {
                    calSection.innerHTML = buildCalendarSection(events, intent.group.name);
                }
            }
        });
    }
}


// --- 디스코그래피 (전체 앨범 목록) ---
async function executeDiscography(container, intent) {
    var detail = await fetchGroupDetail(intent.group.slug);
    if (!detail) {
        showSmartAnswer(container, '데이터 로드 실패', intent.group.name + '의 상세 정보를 불러올 수 없습니다.', 'error');
        return;
    }

    var albums = detail.albums || [];
    if (albums.length === 0) {
        showSmartAnswer(container, intent.group.name + ' 디스코그래피', '앨범 정보가 없습니다.', 'warning');
        return;
    }

    // 발매일 순 정렬 (오래된 것 먼저)
    var sorted = albums.slice().sort(function(a, b) {
        return (a['발매일'] || '').localeCompare(b['발매일'] || '');
    });

    var html = '<div class="namu-smart-answer">' +
        '<div class="namu-smart-answer-header">' +
        '<span class="namu-smart-icon">💿</span>' +
        '<span class="namu-smart-title">' + escapeHtml(intent.group.name) + ' 디스코그래피 (' + albums.length + '장)</span>' +
        '<button class="namu-smart-close" onclick="dismissSmartAnswer()" title="닫기">&times;</button>' +
        '</div>' +
        '<div class="namu-smart-answer-body">' +
        '<div class="table-responsive"><table class="table table-sm namu-smart-table">' +
        '<thead><tr><th>#</th><th>앨범</th><th>유형</th><th>발매일</th><th class="text-end">초동</th></tr></thead>' +
        '<tbody>';

    for (var i = 0; i < sorted.length; i++) {
        var a = sorted[i];
        // 초동: 써클 우선, 한터 폴백
        var sales = a['초동_써클'] || a['초동_한터'] || '-';
        html += '<tr>' +
            '<td>' + (i + 1) + '</td>' +
            '<td class="fw-bold">' + escapeHtml(a.title || '-') + '</td>' +
            '<td><span class="badge bg-light text-dark">' + escapeHtml(a.type || '-') + '</span></td>' +
            '<td>' + escapeHtml(a['발매일'] || '-') + '</td>' +
            '<td class="text-end">' + escapeHtml(sales) + '</td>' +
            '</tr>';
    }

    html += '</tbody></table></div>' +
        '<div class="namu-smart-detail-link">' +
        '<a href="javascript:void(0)" onclick="loadNamuGroupBySlug(\'' + escapeSingleQuote(intent.group.slug) + '\')">' + escapeHtml(intent.group.name) + ' 상세 보기 →</a>' +
        '</div></div></div>';

    container.innerHTML = html;
    container.style.display = 'block';
}

// --- 멤버 나이순 테이블 ---
async function executeMemberAgeOrder(container, intent) {
    var detail = await fetchGroupDetail(intent.group.slug);
    if (!detail) {
        showSmartAnswer(container, '데이터 로드 실패', intent.group.name + '의 상세 정보를 불러올 수 없습니다.', 'error');
        return;
    }

    var members = detail.members || [];
    if (members.length === 0) {
        showSmartAnswer(container, intent.group.name + ' 멤버', '멤버 정보가 없습니다.', 'warning');
        return;
    }

    // 생년월일 파싱 가능한 멤버만 필터링
    var today = new Date();
    var membersWithDate = [];
    for (var i = 0; i < members.length; i++) {
        var m = members[i];
        var bd = m['생년월일'] || '';
        var match = bd.match(/(\d{4})[.\-\/](\d{1,2})[.\-\/](\d{1,2})/);
        if (match) {
            var d = new Date(parseInt(match[1]), parseInt(match[2]) - 1, parseInt(match[3]));
            var age = today.getFullYear() - d.getFullYear();
            if (today.getMonth() < d.getMonth() ||
                (today.getMonth() === d.getMonth() && today.getDate() < d.getDate())) {
                age--;
            }
            membersWithDate.push({
                name: m.name, 본명: m['본명'] || '', 생년월일: bd,
                역할: m['역할'] || '', age: age, date: d
            });
        } else {
            // 생년월일 없는 멤버도 표에 포함 (하단에)
            membersWithDate.push({
                name: m.name, 본명: m['본명'] || '', 생년월일: bd || '-',
                역할: m['역할'] || '', age: null, date: null
            });
        }
    }

    // 연장자순 정렬 (date 없는 멤버는 맨 뒤)
    membersWithDate.sort(function(a, b) {
        if (!a.date && !b.date) return 0;
        if (!a.date) return 1;
        if (!b.date) return -1;
        return a.date - b.date; // 이른 생일(연장자) 먼저
    });

    var html = '<div class="namu-smart-answer">' +
        '<div class="namu-smart-answer-header">' +
        '<span class="namu-smart-icon">🎂</span>' +
        '<span class="namu-smart-title">' + escapeHtml(intent.group.name) + ' 멤버 나이순 (' + members.length + '명)</span>' +
        '<button class="namu-smart-close" onclick="dismissSmartAnswer()" title="닫기">&times;</button>' +
        '</div>' +
        '<div class="namu-smart-answer-body">' +
        '<div class="table-responsive"><table class="table table-sm namu-smart-table">' +
        '<thead><tr><th>#</th><th>이름</th><th>본명</th><th>생년월일</th><th>나이</th><th>역할</th></tr></thead>' +
        '<tbody>';

    for (var j = 0; j < membersWithDate.length; j++) {
        var mem = membersWithDate[j];
        var ageText = mem.age !== null ? '만 ' + mem.age + '세' : '-';
        // 막내/최연장 하이라이트
        var rowStyle = '';
        if (j === 0 && mem.date) rowStyle = ' style="background-color:#e3f2fd;"'; // 최연장 하이라이트
        if (j === membersWithDate.length - 1 && mem.date) rowStyle = ' style="background-color:#fff3cd;"'; // 막내 하이라이트
        html += '<tr' + rowStyle + '>' +
            '<td>' + (j + 1) + '</td>' +
            '<td class="fw-bold">' + escapeHtml(mem.name) + '</td>' +
            '<td>' + escapeHtml(mem.본명 || '-') + '</td>' +
            '<td>' + escapeHtml(mem.생년월일) + '</td>' +
            '<td>' + ageText + '</td>' +
            '<td>' + escapeHtml(mem.역할 || '-') + '</td>' +
            '</tr>';
    }

    html += '</tbody></table></div>';

    // 최연장/막내 요약
    var oldest = membersWithDate.find(function(m) { return m.date !== null; });
    var youngest = null;
    for (var k = membersWithDate.length - 1; k >= 0; k--) {
        if (membersWithDate[k].date) { youngest = membersWithDate[k]; break; }
    }
    if (oldest && youngest && oldest !== youngest) {
        html += '<div class="namu-smart-summary mt-2" style="font-size:0.85em;color:#666;">' +
            '최연장: <strong>' + escapeHtml(oldest.name) + '</strong> (' + oldest.생년월일 + ', 만 ' + oldest.age + '세)' +
            ' / 막내: <strong>' + escapeHtml(youngest.name) + '</strong> (' + youngest.생년월일 + ', 만 ' + youngest.age + '세)' +
            '</div>';
    }

    html += '<div class="namu-smart-detail-link">' +
        '<a href="javascript:void(0)" onclick="loadNamuGroupBySlug(\'' + escapeSingleQuote(intent.group.slug) + '\')">' + escapeHtml(intent.group.name) + ' 상세 보기 →</a>' +
        '</div></div></div>';

    container.innerHTML = html;
    container.style.display = 'block';
}


// --- 나이 극값 질의: "에이티즈 최연소", "에스파 막내" 등 ---
async function executeMemberAgeExtreme(container, intent) {
    var detail = await fetchGroupDetail(intent.group.slug);
    if (!detail) {
        showSmartAnswer(container, '데이터 로드 실패', intent.group.name + '의 상세 정보를 불러올 수 없습니다.', 'error');
        return;
    }

    var members = detail.members || [];
    if (members.length === 0) {
        showSmartAnswer(container, intent.group.name, '멤버 정보가 없습니다.', 'warning');
        return;
    }

    // 생년월일 파싱
    var today = new Date();
    var parsed = [];
    for (var i = 0; i < members.length; i++) {
        var bd = members[i]['생년월일'] || '';
        var match = bd.match(/(\d{4})[.\-\/](\d{1,2})[.\-\/](\d{1,2})/);
        if (match) {
            var d = new Date(parseInt(match[1]), parseInt(match[2]) - 1, parseInt(match[3]));
            var age = today.getFullYear() - d.getFullYear();
            if (today.getMonth() < d.getMonth() ||
                (today.getMonth() === d.getMonth() && today.getDate() < d.getDate())) {
                age--;
            }
            parsed.push({ name: members[i].name, 본명: members[i]['본명'] || '', 생년월일: bd, 역할: members[i]['역할'] || '', age: age, date: d });
        }
    }

    if (parsed.length === 0) {
        showSmartAnswer(container, intent.group.name, '생년월일 데이터가 없습니다.', 'warning');
        return;
    }

    // youngest: 가장 늦은 생일 (큰 date) / oldest: 가장 이른 생일 (작은 date)
    parsed.sort(function(a, b) { return a.date - b.date; });
    var target = intent.mode === 'youngest' ? parsed[parsed.length - 1] : parsed[0];
    var modeText = intent.mode === 'youngest' ? '막내(최연소)' : '최연장';

    var html = '<div class="namu-smart-answer">' +
        '<div class="namu-smart-answer-header">' +
        '<span class="namu-smart-icon">🎂</span>' +
        '<span class="namu-smart-title">' + escapeHtml(intent.group.name) + ' ' + modeText + '</span>' +
        '<button class="namu-smart-close" onclick="dismissSmartAnswer()" title="닫기">&times;</button>' +
        '</div>' +
        '<div class="namu-smart-answer-body">' +
        '<div style="font-size:1.15rem;font-weight:bold;margin-bottom:8px;">' + escapeHtml(target.name) +
        (target.본명 ? ' (' + escapeHtml(target.본명) + ')' : '') + '</div>' +
        '<div>생년월일: ' + escapeHtml(target.생년월일) + ' (만 ' + target.age + '세)</div>' +
        (target.역할 ? '<div>역할: ' + escapeHtml(target.역할) + '</div>' : '') +
        '</div>' +
        '<div class="namu-smart-detail-link">' +
        '<a href="javascript:void(0)" onclick="loadNamuGroupBySlug(\'' + escapeSingleQuote(intent.group.slug) + '\')">' + escapeHtml(intent.group.name) + ' 상세 보기 →</a>' +
        '</div></div>';

    container.innerHTML = html;
    container.style.display = 'block';
}

// --- 외국인 멤버 필터: "아이들 외국인 멤버" 등 ---
async function executeForeignMember(container, intent) {
    var detail = await fetchGroupDetail(intent.group.slug);
    if (!detail) {
        showSmartAnswer(container, '데이터 로드 실패', '상세 정보를 불러올 수 없습니다.', 'error');
        return;
    }

    var members = detail.members || [];
    // 출신지가 "대한민국"이 아닌 멤버 필터링
    var foreign = members.filter(function(m) {
        var origin = (m['출신지'] || '').trim();
        return origin && origin !== '대한민국' && !origin.startsWith('대한민국');
    });

    if (foreign.length === 0) {
        showSmartAnswer(container, intent.group.name + ' 외국인 멤버', '외국인 멤버가 없거나 출신지 데이터가 부족합니다.', 'info');
        return;
    }

    var html = '<div class="namu-smart-answer">' +
        '<div class="namu-smart-answer-header">' +
        '<span class="namu-smart-icon">🌏</span>' +
        '<span class="namu-smart-title">' + escapeHtml(intent.group.name) + ' 외국인 멤버 (' + foreign.length + '명)</span>' +
        '<button class="namu-smart-close" onclick="dismissSmartAnswer()" title="닫기">&times;</button>' +
        '</div>' +
        '<div class="namu-smart-answer-body">' +
        '<div class="table-responsive"><table class="table table-sm namu-smart-table">' +
        '<thead><tr><th>이름</th><th>본명</th><th>출신지</th><th>역할</th></tr></thead>' +
        '<tbody>';

    for (var i = 0; i < foreign.length; i++) {
        var m = foreign[i];
        html += '<tr>' +
            '<td class="fw-bold">' + escapeHtml(m.name || '-') + '</td>' +
            '<td>' + escapeHtml(m['본명'] || '-') + '</td>' +
            '<td>' + escapeHtml(m['출신지'] || '-') + '</td>' +
            '<td>' + escapeHtml(m['역할'] || '-') + '</td>' +
            '</tr>';
    }

    // 전체 멤버 목록도 하단에 표시
    var allNames = members.map(function(m) { return m.name; }).join(', ');
    html += '</tbody></table></div>' +
        '<div class="namu-smart-summary mt-2" style="font-size:0.85em;color:#666;">전체 멤버: ' + escapeHtml(allNames) + '</div>' +
        '<div class="namu-smart-detail-link">' +
        '<a href="javascript:void(0)" onclick="loadNamuGroupBySlug(\'' + escapeSingleQuote(intent.group.slug) + '\')">' + escapeHtml(intent.group.name) + ' 상세 보기 →</a>' +
        '</div></div></div>';

    container.innerHTML = html;
    container.style.display = 'block';
}

// --- 앨범 유형별 카운트: "세븐틴 정규앨범 몇 개" 등 ---
async function executeAlbumTypeCount(container, intent) {
    var detail = await fetchGroupDetail(intent.group.slug);
    if (!detail) {
        showSmartAnswer(container, '데이터 로드 실패', '상세 정보를 불러올 수 없습니다.', 'error');
        return;
    }

    var albums = detail.albums || [];
    var typeKey = intent.albumType; // "정규앨범", "미니앨범" 등
    var matched = albums.filter(function(a) {
        return (a.type || '').indexOf(typeKey) !== -1;
    });

    var html = '<div class="namu-smart-answer">' +
        '<div class="namu-smart-answer-header">' +
        '<span class="namu-smart-icon">💿</span>' +
        '<span class="namu-smart-title">' + escapeHtml(intent.group.name) + ' ' + typeKey + ': ' + matched.length + '개</span>' +
        '<button class="namu-smart-close" onclick="dismissSmartAnswer()" title="닫기">&times;</button>' +
        '</div>' +
        '<div class="namu-smart-answer-body">';

    if (matched.length > 0) {
        html += '<div class="table-responsive"><table class="table table-sm namu-smart-table">' +
            '<thead><tr><th>#</th><th>앨범</th><th>유형</th><th>발매일</th></tr></thead><tbody>';
        // 발매일 오름차순 정렬
        matched.sort(function(a, b) { return (a['발매일'] || '').localeCompare(b['발매일'] || ''); });
        for (var i = 0; i < matched.length; i++) {
            html += '<tr><td>' + (i + 1) + '</td>' +
                '<td class="fw-bold">' + escapeHtml(matched[i].title || '-') + '</td>' +
                '<td><span class="badge bg-light text-dark">' + escapeHtml(matched[i].type || '-') + '</span></td>' +
                '<td>' + escapeHtml(matched[i]['발매일'] || '-') + '</td></tr>';
        }
        html += '</tbody></table></div>';
    } else {
        html += '<div>' + typeKey + ' 앨범이 없습니다.</div>';
    }

    html += '<div class="namu-smart-detail-link">' +
        '<a href="javascript:void(0)" onclick="loadNamuGroupBySlug(\'' + escapeSingleQuote(intent.group.slug) + '\')">' + escapeHtml(intent.group.name) + ' 상세 보기 →</a>' +
        '</div></div></div>';

    container.innerHTML = html;
    container.style.display = 'block';
}

// --- 멤버수 필터: "멤버 10명 이상 그룹" 등 ---
async function executeMemberCountFilter(container, intent) {
    if (!namuIndexData) return;

    var count = intent.count;
    var filtered = namuIndexData.filter(function(g) {
        var mc = parseInt(g.member_count) || 0;
        return intent.direction === 'lte' ? mc <= count : mc >= count;
    });
    // 멤버수 내림차순 정렬
    filtered.sort(function(a, b) { return (parseInt(b.member_count) || 0) - (parseInt(a.member_count) || 0); });

    var dirText = intent.direction === 'lte' ? '이하' : '이상';
    var title = '멤버 ' + count + '명 ' + dirText + ' 그룹 (' + filtered.length + '개)';

    if (filtered.length === 0) {
        showSmartAnswer(container, title, '해당 조건의 그룹이 없습니다.', 'info');
        return;
    }

    var html = '<div class="namu-smart-answer">' +
        '<div class="namu-smart-answer-header">' +
        '<span class="namu-smart-icon">👥</span>' +
        '<span class="namu-smart-title">' + escapeHtml(title) + '</span>' +
        '<button class="namu-smart-close" onclick="dismissSmartAnswer()" title="닫기">&times;</button>' +
        '</div>' +
        '<div class="namu-smart-answer-body">' +
        '<div class="table-responsive"><table class="table table-sm namu-smart-table">' +
        '<thead><tr><th>#</th><th>그룹</th><th>멤버수</th><th>성별</th><th>소속사</th></tr></thead><tbody>';

    var limit = Math.min(filtered.length, 30);
    for (var i = 0; i < limit; i++) {
        var g = filtered[i];
        html += '<tr onclick="loadNamuGroupBySlug(\'' + escapeSingleQuote(g.slug) + '\')" style="cursor:pointer;">' +
            '<td>' + (i + 1) + '</td>' +
            '<td class="fw-bold">' + escapeHtml(g.name) + '</td>' +
            '<td>' + (g.member_count || '-') + '명</td>' +
            '<td>' + (g.gender === '여자' ? '🔴' : '🔵') + ' ' + g.gender + '</td>' +
            '<td>' + escapeHtml((g.agency || '').length > 20 ? g.agency.substring(0, 20) + '…' : (g.agency || '-')) + '</td>' +
            '</tr>';
    }

    html += '</tbody></table></div></div></div>';
    container.innerHTML = html;
    container.style.display = 'block';
}

// --- 앨범수 필터: "앨범 30개 이상 그룹" 등 ---
async function executeAlbumCountFilter(container, intent) {
    if (!namuIndexData) return;

    var count = intent.count;
    var filtered = namuIndexData.filter(function(g) {
        var ac = parseInt(g.album_count) || 0;
        return intent.direction === 'lte' ? ac <= count : ac >= count;
    });
    // 앨범수 내림차순 정렬
    filtered.sort(function(a, b) { return (parseInt(b.album_count) || 0) - (parseInt(a.album_count) || 0); });

    var dirText = intent.direction === 'lte' ? '이하' : '이상';
    var title = '앨범 ' + count + '개 ' + dirText + ' 그룹 (' + filtered.length + '개)';

    if (filtered.length === 0) {
        showSmartAnswer(container, title, '해당 조건의 그룹이 없습니다.', 'info');
        return;
    }

    var html = '<div class="namu-smart-answer">' +
        '<div class="namu-smart-answer-header">' +
        '<span class="namu-smart-icon">💿</span>' +
        '<span class="namu-smart-title">' + escapeHtml(title) + '</span>' +
        '<button class="namu-smart-close" onclick="dismissSmartAnswer()" title="닫기">&times;</button>' +
        '</div>' +
        '<div class="namu-smart-answer-body">' +
        '<div class="table-responsive"><table class="table table-sm namu-smart-table">' +
        '<thead><tr><th>#</th><th>그룹</th><th>앨범수</th><th>성별</th></tr></thead><tbody>';

    for (var i = 0; i < filtered.length; i++) {
        var g = filtered[i];
        html += '<tr onclick="loadNamuGroupBySlug(\'' + escapeSingleQuote(g.slug) + '\')" style="cursor:pointer;">' +
            '<td>' + (i + 1) + '</td>' +
            '<td class="fw-bold">' + escapeHtml(g.name) + '</td>' +
            '<td>' + (g.album_count || '-') + '개</td>' +
            '<td>' + (g.gender === '여자' ? '🔴' : '🔵') + ' ' + g.gender + '</td>' +
            '</tr>';
    }

    html += '</tbody></table></div></div></div>';
    container.innerHTML = html;
    container.style.display = 'block';
}

// --- 특정 앨범 조회: "블랙핑크 BORN PINK 초동" 등 ---
async function executeSpecificAlbumLookup(container, intent) {
    var detail = await fetchGroupDetail(intent.group.slug);
    if (!detail) {
        showSmartAnswer(container, '데이터 로드 실패', '상세 정보를 불러올 수 없습니다.', 'error');
        return;
    }

    var albums = detail.albums || [];
    var query = intent.albumQuery;

    // 앨범명 정규화 함수: 대소문자/특수문자/공백 무시 비교
    function normalizeAlbumTitle(s) {
        return (s || '').toLowerCase()
            .replace(/['']/g, "'")               // 스마트 따옴표 통일
            .replace(/[()（）\[\]{}「」『』]/g, '') // 괄호 류 제거
            .replace(/[&+]/g, 'and')             // & → and
            .replace(/[:：·\-–—_.,!?'"]/g, '')   // 구두점/특수기호 제거
            .replace(/\s+/g, '')                  // 공백 전부 제거
            .trim();
    }

    var normQuery = normalizeAlbumTitle(query);

    // 1단계: 정규화된 부분 일치 매칭
    var matched = albums.filter(function(a) {
        return normalizeAlbumTitle(a.title).indexOf(normQuery) !== -1;
    });

    // 2단계: 원본 title 단어 토큰 매칭 (Remix/Ver. 변형 앨범 중 원곡 우선)
    if (matched.length > 1) {
        var exact = matched.filter(function(a) {
            return normalizeAlbumTitle(a.title) === normQuery;
        });
        if (exact.length > 0) matched = exact;
    }

    if (matched.length === 0) {
        // 정확 매칭 실패 → raw_text 검색으로 폴백
        await executeGroupRawSearch(container, {
            group: intent.group,
            keyword: intent.albumQuery + ' ' + intent.infoType
        });
        return;
    }

    var album = matched[0]; // 첫 번째 매칭
    var infoType = intent.infoType;
    var title = intent.group.name + ' — ' + (album.title || '');

    var html = '<div class="namu-smart-answer">' +
        '<div class="namu-smart-answer-header">' +
        '<span class="namu-smart-icon">💿</span>' +
        '<span class="namu-smart-title">' + escapeHtml(title) + '</span>' +
        '<button class="namu-smart-close" onclick="dismissSmartAnswer()" title="닫기">&times;</button>' +
        '</div>' +
        '<div class="namu-smart-answer-body">' +
        '<div class="table-responsive"><table class="table table-sm namu-smart-table">' +
        '<tbody>' +
        '<tr><td class="fw-bold">앨범</td><td>' + escapeHtml(album.title || '-') + '</td></tr>' +
        '<tr><td class="fw-bold">유형</td><td>' + escapeHtml(album.type || '-') + '</td></tr>' +
        '<tr><td class="fw-bold">발매일</td><td>' + escapeHtml(album['발매일'] || '-') + '</td></tr>' +
        '<tr><td class="fw-bold">초동(써클)</td><td>' + escapeHtml(album['초동_써클'] || '-') + '</td></tr>' +
        '<tr><td class="fw-bold">초동(한터)</td><td>' + escapeHtml(album['초동_한터'] || '-') + '</td></tr>' +
        '<tr><td class="fw-bold">누적(써클)</td><td>' + escapeHtml(album['누적_써클'] || '-') + '</td></tr>' +
        '<tr><td class="fw-bold">누적(한터)</td><td>' + escapeHtml(album['누적_한터'] || '-') + '</td></tr>';

    if (album['비고']) {
        html += '<tr><td class="fw-bold">비고</td><td>' + escapeHtml(album['비고']) + '</td></tr>';
    }

    html += '</tbody></table></div>' +
        '<div class="namu-smart-detail-link">' +
        '<a href="javascript:void(0)" onclick="loadNamuGroupBySlug(\'' + escapeSingleQuote(intent.group.slug) + '\')">' + escapeHtml(intent.group.name) + ' 상세 보기 →</a>' +
        '</div></div></div>';

    container.innerHTML = html;
    container.style.display = 'block';
}


// ============================================================
// 동명 멤버 선택 UI
// ============================================================

function showDisambiguationUI(container, memberName, groups) {
    var html = '<div class="namu-smart-answer">' +
        '<div class="namu-smart-answer-header">' +
        '<span class="namu-smart-icon">❓</span>' +
        '<span class="namu-smart-title">"' + escapeHtml(memberName) + '" — 어느 그룹의 멤버인가요?</span>' +
        '<button class="namu-smart-close" onclick="dismissSmartAnswer()" title="닫기">&times;</button>' +
        '</div>' +
        '<div class="namu-smart-answer-body">' +
        '<div class="d-flex flex-wrap gap-2">';

    for (var i = 0; i < groups.length; i++) {
        var g = groups[i];
        html += '<button class="btn btn-outline-primary btn-sm" ' +
            'onclick="loadNamuGroupBySlug(\'' + escapeSingleQuote(g.slug) + '\')">' +
            escapeHtml(g.group_name) + '의 ' + escapeHtml(memberName) +
            '</button>';
    }

    html += '</div></div></div>';

    container.innerHTML = html;
    container.style.display = 'block';
}


// ============================================================
// 답변 카드 렌더링 유틸리티
// ============================================================

function showSmartAnswer(container, title, body, type, slug) {
    // 채팅 UI: AI 답변 영역에 깔끔한 텍스트로 렌더링
    var icons = { info: '💡', warning: '⚠️', error: '❌', ai: '✨' };
    var icon = icons[type] || '💡';

    var html = '<div class="chat-ai-content">';
    html += '<p style="margin-bottom:6px;"><strong>' + icon + ' ' + escapeHtml(title) + '</strong></p>';
    html += '<p>' + escapeHtml(body) + '</p>';

    if (slug) {
        html += '<div class="chat-ai-detail-link">' +
            '<a href="javascript:void(0)" onclick="loadNamuGroupBySlug(\'' + escapeSingleQuote(slug) + '\')">' + '상세 보기 →</a>' +
            '</div>';
    }
    // 나무위키 원문 링크 — 캐시된 그룹 상세에 namu_url이 있을 때 표시
    if (slug && smartSearchGroupCache[slug] && smartSearchGroupCache[slug].namu_url) {
        html += '<div class="chat-ai-namu-link">' +
            '<a href="' + escapeHtml(smartSearchGroupCache[slug].namu_url) + '" target="_blank" rel="noopener">' +
            '📚 나무위키에서 직접 확인하기 →</a></div>';
    }
    html += '</div>';
    container.innerHTML = html;

    // 부모 chat-container도 표시
    var chatContainer = document.getElementById('namuSmartAnswer');
    if (chatContainer) chatContainer.style.display = 'flex';
}

// 스마트 답변 닫기 → 검색 뷰 복원 + 진행 중인 검색 취소
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
}


// ============================================================
// 비교 차트 렌더링
// ============================================================

var smartCompareChartInstance = null;

function renderComparisonChart(d1, d2) {
    if (typeof Chart === 'undefined') return;

    // 기존 차트 파괴
    if (smartCompareChartInstance) {
        smartCompareChartInstance.destroy();
        smartCompareChartInstance = null;
    }

    var canvas = document.getElementById('smartCompareChart');
    if (!canvas) return;

    // 각 그룹 최근 5개 앨범의 초동 데이터
    var data1 = getRecentSalesData(d1, 5);
    var data2 = getRecentSalesData(d2, 5);

    // 앨범이 없으면 차트 숨기기
    if (data1.labels.length === 0 && data2.labels.length === 0) {
        canvas.style.display = 'none';
        return;
    }

    // 전체 라벨 합산 (최신순 → 오래된순으로 정렬해 표시)
    var allLabels = [];
    var map1 = {};
    var map2 = {};
    for (var i = 0; i < data1.labels.length; i++) {
        map1[data1.labels[i]] = data1.values[i];
        if (allLabels.indexOf(data1.labels[i]) === -1) allLabels.push(data1.labels[i]);
    }
    for (var j = 0; j < data2.labels.length; j++) {
        map2[data2.labels[j]] = data2.values[j];
        if (allLabels.indexOf(data2.labels[j]) === -1) allLabels.push(data2.labels[j]);
    }

    var ctx = canvas.getContext('2d');
    smartCompareChartInstance = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: [d1.name, d2.name],
            datasets: [{
                label: '최고 초동',
                data: [getMaxSalesNum(d1), getMaxSalesNum(d2)],
                backgroundColor: ['rgba(0, 97, 242, 0.7)', 'rgba(233, 30, 99, 0.7)'],
                borderColor: ['#0061f2', '#e91e63'],
                borderWidth: 1
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        label: function(ctx) { return ctx.raw.toLocaleString() + '장'; }
                    }
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    ticks: {
                        callback: function(v) {
                            if (v >= 1000000) return (v / 1000000).toFixed(1) + 'M';
                            if (v >= 1000) return (v / 1000).toFixed(0) + 'K';
                            return v;
                        }
                    }
                }
            }
        }
    });
}


// ============================================================
// Gemini Flash API 폴백 (Method B)
// ============================================================

// 로컬 개발 환경 감지 (localhost / 127.0.0.1)
function isLocalDev() {
    var h = location.hostname;
    return h === 'localhost' || h === '127.0.0.1';
}

/**
 * 로컬 개발용: Gemini API 직접 호출 (GAS 프록시 우회)
 * API 키: localStorage.setItem('GEMINI_API_KEY', 'your-key')
 */
async function callGeminiDirect(query, context, signal) {
    var apiKey = localStorage.getItem('GEMINI_API_KEY');
    if (!apiKey) {
        console.warn('%c🔑 로컬 Gemini: API 키가 필요합니다', 'color:#FF5722;font-weight:bold');
        console.warn('브라우저 콘솔에서 실행: localStorage.setItem("GEMINI_API_KEY", "your-key")');
        return { _error: true, message: 'GEMINI_API_KEY가 설정되지 않았습니다. 브라우저 콘솔에서 localStorage.setItem("GEMINI_API_KEY", "your-key")를 실행하세요.' };
    }

    // GAS handleGeminiProxy와 동일한 시스템 프롬프트 (오늘 날짜 주입)
    var todayStr = new Date().toISOString().slice(0, 10); // yyyy-MM-dd
    var systemPrompt = '당신은 K-POP 아이돌 전문가입니다.\n' +
        '오늘 날짜: ' + todayStr + '\n' +
        '나이를 언급할 때는 반드시 오늘 날짜 기준으로 만 나이를 계산하세요. 학습 데이터의 과거 날짜를 기준으로 하지 마세요.\n' +
        '아래 데이터베이스 정보를 우선 참고하되, 데이터베이스에 없는 정보는 당신의 지식을 활용하여 답변하세요.\n' +
        '데이터베이스 기반 답변과 자체 지식 기반 답변을 구분하지 않아도 됩니다.\n' +
        '답변은 JSON 형식으로 반환하세요: {"title": "답변 제목", "content": "답변 내용 (마크다운 가능)"}\n' +
        '반드시 JSON만 반환하고 다른 텍스트는 포함하지 마세요.';

    var payload = {
        contents: [{ parts: [{ text: systemPrompt + '\n\n=== 데이터베이스 ===\n' + context + '\n\n질문: ' + query }] }],
        generationConfig: { temperature: 0.1, maxOutputTokens: 1024 }
    };

    // 20초 타임아웃
    var controller = new AbortController();
    var timeoutId = setTimeout(function() { controller.abort(); }, 20000);

    // 외부 시그널 연결
    var abortHandler = null;
    if (signal) {
        if (signal.aborted) { clearTimeout(timeoutId); return { _aborted: true }; }
        abortHandler = function() { controller.abort(); };
        signal.addEventListener('abort', abortHandler);
    }

    try {
        console.log('%c🤖 로컬 Gemini 직접 호출', 'color:#2196F3;font-weight:bold', query);
        var response = await fetch(
            'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=' + apiKey,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                signal: controller.signal,
                body: JSON.stringify(payload)
            }
        );
        clearTimeout(timeoutId);
        if (abortHandler) signal.removeEventListener('abort', abortHandler);
        if (signal && signal.aborted) return { _aborted: true };

        if (!response.ok) {
            var errText = '';
            try { errText = await response.text(); } catch (_) {}
            console.error('Gemini API 오류:', response.status, errText);
            return { _error: true, message: 'Gemini API 오류 (' + response.status + ')' };
        }

        var result = await response.json();
        var text = result.candidates[0].content.parts[0].text;

        // JSON 파싱 시도
        try {
            var cleaned = text.replace(/^```json\s*/, '').replace(/\s*```$/, '').trim();
            return JSON.parse(cleaned);
        } catch (e) {
            // JSON 파싱 실패 → 텍스트 그대로 반환
            return { title: '검색 결과', content: text };
        }
    } catch (e) {
        clearTimeout(timeoutId);
        if (abortHandler) signal.removeEventListener('abort', abortHandler);
        if (signal && signal.aborted) return { _aborted: true };
        if (e.name === 'AbortError') {
            console.warn('Gemini API 타임아웃 (20초)');
            return { _error: true, message: '응답 시간 초과 (20초)' };
        }
        console.error('Gemini API 호출 실패:', e);
        return null;
    }
}

// ============================================================
// 복합 질의 전용 Gemini 합성 함수 (Retrieve & Synthesize)
// - 자동 컨텍스트 빌드 생략 (focused context 직접 전달)
// - 데이터 분석 특화 시스템 프롬프트 (순위표 + 요약 지시)
// - maxOutputTokens 2048 (17개+ 그룹 순위표 생성 여유)
// ============================================================
var COMPOUND_SYSTEM_PROMPT = '당신은 K-POP 아이돌 데이터 분석가입니다.\n' +
    '오늘 날짜: ' + new Date().toISOString().slice(0, 10) + '\n' +
    '나이를 언급할 때는 반드시 오늘 날짜 기준으로 만 나이를 계산하세요.\n' +
    '사용자가 제공한 데이터를 바탕으로 아래 규칙에 따라 답변하세요.\n\n' +
    '규칙:\n' +
    '1. 순위나 비교가 필요하면 반드시 마크다운 표(| 순위 | 그룹명 | ... |) 형식으로 정리하세요.\n' +
    '2. 표에는 순위, 그룹명, 성별, 데뷔연도, 판매량(수치), 해당 앨범명을 포함하세요.\n' +
    '3. 판매량 데이터가 없는 그룹은 표 하단에 "데이터 없음"으로 묶어 표시하세요.\n' +
    '4. 표 아래에 **핵심 요약**이라는 제목으로 1위 그룹, 걸그룹/보이그룹 1위, 주요 트렌드 등을 3줄 이내로 요약하세요.\n' +
    '5. 데이터에 없는 내용을 지어내지 마세요.\n' +
    '6. 판매량 수치에 ** 마스킹이 있으면 ~표시와 함께 추정치로 표기하세요 (예: 2,344,7** → ~2,344,700).\n\n' +
    '답변은 JSON 형식으로 반환하세요: {"title": "답변 제목", "content": "답변 내용 (마크다운 표 포함)"}\n' +
    '반드시 JSON만 반환하고 다른 텍스트는 포함하지 마세요.';

async function callGeminiSynthesize(originalQuery, focusedContext, externalSignal) {
    var abortSignal = externalSignal || (currentSearchAbortController ? currentSearchAbortController.signal : null);
    if (abortSignal && abortSignal.aborted) return { _aborted: true };

    // 캐시 확인 (원본 쿼리 기준)
    var cached = getGeminiCache(originalQuery);
    if (cached) {
        console.log('%c⚡ 복합 질의 캐시 히트', 'color:#4CAF50;font-weight:bold', originalQuery);
        cached._fromCache = true;
        return cached;
    }

    // 프롬프트 조립: 시스템 프롬프트 + focused context + 원본 질문
    var fullPrompt = COMPOUND_SYSTEM_PROMPT + '\n\n=== 제공된 데이터 ===\n' + focusedContext + '\n\n질문: ' + originalQuery;

    // 20초 타임아웃
    var controller = new AbortController();
    var timeoutId = setTimeout(function() { controller.abort(); }, 20000);
    var abortHandler = null;
    if (abortSignal) {
        abortHandler = function() { controller.abort(); };
        abortSignal.addEventListener('abort', abortHandler);
    }

    try {
        var response;
        if (isLocalDev()) {
            // 로컬 개발: Gemini API 직접 호출
            var apiKey = localStorage.getItem('GEMINI_API_KEY');
            if (!apiKey) return { _error: true, message: 'GEMINI_API_KEY가 설정되지 않았습니다.' };

            console.log('%c🔬 복합 질의 Gemini 합성', 'color:#9C27B0;font-weight:bold', originalQuery);
            response = await fetch(
                'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=' + apiKey,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    signal: controller.signal,
                    body: JSON.stringify({
                        contents: [{ parts: [{ text: fullPrompt }] }],
                        generationConfig: { temperature: 0.1, maxOutputTokens: 2048 }
                    })
                }
            );
        } else {
            // 프로덕션: GAS 프록시 (compound 플래그 전달)
            var gasUrl = window.GAS_WEBAPP_URL || (typeof API_URL !== 'undefined' ? API_URL : '');
            if (!gasUrl) return null;

            response = await fetch(gasUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'text/plain' },
                signal: controller.signal,
                body: JSON.stringify({
                    action: 'geminiProxy',
                    query: originalQuery,
                    context: focusedContext,
                    compound: true  // GAS에서 전용 프롬프트 사용 플래그
                })
            });
        }

        clearTimeout(timeoutId);
        if (abortHandler) abortSignal.removeEventListener('abort', abortHandler);
        if (abortSignal && abortSignal.aborted) return { _aborted: true };

        if (!response.ok) {
            console.error('복합 질의 Gemini 오류:', response.status);
            return { _error: true, message: 'API 호출 실패 (' + response.status + ')' };
        }

        var result = await response.json();

        // 로컬 dev: Gemini raw response 파싱
        if (isLocalDev()) {
            var text = result.candidates[0].content.parts[0].text;
            try {
                var cleaned = text.replace(/^```json\s*/, '').replace(/\s*```$/, '').trim();
                result = JSON.parse(cleaned);
            } catch (e) {
                result = { title: '분석 결과', content: text };
            }
        }

        // GAS 프록시: 에러 체크
        if (result._error) return result;
        if (!result.title && !result.content) return null;

        // 성공 → 캐시 저장 (원본 쿼리 기준)
        setGeminiCache(originalQuery, result);
        return result;

    } catch (e) {
        clearTimeout(timeoutId);
        if (abortHandler) abortSignal.removeEventListener('abort', abortHandler);
        if (abortSignal && abortSignal.aborted) return { _aborted: true };
        if (e.name === 'AbortError') return { _error: true, message: '응답 시간 초과 (20초)' };
        console.error('복합 질의 Gemini 호출 실패:', e);
        return null;
    }
}

// ============================================================
// 나무위키 원문 정제 전용 Gemini 합성 함수 (RAG Synthesis Layer)
// - raw_text 검색 성공 시 날것 텍스트 대신 자동 호출
// - 목차번호/위키문법 잡음 제거 + 마크다운 표/리스트로 정돈
// ============================================================
var NAMU_SYNTHESIS_SYSTEM_PROMPT =
    '당신은 K-POP 정보 요약 전문가입니다.\n' +
    '오늘 날짜: ' + new Date().toISOString().slice(0, 10) + '\n' +
    '나이를 언급할 때는 반드시 오늘 날짜 기준으로 만 나이를 계산하세요.\n\n' +
    '제공된 [나무위키 원문]만을 바탕으로 사용자 질문에 답변하세요.\n\n' +
    '규칙:\n' +
    '1. 원문을 그대로 복사하지 마세요. 내용을 이해하고 자연스러운 문장으로 새롭게 작성하세요.\n' +
    '2. 시간 순서나 변화(예: 룸메이트 변경, 소속사 이동, 활동 이력)가 있다면 반드시 마크다운 표(| 시기 | 내용 |)를 사용하세요.\n' +
    '3. 홍보대사, 수상 이력, 멤버 목록처럼 여러 항목이 나열될 경우 글머리 기호(-)를 사용하여 깔끔하게 정리하세요.\n' +
    '4. "기사", "SNS", "9.3." 같은 목차 번호나 나무위키 문법 잔재(각주 번호 [1], 편집 링크 등)는 모두 제거하세요.\n' +
    '5. 없는 내용을 지어내지 마세요.\n' +
    '6. ⚠️ 원문에 있는 모든 연도별 이력, 항목, 표 데이터를 절대 누락하거나 축약하지 마세요. 항목이 많을수록 더 풍부하게 전부 작성해야 합니다.\n\n' +
    '답변은 반드시 JSON 형식으로 반환하세요: {"title": "답변 제목", "content": "답변 내용 (마크다운 표/리스트 포함)"}\n' +
    '반드시 JSON만 반환하고 다른 텍스트는 포함하지 마세요.';

/**
 * Multi-Hit Aggregation: 키워드 히트 위치 주변 ±WINDOW줄씩 추출 후 병합
 * - 목차(TOC) 구간 자동 제외: 주변 20줄 중 긴 줄(>20자)이 5개 미만이면 TOC로 판단
 * - 실제 콘텐츠 섹션 우선, 겹치는 구간 자동 병합, 최대 maxLines 제한
 * @param {string[]} lines   - rawText.split('\n')
 * @param {string}   keyword - 검색 키워드 (공백 포함 가능)
 * @param {number}   [maxLines=200] - 최대 출력 줄 수
 * @returns {string|null}
 */
function buildWideContext(lines, keyword, maxLines) {
    maxLines = maxLines || 200;
    var WINDOW = 80; // 히트 위치 전후 80줄
    var subKws = keyword.split(/\s+/).filter(function(w) { return w.length >= 2; });
    var kwLower = keyword.toLowerCase();

    // 모든 히트 위치 수집 (전체 키워드 OR 서브키워드 과반 매칭)
    var hitIndices = [];
    for (var i = 0; i < lines.length; i++) {
        var ll = lines[i].toLowerCase();
        var hit = ll.indexOf(kwLower) !== -1;
        if (!hit && subKws.length > 1) {
            var cnt = 0;
            for (var k = 0; k < subKws.length; k++) {
                if (ll.indexOf(subKws[k].toLowerCase()) !== -1) cnt++;
            }
            hit = cnt >= Math.ceil(subKws.length / 2);
        }
        if (hit) hitIndices.push(i);
    }
    if (hitIndices.length === 0) return null;

    // TOC 구간 제외 필터: TOC는 주변 모든 줄이 짧음(최대 11자 수준)
    // 콘텐츠 구간에는 25자 이상 줄이 반드시 존재 → max line length ≥ 25자면 실제 콘텐츠
    function isContentHit(idx) {
        var s = Math.max(0, idx - 10), e = Math.min(lines.length - 1, idx + 10);
        var maxLen = 0;
        for (var j = s; j <= e; j++) {
            var len = lines[j].trim().length;
            if (len > maxLen) maxLen = len;
        }
        return maxLen >= 25;
    }

    // 실제 콘텐츠 히트 우선, 없으면 전체 히트 사용
    var contentHits = hitIndices.filter(isContentHit);
    var finalHits = contentHits.length > 0 ? contentHits : hitIndices;

    // 각 히트 주변 구간 설정
    var ranges = finalHits.map(function(idx) {
        return { start: Math.max(0, idx - WINDOW), end: Math.min(lines.length - 1, idx + WINDOW) };
    });

    // 인접 구간 병합 (간격 ≤ 15줄이면 합침)
    ranges.sort(function(a, b) { return a.start - b.start; });
    var merged = [{ start: ranges[0].start, end: ranges[0].end }];
    for (var ri = 1; ri < ranges.length; ri++) {
        var last = merged[merged.length - 1];
        if (ranges[ri].start <= last.end + 15) {
            last.end = Math.max(last.end, ranges[ri].end);
        } else {
            merged.push({ start: ranges[ri].start, end: ranges[ri].end });
        }
    }

    // 병합된 구간들을 연결 (최대 maxLines)
    var out = [];
    for (var mi = 0; mi < merged.length; mi++) {
        if (out.length >= maxLines) break;
        if (mi > 0) out.push('...');
        var seg = lines.slice(merged[mi].start, merged[mi].end + 1);
        var remaining = maxLines - out.length;
        out = out.concat(seg.slice(0, remaining));
    }
    return out.join('\n').trim();
}

async function callGeminiNamuSynthesize(query, rawContext, externalSignal) {
    // 취소 시그널 처리
    var abortSignal = externalSignal || (currentSearchAbortController ? currentSearchAbortController.signal : null);
    if (abortSignal && abortSignal.aborted) return { _aborted: true };

    // 캐시 확인 (쿼리 기준, 7일 TTL)
    var cacheKey = 'namu_synth:' + query;
    var cached = getGeminiCache(cacheKey);
    if (cached) {
        console.log('%c⚡ 나무 합성 캐시 히트', 'color:#4CAF50;font-weight:bold', query);
        cached._fromCache = true;
        return cached;
    }

    var fullPrompt = NAMU_SYNTHESIS_SYSTEM_PROMPT +
        '\n\n=== 나무위키 원문 ===\n' + rawContext + '\n\n질문: ' + query;

    // 20초 타임아웃
    var controller = new AbortController();
    var timeoutId = setTimeout(function() { controller.abort(); }, 20000);
    var abortHandler = null;
    if (abortSignal) {
        abortHandler = function() { controller.abort(); };
        abortSignal.addEventListener('abort', abortHandler);
    }

    try {
        var response;
        if (isLocalDev()) {
            // 로컬: API 키 없으면 null 반환 → raw 폴백
            var apiKey = localStorage.getItem('GEMINI_API_KEY');
            if (!apiKey) {
                clearTimeout(timeoutId);
                if (abortHandler) abortSignal.removeEventListener('abort', abortHandler);
                return null;
            }
            console.log('%c🔬 나무 원문 Gemini 정제', 'color:#E91E63;font-weight:bold', query);
            response = await fetch(
                'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=' + apiKey,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    signal: controller.signal,
                    body: JSON.stringify({
                        contents: [{ parts: [{ text: fullPrompt }] }],
                        generationConfig: { temperature: 0.1, maxOutputTokens: 1024 }
                    })
                }
            );
        } else {
            // 프로덕션: GAS 프록시 (namu_synthesis 플래그 전달)
            var gasUrl = window.GAS_WEBAPP_URL || (typeof API_URL !== 'undefined' ? API_URL : '');
            if (!gasUrl) { clearTimeout(timeoutId); return null; }
            response = await fetch(gasUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'text/plain' },
                signal: controller.signal,
                body: JSON.stringify({
                    action: 'geminiProxy',
                    query: query,
                    context: rawContext,
                    namu_synthesis: true
                })
            });
        }

        clearTimeout(timeoutId);
        if (abortHandler) abortSignal.removeEventListener('abort', abortHandler);
        if (abortSignal && abortSignal.aborted) return { _aborted: true };

        if (!response.ok) {
            console.warn('나무 합성 API 오류:', response.status);
            return null;
        }

        var result = await response.json();

        // 로컬 dev: Gemini raw response 파싱
        if (isLocalDev()) {
            var text = result.candidates[0].content.parts[0].text;
            try {
                var cleaned = text.replace(/^```json\s*/, '').replace(/\s*```$/, '').trim();
                result = JSON.parse(cleaned);
            } catch (e) {
                result = { title: query, content: text };
            }
        }

        if (!result || result._error) return null;

        // 성공 → 캐시 저장
        setGeminiCache(cacheKey, result);
        return result;

    } catch (e) {
        clearTimeout(timeoutId);
        if (abortHandler) abortSignal.removeEventListener('abort', abortHandler);
        if (abortSignal && abortSignal.aborted) return { _aborted: true };
        if (e.name === 'AbortError') return { _error: true, message: '응답 시간 초과 (20초)' };
        console.warn('나무 합성 Gemini 호출 실패:', e);
        return null;
    }
}

async function callGeminiFlash(query, externalSignal) {
    // 취소 시그널: 외부 전달 > 모듈 레벨 폴백
    var abortSignal = externalSignal || (currentSearchAbortController ? currentSearchAbortController.signal : null);

    // 이미 취소된 시그널이면 즉시 리턴 (새 검색이 시작됨)
    if (abortSignal && abortSignal.aborted) {
        return { _aborted: true };
    }

    // 캐시 확인 (localStorage)
    var cached = getGeminiCache(query);
    if (cached) {
        console.log('%c⚡ Gemini 캐시 히트', 'color:#4CAF50;font-weight:bold', query);
        cached._fromCache = true; // 캐시 히트 마커
        return cached;
    }

    // 인덱스 요약 + 그룹 상세 컨텍스트 생성
    var contextSummary = buildGeminiContext(query);
    var detailedContext = await buildDetailedContext(query);

    // 외부 취소 체크 (컨텍스트 빌드 중 새 검색 시작 가능)
    if (abortSignal && abortSignal.aborted) {
        return { _aborted: true };
    }

    // 로컬 개발 환경이면 Gemini API 직접 호출 (GAS 프록시 우회)
    if (isLocalDev()) {
        var localResult = await callGeminiDirect(query, contextSummary + detailedContext, abortSignal);
        // 성공 응답만 캐시 저장
        if (localResult && !localResult._error && !localResult._aborted && (localResult.title || localResult.content)) {
            setGeminiCache(query, localResult);
        }
        return localResult;
    }

    // 프로덕션: GAS 프록시 URL (script.js의 API_URL 재활용, window.GAS_WEBAPP_URL 우선)
    var gasUrl = window.GAS_WEBAPP_URL || (typeof API_URL !== 'undefined' ? API_URL : '');
    if (!gasUrl) {
        console.warn('GAS 프록시 URL이 설정되지 않았습니다.');
        return null;
    }

    // 쿼리에서 그룹 slug 추출 (raw_text 서버사이드 로드용)
    var slug = '';
    if (namuIndexData) {
        var qLower = query.toLowerCase().replace(/\s/g, '');
        for (var i = 0; i < namuIndexData.length; i++) {
            var g = namuIndexData[i];
            if (qLower.indexOf(g.name.toLowerCase().replace(/\s/g, '')) !== -1 ||
                qLower.indexOf(g.name_en.toLowerCase().replace(/\s/g, '')) !== -1) {
                slug = g.slug;
                break;
            }
        }
    }

    // 20초 타임아웃 (GAS 중계 감안)
    var controller = new AbortController();
    var timeoutId = setTimeout(function() { controller.abort(); }, 20000);

    // 외부 시그널 연결: 외부 abort → 내부 fetch abort
    var abortHandler = null;
    if (abortSignal) {
        abortHandler = function() { controller.abort(); };
        abortSignal.addEventListener('abort', abortHandler);
    }

    try {
        var response = await fetch(gasUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain' },  // GAS CORS 우회
            signal: controller.signal,
            body: JSON.stringify({
                action: 'geminiProxy',
                query: query,
                context: contextSummary + detailedContext,
                slug: slug
            })
        });
        clearTimeout(timeoutId);
        if (abortHandler) abortSignal.removeEventListener('abort', abortHandler);

        // 외부 취소 체크 (fetch 완료 후에도 새 검색이 시작되었을 수 있음)
        if (abortSignal && abortSignal.aborted) {
            return { _aborted: true };
        }

        if (!response.ok) {
            var errBody = '';
            try { errBody = await response.text(); } catch (_) {}
            console.error('GAS Gemini 프록시 오류:', response.status, errBody);
            return { _error: true, status: response.status, message: 'API 호출 실패 (' + response.status + ')' };
        }

        var parsed = await response.json();
        if (parsed._error) {
            console.error('Gemini 프록시 에러:', parsed.message);
            return parsed; // 에러 응답은 캐시하지 않음
        }
        if (!parsed.title && !parsed.content) return null; // 빈 응답 캐시 안 함
        // 성공 응답만 캐시 저장
        setGeminiCache(query, parsed);
        return parsed;
    } catch (e) {
        clearTimeout(timeoutId);
        if (abortHandler) abortSignal.removeEventListener('abort', abortHandler);

        // 외부 취소로 인한 abort → 조용히 리턴 (에러 표시 X)
        if (abortSignal && abortSignal.aborted) {
            return { _aborted: true };
        }

        if (e.name === 'AbortError') {
            // 내부 타임아웃에 의한 abort
            console.warn('GAS Gemini 프록시 타임아웃 (20초)');
            return { _error: true, message: '응답 시간 초과 (20초)' };
        }
        console.error('GAS Gemini 프록시 호출 실패:', e);
        return null;
    }
}

// ============================================================
// 역인덱스 검색 (Phase 2)
// ============================================================

/**
 * 역인덱스에서 키워드로 관련 그룹 slug 검색 (O(1) 룩업)
 * @param {string[]} keywords - 검색 키워드 배열
 * @returns {string[]} 교집합 slug 배열 (모든 키워드가 등장하는 그룹)
 */
function searchByIndex(keywords) {
    if (!searchIndexData || !searchIndexData.index || !keywords || keywords.length === 0) return [];
    var idx = searchIndexData.index;
    var slugSets = [];
    for (var i = 0; i < keywords.length; i++) {
        var kw = keywords[i].toLowerCase().trim();
        if (kw.length < 2) continue;
        var slugs = idx[kw];
        if (slugs) {
            slugSets.push(new Set(slugs));
        }
    }
    if (slugSets.length === 0) return [];
    // 교집합: 모든 키워드에 등장하는 slug만 반환
    var result = slugSets[0];
    for (var j = 1; j < slugSets.length; j++) {
        var next = slugSets[j];
        var intersection = new Set();
        result.forEach(function(s) { if (next.has(s)) intersection.add(s); });
        result = intersection;
    }
    // 교집합이 비면 합집합으로 폴백 (최소 1개 키워드 매칭)
    if (result.size === 0) {
        var union = new Set();
        for (var k = 0; k < slugSets.length; k++) {
            slugSets[k].forEach(function(s) { union.add(s); });
        }
        return Array.from(union);
    }
    return Array.from(result);
}

// raw_text 캐시 (slug → text)
var rawTextCache = {};

// 그룹 raw_text 로드 (on-demand, Gemini 폴백 전용)
async function fetchGroupRawText(slug) {
    if (rawTextCache[slug] !== undefined) return rawTextCache[slug];
    try {
        var response = await fetch('/data/namu-raw/' + slug + '.txt?v=' + NAMU_DATA_VERSION);
        if (!response.ok) {
            rawTextCache[slug] = '';
            return '';
        }
        var text = await response.text();
        rawTextCache[slug] = text;
        return text;
    } catch (e) {
        rawTextCache[slug] = '';
        return '';
    }
}

// 전체 그룹 raw_text 병렬 배치 로드 (크로스그룹 검색용)
async function fetchAllRawTexts(signal, onProgress) {
    if (!namuIndexData) return;

    // 아직 캐시되지 않은 slug만 추출
    var slugsToFetch = [];
    for (var i = 0; i < namuIndexData.length; i++) {
        var slug = namuIndexData[i].slug;
        if (rawTextCache[slug] === undefined) {
            slugsToFetch.push(slug);
        }
    }

    var total = slugsToFetch.length;
    if (total === 0) return; // 모두 캐시됨

    var loaded = 0;
    var BATCH_SIZE = 20; // 브라우저 커넥션 풀 활용 (병렬 20개)

    for (var batchStart = 0; batchStart < total; batchStart += BATCH_SIZE) {
        // abort 체크 (배치 간)
        if (signal && signal.aborted) return;

        var batch = slugsToFetch.slice(batchStart, batchStart + BATCH_SIZE);
        // 배치 내 병렬 fetch
        await Promise.all(batch.map(function(slug) {
            return fetchGroupRawText(slug); // 내부에서 캐시 저장
        }));

        loaded += batch.length;
        if (onProgress) onProgress(loaded, total);
    }
}

// 전체 그룹 raw_text 키워드 검색 (크로스그룹 질의용)
async function searchAllGroupsRawText(keywords, signal, onProgress, filterSlugs) {
    if (!namuIndexData || !keywords || keywords.length === 0) return [];

    // 역인덱스가 있으면 후보 slug만 먼저 특정 (173개 전체 대신 5~10개만 fetch)
    var indexHits = searchByIndex(keywords);
    if (indexHits.length > 0 && !filterSlugs) {
        // 역인덱스 히트 slug만 filterSlugs로 설정
        filterSlugs = {};
        for (var ih = 0; ih < indexHits.length; ih++) {
            filterSlugs[indexHits[ih]] = true;
        }
        console.log('🔎 역인덱스 히트: ' + indexHits.length + '개 그룹 (' + keywords.join(', ') + ')');
        // 히트된 그룹의 raw_text만 로드
        var hitSlugs = indexHits.slice(0, 30); // 최대 30개만
        await Promise.all(hitSlugs.map(function(slug) { return fetchGroupRawText(slug); }));
        if (signal && signal.aborted) return [];
    } else {
        // 역인덱스 없거나 히트 없음 → 전체 로드 (기존 방식)
        await fetchAllRawTexts(signal, onProgress);
        if (signal && signal.aborted) return [];
    }

    // 그룹명 세트 구축 (그룹명 자체가 키워드면 감점용)
    var groupNameSet = {};
    for (var gi = 0; gi < namuIndexData.length; gi++) {
        groupNameSet[namuIndexData[gi].name.toLowerCase()] = true;
        groupNameSet[namuIndexData[gi].name_en.toLowerCase()] = true;
    }

    var results = [];

    for (var i = 0; i < namuIndexData.length; i++) {
        var group = namuIndexData[i];
        // filterSlugs 옵션: 세대/성별 필터된 그룹만 검색
        if (filterSlugs && !filterSlugs[group.slug]) continue;

        var rawText = rawTextCache[group.slug];
        if (!rawText) continue;

        var lines = rawText.split('\n');
        var scored = []; // {text, score}

        for (var li = 0; li < lines.length; li++) {
            var line = lines[li].trim();
            if (line.length <= 5) continue;
            // 노이즈 라인 스킵 (보일러플레이트 + 트랙리스트)
            if (RAW_TEXT_NOISE.test(line)) continue;
            if (RAW_TEXT_TRACKLIST.test(line)) continue;

            var lineScore = 0;
            var matchedCount = 0;

            for (var ki = 0; ki < keywords.length; ki++) {
                var kw = keywords[ki];
                var kwLower = kw.toLowerCase();

                // 그룹명 자체가 키워드면 감점 (자기 문서에서 그룹명 대량 매칭 방지)
                if (groupNameSet[kwLower]) {
                    lineScore -= 30;
                    continue;
                }

                // 독립 단어 매칭 (앞글자가 한글/영문이 아닌 경우)
                var independentPattern = new RegExp('(?:^|[^가-힣a-zA-Z])' + escapeRegex(kw), 'i');
                if (independentPattern.test(line)) {
                    lineScore += 50;
                    matchedCount++;
                } else if (line.toLowerCase().indexOf(kwLower) !== -1) {
                    // 부분 매칭
                    lineScore += 20;
                    matchedCount++;
                }
            }

            if (matchedCount === 0) continue;

            // 전체 키워드 매칭 보너스 (모든 키워드 동시 등장 시 대폭 가산)
            if (keywords.length > 1 && matchedCount === keywords.length) lineScore += 100;
            // 추가 키워드 보너스 (2개 이상 동시 매칭)
            else if (matchedCount > 1) lineScore += (matchedCount - 1) * 30;
            // 숫자/단위 포함 보너스
            if (/\d/.test(line)) lineScore += 15;
            if (/cm|kg|세|명|만|억|위|회|년|월/.test(line)) lineScore += 10;
            // 적절 길이 보너스
            if (line.length >= 10 && line.length <= 300) lineScore += 10;

            if (lineScore > 0) {
                scored.push({ text: line, score: lineScore });
            }
        }

        if (scored.length === 0) continue;

        // 점수 내림차순 정렬 → 상위 3개 스니펫
        scored.sort(function(a, b) { return b.score - a.score; });
        var topSnippets = scored.slice(0, 3);
        var totalScore = 0;
        for (var ti = 0; ti < topSnippets.length; ti++) {
            totalScore += topSnippets[ti].score;
        }

        results.push({
            group: group,
            score: totalScore,
            matchCount: scored.length,
            snippets: topSnippets.map(function(s) { return s.text; })
        });
    }

    // 점수 내림차순 정렬
    results.sort(function(a, b) { return b.score - a.score; });
    return results;
}

// raw_text에서 쿼리 키워드 주변 텍스트 추출 (±CONTEXT_RADIUS 글자)
function extractRelevantRawText(rawText, query, maxChars) {
    if (!rawText || !query) return '';
    maxChars = maxChars || 2000;

    // 쿼리에서 일반어 제거 후 키워드 추출 (단어 단위로 조사 제거)
    var cleaned = query.replace(/알려|주세요|줘|뭐야|뭐예요|언제|어디|누구/g, '');
    var rawKeywords = cleaned.split(/\s+/)
        .map(function(w) { return w.replace(/[을를이가은는의과와]$/, ''); }) // 끝 조사만 제거
        .filter(function(w) { return w.length >= 2; });

    // 복합어 분리: "숙소관련" → "숙소", "관련" / "멤버정보" → "멤버", "정보"
    var COMPOUND_SUFFIXES = ['관련', '상황', '정보', '대해', '대한', '에대해', '에대한', '현황'];
    var keywords = [];
    for (var kw = 0; kw < rawKeywords.length; kw++) {
        var word = rawKeywords[kw];
        var stripped = false;
        for (var s = 0; s < COMPOUND_SUFFIXES.length; s++) {
            var suf = COMPOUND_SUFFIXES[s];
            if (word.length > suf.length && word.endsWith(suf)) {
                var core = word.slice(0, -suf.length);
                if (core.length >= 2) { keywords.push(core); stripped = true; }
                break;
            }
        }
        if (!stripped) keywords.push(word);
    }

    if (keywords.length === 0) return '';

    var CONTEXT_RADIUS = 500; // 키워드 전후 추출 범위
    var snippets = [];
    var usedRanges = []; // 중복 추출 방지

    for (var k = 0; k < keywords.length; k++) {
        var keyword = keywords[k];
        var searchFrom = 0;
        while (searchFrom < rawText.length) {
            var idx = rawText.indexOf(keyword, searchFrom);
            if (idx === -1) break;

            var start = Math.max(0, idx - CONTEXT_RADIUS);
            var end = Math.min(rawText.length, idx + keyword.length + CONTEXT_RADIUS);

            // 이미 추출된 범위와 겹치는지 확인
            var overlaps = false;
            for (var r = 0; r < usedRanges.length; r++) {
                if (start < usedRanges[r][1] && end > usedRanges[r][0]) {
                    // 겹치면 기존 범위 확장
                    usedRanges[r][0] = Math.min(usedRanges[r][0], start);
                    usedRanges[r][1] = Math.max(usedRanges[r][1], end);
                    overlaps = true;
                    break;
                }
            }
            if (!overlaps) {
                usedRanges.push([start, end]);
            }
            searchFrom = idx + keyword.length;
        }
    }

    // 범위별 텍스트 추출
    usedRanges.sort(function(a, b) { return a[0] - b[0]; });
    var totalLen = 0;
    for (var i = 0; i < usedRanges.length && totalLen < maxChars; i++) {
        var snippet = rawText.slice(usedRanges[i][0], usedRanges[i][1]);
        snippets.push(snippet);
        totalLen += snippet.length;
    }

    return snippets.join('\n...\n');
}

// 엔터 도메인 범용어 (아이돌 위키 90%+ 등장 → 크로스그룹 변별력 제로)
var DOMAIN_STOPWORDS_SET = {};
['공연', '진행', '활동', '무대', '콘서트', '투어', '행사', '출연', '참여', '참가',
 '음악', '방송', '노래', '앨범', '음반', '발매', '수록', '차트', '성적',
 '시작', '기록', '이후', '당시', '현재', '가수', '아티스트', '연습생',
 '수상', '소속', '사무소', '엔터', '엔터테인먼트', '기획사',
 '무대', '안무', '퍼포먼스', '보컬', '래퍼', '댄서'
].forEach(function(w) { DOMAIN_STOPWORDS_SET[w] = true; });

// 크로스그룹 검색용 키워드 추출 (불용어·조사·도메인범용어 제거)
function extractCrossGroupKeywords(query) {
    var q = normalizeQuery(query); // 꼬리 표현 제거 ("알려주세요", "?" 등)

    // 크로스그룹 불용어 제거 (그룹/아이돌/질문어 등)
    var CROSS_STOPWORDS = /그룹|아이돌|걸그룹|보이그룹|누구|어떤|몇|있는|했던|있나|없나|한|된|인|할|하는|해서|에서|으로|부터|까지|대한|들이|들은|중에|중에서/g;
    q = q.replace(CROSS_STOPWORDS, ' ');

    // 조사 제거 (을/를/이/가/은/는/의/과/와/에/도/만/로/서)
    var words = q.split(/\s+/).map(function(w) {
        return w.replace(/[을를이가은는의과와에도만로서]$/, '');
    }).filter(Boolean);

    // COMPOUND_SUFFIXES 분리 ("숙소관련" → "숙소")
    var COMPOUND_SUFFIXES = ['관련', '상황', '정보', '대해', '대한', '에대해', '에대한', '현황'];
    var keywords = [];
    for (var i = 0; i < words.length; i++) {
        var word = words[i];
        var stripped = false;
        for (var s = 0; s < COMPOUND_SUFFIXES.length; s++) {
            var suf = COMPOUND_SUFFIXES[s];
            if (word.length > suf.length && word.endsWith(suf)) {
                var core = word.slice(0, -suf.length);
                if (core.length >= 2) { keywords.push(core); stripped = true; }
                break;
            }
        }
        if (!stripped) keywords.push(word);
    }

    // 2자 미만 필터 + 중복 제거
    var seen = {};
    var allKws = [];
    for (var j = 0; j < keywords.length; j++) {
        var kw = keywords[j];
        if (kw.length < 2) continue;
        if (seen[kw]) continue;
        seen[kw] = true;
        allKws.push(kw);
    }

    // 엔터 도메인 범용어 분리: specific(변별력 있음) vs generic(범용)
    var specific = [];
    var generic = [];
    for (var k = 0; k < allKws.length; k++) {
        if (DOMAIN_STOPWORDS_SET[allKws[k]]) {
            generic.push(allKws[k]);
        } else {
            specific.push(allKws[k]);
        }
    }

    // specific 키워드가 있으면 그것만 사용 (변별력 확보)
    // 모두 generic이면 전체 반환 (Gemini 폴백 가능성 높음)
    return specific.length > 0 ? specific : allKws;
}

// 쿼리에서 그룹명 감지 → 해당 그룹 상세 JSON + raw_text를 텍스트로 직렬화
async function buildDetailedContext(query) {
    if (!namuIndexData) return '';

    // 쿼리에서 그룹명 감지 (인덱스 전체 순회하여 매칭)
    var q = query.toLowerCase().replace(/\s/g, '');
    var matchedGroup = null;
    for (var i = 0; i < namuIndexData.length; i++) {
        var g = namuIndexData[i];
        var nameNorm = g.name.toLowerCase().replace(/\s/g, '');
        var nameEnNorm = g.name_en.toLowerCase().replace(/\s/g, '');
        if (q.includes(nameNorm) || q.includes(nameEnNorm)) {
            matchedGroup = g;
            break;
        }
    }

    if (!matchedGroup) return '';

    // 그룹 상세 데이터 + raw_text 병렬 로드
    var results = await Promise.all([
        fetchGroupDetail(matchedGroup.slug),
        fetchGroupRawText(matchedGroup.slug)
    ]);
    var detail = results[0];
    var rawText = results[1];

    if (!detail) return '';

    var lines = [];
    lines.push('=== ' + detail.name + '(' + detail.name_en + ') 상세 데이터 ===');

    // 그룹 기본 정보
    if (detail.info) {
        lines.push('[기본정보]');
        for (var key in detail.info) {
            lines.push('  ' + key + ': ' + detail.info[key]);
        }
    }

    // 멤버 정보
    if (detail.members && detail.members.length > 0) {
        lines.push('[멤버 ' + detail.members.length + '명]');
        for (var m = 0; m < detail.members.length; m++) {
            var member = detail.members[m];
            var parts = [member.name];
            if (member['본명']) parts.push('본명:' + member['본명']);
            if (member['생년월일']) parts.push('생일:' + member['생년월일']);
            if (member['출신지']) parts.push('출신:' + member['출신지']);
            if (member['역할']) parts.push('역할:' + member['역할']);
            lines.push('  - ' + parts.join(', '));
        }
    }

    // 앨범 정보 (최근 10개)
    if (detail.albums && detail.albums.length > 0) {
        var recentAlbums = detail.albums.slice(-10);
        lines.push('[앨범 ' + detail.albums.length + '개, 최근 ' + recentAlbums.length + '개 표시]');
        for (var a = 0; a < recentAlbums.length; a++) {
            var album = recentAlbums[a];
            lines.push('  - ' + (album.title || '?') + ' (' + (album.type || '?') + ', ' + (album['발매일'] || '?') + ') 초동:' + (album['초동_써클'] || '-'));
        }
    }

    // raw_text에서 쿼리 관련 부분 추출 (나무위키 원문)
    // 그룹명(한글/영문)을 쿼리에서 제거하여 그룹명 자체로 매칭하지 않도록 함
    if (rawText) {
        var topicQuery = query;
        topicQuery = topicQuery.replace(new RegExp(escapeRegex(matchedGroup.name), 'gi'), '');
        topicQuery = topicQuery.replace(new RegExp(escapeRegex(matchedGroup.name_en), 'gi'), '');
        var relevant = extractRelevantRawText(rawText, topicQuery.trim(), 2000);
        if (relevant) {
            lines.push('\n[나무위키 원문 중 관련 부분]');
            lines.push(relevant);
        }
    }

    return '\n\n' + lines.join('\n');
}

// Gemini용 인덱스 요약 생성 (쿼리 관련 그룹만 멤버 포함 → 토큰 절약)
function buildGeminiContext(query) {
    if (!namuIndexData) return '';

    var q = (query || '').toLowerCase().replace(/\s/g, '');
    var lines = [];
    for (var i = 0; i < namuIndexData.length; i++) {
        var g = namuIndexData[i];
        // 쿼리에 그룹명이 포함된 경우만 멤버 목록 추가
        var nameNorm = g.name.toLowerCase().replace(/\s/g, '');
        var nameEnNorm = g.name_en.toLowerCase().replace(/\s/g, '');
        var isRelevant = q && (q.includes(nameNorm) || q.includes(nameEnNorm));

        var line = g.name + '(' + g.name_en + ') - ' + (g.agency || '?') +
            ', ' + (g.debut_year || '?') + '데뷔, ' + g.gender +
            ', ' + g.member_count + '명, 앨범' + g.album_count + '개';
        // 관련 그룹만 멤버 이름 포함
        if (isRelevant) {
            var members = (g.members || []).join(',');
            if (members) line += ', 멤버:' + members;
        }
        lines.push(line);
    }
    return lines.join('\n');
}

// 간단 마크다운 → HTML 변환 (Gemini 답변용, XSS-safe)
// 지원: **bold**, * bullet, - bullet, | table |, 빈 줄 → <br>
function markdownToHtml(text) {
    if (!text) return '';
    var escaped = escapeHtml(text);
    var lines = escaped.split('\n');
    var html = '';
    var inList = false;
    var inTable = false;
    var tableHeaderDone = false;

    for (var i = 0; i < lines.length; i++) {
        var line = lines[i];
        var trimmed = line.trim();

        // 마크다운 테이블: |col|col| 형식
        if (/^\|/.test(trimmed) && /\|$/.test(trimmed)) {
            // 구분선 (|---|---|) → 헤더 완료 마킹
            if (/^\|[\s\-:]+(\|[\s\-:]+)+\|$/.test(trimmed)) {
                tableHeaderDone = true;
                continue;
            }
            if (!inTable) {
                if (inList) { html += '</ul>'; inList = false; }
                html += '<div class="table-responsive"><table class="table table-sm namu-smart-table">';
                inTable = true;
                tableHeaderDone = false;
            }
            var cells = trimmed.split('|').filter(function(c) { return c.trim() !== ''; });
            if (!tableHeaderDone) {
                // 첫 행은 헤더로 처리
                html += '<thead><tr>';
                for (var ci = 0; ci < cells.length; ci++) {
                    var cellText = cells[ci].trim().replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
                    html += '<th>' + cellText + '</th>';
                }
                html += '</tr></thead><tbody>';
            } else {
                html += '<tr>';
                for (var cj = 0; cj < cells.length; cj++) {
                    var cellText2 = cells[cj].trim().replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
                    html += '<td>' + cellText2 + '</td>';
                }
                html += '</tr>';
            }
            continue;
        }
        // 테이블 종료
        if (inTable) {
            html += '</tbody></table></div>';
            inTable = false;
            tableHeaderDone = false;
        }

        // 불릿 리스트: * item 또는 - item (줄 시작)
        if (/^[\*\-]\s+/.test(trimmed)) {
            if (!inList) { html += '<ul class="namu-smart-list">'; inList = true; }
            var itemText = trimmed.replace(/^[\*\-]\s+/, '');
            itemText = itemText.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
            html += '<li>' + itemText + '</li>';
            continue;
        }
        // 리스트 종료
        if (inList) { html += '</ul>'; inList = false; }

        // 일반 텍스트: **bold** 변환 + 줄바꿈
        line = trimmed.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
        html += (line === '' ? '<br>' : line + '<br>');
    }

    // 열린 태그 닫기
    if (inList) html += '</ul>';
    if (inTable) html += '</tbody></table></div>';
    // 끝 <br> 제거
    html = html.replace(/<br>$/, '');
    return html;
}

// Gemini 답변 렌더링
function renderGeminiAnswer(container, data) {
    var title = data.title || 'AI 답변';
    var content = data.content || '';

    // 채팅 UI: AI 답변을 마크다운 HTML로 렌더링
    var html = '<div class="chat-ai-content">';

    if (data.answer_type === 'table' && data.data && data.data.headers && data.data.rows) {
        html += '<div class="table-responsive"><table class="table table-sm namu-smart-table">';
        html += '<thead><tr>';
        for (var h = 0; h < data.data.headers.length; h++) {
            html += '<th>' + escapeHtml(String(data.data.headers[h])) + '</th>';
        }
        html += '</tr></thead><tbody>';
        for (var r = 0; r < data.data.rows.length; r++) {
            html += '<tr>';
            var row = data.data.rows[r];
            for (var c = 0; c < row.length; c++) {
                html += '<td>' + escapeHtml(String(row[c] || '-')) + '</td>';
            }
            html += '</tr>';
        }
        html += '</tbody></table></div>';
        if (content) {
            html += '<div class="mt-2">' + renderMarkdown(content) + '</div>';
        }
    } else if (data.answer_type === 'list' && data.data && Array.isArray(data.data)) {
        html += '<ul class="namu-smart-list">';
        for (var i = 0; i < data.data.length; i++) {
            html += '<li>' + escapeHtml(String(data.data[i])) + '</li>';
        }
        html += '</ul>';
    } else {
        html += renderMarkdown(content);
    }

    html += '</div>';
    html += '<div class="chat-ai-disclaimer">AI 생성 답변 — 정확하지 않을 수 있습니다</div>';

    container.innerHTML = html;
    appendFeedbackButtons(container);  // 👍👎 피드백 버튼 추가
    var chatContainer = document.getElementById('namuSmartAnswer');
    if (chatContainer) chatContainer.style.display = 'flex';
}

// 크로스그룹 raw_text 검색 결과 렌더링
// 상위 결과 그룹들의 나무위키 URL 일괄 조회 (병렬)
async function fetchNamuUrlsForGroups(results) {
    var namuUrls = {};
    await Promise.all(results.map(function(r) {
        return fetchGroupDetail(r.group.slug).then(function(detail) {
            if (detail && detail.namu_url) {
                namuUrls[r.group.slug] = detail.namu_url;
            }
        }).catch(function() { /* 무시 */ });
    }));
    return namuUrls;
}

// 크로스그룹 raw_text 검색 결과 렌더링 (raw only — Gemini 실패 시 폴백용)
function renderCrossGroupRawResults(container, query, results, keywords) {
    if (!results || results.length === 0) return;

    // 상위 10개 그룹만 표시
    var displayResults = results.slice(0, 10);
    var kwDisplay = keywords.join(', ');

    var html = '<div class="namu-smart-answer">' +
        '<div class="namu-smart-answer-header">' +
        '<span class="namu-smart-icon">📖</span>' +
        '<span class="namu-smart-title">"' + escapeHtml(kwDisplay) + '" 관련 그룹 (' + results.length + '개 발견)</span>' +
        '<button class="namu-smart-close" onclick="dismissSmartAnswer()" title="닫기">&times;</button>' +
        '</div>' +
        '<div class="namu-smart-answer-body">';

    // 키워드 하이라이트 함수 (텍스트 내 키워드를 <mark> 태그로 감싸기)
    function highlightKeywords(text) {
        var escaped = escapeHtml(text);
        for (var k = 0; k < keywords.length; k++) {
            var kw = keywords[k];
            // 대소문자 무시 하이라이트
            var re = new RegExp('(' + escapeRegex(escapeHtml(kw)) + ')', 'gi');
            escaped = escaped.replace(re, '<mark>$1</mark>');
        }
        return escaped;
    }

    // 각 그룹 카드 렌더링
    for (var i = 0; i < displayResults.length; i++) {
        var r = displayResults[i];
        var g = r.group;
        var genderBadge = g.gender === '여자'
            ? '<span class="badge bg-danger-subtle text-danger">걸그룹</span>'
            : '<span class="badge bg-primary-subtle text-primary">보이그룹</span>';

        html += '<div class="cross-group-result" style="border:1px solid #e9ecef;border-radius:8px;padding:10px 14px;margin-bottom:8px;">' +
            '<div style="display:flex;align-items:center;gap:6px;margin-bottom:4px;">' +
            '<a href="#" onclick="loadNamuGroupBySlug(\'' + escapeSingleQuote(g.slug) + '\');return false;" ' +
            'style="font-weight:600;color:#2c3e50;text-decoration:none;font-size:1rem;">' +
            escapeHtml(g.name) + '</a> ' +
            '<small class="text-muted">' + escapeHtml(g.name_en) + '</small> ' +
            genderBadge + ' ' +
            '<span class="badge bg-warning-subtle text-warning-emphasis">' + r.matchCount + '건 매칭</span>' +
            '</div>';

        // 스니펫 (최대 3개)
        for (var si = 0; si < r.snippets.length; si++) {
            // 스니펫 길이 제한 (200자)
            var snippet = r.snippets[si];
            if (snippet.length > 200) snippet = snippet.substring(0, 200) + '…';
            html += '<div style="font-size:0.85rem;color:#555;padding:2px 0;border-top:1px solid #f5f5f5;margin-top:2px;">' +
                highlightKeywords(snippet) + '</div>';
        }

        html += '</div>';
    }

    // 10개 초과 시 안내
    if (results.length > 10) {
        html += '<div style="text-align:center;color:#888;font-size:0.85rem;padding:6px 0;">' +
            '외 ' + (results.length - 10) + '개 그룹 더 있음</div>';
    }

    // "AI로 정리하기" 버튼 (상위 5개 그룹 스니펫을 Gemini 컨텍스트로 전달)
    var top5 = results.slice(0, 5);
    var rawContext = '';
    for (var ci = 0; ci < top5.length; ci++) {
        rawContext += '### ' + top5[ci].group.name + ' (' + top5[ci].group.name_en + ')\n';
        rawContext += top5[ci].snippets.join('\n') + '\n\n';
    }
    // raw context 길이 제한 (4000자)
    if (rawContext.length > 4000) rawContext = rawContext.substring(0, 4000);

    html += '<div style="text-align:center;margin-top:10px;">' +
        '<button class="btn btn-sm btn-outline-primary" ' +
        'data-raw-context="' + escapeHtml(rawContext) + '" ' +
        'onclick="synthesizeWithGemini(this, \'' + escapeSingleQuote(query) + '\')">' +
        '🤖 AI로 정리하기</button></div>';

    html += '</div>' +
        '<div class="namu-smart-ai-disclaimer">나무위키 원문 기반 검색 — 원문 표현 그대로 표시됩니다</div>' +
        '</div>';

    container.innerHTML = html;
    container.style.display = 'block';
}

// 크로스그룹 3단계 통합 뷰: AI 정리 → 원문 보기(토글) → 나무위키 링크
function renderCrossGroupCombinedView(container, query, geminiData, results, keywords, namuUrls) {
    var displayResults = results.slice(0, 10);

    // ── AI 정리 섹션 (기본 표시) ──
    var html = '<div class="namu-smart-answer namu-smart-answer-ai">' +
        '<div class="namu-smart-answer-header">' +
        '<span class="namu-smart-icon">🤖</span>' +
        '<span class="namu-smart-title">' + escapeHtml(geminiData.title || 'AI 답변') + '</span>' +
        '<span class="namu-smart-ai-badge">AI</span>' +
        '<button class="namu-smart-close" onclick="dismissSmartAnswer()" title="닫기">&times;</button>' +
        '</div>' +
        '<div class="namu-smart-answer-body">';

    // AI 본문 (마크다운 렌더링)
    var content = geminiData.content || '';
    if (geminiData.answer_type === 'table' && geminiData.data && geminiData.data.headers) {
        // 구조화 테이블 응답
        html += '<div class="table-responsive"><table class="table table-sm namu-smart-table"><thead><tr>';
        for (var h = 0; h < geminiData.data.headers.length; h++) {
            html += '<th>' + escapeHtml(String(geminiData.data.headers[h])) + '</th>';
        }
        html += '</tr></thead><tbody>';
        for (var ri = 0; ri < (geminiData.data.rows || []).length; ri++) {
            html += '<tr>';
            var row = geminiData.data.rows[ri];
            for (var ci2 = 0; ci2 < row.length; ci2++) {
                html += '<td>' + escapeHtml(String(row[ci2] || '-')) + '</td>';
            }
            html += '</tr>';
        }
        html += '</tbody></table></div>';
        if (content) html += '<div class="mt-2">' + markdownToHtml(content) + '</div>';
    } else {
        html += '<div class="namu-smart-answer-text">' + markdownToHtml(content) + '</div>';
    }

    // ── 원문 보기 토글 버튼 ──
    html += '<div style="text-align:center;margin-top:12px;padding-top:10px;border-top:1px solid #eee;">' +
        '<button class="btn btn-sm btn-outline-secondary" ' +
        'data-group-count="' + displayResults.length + '" ' +
        'onclick="toggleCrossGroupRawSection(this)" style="font-size:0.85rem;">' +
        '📖 원문 보기 (' + displayResults.length + '개 그룹)</button></div>';

    // ── 원문 섹션 (기본 숨김) ──
    html += '<div class="cross-group-raw-section" style="display:none;margin-top:10px;">';

    // 키워드 하이라이트 헬퍼
    function hl(text) {
        var escaped = escapeHtml(text);
        for (var k = 0; k < keywords.length; k++) {
            var re = new RegExp('(' + escapeRegex(escapeHtml(keywords[k])) + ')', 'gi');
            escaped = escaped.replace(re, '<mark>$1</mark>');
        }
        return escaped;
    }

    for (var i = 0; i < displayResults.length; i++) {
        var r = displayResults[i];
        var g = r.group;
        var namuUrl = (namuUrls && namuUrls[g.slug]) || '';

        html += '<div style="border:1px solid #e9ecef;border-radius:8px;padding:10px 14px;margin-bottom:8px;">' +
            '<div style="display:flex;align-items:center;gap:6px;margin-bottom:4px;flex-wrap:wrap;">' +
            '<a href="#" onclick="loadNamuGroupBySlug(\'' + escapeSingleQuote(g.slug) + '\');return false;" ' +
            'style="font-weight:600;color:#2c3e50;text-decoration:none;">' +
            escapeHtml(g.name) + '</a> ' +
            '<small class="text-muted">' + escapeHtml(g.name_en) + '</small> ' +
            '<span class="badge bg-warning-subtle text-warning-emphasis" style="font-size:0.75rem;">' + r.matchCount + '건</span>';

        // 나무위키 외부 링크 (3단계)
        if (namuUrl) {
            html += ' <a href="' + escapeHtml(namuUrl) + '" target="_blank" rel="noopener" ' +
                'style="font-size:0.8rem;color:#1a73e8;text-decoration:none;" title="나무위키에서 보기">' +
                '나무위키 →</a>';
        }

        html += '</div>';

        // 스니펫 (키워드 하이라이트)
        for (var si = 0; si < r.snippets.length; si++) {
            var snippet = r.snippets[si];
            if (snippet.length > 200) snippet = snippet.substring(0, 200) + '…';
            html += '<div style="font-size:0.85rem;color:#555;padding:2px 0;border-top:1px solid #f5f5f5;">' +
                hl(snippet) + '</div>';
        }
        html += '</div>';
    }

    // 10개 초과 안내
    if (results.length > 10) {
        html += '<div style="text-align:center;color:#888;font-size:0.85rem;padding:6px 0;">' +
            '외 ' + (results.length - 10) + '개 그룹 더 있음</div>';
    }

    html += '</div>'; // close raw section
    html += '</div>'; // close body
    html += '<div class="namu-smart-ai-disclaimer">AI 생성 답변 (나무위키 원문 기반) — 정확하지 않을 수 있습니다</div>' +
        '</div>';

    container.innerHTML = html;
    appendFeedbackButtons(container);  // 👍👎 피드백 버튼 추가
    container.style.display = 'block';
}

// 원문 보기 토글
function toggleCrossGroupRawSection(btn) {
    var answer = btn.closest('.namu-smart-answer');
    if (!answer) return;
    var section = answer.querySelector('.cross-group-raw-section');
    if (!section) return;
    var count = btn.getAttribute('data-group-count') || '';
    if (section.style.display === 'none') {
        section.style.display = 'block';
        btn.textContent = '📖 원문 접기';
    } else {
        section.style.display = 'none';
        btn.textContent = '📖 원문 보기 (' + count + '개 그룹)';
    }
}


// ============================================================
// 메인 핸들러
// ============================================================

async function handleSmartSearch(query) {
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
        var _prevQ = currentSearchMeta.query.toLowerCase().replace(/\s+/g, '');
        var _newQ  = query.toLowerCase().replace(/\s+/g, '');
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
        }

        // 채팅 레이아웃 초기화: 사용자 말풍선(우측) + AI 로딩 영역(좌측)
        var aiBody = initChatLayout(container, query);

        // === 복합 질의 감지 ===
        if (isCompoundQuery(query, intent.type)) {
            // 캐시 체크
            var cachedResult = getGeminiCache(query);
            if (cachedResult) {
                cachedResult._fromCache = true;
                renderGeminiAnswer(aiBody, cachedResult);
                trackEvent('namu_smart_search', { query: query, method: 'cache', intent: intent.type });
                logSearchToGAS({ query: query, group: '', intent_type: intent.type, response_method: 'cache', response_time_ms: Date.now() - searchStartTime, success: true });
                return;
            }

            updateSearchProgress(aiBody, 1, '그룹 상세 데이터 수집 중...');
            var focusedContext = await collectFilteredContext(intent);
            if (searchSignal.aborted) return;

            updateSearchProgress(aiBody, 2, 'AI가 순위표를 생성하는 중...');
            var geminiResult = await callGeminiSynthesize(query, focusedContext, searchSignal);
            if (searchSignal.aborted) return;

            if (geminiResult && !geminiResult._error && !geminiResult._aborted) {
                renderGeminiAnswer(aiBody, geminiResult);
                trackEvent('namu_smart_search', { query: query, method: 'compound_gemini', intent: intent.type });
                logSearchToGAS({ query: query, group: '', intent_type: intent.type, response_method: 'compound_gemini', response_time_ms: Date.now() - searchStartTime, success: true });
            } else {
                // Gemini 실패 → 패턴 폴백
                clearSearchProgress(aiBody);
                aiBody.innerHTML = '';
                updateSearchProgress(aiBody, 1, '데이터베이스에서 검색 중...');
                try {
                    await executeIntent(intent);
                } catch (execErr) {
                    console.error('executeIntent 오류:', execErr);
                    showSmartAnswer(aiBody, '검색 오류', '데이터를 처리하는 중 문제가 발생했습니다. 다시 시도해 주세요.', 'error');
                }
                trackEvent('namu_smart_search', { query: query, method: 'compound_fallback', intent: intent.type });
                logSearchToGAS({ query: query, group: '', intent_type: intent.type, response_method: 'compound_fallback', response_time_ms: Date.now() - searchStartTime, success: true });
            }
            return;
        }

        // 단순 패턴 검색
        updateSearchProgress(aiBody, 1, '데이터베이스에서 검색 중...');

        try {
            await executeIntent(intent);
        } catch (execErr) {
            console.error('executeIntent 오류:', execErr);
            showSmartAnswer(aiBody, '검색 오류', '데이터를 처리하는 중 문제가 발생했습니다. 다시 시도해 주세요.', 'error');
        }
        trackEvent('namu_smart_search', { query: query, method: 'pattern', intent: intent.type });
        logSearchToGAS({ query: query, group: intent.group ? intent.group.name : '', intent_type: intent.type, response_method: 'pattern', response_time_ms: Date.now() - searchStartTime, success: true });
        return;
    }

    // 채팅 레이아웃 초기화 (패턴 매칭 실패)
    var aiBody = initChatLayout(container, query);

    // Method A-2: 별칭 해석 후 패턴 매칭 재시도
    var normalizedQ = normalizeQuery(query);
    var aliasResolved = resolveGroupAlias(normalizedQ);
    if (!aliasResolved) {
        // 쿼리에서 그룹 부분만 추출 시도 (예: "방탄 멤버" → "방탄")
        var words = normalizedQ.split(/\s+/);
        for (var wi = 0; wi < Math.min(words.length, 3); wi++) {
            aliasResolved = resolveGroupAlias(words[wi]);
            if (aliasResolved) break;
        }
    }
    if (aliasResolved) {
        // 별칭→정규명 치환 후 패턴 매칭 재시도
        var resolvedQuery = query;
        var resolvedGroup = findGroupByName(aliasResolved);
        if (resolvedGroup) {
            // 원래 쿼리에서 별칭 부분을 정규명으로 교체
            var words2 = normalizedQ.split(/\s+/);
            for (var wj = 0; wj < words2.length; wj++) {
                if (resolveGroupAlias(words2[wj])) {
                    words2[wj] = aliasResolved;
                    break;
                }
            }
            resolvedQuery = words2.join(' ');
            var retryIntent = parseSmartQuery(resolvedQuery);
            if (retryIntent) {
                console.log('🏷️ 별칭 해석: "' + query + '" → "' + resolvedQuery + '" (패턴: ' + retryIntent.type + ')');
                updateSearchProgress(aiBody, 1, '데이터베이스에서 검색 중...');
                try {
                    await executeIntent(retryIntent);
                } catch (execErr) {
                    console.error('executeIntent 오류:', execErr);
                    showSmartAnswer(aiBody, '검색 오류', '데이터를 처리하는 중 문제가 발생했습니다.', 'error');
                }
                trackEvent('namu_smart_search', { query: query, method: 'alias_pattern', intent: retryIntent.type });
                logSearchToGAS({ query: query, group: resolvedGroup.name, intent_type: retryIntent.type, response_method: 'alias_pattern', response_time_ms: Date.now() - searchStartTime, success: true });
                return;
            }
        }
    }

    // Method B-0: 통합 검색 (역인덱스 + 구조화 데이터 병합)
    var unifiedResult = unifiedSearch(normalizedQ);
    if (unifiedResult && unifiedResult.results.length > 0) {
        updateSearchProgress(aiBody, 1, '데이터베이스에서 검색 중...');
        renderUnifiedSearchResults(aiBody, query, unifiedResult);
        trackEvent('namu_smart_search', { query: query, method: 'unified', result_count: unifiedResult.results.length });
        logSearchToGAS({ query: query, group: '', intent_type: 'unified', response_method: 'unified', response_time_ms: Date.now() - searchStartTime, success: true });
        return;
    }

    // Method B-1: 크로스그룹 raw_text 키워드 검색
    var crossKeywords = extractCrossGroupKeywords(query);

    if (crossKeywords.length > 0) {
        updateSearchProgress(aiBody, 1, '전체 그룹 원문 데이터 로딩 중...');

        var crossResults = await searchAllGroupsRawText(crossKeywords, searchSignal, function(loaded, total) {
            var progressEl = aiBody.querySelector('.search-progress');
            if (progressEl) {
                var lastStep = progressEl.querySelector('.progress-step:last-child span:last-child');
                if (lastStep) lastStep.textContent = '전체 그룹 원문 데이터 로딩 중... (' + loaded + '/' + total + ')';
            }
        });
        if (searchSignal.aborted) return;

        var validResults = crossResults.filter(function(r) { return r.score >= 50; });
        if (validResults.length > 0) {
            // raw context 구성 (상위 5개 그룹 스니펫)
            var top5 = validResults.slice(0, 5);
            var rawContext = '';
            for (var ci = 0; ci < top5.length; ci++) {
                rawContext += '### ' + top5[ci].group.name + ' (' + top5[ci].group.name_en + ')\n';
                rawContext += top5[ci].snippets.join('\n') + '\n\n';
            }
            if (rawContext.length > 4000) rawContext = rawContext.substring(0, 4000);

            updateSearchProgress(aiBody, 2, 'AI가 답변을 정리하는 중...');
            var synthesizeQuery = '다음 나무위키 원문을 참고하여 "' + query + '"에 대해 깔끔하게 정리해주세요:\n\n' + rawContext;
            var top10 = validResults.slice(0, 10);

            var parallelResults = await Promise.all([
                callGeminiFlash(synthesizeQuery, searchSignal),
                fetchNamuUrlsForGroups(top10)
            ]);
            if (searchSignal.aborted) return;

            var geminiSynthesis = parallelResults[0];
            var namuUrls = parallelResults[1];

            if (geminiSynthesis && !geminiSynthesis._error && !geminiSynthesis._aborted) {
                renderCrossGroupCombinedView(aiBody, query, geminiSynthesis, validResults, crossKeywords, namuUrls);
            } else {
                renderCrossGroupRawResults(aiBody, query, validResults, crossKeywords);
            }
            trackEvent('namu_smart_search', { query: query, method: 'cross_group_combined', result_count: validResults.length });
            logSearchToGAS({ query: query, group: '', intent_type: 'cross_group_raw', response_method: geminiSynthesis && !geminiSynthesis._error ? 'combined' : 'raw_text', response_time_ms: Date.now() - searchStartTime, success: true });
            return;
        }
        // 결과 없으면 Gemini 폴백으로 진행
    }

    // Method B-2: Gemini Flash 폴백
    updateSearchProgress(aiBody, 1, '데이터베이스에서 검색 중...');
    updateSearchProgress(aiBody, 2, 'AI가 답변을 정리하는 중...');

    var geminiResult = await callGeminiFlash(query, searchSignal);

    // 새 검색이 시작되어 취소된 경우 → DOM 업데이트 스킵
    if (searchSignal.aborted || (geminiResult && geminiResult._aborted)) return;

    if (geminiResult && geminiResult._error) {
        showSmartAnswer(aiBody, '검색 실패', geminiResult.message || 'AI 응답을 받지 못했습니다. 잠시 후 다시 시도해 주세요.', 'warning');
        trackEvent('namu_smart_search', { query: query, method: 'gemini_error' });
        logSearchToGAS({ query: query, group: '', intent_type: 'gemini_fallback', response_method: 'gemini_error', response_time_ms: Date.now() - searchStartTime, success: false });
    } else if (geminiResult && !geminiResult._error) {
        var responseMethod = geminiResult._fromCache ? 'cache' : 'gemini';
        renderGeminiAnswer(aiBody, geminiResult);
        trackEvent('namu_smart_search', { query: query, method: responseMethod });
        logSearchToGAS({ query: query, group: '', intent_type: 'gemini_fallback', response_method: responseMethod, response_time_ms: Date.now() - searchStartTime, success: true });
    } else {
        showSmartAnswer(aiBody, '"' + query + '"', '검색 결과를 찾을 수 없습니다. 다른 키워드로 시도해 보세요.', 'warning');
        trackEvent('namu_smart_search', { query: query, method: 'fallback_failed' });
        logSearchToGAS({ query: query, group: '', intent_type: 'gemini_fallback', response_method: 'fallback_failed', response_time_ms: Date.now() - searchStartTime, success: false });
    }
}


// ============================================================
// 통합 검색 (Phase 3)
// ============================================================

/**
 * 구조화 데이터 + 역인덱스를 소스별 가중치로 병합 검색
 * @param {string} query - 정규화된 검색어
 * @returns {{ results: Array, sources: Object }|null}
 */
function unifiedSearch(query) {
    if (!namuIndexData) return null;
    var q = query.toLowerCase().trim();
    var results = {}; // slug → { group, score, sources: [] }

    // 가중치 상수
    var W_INDEX = 3;    // namuIndexData (메타)
    var W_DETAIL = 4;   // groupDetail (상세)
    var W_RANKING = 5;  // namuRankingData (판매량)
    var W_RAW = 2;      // 역인덱스 히트 (비구조화)
    var W_SNS = 3;      // SNS 데이터

    // 1. namuIndexData에서 검색 (메타 — 즉시)
    for (var i = 0; i < namuIndexData.length; i++) {
        var g = namuIndexData[i];
        var score = 0;
        var matchedFields = [];

        // 소속사 매칭
        if (g.agency && g.agency.toLowerCase().indexOf(q) !== -1) {
            score += 30 * W_INDEX;
            matchedFields.push('소속사: ' + g.agency);
        }
        // 멤버명 매칭
        var members = g.members || [];
        for (var mi = 0; mi < members.length; mi++) {
            if (members[mi].toLowerCase() === q || members[mi].toLowerCase().indexOf(q) !== -1) {
                score += 20 * W_INDEX;
                matchedFields.push('멤버: ' + members[mi]);
                break;
            }
        }
        // 데뷔 연도 매칭
        if (g.debut_year && q.indexOf(g.debut_year) !== -1) {
            score += 15 * W_INDEX;
            matchedFields.push('데뷔: ' + g.debut_year);
        }

        if (score > 0) {
            results[g.slug] = results[g.slug] || { group: g, score: 0, sources: [] };
            results[g.slug].score += score;
            results[g.slug].sources.push({ type: 'index', fields: matchedFields });
        }
    }

    // 2. namuRankingData에서 검색 (판매량)
    if (namuRankingData) {
        for (var ri = 0; ri < namuRankingData.length; ri++) {
            var album = namuRankingData[ri];
            var slug = album.slug || album.group_slug;
            if (!slug) continue;
            // 앨범명 매칭
            if (album.title && album.title.toLowerCase().indexOf(q) !== -1) {
                results[slug] = results[slug] || { group: findGroupBySlug(slug), score: 0, sources: [] };
                results[slug].score += 40 * W_RANKING;
                results[slug].sources.push({ type: 'ranking', fields: ['앨범: ' + album.title + ' (' + (album['초동_써클'] || album['초동_한터'] || '-') + ')'] });
            }
        }
    }

    // 3. 역인덱스 검색 (raw_text 키워드)
    var qWords = q.split(/\s+/).filter(function(w) { return w.length >= 2; });
    if (qWords.length > 0) {
        var indexHits = searchByIndex(qWords);
        for (var hi = 0; hi < indexHits.length; hi++) {
            var hitSlug = indexHits[hi];
            results[hitSlug] = results[hitSlug] || { group: findGroupBySlug(hitSlug), score: 0, sources: [] };
            results[hitSlug].score += 20 * W_RAW;
            results[hitSlug].sources.push({ type: 'raw_index', fields: ['원문 키워드 매칭'] });
        }
    }

    // 결과 정렬 (점수 내림차순)
    var sorted = Object.keys(results)
        .map(function(slug) { return results[slug]; })
        .filter(function(r) { return r.group; })
        .sort(function(a, b) { return b.score - a.score; })
        .slice(0, 15); // 상위 15개

    // 최소 점수 임계값 (노이즈 필터링)
    var minScore = 30;
    sorted = sorted.filter(function(r) { return r.score >= minScore; });

    if (sorted.length === 0) return null;
    return { results: sorted };
}

/**
 * slug로 인덱스에서 그룹 찾기 (헬퍼)
 */
function findGroupBySlug(slug) {
    if (!namuIndexData) return null;
    for (var i = 0; i < namuIndexData.length; i++) {
        if (namuIndexData[i].slug === slug) return namuIndexData[i];
    }
    return null;
}

/**
 * 통합 검색 결과 렌더링
 */
function renderUnifiedSearchResults(container, query, searchResult) {
    if (!container || !searchResult || !searchResult.results) return;
    var results = searchResult.results;

    var html = '<div class="smart-answer-card unified-results">'
        + '<div class="smart-answer-header">'
        + '<span class="smart-answer-icon">🔍</span>'
        + '<h6 class="smart-answer-title">"' + escapeHtml(query) + '" 검색 결과</h6>'
        + '</div>'
        + '<div class="smart-answer-body">'
        + '<p class="text-muted small mb-3">' + results.length + '개 그룹에서 관련 정보를 찾았습니다</p>';

    // 그룹별 결과 카드
    for (var i = 0; i < results.length; i++) {
        var r = results[i];
        var g = r.group;
        if (!g) continue;

        var genderClass = g.gender === '여자' ? 'text-danger' : 'text-primary';
        var genderIcon = g.gender === '여자' ? '♀' : '♂';

        // 소스별 매칭 정보 수집
        var matchInfo = [];
        for (var si = 0; si < r.sources.length; si++) {
            var src = r.sources[si];
            if (src.fields) {
                for (var fi = 0; fi < src.fields.length; fi++) {
                    matchInfo.push(src.fields[fi]);
                }
            }
        }

        html += '<div class="unified-result-item" onclick="loadNamuGroupBySlug(\'' + escapeSingleQuote(g.slug) + '\')" style="cursor:pointer; padding: 10px; border-bottom: 1px solid #eee;">'
            + '<div class="d-flex justify-content-between align-items-start">'
            + '<div>'
            + '<span class="' + genderClass + ' me-1">' + genderIcon + '</span>'
            + '<strong>' + escapeHtml(g.name) + '</strong>'
            + ' <small class="text-muted">' + escapeHtml(g.name_en) + '</small>'
            + (g.agency ? ' · <small class="text-muted">' + escapeHtml(g.agency) + '</small>' : '')
            + '</div>'
            + '<small class="text-muted">score: ' + r.score + '</small>'
            + '</div>';

        if (matchInfo.length > 0) {
            html += '<div class="mt-1">';
            for (var mi2 = 0; mi2 < Math.min(matchInfo.length, 3); mi2++) {
                html += '<span class="badge bg-light text-dark me-1 mb-1" style="font-size:0.75rem;">' + escapeHtml(matchInfo[mi2]) + '</span>';
            }
            html += '</div>';
        }
        html += '</div>';
    }

    html += '</div></div>';
    container.innerHTML = html;

    // 하단에 Gemini 심화 검색 버튼
    var deepBtn = document.createElement('div');
    deepBtn.className = 'text-center mt-2';
    deepBtn.innerHTML = '<button class="btn btn-outline-primary btn-sm" onclick="synthesizeWithGemini(this, \'' + escapeSingleQuote(query) + '\')">'
        + CHAT_AI_ICON_SVG + ' AI로 더 자세히 분석하기</button>';
    container.appendChild(deepBtn);
}

// ============================================================
// 유틸리티 함수
// ============================================================

// 검색 진행 표시 업데이트 (Agentic UX)
function updateSearchProgress(container, step, message) {
    if (!container) return;
    var progressEl = container.querySelector('.search-progress');
    if (!progressEl) {
        // 채팅 UI: AI body 내부에 progress 컨테이너 생성
        container.innerHTML = '';
        progressEl = document.createElement('div');
        progressEl.className = 'search-progress';
        container.appendChild(progressEl);
    }
    // 단계별 진행 표시 (이전 단계 체크마크 + 현재 단계 스피너)
    var steps = progressEl.querySelectorAll('.progress-step');
    for (var i = 0; i < steps.length; i++) {
        var spinner = steps[i].querySelector('.progress-spinner');
        if (spinner) spinner.textContent = '✅'; // 이전 단계 완료 마킹
    }
    var stepEl = document.createElement('div');
    stepEl.className = 'progress-step';
    stepEl.style.cssText = 'padding:4px 0;color:#555;font-size:0.9rem;';
    stepEl.innerHTML = '<span class="progress-spinner">⏳</span> <span>' + message + '</span>';
    progressEl.appendChild(stepEl);
}

// 검색 진행 표시 제거
function clearSearchProgress(container) {
    if (!container) return;
    var progressEl = container.querySelector('.search-progress');
    if (progressEl) progressEl.remove();
}

// raw_text 결과를 Gemini로 정리 (Retrieve & Synthesize 하이브리드)
async function synthesizeWithGemini(btnEl, query) {
    var rawContext = btnEl.getAttribute('data-raw-context');
    if (!rawContext) return;

    // 버튼 비활성화 + 로딩 상태
    btnEl.disabled = true;
    btnEl.innerHTML = '<span class="spinner-border spinner-border-sm"></span> AI 정리 중...';

    // 채팅 UI: AI 답변 영역에 렌더링
    var aiTarget = getChatAiBody() || document.getElementById('namuSmartAnswer');

    var synthesizeQuery = '다음 나무위키 원문을 참고하여 "' + query + '"에 대해 깔끔하게 정리해주세요:\n\n' + rawContext;
    var result = await callGeminiFlash(synthesizeQuery);

    if (result && result._aborted) return;
    if (result && !result._error) {
        renderGeminiAnswer(aiTarget, result);
        trackEvent('namu_smart_search', { query: query, method: 'synthesize' });
    } else {
        // 실패 시 버튼 복원
        btnEl.disabled = false;
        btnEl.innerHTML = '🤖 AI로 정리하기';
    }
}

// HTML 이스케이프
function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;')
              .replace(/</g, '&lt;')
              .replace(/>/g, '&gt;')
              .replace(/"/g, '&quot;');
}

// 정규식 특수문자 이스케이프
function escapeRegex(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// onclick 내부 작은따옴표 이스케이프 (XSS 방어)
function escapeSingleQuote(str) {
    if (!str) return '';
    // 순서 중요: 백슬래시를 먼저 이스케이프한 후 작은따옴표 처리
    return str.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

// 소속사로 그룹 찾기
function findGroupsByAgency(agencyTerm) {
    if (!namuIndexData) return [];
    var term = agencyTerm.toLowerCase();
    return namuIndexData.filter(function(g) {
        return (g.agency || '').toLowerCase().includes(term);
    });
}

// 최고 초동 (문자열)
function getMaxSales(detail) {
    var albums = detail.albums || [];
    var maxVal = 0;
    var maxStr = '-';
    for (var i = 0; i < albums.length; i++) {
        var num = albums[i]['초동_써클_numeric'] || 0;
        if (num > maxVal) {
            maxVal = num;
            maxStr = albums[i]['초동_써클'] || '-';
        }
    }
    return maxStr;
}

// 최고 초동 (숫자)
function getMaxSalesNum(detail) {
    var albums = detail.albums || [];
    var maxVal = 0;
    for (var i = 0; i < albums.length; i++) {
        var num = albums[i]['초동_써클_numeric'] || 0;
        if (num > maxVal) maxVal = num;
    }
    return maxVal;
}

// 최근 N개 앨범 초동 데이터 (차트용)
function getRecentSalesData(detail, n) {
    var albums = (detail.albums || []).filter(function(a) {
        return (a['초동_써클_numeric'] || 0) > 0;
    }).sort(function(a, b) {
        return (a['발매일'] || '').localeCompare(b['발매일'] || '');
    });

    var recent = albums.slice(-n);
    return {
        labels: recent.map(function(a) { return a.title || ''; }),
        values: recent.map(function(a) { return a['초동_써클_numeric'] || 0; })
    };
}


// === 목록형 필터 공유 렌더러 (데뷔연도/세대/소속사) ===
// 그룹 상세 JSON 병렬 로드 → 데뷔일순 정렬 → 번호 매김 테이블 → 성별 요약
async function renderEnhancedGroupList(container, filtered, options) {
    // options: { title, icon, sortBy, showDebutDate, emptyMessage }

    // 빈 결과 처리
    if (filtered.length === 0) {
        showSmartAnswer(container, options.title, options.emptyMessage || '해당 조건의 그룹이 없습니다.', 'info');
        return;
    }

    // 1. 그룹 상세 JSON 병렬 로드 (fetchGroupDetail → 캐시 히트 시 즉시 반환)
    var details = await Promise.all(filtered.map(function(g) {
        return fetchGroupDetail(g.slug);
    }));

    // 2. 데뷔일 추출 + 아이템 배열 구성
    var items = filtered.map(function(g, i) {
        var detail = details[i];
        var debutDate = (detail && detail.info) ? (detail.info['데뷔일'] || '') : '';
        var agency = (detail && detail.info) ? (detail.info['소속사'] || g.agency || '') : (g.agency || '');
        return { group: g, detail: detail, debutDate: debutDate, agency: agency };
    });

    // 3. 정렬: 데뷔일순 (YYYY.MM.DD 문자열 비교)
    if (options.sortBy === 'debut_date') {
        items.sort(function(a, b) {
            return (a.debutDate || '9999').localeCompare(b.debutDate || '9999');
        });
    }

    // 4. 성별 요약용 분류
    var femaleGroups = [];
    var maleGroups = [];
    for (var i = 0; i < items.length; i++) {
        if (items[i].group.gender === '여자') {
            femaleGroups.push(items[i].group.name);
        } else {
            maleGroups.push(items[i].group.name);
        }
    }

    // 5. 테이블 HTML 생성
    var html = '<div class="namu-smart-answer">' +
        '<div class="namu-smart-answer-header">' +
        '<span class="namu-smart-icon">' + (options.icon || '📋') + '</span>' +
        '<span class="namu-smart-title">' + escapeHtml(options.title + ' (' + filtered.length + '팀)') + '</span>' +
        '<button class="namu-smart-close" onclick="dismissSmartAnswer()" title="닫기">&times;</button>' +
        '</div>' +
        '<div class="namu-smart-answer-body">' +
        '<div class="table-responsive"><table class="table table-sm namu-smart-table">' +
        '<thead><tr><th>#</th><th>그룹</th><th>성별</th><th>데뷔일</th><th>소속사</th></tr></thead>' +
        '<tbody>';

    for (var j = 0; j < items.length; j++) {
        var it = items[j];
        var genderBadge = it.group.gender === '여자' ? '👩' : '👨';
        var displayDate = it.debutDate || it.group.debut_year || '-';
        html += '<tr onclick="loadNamuGroupBySlug(\'' + escapeSingleQuote(it.group.slug) + '\')" style="cursor:pointer;">' +
            '<td>' + (j + 1) + '</td>' +
            '<td class="fw-bold">' + escapeHtml(it.group.name) + ' <small class="text-muted">' + escapeHtml(it.group.name_en) + '</small></td>' +
            '<td>' + genderBadge + '</td>' +
            '<td>' + escapeHtml(displayDate) + '</td>' +
            '<td>' + escapeHtml((it.agency || '-').length > 20 ? (it.agency || '-').substring(0, 20) + '…' : (it.agency || '-')) + '</td>' +
            '</tr>';
    }

    html += '</tbody></table></div>';

    // 6. 성별 요약 텍스트 (여/남 그룹 나열)
    var summaryParts = [];
    if (femaleGroups.length > 0) {
        summaryParts.push('여자 그룹 ' + femaleGroups.length + '개: ' + femaleGroups.join(', '));
    }
    if (maleGroups.length > 0) {
        summaryParts.push('남자 그룹 ' + maleGroups.length + '개: ' + maleGroups.join(', '));
    }
    if (summaryParts.length > 0) {
        html += '<div class="namu-smart-summary mt-2" style="font-size:0.85em;color:#666;">' +
            summaryParts.join('<br>') + '</div>';
    }

    html += '</div></div>';

    container.innerHTML = html;
    container.style.display = 'block';
}


// === 복합 질의용: 인텐트 기준 그룹 필터링 ===
function filterGroupsByIntent(intent) {
    if (!namuIndexData) return [];
    var filtered = [];

    if (intent.type === 'debut_year_filter') {
        // 데뷔 연도 매칭
        filtered = namuIndexData.filter(function(g) {
            return parseInt(g.debut_year) === intent.year;
        });
    } else if (intent.type === 'generation_filter') {
        // 세대 범위 매칭
        var range = GENERATION_MAP[intent.generation];
        if (!range) return [];
        filtered = namuIndexData.filter(function(g) {
            var year = parseInt(g.debut_year);
            return year >= range[0] && year <= range[1];
        });
    } else if (intent.type === 'agency_filter') {
        // 소속사 매칭
        var agencyNames = AGENCY_ALIASES[intent.agency] || [intent.agency];
        filtered = namuIndexData.filter(function(g) {
            var agency = (g.agency || '').toLowerCase();
            for (var i = 0; i < agencyNames.length; i++) {
                if (agency.includes(agencyNames[i].toLowerCase())) return true;
            }
            return false;
        });
        // 소속사 인텐트의 세대 필터
        if (intent.generation && GENERATION_MAP[intent.generation]) {
            var genRange = GENERATION_MAP[intent.generation];
            filtered = filtered.filter(function(g) {
                var y = parseInt(g.debut_year);
                return y >= genRange[0] && y <= genRange[1];
            });
        }
    }

    // 공통 성별 필터
    if (intent.gender) {
        filtered = filtered.filter(function(g) { return g.gender === intent.gender; });
    }

    return filtered;
}

// === 복합 질의용: 앨범 배열에서 초동 최고값 앨범 추출 ===
// 한터/써클 양쪽 모두 비교하여 MAX 값 사용 (데이터 소스 편향 방지)
function findTopSalesAlbum(albums) {
    if (!albums || albums.length === 0) return null;
    var maxVal = 0;
    var topAlbum = null;
    for (var i = 0; i < albums.length; i++) {
        // 써클과 한터 모두 파싱하여 더 큰 값 사용
        var circleNum = albums[i]['초동_써클_numeric'] || 0;
        var hanterStr = (albums[i]['초동_한터'] || '').replace(/[,\s]/g, '');
        var hanterNum = parseInt(hanterStr) || 0;
        var num = Math.max(circleNum, hanterNum);
        if (num === 0) continue;
        if (num > maxVal) {
            maxVal = num;
            // 표시용: 더 큰 값의 출처를 표시
            var salesStr, source;
            if (hanterNum > circleNum) {
                salesStr = albums[i]['초동_한터'] || String(hanterNum);
                source = '한터';
            } else {
                salesStr = albums[i]['초동_써클'] || String(circleNum);
                source = '써클';
            }
            topAlbum = { title: albums[i].title || albums[i]['앨범명'] || '', sales: salesStr, source: source, salesNum: num };
        }
    }
    return topAlbum;
}

// === 복합 질의용: 필터된 그룹의 상세 데이터를 병렬 로드 → 판매량 포함 요약 텍스트 ===
async function collectFilteredContext(intent) {
    // 인텐트 기준 그룹 필터링
    var filtered = filterGroupsByIntent(intent);
    if (filtered.length === 0) return '해당 조건의 그룹이 없습니다.';

    // 각 그룹 상세 JSON 병렬 로드 (fetchGroupDetail 캐시 재활용)
    var details = await Promise.all(filtered.map(function(g) {
        return fetchGroupDetail(g.slug);
    }));

    // 판매량 포함 요약 텍스트 생성
    var lines = [];
    for (var i = 0; i < filtered.length; i++) {
        var g = filtered[i];
        var d = details[i];
        var line = g.name + ' (' + g.name_en + ') | ' + g.gender +
                   ' | 데뷔: ' + (g.debut_year || '-') + ' | 소속사: ' + (g.agency || '-');
        if (d && d.albums && d.albums.length > 0) {
            // 초동 최고값 앨범 (한터/써클 MAX)
            var topAlbum = findTopSalesAlbum(d.albums);
            if (topAlbum) {
                line += ' | 최고초동: ' + topAlbum.sales + ' [' + topAlbum.source + '] (' + topAlbum.title + ')';
            }
            line += ' | 총 앨범 ' + d.albums.length + '개';
            // 전체 초동 리스트 (한터/써클 중 더 큰 값 사용)
            var salesList = [];
            for (var j = 0; j < d.albums.length; j++) {
                var a = d.albums[j];
                var circleN = a['초동_써클_numeric'] || 0;
                var hanterS = (a['초동_한터'] || '').replace(/[,\s]/g, '');
                var hanterN = parseInt(hanterS) || 0;
                var bestNum = Math.max(circleN, hanterN);
                if (bestNum > 0) {
                    var bestStr = hanterN > circleN
                        ? (a['초동_한터'] || String(hanterN))
                        : (a['초동_써클'] || String(circleN));
                    salesList.push((a.title || a['앨범명'] || '?') + ': ' + bestStr);
                }
            }
            if (salesList.length > 0) {
                line += '\n  앨범별 초동: ' + salesList.join(', ');
            }
        }
        lines.push(line);
    }
    return '총 ' + filtered.length + '팀\n\n' + lines.join('\n\n');
}

// ============================================================
// 스마트 검색 패턴 자동 검증 (콘솔 전용)
// 사용법: 브라우저 콘솔에서 runSmartSearchTests() 실행
// 전제: 나무위키 탭 진입 후 namuIndexData 로드 완료 상태
// ============================================================
function runSmartSearchTests() {
    // namuIndexData 로드 확인
    if (!namuIndexData || namuIndexData.length === 0) {
        console.error('[테스트 실패] namuIndexData가 로드되지 않았습니다. 나무위키 탭에 먼저 진입하세요.');
        return;
    }

    // 79개 테스트 케이스: [쿼리, 기대 type, 설명]
    var cases = [
        // 1-3: comparison (패턴 1)
        ['에스파 vs 뉴진스', 'comparison', '한글 vs 한글'],
        ['세븐틴 비교 스트레이키즈', 'comparison', '한글 비교 한글'],
        ['LE SSERAFIM VS IVE', 'comparison', '영문 VS 영문'],

        // 4-6: ranking_filter (패턴 2)
        ['초동 100만 이상', 'ranking_filter', '초동 100만 이상'],
        ['2024년 초동 50만 이상', 'ranking_filter', '연도+초동 이상'],
        ['초동 200만 이하', 'ranking_filter', '초동 이하'],

        // 6a-6c: album_sales_ranking (패턴 2-b)
        ['역대 초동 1위 앨범은?', 'album_sales_ranking', '역대 초동 1위'],
        ['초동 TOP 20', 'album_sales_ranking', '초동 TOP N'],
        ['2024년 초동 순위 걸그룹', 'album_sales_ranking', '연도+초동순위+걸그룹'],

        // 7-9: agency_filter (패턴 2-a, 3)
        ['SM 4세대', 'agency_filter', 'SM+세대'],
        ['하이브 걸그룹', 'agency_filter', '하이브+걸그룹'],
        ['JYP 보이그룹', 'agency_filter', 'JYP+보이그룹'],
        ['하이브 소속 아이돌 누가 있어?', 'agency_filter', '소속+꼬리표현 정규화'],
        ['SM 소속 그룹', 'agency_filter', '소속사 단독 필터'],

        // 10-12: generation_filter (패턴 3-1)
        ['4세대 걸그룹', 'generation_filter', '세대+걸그룹'],
        ['5세대 보이그룹', 'generation_filter', '세대+보이그룹'],
        ['3세대 아이돌 목록', 'generation_filter', '세대+아이돌+목록'],

        // 12a-12c: debut_year_filter (패턴 3-0b)
        ['2020년 데뷔', 'debut_year_filter', '데뷔 연도 단독'],
        ['2018년 데뷔 걸그룹', 'debut_year_filter', '데뷔 연도+걸그룹'],
        ['2022년 데뷔 아이돌', 'debut_year_filter', '데뷔 연도+아이돌'],

        // 13-14: cross_group_search (패턴 3-1a)
        ['4세대 걸그룹 평균 멤버수', 'cross_group_search', '세대+걸그룹+집계'],
        ['5세대 보이그룹 초동 1위', 'cross_group_search', '세대+보이그룹+집계'],

        // 15-16: group_field (패턴 3-2)
        ['에스파 멤버 몇명', 'group_field', '그룹 멤버수 질의'],
        ['있지 인원수', 'group_field', '그룹 인원수'],

        // 17-21: recent_album (패턴 3-3)
        ['르세라핌 최신 앨범', 'recent_album', '최신 앨범'],
        ['엔하이픈 신보', 'recent_album', '신보'],
        ['엔시티 드림 최근 앨범', 'recent_album', '최근 앨범 (한글그룹)'],
        ['에스파 최근 컴백일자', 'recent_album', '최근 컴백일자'],
        ['에스파 컴백일', 'recent_album', '컴백일 단독'],

        // 20-23: group_member_table (패턴 4)
        ['에스파 멤버 생일', 'group_member_table', '멤버+생일'],
        ['세븐틴 멤버 출신지', 'group_member_table', '멤버+출신지'],
        ['스트레이키즈 멤버들 역할', 'group_member_table', '멤버들+역할'],
        ['아이브 맴버 생년월일', 'group_member_table', '맴버(오타)+생년월일'],
        ['다이몬 멤버 특징', 'group_member_table', '멤버+특징(→info 매핑)'],
        ['에스파 멤버 별명과 생일', 'group_member_table', '멤버+별명(info)+생일(복합)'],
        ['뉴진스 멤버 프로필', 'group_member_table', '멤버+프로필(전체표시)'],
        ['에스파 멤버 정보', 'group_member_table', '멤버+정보(전체표시)'],
        ['뉴진스 멤버 몇 명이야?', 'member_count', '멤버 수 질문'],
        ['에스파 멤버 인원', 'member_count', '멤버 인원'],
        ['뉴진스 멤버들의 성격', 'group_member_table', '멤버들의+성격(→info 매핑)'],

        // 27-28: member_aggregate (패턴 4 → 집계 분기)
        ['뉴진스 멤버 평균 키', 'member_aggregate', '멤버 평균 키'],
        ['에스파 멤버 최대 키', 'member_aggregate', '멤버 최대 키'],

        // 26-27: member_raw_search (패턴 4 → 비정형 분기)
        ['르세라핌 멤버 MBTI', 'group_member_table', '멤버 MBTI (FIELD_ALIASES 매칭→실행시 raw 폴백)'],
        ['세븐틴 멤버 혈액형', 'group_member_table', '멤버 혈액형 (FIELD_ALIASES 매칭→실행시 raw 폴백)'],

        // 28-30: album_sales (패턴 5)
        ['에스파 앨범 초동', 'album_sales', '그룹 앨범 초동'],
        ['스트레이키즈 1집 초동', 'album_sales', 'N집 초동'],
        ['세븐틴 3집 초동', 'album_sales', 'N집 초동 (2)'],
        ['르세라핌 초동 판매량 가장 높은 앨범은?', 'album_sales', '자연어 초동 판매량 가장 높은'],
        ['에스파 앨범 판매량 가장 많은', 'album_sales', '자연어 앨범 판매량 가장 많은'],

        // 31-33: member_field (패턴 6)
        ['카리나 생일', 'member_field', '멤버+생일'],
        ['민지 출신지', 'member_field', '멤버+출신지'],
        ['승관 역할', 'member_field', '멤버+역할'],

        // 34-36: group_raw_search (패턴 6-1, 6-2)
        ['에스파 컨셉', 'group_raw_search', '그룹+비정형 키워드'],
        ['아이브 데뷔 스토리', 'group_raw_search', '그룹+다중 키워드'],
        ['뉴진스 하이브 논란', 'group_raw_search', '그룹+다중 키워드 (2)'],

        // 37-38: member_raw_search (패턴 6-3)
        ['카리나 보컬 실력', 'member_raw_search', '멤버+다중 키워드'],
        ['방찬 작곡 활동', 'member_raw_search', '멤버+다중 키워드 (2)'],

        // 39-40: member_field — 소속 패턴 (패턴 7)
        ['혜인 어느 그룹', 'member_field', '멤버 소속 질의'],
        ['하오 소속', 'member_field', '멤버 소속 질의 (2)'],

        // 41-44: navigate (패턴 8)
        ['에스파', 'navigate', '한글 그룹명 직접'],
        ['Stray Kids', 'navigate', '영문 그룹명 직접'],
        ['르세라핌', 'navigate', '한글 그룹명 직접 (2)'],
        ['ENHYPEN', 'navigate', '영문 그룹명 직접 (3)'],

        // 45-46: navigate_member (패턴 9)
        ['카리나', 'navigate_member', '멤버명 직접'],
        ['아이엔', 'navigate_member', '멤버명 직접 (2)'],

        // 47-48: discography (패턴 3-4)
        ['에스파 디스코그래피', 'discography', '디스코그래피'],
        ['아이브 앨범 목록', 'discography', '앨범 목록'],
        ['뉴진스 전체 앨범', 'discography', '전체 앨범'],

        // 49-50: member_age_order (패턴 3-5)
        ['에스파 멤버 나이순', 'member_age_order', '멤버 나이순'],
        ['아이브 나이순', 'member_age_order', '나이순 (멤버 키워드 생략)'],

        // 51-52: member_age_extreme (패턴 3-6 — AGE_KEYWORDS)
        ['에스파 최연소', 'member_age_extreme', '최연소 (AGE_KEYWORDS)'],
        ['뉴진스 막내', 'member_age_extreme', '막내 (AGE_KEYWORDS)'],

        // 53-54: foreign_member (패턴 3-7)
        ['에스파 외국인 멤버', 'foreign_member', '외국인 멤버'],
        ['세븐틴 해외 멤버', 'foreign_member', '해외 멤버'],

        // 55-56: album_type_count (패턴 3-8)
        ['에스파 정규앨범 몇 개', 'album_type_count', '정규앨범 몇 개'],
        ['뉴진스 미니앨범 몇장', 'album_type_count', '미니앨범 몇장'],

        // 57-58: member_count_filter (패턴 3-2a)
        ['멤버 10명 이상 그룹', 'member_count_filter', '멤버 10명 이상'],
        ['멤버 5명인 그룹', 'member_count_filter', '멤버 5명인'],

        // 59-60: album_count_filter (패턴 3-2a)
        ['앨범 30개 이상 그룹', 'album_count_filter', '앨범 30개 이상'],
        ['앨범 20개 이상 아이돌', 'album_count_filter', '앨범 20개 이상'],

        // 61-62: specific_album_lookup (패턴 5-b)
        ['에스파 Supernova 초동', 'specific_album_lookup', '특정 앨범 초동 조회'],
        ['뉴진스 Supernatural 발매일', 'specific_album_lookup', '특정 앨범 발매일 조회'],

        // 62a-62b: specific_album_lookup 추가 (fuzzy matching 검증)
        ['블랙핑크 born pink 초동', 'specific_album_lookup', '소문자 앨범명 fuzzy'],
        ['르세라핌 fearless 발매일', 'specific_album_lookup', '소문자 영문 앨범명 fuzzy'],
        ['방탄소년단 dark wild 초동', 'specific_album_lookup', '& 생략 fuzzy'],

        // 63-64: album_sales 확장 (패턴 5-a — 독립 초동)
        ['에스파 초동', 'album_sales', '그룹+초동 단독'],
        ['뉴진스 판매량', 'album_sales', '그룹+판매량 단독'],

        // 65-66: agency_filter — 소속 패턴 (패턴 2-a)
        ['큐브 소속 걸그룹', 'agency_filter', '소속사+소속+걸그룹'],
        ['스타쉽 소속 아이돌', 'agency_filter', '소속사+소속+아이돌'],

        // 67-68: ranking_filter — 성별 포함
        ['초동 100만 이상 걸그룹', 'ranking_filter', '초동+이상+걸그룹'],
        ['2024년 초동 50만 이상 보이그룹', 'ranking_filter', '연도+초동+보이그룹'],

        // 69-70: recent_album — 컴백 확장
        ['에스파 컴백 날짜', 'recent_album', '컴백 날짜'],
        ['뉴진스 최근 활동', 'recent_album', '최근 활동'],

        // 71-72: generation_filter — 추천 키워드
        ['4세대 걸그룹 추천', 'generation_filter', '세대+걸그룹+추천'],

        // 73-74: group_field — 팬덤명 (FIELD_ALIASES '팬 이름')
        ['에스파 팬덤명', 'group_field', '그룹+팬덤명'],

        // 75-76: null (매칭 실패)
        ['오늘 날씨', null, '아이돌 무관 쿼리'],
        ['아이돌', null, '너무 포괄적인 단어'],

        // 77-79: calendar_schedule (패턴 3-3a — 그룹 없는 캘린더 일정)
        ['컴백 일정', 'calendar_schedule', '캘린더 일정 (그룹 없음)'],
        ['이번달 컴백 일정', 'calendar_schedule', '이번달 컴백 일정'],
        ['다음달 컴백 일정', 'calendar_schedule', '다음달 컴백 일정'],

        // 80-91: group_sns / sns_comparison (패턴 3-3b~3-3d)
        ['에스파 SNS', 'group_sns', '전체 SNS 조회'],
        ['에스파 팔로워', 'group_sns', '전체 팔로워 조회'],
        ['에스파 유튜브', 'group_sns', '특정 플랫폼 (유튜브)'],
        ['에스파 유튜브 팔로워', 'group_sns', '플랫폼+팔로워'],
        ['에스파 트위터', 'group_sns', '트위터 동의어'],
        ['에스파 엑스 팔로워', 'group_sns', 'X 동의어'],
        ['뉴진스 웨이보 구독자', 'group_sns', '웨이보+구독자'],
        ['에스파 인스타', 'group_sns', '인스타 미추적 안내'],
        ['르세라핌 스포티파이', 'group_sns', '스포티파이'],
        ['에스파 vs 뉴진스 팔로워', 'sns_comparison', 'SNS 비교'],
        ['에스파 vs 르세라핌 웨이보 팔로워 비교', 'sns_comparison', 'SNS 비교+플랫폼+비교'],
        ['세븐틴 비교 스트레이키즈 SNS', 'sns_comparison', 'SNS 비교 (비교 키워드)'],
        ['BTS 유튜브 구독자', 'group_sns', '영문 그룹명+유튜브'],
        // sns_ranking (패턴 0)
        ['4세대 걸그룹 유튜브 구독자 1위', 'sns_ranking', 'SNS랭킹+세대+성별'],
        ['유튜브 구독자 순위', 'sns_ranking', 'SNS랭킹 기본'],
        ['웨이보 팔로워 많은 남자 아이돌', 'sns_ranking', 'SNS랭킹+성별']
    ];

    var results = [];  // console.table용
    var failures = []; // 실패 케이스 별도 수집
    var passCount = 0;

    for (var i = 0; i < cases.length; i++) {
        var query = cases[i][0];
        var expectedType = cases[i][1];
        var desc = cases[i][2];

        var result = parseSmartQuery(query);
        var actualType = result ? result.type : null;
        var pass = actualType === expectedType;

        if (pass) passCount++;

        results.push({
            '#': i + 1,
            '쿼리': query,
            '기대': expectedType || 'null',
            '실제': actualType || 'null',
            '결과': pass ? 'PASS ✓' : 'FAIL ✗',
            '설명': desc
        });

        if (!pass) {
            failures.push({
                '#': i + 1,
                '쿼리': query,
                '기대': expectedType || 'null',
                '실제': actualType || 'null',
                '설명': desc,
                '상세': result ? JSON.stringify(result) : 'null'
            });
        }
    }

    // 결과 출력
    console.log('%c=== 스마트 검색 패턴 테스트 ===', 'font-size:14px;font-weight:bold;color:#2196F3');
    console.log('총 ' + cases.length + '개 | PASS: ' + passCount + ' | FAIL: ' + (cases.length - passCount));
    console.table(results);

    // 실패 케이스 별도 경고
    if (failures.length > 0) {
        console.warn('%c=== FAIL 케이스 상세 ===', 'font-size:13px;font-weight:bold;color:#f44336');
        for (var f = 0; f < failures.length; f++) {
            console.warn(
                '#' + failures[f]['#'] + ' | "' + failures[f]['쿼리'] + '"' +
                ' → 기대: ' + failures[f]['기대'] + ', 실제: ' + failures[f]['실제'] +
                ' | ' + failures[f]['설명'] +
                '\n   상세: ' + failures[f]['상세']
            );
        }
    } else {
        console.log('%c모든 테스트 통과! ✓', 'font-size:13px;font-weight:bold;color:#4CAF50');
    }

    // 요약 반환 (프로그래밍 활용)
    return { total: cases.length, pass: passCount, fail: cases.length - passCount, failures: failures };
}

// ============================================================
// 페이지 로드 시 만료된 Gemini 캐시 정리 (idle 콜백)
// ============================================================
if (typeof window !== 'undefined') {
    window.addEventListener('load', function() {
        if ('requestIdleCallback' in window) {
            requestIdleCallback(cleanupGeminiCache, { timeout: 90000 }); // 90초 내 실행
        } else {
            setTimeout(cleanupGeminiCache, 90000); // 폴백: 90초 후 실행
        }
    });
}
