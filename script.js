// ========================================
// 📊 Google Analytics 4 유틸리티
// ========================================

/**
 * GA4 이벤트 전송 헬퍼 함수
 * @param {string} eventName - 이벤트 이름
 * @param {Object} params - 이벤트 파라미터
 */
function trackEvent(eventName, params = {}) {
    // GA4가 로드되지 않았거나 로컬 환경이거나 봇이면 무시
    if (typeof gtag !== 'function' || window.location.hostname === 'localhost' || window.__isBot) {
        return;
    }

    try {
        gtag('event', eventName, {
            ...params,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('GA4 이벤트 전송 실패:', error);
    }
}

/**
 * 디바운스 함수 (중복 이벤트 방지)
 */
function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

// ⚠️ 여기에 GAS 웹앱 URL 붙여넣으세요!
const API_URL = "https://script.google.com/macros/s/AKfycbx0W0_25f135Ze2kjA7Q66d7T6Y210iXhIEBfFhdok8G1vwj5OTnQdu3P6_uFAKZNmg/exec";

// 엔터뉴스: 정적 JSON 우선 → GAS API 폴백
const NEWS_STATIC_URL = '/data/news.json';
const ENTER_NEWS_API = API_URL + "?action=getNews";

// SNS API값 → 화면 표시명 매핑 ('차오화'만 다름)
const SNS_DISPLAY = {
    '웨이보':'웨이보', '차오화':'웨이보(슈퍼챗)', '빌리빌리':'빌리빌리',
    'QQ뮤직':'QQ뮤직', 'X(트위터)':'X(트위터)', '유튜브':'유튜브', '스포티파이':'스포티파이',
    '인스타그램':'인스타그램'
};

/**
 * 현재 표시 중인 페이지 ID 반환
 */
function getCurrentPageId() {
    const sections = document.querySelectorAll('.page-section');
    for (const section of sections) {
        if (!section.classList.contains('d-none')) {
            return section.id.replace('page-', '');
        }
    }
    return 'home';
}

// 전역 캐시 변수
let cachedData = [];         // 현재 표시 중인 필터의 데이터 저장
let cachedMonths = [];       // 사용 가능한 월 목록
let metadataCache = {};      // 아이돌 메타데이터 캐시 {name_gender: {data}}
let staticDataCache = null;  // 정적 JSON 전체 메모리 캐시 (version 2: 전 조합 포함)

// ========================================
// 📦 정적 JSON 데이터 캐시 (API 대체)
// ========================================
let fullSnsCache = {};       // 전체 SNS 데이터 캐시 { '남자': snsData, '여자': snsData }
let fullMetadataCache = {};  // 정적 메타데이터 JSON 캐시 { '남자': data, '여자': data }

/**
 * 전체 SNS JSON 로드 (성별당 1회만 fetch, 이후 메모리 캐시)
 * 파일 구조: { version:3, gender, snsList, data: { "웨이보": { months:[], records:[] }, ... } }
 * @param {string} gender - '남자' 또는 '여자'
 * @returns {Promise<Object|null>} SNS 데이터 또는 null
 */
async function loadFullSnsData(gender) {
    // 이미 메모리에 캐시되어 있으면 즉시 반환
    if (fullSnsCache[gender]) return fullSnsCache[gender];

    const fileName = gender === '남자' ? 'sns-male.json' : 'sns-female.json';
    try {
        const response = await fetch(`/data/${fileName}`);
        if (!response.ok) return null; // 파일이 없으면 null

        const data = await response.json();
        fullSnsCache[gender] = data; // 메모리 캐시 저장

        // 통계 로그
        const snsList = Object.keys(data.data);
        const totalRecords = snsList.reduce((sum, sns) => sum + (data.data[sns].records ? data.data[sns].records.length : 0), 0);
        console.log(`📦 전체 SNS 데이터 로드 완료 (${gender}): ${totalRecords}건, ${snsList.length} SNS`);
        return data;
    } catch (e) {
        console.warn(`전체 SNS 데이터 로드 실패 (${gender}):`, e);
        return null;
    }
}

/**
 * 정적 JSON에서 특정 월 데이터 추출
 * @param {string} gender - '남자' 또는 '여자'
 * @param {string} sns - SNS 이름 (예: '웨이보')
 * @param {string} month - 월 (예: '2026-01')
 * @returns {Promise<Array|null>} 데이터 배열 또는 null
 */
async function getStaticMonthData(gender, sns, month) {
    const snsData = await loadFullSnsData(gender);
    if (!snsData || !snsData.data || !snsData.data[sns]) return null;

    const snsGroup = snsData.data[sns];

    // 해당 월이 데이터에 없으면 null
    if (snsGroup.months && !snsGroup.months.includes(month)) return null;

    // records에서 해당 월 필터링
    const filtered = snsGroup.records.filter(r => r.date === month);
    return filtered.length > 0 ? filtered : null;
}

/**
 * 정적 JSON에서 해당 SNS의 전체 월 목록 반환
 * @param {string} gender - '남자' 또는 '여자'
 * @param {string} sns - SNS 이름
 * @returns {Array<string>} 월 목록 배열
 */
function getStaticMonths(gender, sns) {
    const data = fullSnsCache[gender];
    if (!data || !data.data || !data.data[sns]) return [];
    return data.data[sns].months || [];
}

/**
 * 정적 JSON 데이터 로드 (즉시 렌더링용)
 * version 2: 전체 성별/SNS 조합 지원 (16개 조합)
 * version 1: 기존 남자/웨이보만 지원 (하위 호환)
 * @param {string} gender - '남자' 또는 '여자'
 * @param {string} sns - SNS 이름 (예: '웨이보', '빌리빌리')
 * @returns {Promise<Object|null>} - { meta, data } 또는 null
 */
async function loadStaticInitialData(gender, sns) {
    try {
        // 메모리 캐시에 있으면 fetch 생략
        if (!staticDataCache) {
            const response = await fetch('/data/initial-data.json');
            if (!response.ok) return null;
            staticDataCache = await response.json();
        }

        const data = staticDataCache;

        // 데이터 신선도 확인 (45일 이상 오래되면 무시)
        const generated = new Date(data.generated);
        const age = Date.now() - generated.getTime();
        const MAX_AGE = 45 * 24 * 60 * 60 * 1000; // 45일
        if (age > MAX_AGE) {
            console.warn('⚠️ 정적 데이터 만료됨, 전체 SNS JSON 사용');
            return null;
        }

        // version 2: 전체 조합 지원
        if (data.version === 2 && data.combinations) {
            const key = `${gender}_${sns}`;
            const combo = data.combinations[key];
            if (!combo || !combo.data || combo.data.length === 0) {
                console.warn(`⚠️ 정적 데이터에 ${key} 조합 없음`);
                return null;
            }
            // 기존 인터페이스와 동일한 형태로 반환
            return { meta: combo.meta, data: combo.data };
        }

        // version 1 (하위 호환): 남자/웨이보만 지원
        if (data.meta && data.data && data.data.length > 0) {
            if (gender === data.meta.gender && sns === data.meta.sns) {
                return data;
            }
            return null; // 요청한 조합이 v1 데이터와 불일치
        }

        console.warn('⚠️ 정적 데이터가 비어있음, 전체 SNS JSON 사용');
        return null;
    } catch (e) {
        console.warn('정적 데이터 로드 실패:', e);
        return null;
    }
}

// 초기 로드 (정적 JSON만 사용: initial-data.json → sns-{gender}.json)
async function loadData(isInit = true) {
    console.log("⚡ Loading data...");

    const gender = document.getElementById('gender').value;
    const sns = document.getElementById('sns').value;

    // gender나 sns가 변경되면 기존 메모리 캐시 초기화
    if (window.currentFilter &&
        (window.currentFilter.gender !== gender || window.currentFilter.sns !== sns)) {
        console.log('Filter changed, clearing memory cache');
        cachedData = [];
    }

    // 현재 필터 저장
    window.currentFilter = { gender, sns };

    // 🚀 0단계: initial-data.json에서 즉시 로드 (모든 성별/SNS 조합 지원)
    if (isInit) {
        const staticData = await loadStaticInitialData(gender, sns);
        if (staticData) {
            console.log(`⚡⚡⚡ 정적 데이터 즉시 로드! (${gender}/${sns})`);

            cachedData = staticData.data;
            cachedMonths = staticData.meta.allMonths;

            updateMonthOptions(cachedMonths);
            document.getElementById('month').value = staticData.meta.latestMonth;
            document.getElementById('monthDropdown').innerHTML = formatYearMonth(staticData.meta.latestMonth);

            // 즉시 렌더링 (0.1초 이내!)
            renderList(staticData.meta.latestMonth);

            // 메타데이터 정적 JSON 로드 시작
            prefetchTopIdolsMetadata(gender);

            showLoading(false);

            // 백그라운드에서 전체 SNS 데이터 로드 (모든 월 접근 가능하게)
            setTimeout(() => loadFullSnsDataInBackground(gender, sns), 100);
            return;
        }
    }

    // 🚀 1단계: initial-data.json 실패 시 → 전체 SNS JSON에서 직접 로드
    showLoading(true);

    try {
        const snsData = await loadFullSnsData(gender);
        if (snsData && snsData.data && snsData.data[sns]) {
            const snsGroup = snsData.data[sns];
            cachedMonths = snsGroup.months || [];

            updateMonthOptions(cachedMonths);

            // 최신 월 데이터 추출
            if (cachedMonths.length > 0) {
                const latestMonth = cachedMonths[cachedMonths.length - 1];
                const prevMonth = cachedMonths.length > 1 ? cachedMonths[cachedMonths.length - 2] : null;

                // 최신 월 + 전월 데이터를 cachedData에 저장
                const latestData = snsGroup.records.filter(r => r.date === latestMonth);
                const prevData = prevMonth ? snsGroup.records.filter(r => r.date === prevMonth) : [];
                cachedData = [...latestData, ...prevData];

                document.getElementById('month').value = latestMonth;
                document.getElementById('monthDropdown').innerHTML = formatYearMonth(latestMonth);

                renderList(latestMonth);
                prefetchTopIdolsMetadata(gender);
            }
        } else {
            console.error('정적 JSON 데이터를 찾을 수 없습니다.');
            document.getElementById('result-area').innerHTML =
                '<div class="text-center py-5 text-muted">데이터를 불러올 수 없습니다. 잠시 후 다시 시도해주세요.</div>';
        }
    } catch (error) {
        console.error("Error loading data:", error);
        document.getElementById('result-area').innerHTML =
            '<div class="text-center py-5 text-muted">데이터 로딩 중 오류가 발생했습니다.</div>';
    } finally {
        showLoading(false);

        // 링크/뉴스 프리페칭 (정적 JSON 로드와 무관하게 시작)
        setTimeout(() => prefetchLinksData(), 5000);
        setTimeout(() => prefetchEnterNews(), 7000);
    }
}

// 특정 월 데이터 로드 (정적 JSON에서 조회)
async function loadSpecificMonth(month) {
    const gender = document.getElementById('gender').value;
    const sns = document.getElementById('sns').value;

    // 정적 JSON에서 데이터 조회
    const monthData = await getStaticMonthData(gender, sns, month);
    if (monthData && monthData.length > 0) {
        console.log(`📦 정적 JSON에서 로드: ${month} (${monthData.length}건)`);

        // 전월 데이터도 로드 (증감률 계산용)
        const monthIndex = cachedMonths.indexOf(month);
        const prevMonth = monthIndex > 0 ? cachedMonths[monthIndex - 1] : null;
        if (prevMonth) {
            const prevData = await getStaticMonthData(gender, sns, prevMonth);
            if (prevData) {
                cachedData = cachedData.filter(d => d.date !== prevMonth);
                cachedData.push(...prevData);
            }
        }

        // 해당 월 데이터 캐시 업데이트 + 렌더링
        cachedData = cachedData.filter(d => d.date !== month);
        cachedData.push(...monthData);
        renderList(month);
        showLoading(false);
    } else {
        console.warn(`정적 JSON에 ${month} 데이터가 없습니다.`);
        document.getElementById('result-area').innerHTML =
            '<div class="text-center py-5 text-muted">해당 월의 데이터가 없습니다.</div>';
        showLoading(false);
    }
}

/**
 * 백그라운드에서 전체 SNS 데이터 로드 (정적 JSON)
 * initial-data.json으로 즉시 렌더링 후, 전체 데이터를 로드하여 모든 월 접근 가능하게 함
 * @param {string} gender - 성별
 * @param {string} sns - 현재 선택된 SNS
 */
async function loadFullSnsDataInBackground(gender, sns) {
    console.log('📥 전체 SNS 데이터 백그라운드 로드 중...');

    try {
        const snsData = await loadFullSnsData(gender);
        if (snsData && snsData.data && snsData.data[sns]) {
            const snsGroup = snsData.data[sns];

            // 월 목록 업데이트 (전체 JSON이 initial-data.json보다 최신일 수 있음)
            if (snsGroup.months && snsGroup.months.length > cachedMonths.length) {
                cachedMonths = snsGroup.months;
                updateMonthOptions(cachedMonths);
            }

            // 현재 표시 중인 월의 전체 데이터로 re-render (Top30 → 전체 아이돌)
            const currentMonth = document.getElementById('month').value;
            const fullMonthData = snsGroup.records.filter(r => r.date === currentMonth);

            if (fullMonthData.length > 0) {
                // 전월 데이터도 로드 (증감률 계산용)
                const monthIndex = cachedMonths.indexOf(currentMonth);
                const prevMonth = monthIndex > 0 ? cachedMonths[monthIndex - 1] : null;
                const prevData = prevMonth ? snsGroup.records.filter(r => r.date === prevMonth) : [];

                cachedData = [...fullMonthData, ...prevData];
                renderList(currentMonth);
            }

            console.log(`✅ 전체 SNS 데이터 로드 완료 (${gender}/${sns})`);
        }

        // 메타데이터 정적 JSON 로드 시작
        loadStaticMetadata(gender);

        // 링크/뉴스 프리페칭 (정적 JSON 로드 완료 후)
        setTimeout(() => prefetchLinksData(), 5000);
        setTimeout(() => prefetchEnterNews(), 7000);

    } catch (error) {
        console.warn('전체 SNS 데이터 백그라운드 로드 실패:', error);
    }
}


document.addEventListener('DOMContentLoaded', () => {
    // SEO 정적 콘텐츠 숨기기 (JS 실행 확인 = 실제 사용자)
    const seoStatic = document.getElementById('seo-static-content');
    if (seoStatic) seoStatic.style.display = 'none';

    // 필터 변경 시 초기화 로드
    document.getElementById('gender').addEventListener('change', () => loadData(true));
    document.getElementById('sns').addEventListener('change', () => loadData(true));
    document.getElementById('month').addEventListener('change', handleMonthChange);

    // 검색 입력 시 필터링 및 GA4 추적
    const searchInput = document.getElementById('searchInput');

    // GA4 검색 이벤트 추적 (1초 디바운스)
    const debouncedSearch = debounce((searchTerm) => {
        if (searchTerm.length >= 2) {
            trackEvent('search', {
                search_term: searchTerm,
                current_gender: document.getElementById('gender').value,
                current_sns: document.getElementById('sns').value,
                event_category: 'engagement'
            });
        }
    }, 1000);

    searchInput.addEventListener('input', function () {
        const term = this.value.trim();

        // GA4 이벤트 전송 (디바운스)
        debouncedSearch(term);

        // 기존 필터링 로직
        const currentMonth = document.getElementById('month').value;
        if (currentMonth) {
            renderList(currentMonth);
        }
    });

    // ★ 초기 URL 파싱: URL path에 맞는 페이지 표시 (SPA 라우팅)
    const currentPath = window.location.pathname;
    const initialPageId = getPageIdFromPath(currentPath);
    const urlParams = parseUrlParams(currentPath);

    if (initialPageId !== 'home') {
        // /news, /jobs 등 직접 접근 시 해당 페이지 표시
        route(initialPageId, false); // pushState 안 함 (이미 올바른 URL)
    } else if (urlParams.idolSlug) {
        // /idol/{slug} 접근 → 랭킹 페이지 표시 후 모달 열기
        loadData(true).then(() => {
            // cachedData에서 아이돌 검색
            const idol = findIdolBySlug(urlParams.idolSlug);
            if (idol) {
                // 약간의 딜레이 후 모달 열기 (렌더링 완료 대기)
                setTimeout(() => showIdolModal(idol.name, idol.gender), 500);
            } else {
                console.warn(`아이돌을 찾을 수 없음: ${urlParams.idolSlug}`);
            }
        });
    } else if (urlParams.sns || urlParams.month) {
        // /ranking/{sns} 또는 /ranking/{YYMM}/{sns} 접근 → 드롭다운 자동 선택
        if (urlParams.sns) {
            document.getElementById('sns').value = urlParams.sns;
            document.getElementById('snsDropdown').innerHTML = SNS_DISPLAY[urlParams.sns] || urlParams.sns;
        }
        // 데이터 로드 (월은 데이터 로드 후 설정)
        loadData(true).then(() => {
            if (urlParams.month && cachedMonths.includes(urlParams.month)) {
                document.getElementById('month').value = urlParams.month;
                document.getElementById('monthDropdown').innerHTML = formatYearMonth(urlParams.month);
                renderList(urlParams.month);
            }
        });
    } else {
        // 기본 home 페이지 → SNS 랭킹 데이터 로드
        loadData(true);
    }
});



// 월 선택 변경 핸들러 (메모리 캐시 → 정적 JSON 순서로 조회)
async function handleMonthChange() {
    const selectedMonth = document.getElementById('month').value;
    const gender = document.getElementById('gender').value;
    const sns = document.getElementById('sns').value;

    // 현재 월의 인덱스 찾기 (전월 데이터 = 증감률 계산용)
    const monthIndex = cachedMonths.indexOf(selectedMonth);
    const baseMonth = monthIndex > 0 ? cachedMonths[monthIndex - 1] : selectedMonth;

    // ★ 1단계: 메모리 캐시 확인
    const hasCurrentMonth = cachedData.some(d => d.date === selectedMonth);
    const hasBaseMonth = cachedData.some(d => d.date === baseMonth);

    if (hasCurrentMonth && hasBaseMonth) {
        console.log(`⚡ 메모리 캐시에서 로드: ${selectedMonth}`);
        renderList(selectedMonth);
        return;
    }

    // ★ 2단계: 정적 JSON에서 로드
    console.log(`📦 정적 JSON에서 로드: ${selectedMonth}...`);
    await loadSpecificMonth(selectedMonth);
}

// 로딩 스피너 제어 (스켈레톤 UI)
function showLoading(isLoading) {
    const resultArea = document.getElementById('result-area');
    if (isLoading) {
        // 스켈레톤 카드 8개 표시 (실제 카드 모양과 유사)
        const skeletonCards = Array(8).fill(`
            <div class="col-12">
                <div class="idol-card skeleton-card" style="background: linear-gradient(90deg, #f0f0f0 25%, #e0e0e0 50%, #f0f0f0 75%); background-size: 200% 100%; animation: shimmer 1.5s infinite;">
                    <div class="rank-badge" style="background: #ddd; color: transparent;">0</div>
                    <div class="flex-grow-1 ps-2">
                        <div style="height: 20px; width: 80px; background: #ddd; border-radius: 4px; margin-bottom: 6px;"></div>
                        <div style="height: 14px; width: 120px; background: #e5e5e5; border-radius: 4px;"></div>
                    </div>
                    <div class="text-end">
                        <div style="height: 24px; width: 60px; background: #ddd; border-radius: 4px; margin-left: auto; margin-bottom: 4px;"></div>
                        <div style="height: 14px; width: 80px; background: #e5e5e5; border-radius: 4px; margin-left: auto;"></div>
                    </div>
                </div>
            </div>
        `).join('');

        // 스켈레톤 애니메이션 CSS 추가 (한 번만)
        if (!document.getElementById('skeleton-style')) {
            const style = document.createElement('style');
            style.id = 'skeleton-style';
            style.textContent = `
                @keyframes shimmer {
                    0% { background-position: -200% 0; }
                    100% { background-position: 200% 0; }
                }
                .skeleton-card {
                    pointer-events: none;
                    opacity: 0.7;
                }
            `;
            document.head.appendChild(style);
        }

        resultArea.innerHTML = skeletonCards;
    } else {
        // ✅ 로딩 완료 시 스켈레톤 카드 제거 (renderList가 새 내용으로 대체)
        const skeletonCards = resultArea.querySelectorAll('.skeleton-card');
        skeletonCards.forEach(card => card.closest('.col-12')?.remove());
    }
}


// 데이터 렌더링 (클라이언트에서 계산)
function renderList(targetMonth) {
    const listContainer = document.getElementById('result-area');

    try {
        // 현재 선택된 필터 가져오기
        const currentGender = document.getElementById('gender').value;
        const currentSns = document.getElementById('sns').value;

        // ✅ 1단계: 현재 월 데이터 존재 확인
        const currentMonthData = cachedData.filter(d => d.date === targetMonth);

        if (currentMonthData.length === 0) {
            // 캐시에 해당 월 데이터가 없다면 (백그라운드 로딩 중일 수 있음)
            console.warn(`⚠️ No data for ${targetMonth}, waiting for background load...`);
            listContainer.innerHTML = `<div class="text-center py-5"><div class="spinner-border text-secondary"></div><p class="mt-2">추가 데이터 로딩 중...</p></div>`;
            return;
        }

        // ✅ 2단계: 전체 캐시 데이터 확인
        if (!cachedData || cachedData.length === 0) {
            console.error('❌ No cached data available');
            listContainer.innerHTML = `<div class="text-center p-5 text-muted">데이터가 없습니다.</div>`;
            return;
        }

        // 비교할 기준 월 결정 (전 달)
        const targetIndex = cachedMonths.indexOf(targetMonth);
        const baseMonth = targetIndex > 0 ? cachedMonths[targetIndex - 1] : targetMonth;

        // ✅ 3단계: baseMonth 데이터 확인 (없어도 진행)
        const baseMonthData = cachedData.filter(d => d.date === baseMonth);
        const hasBaseData = baseMonthData.length > 0;

        if (!hasBaseData && targetMonth !== baseMonth) {
            console.warn(`⚠️ No base data for ${baseMonth}, rendering without trend comparison`);
        }

        console.log(`Rendering for ${targetMonth} (Base: ${baseMonth}, Base Data: ${hasBaseData ? 'Available' : 'N/A'})`);

        // 아이돌별 데이터 집계 (현재 월과 기준 월 데이터만 사용)
        const idolMap = {};

        // 현재 월 데이터만 먼저 처리 (순위 계산의 기준)
        cachedData
            .filter(item => item.date === targetMonth || item.date === baseMonth)
            .forEach(item => {
                if (!idolMap[item.name]) {
                    idolMap[item.name] = {
                        name: item.name,
                        group: item.group,
                        current: 0,
                        base: 0,
                        rank: 0, // 순위 초기화
                        logo: item.logo || 'https://via.placeholder.com/60'
                    };
                }

                if (item.date === targetMonth) idolMap[item.name].current = item.count;
                if (item.date === baseMonth) idolMap[item.name].base = item.count;
            });

        // 증감률 계산 및 정렬 (검색 필터 적용 전 전체 목록)
        const fullRankedList = Object.values(idolMap)
            .filter(item => item.current > 0 || item.base > 0)
            .map(item => {
                let growth = 0;
                let growthDisplay = '-';  // 기본값

                // 기준 월이 현재 월과 같으면 비교 불가 (첫 로딩 시)
                if (targetMonth === baseMonth || item.base === 0) {
                    growthDisplay = '-';
                } else if (item.current > 0 && item.base > 0) {
                    growth = ((item.current - item.base) / item.base) * 100;
                    growthDisplay = growth.toFixed(2);
                } else if (item.current === 0 && item.base > 0) {
                    // 목록에서 사라짐
                    growth = -100;
                    growthDisplay = '-100';
                }

                return { ...item, growthRate: growthDisplay, growthNumeric: growth };
            })
            .sort((a, b) => b.current - a.current);

        // ✅ 먼저 전체 목록에서 순위 계산 (검색 후에도 원래 순위 유지)
        fullRankedList.forEach((item, index) => {
            if (index === 0) {
                item.rank = 1;
            } else {
                const prevItem = fullRankedList[index - 1];
                if (item.current === prevItem.current) {
                    item.rank = prevItem.rank; // 동일 수치면 동일 순위
                } else {
                    item.rank = index + 1; // 다른 수치면 index + 1
                }
            }
        });

        // ✅ 검색 필터 적용
        const searchInput = document.getElementById('searchInput');
        const searchTerm = searchInput ? searchInput.value.trim().toLowerCase().replace(/\s/g, '') : '';

        let displayList;
        if (searchTerm) {
            // 검색어가 있으면: 전체 목록에서 검색 결과 표시 (순위는 이미 계산됨)
            displayList = fullRankedList.filter(item => {
                const nameNoSpace = item.name.toLowerCase().replace(/\s/g, '');
                const groupNoSpace = item.group.toLowerCase().replace(/\s/g, '');
                return nameNoSpace.includes(searchTerm) || groupNoSpace.includes(searchTerm);
            });
        } else {
            // 검색어가 없으면: Top 50만 표시
            displayList = fullRankedList.slice(0, 50);
        }

        // ✅ 렌더링 시작 전 기존 카드 모두 제거
        listContainer.innerHTML = '';

        // ✅ HTML을 배열에 수집 (성능 최적화)
        const htmlArray = [];

        displayList.forEach((item, index) => {
            // 순위는 이미 fullRankedList에서 계산됨
            const rank = item.rank;

            // 증감률이 "-"인 경우 처리
            let changeDisplay = '';
            if (item.growthRate === '-') {
                changeDisplay = `<div class="text-muted fw-bold" style="font-size:0.85rem">-</div>`;
            } else {
                const isUp = parseFloat(item.growthRate) >= 0;
                const color = isUp ? 'text-danger' : 'text-primary';
                const arrow = isUp ? '▲' : '▼';
                changeDisplay = `<div class="${color} fw-bold" style="font-size:0.85rem">${arrow} ${Math.abs(item.growthRate)}%</div>`;
            }

            const html = `
            <div class="col-12">
                <div class="idol-card" data-idol-name="${item.name}">
                    <div class="rank-badge">${rank}</div>
                    <div class="flex-grow-1 ps-2">
                        <h5 class="m-0 fw-bold">${String(item.name)}</h5>
                        <small class="text-muted">${String(item.group)}</small>
                    </div>
                    <div class="text-end">
                        <div class="fw-bold fs-5">${Number(item.current).toLocaleString()}</div>
                        <small class="text-muted" style="font-size:0.75rem">(${formatYearMonth(baseMonth)} 대비)</small>
                        ${changeDisplay}
                    </div>
                </div>
            </div>
        `;
            htmlArray.push(html);
        });

        // ✅ 한 번에 DOM에 설정
        listContainer.innerHTML = htmlArray.join('');

        // 카드 클릭 이벤트 추가
        const cards = listContainer.querySelectorAll('.idol-card');
        cards.forEach(card => {
            card.addEventListener('click', () => {
                const idolName = card.getAttribute('data-idol-name');
                showIdolModal(idolName, currentGender);
            });
        });

        console.log(`✅ Rendered ${cards.length} idol cards for ${targetMonth}`);

    } catch (error) {
        // ✅ 에러 발생 시 사용자에게 명확한 메시지 표시
        console.error('❌ Render error:', error);
        listContainer.innerHTML = `
            <div class="text-center py-5">
                <div class="alert alert-danger d-inline-block">
                    <strong>렌더링 오류</strong><br>
                    ${error.message || '데이터를 표시하는 중 오류가 발생했습니다.'}
                </div>
            </div>
        `;
    }
}


// 월 옵션 업데이트 (Bootstrap Dropdown용)
function updateMonthOptions(months) {
    const dropdownMenu = document.getElementById('monthDropdownMenu');
    const currentVal = document.getElementById('month').value;

    dropdownMenu.innerHTML = '';

    // 내림차순 정렬 (최신 월이 위로)
    [...months].reverse().forEach(month => {
        const li = document.createElement('li');
        const a = document.createElement('a');
        a.className = 'dropdown-item';
        a.href = '#';
        a.textContent = formatYearMonth(month);
        a.onclick = function () {
            updateFilter('month', month);
            return false;
        };
        li.appendChild(a);
        dropdownMenu.appendChild(li);
    });

    // 기본값 설정: 가장 최신 월
    if (!currentVal && months.length > 0) {
        const latestMonth = months[months.length - 1];
        document.getElementById('month').value = latestMonth;
        document.getElementById('monthDropdown').innerHTML = formatYearMonth(latestMonth);
    }
}

// Bootstrap Dropdown 필터 업데이트 함수
function updateFilter(type, value) {
    // GA4 이벤트 추적
    trackEvent('filter_change', {
        filter_type: type,      // 'gender', 'sns', 'month'
        filter_value: value,
        event_category: 'user_engagement'
    });

    if (type === 'gender') {
        document.getElementById('gender').value = value;
        document.getElementById('genderDropdown').innerHTML = value;
        // gender 변경 시 데이터 재로드
        loadData(true);
    } else if (type === 'sns') {
        document.getElementById('sns').value = value;
        document.getElementById('snsDropdown').innerHTML = SNS_DISPLAY[value] || value;
        // sns 변경 시 데이터 재로드
        loadData(true);
    } else if (type === 'month') {
        document.getElementById('month').value = value;
        document.getElementById('monthDropdown').innerHTML = formatYearMonth(value);
        // 월 변경 시 렌더링만
        handleMonthChange();
    }

    // ★ SNS/월 변경 시 URL도 업데이트 (SEO 라우팅)
    updateRankingUrl();
}

/**
 * 현재 SNS/월 선택 상태에 맞는 URL로 history 업데이트
 * 기본값(웨이보)이면 /ranking, 아니면 /ranking/{sns} 또는 /ranking/{YYMM}/{sns}
 */
function updateRankingUrl() {
    const sns = document.getElementById('sns').value;
    const month = document.getElementById('month').value;
    const snsSlug = SNS_SLUG_REVERSE[sns];

    // SNS 슬러그가 없으면 (매핑 안 되는 경우) /ranking 유지
    if (!snsSlug) return;

    let newPath = '/ranking';
    let newTitle = PAGE_META.home.title;
    let newDesc = PAGE_DESCRIPTIONS.home;

    if (sns !== '웨이보') {
        // 기본값이 아닌 SNS 선택 시 → /ranking/{sns}
        newPath = '/ranking/' + snsSlug;
        const snsLabel = SNS_DISPLAY[sns] || sns;
        newTitle = `${snsLabel} Ranking | AIMCONTENTS`;
        newDesc = `K-POP ${snsLabel} Follower Ranking`;
    }

    // 월이 최신월이 아닌 경우 → /ranking/{YYMM}/{sns}
    if (month && cachedMonths.length > 0 && month !== cachedMonths[cachedMonths.length - 1]) {
        const yymm = month.replace('20', '').replace('-', ''); // '2025-12' → '2512'
        newPath = '/ranking/' + yymm + '/' + snsSlug;
        const snsLabel = SNS_DISPLAY[sns] || sns;
        newTitle = `${formatYearMonth(month)} ${snsLabel} Ranking | AIMCONTENTS`;
        newDesc = `${formatYearMonth(month)} K-POP ${snsLabel} Follower Ranking`;
    }

    // URL 업데이트 (현재 경로와 다를 때만)
    if (window.location.pathname !== newPath) {
        history.pushState({ pageId: 'home', sns, month }, newTitle, newPath);
        document.title = newTitle;
        // meta description 업데이트
        document.querySelector('meta[name="description"]')?.setAttribute('content', newDesc);
        document.querySelector('meta[property="og:description"]')?.setAttribute('content', newDesc);
        document.querySelector('meta[property="og:title"]')?.setAttribute('content', newTitle);
        document.querySelector('meta[property="og:url"]')?.setAttribute('content',
            window.location.origin + newPath);
        const canonical = document.querySelector('link[rel="canonical"]');
        if (canonical) canonical.setAttribute('href', 'https://aimcontents.com' + newPath);
    }
}

function formatYearMonth(ym) {
    if (!ym) return '';
    try {
        const parts = ym.split('-');
        if (parts.length === 2) {
            const shortYear = parts[0].substring(2); // '2025' -> '25'
            const month = parseInt(parts[1]); // '11' -> 11
            return shortYear + '년' + month + '월';
        }
    } catch (e) { return ym; }
    return ym;
}

// ============================================================
// 🌐 SPA 라우팅 메타데이터
// ============================================================
const PAGE_META = {
    home:    { path: '/ranking', title: '아이돌 SNS 팔로워 순위 - 웨이보·빌리빌리·유튜브·스포티파이·인스타 | 아이엠콘텐츠' },
    comeback:{ path: '/comeback', title: 'K-POP 컴백 일정 2026 - 아이돌 컴백·데뷔 스케줄 | 아이엠콘텐츠' },
    news:    { path: '/news',    title: '엔터테인먼트 뉴스 - K-POP·드라마·엔터 업계 소식 | 아이엠콘텐츠' },
    links:   { path: '/links',   title: 'K-POP 링크 모음 - 음원·투표·팬카페·공식채널 | 아이엠콘텐츠' },
    jobs:    { path: '/jobs',    title: '엔터테인먼트 채용정보 - 기획사·매니지먼트·마케팅 | 아이엠콘텐츠' },
    vendors: { path: '/vendors', title: '엔터테인먼트 업체 DB - 제작·유통·마케팅 협력사 | 아이엠콘텐츠' },
    douyin:  { path: '/douyin',  title: '도우인(抖音) 인기 챌린지 - 중국 K-POP 트렌드 | 아이엠콘텐츠' },
    namu:    { path: '/namu',   title: '아이돌 그룹 정보 - 멤버·소속사·팬덤명·데뷔일 총정리 | 아이엠콘텐츠' },
    team:    { path: '/team',    title: 'Team | 아이엠콘텐츠' }
};

// SNS 영문 슬러그 ↔ 한글명 매핑 (URL 라우팅용)
const SNS_SLUG_MAP = {
    weibo: '웨이보', bilibili: '빌리빌리', qqmusic: 'QQ뮤직',
    twitter: 'X(트위터)', youtube: '유튜브', spotify: '스포티파이',
    chaohua: '차오화', instagram: '인스타그램'
};
// 역방향 매핑 (한글명 → 슬러그)
const SNS_SLUG_REVERSE = {};
Object.entries(SNS_SLUG_MAP).forEach(([slug, name]) => {
    SNS_SLUG_REVERSE[name] = slug;
});

/**
 * 아이돌 슬러그로 cachedData에서 이름과 성별 검색
 * 한글 이름(방탄소년단) 또는 영문 그룹명(bts) 모두 지원
 * @param {string} slug - URL 슬러그
 * @returns {{ name: string, gender: string } | null}
 */
function findIdolBySlug(slug) {
    if (!cachedData || cachedData.length === 0) return null;
    const lowerSlug = slug.toLowerCase();

    // 1. 정확한 이름 매치 (한글)
    const exact = cachedData.find(d => d.name === slug);
    if (exact) return { name: exact.name, gender: document.getElementById('gender').value };

    // 2. 그룹명 매치 (대소문자 무시)
    const groupMatch = cachedData.find(d => d.group && d.group.toLowerCase() === lowerSlug);
    if (groupMatch) return { name: groupMatch.name, gender: document.getElementById('gender').value };

    // 3. 이름에 슬러그 포함 (부분 매치)
    const partial = cachedData.find(d =>
        d.name.toLowerCase().includes(lowerSlug) ||
        (d.group && d.group.toLowerCase().includes(lowerSlug))
    );
    if (partial) return { name: partial.name, gender: document.getElementById('gender').value };

    return null;
}

// 페이지별 SEO description 매핑
const PAGE_DESCRIPTIONS = {
    home:    'K-POP 아이돌 웨이보, 빌리빌리, 유튜브, 스포티파이, 인스타그램 팔로워 순위를 월별로 비교하세요. 170개 이상 아이돌 그룹의 SNS 팔로워 수 실시간 랭킹.',
    comeback:'2026년 K-POP 아이돌 컴백·데뷔 일정을 한눈에 확인하세요. 날짜별 컴백 스케줄, 앨범 정보, 타이틀곡 미리보기.',
    news:    '엔터테인먼트 업계 최신 뉴스를 실시간으로 전달합니다. K-POP, 드라마, 기획사 동향, 아이돌 활동 소식.',
    links:   'K-POP 팬을 위한 필수 링크 모음. 음원 사이트, 투표 앱, 팬카페, 공식 SNS 채널 바로가기.',
    jobs:    '엔터테인먼트 기획사 채용정보를 모았습니다. SM, JYP, HYBE 등 주요 기획사 마케팅·매니지먼트·해외사업 포지션.',
    vendors: '엔터테인먼트 업계 협력사 데이터베이스. 앨범 제작, 음원 유통, 굿즈 제작, 공연 기획 업체 정보.',
    douyin:  '중국 도우인(抖音)에서 유행하는 K-POP 챌린지 영상을 주간 단위로 업데이트합니다. 조회수·좋아요 기준 인기 트렌드.',
    namu:    '1세대부터 5세대까지 K-POP 아이돌 173개 그룹 총정리. 멤버 구성, 소속사, 팬덤명, 데뷔일, 앨범 판매량까지 한눈에.',
    team:    'Team | 아이엠콘텐츠'
};

/**
 * 동적 meta description + OG 태그 업데이트 (SEO)
 * @param {string} pageId - 페이지 식별자
 */
function updateMetaDescription(pageId) {
    const desc = PAGE_DESCRIPTIONS[pageId];
    if (!desc) return;
    // meta description 업데이트
    document.querySelector('meta[name="description"]')?.setAttribute('content', desc);
    // OG description 업데이트
    document.querySelector('meta[property="og:description"]')?.setAttribute('content', desc);
    // OG title 업데이트
    const meta = PAGE_META[pageId];
    if (meta) {
        document.querySelector('meta[property="og:title"]')?.setAttribute('content', meta.title);
        document.querySelector('meta[property="og:url"]')?.setAttribute('content',
            window.location.origin + meta.path);
    }
    // canonical URL 업데이트
    const canonical = document.querySelector('link[rel="canonical"]');
    if (canonical && meta) {
        canonical.setAttribute('href', 'https://aimcontents.com' + meta.path);
    }
}

/**
 * URL path → pageId 매핑 (SPA 라우팅용)
 * 지원 패턴:
 *   /ranking          → home (기본)
 *   /ranking/weibo    → home + SNS 자동 선택
 *   /ranking/2512/weibo → home + 월 + SNS 자동 선택
 *   /idol/bts         → home + 아이돌 모달 자동 열기
 * @param {string} path - URL pathname
 * @returns {string} pageId
 */
function getPageIdFromPath(path) {
    // 기본 페이지 매핑
    const map = {
        '/': 'home', '/ranking': 'home',
        '/comeback': 'comeback', '/news': 'news',
        '/links': 'links', '/jobs': 'jobs',
        '/vendors': 'vendors', '/douyin': 'douyin', '/namu': 'namu', '/namuwiki': 'namu', '/team': 'team'
    };
    if (map[path]) return map[path];

    // /ranking/{sns} 또는 /ranking/{YYMM}/{sns} 패턴
    if (path.startsWith('/ranking/')) return 'home';

    // /idol/{slug} 패턴
    if (path.startsWith('/idol/')) return 'home';

    // /namu/{slug} 패턴
    if (path.startsWith('/namu/')) return 'namu';

    return 'home';
}

/**
 * URL path에서 SNS/월/아이돌 파라미터 파싱
 * @param {string} path - URL pathname
 * @returns {Object} { sns, month, idolSlug }
 */
function parseUrlParams(path) {
    const result = { sns: null, month: null, idolSlug: null };

    // /ranking/{sns} 패턴 (예: /ranking/bilibili)
    const snsMatch = path.match(/^\/ranking\/([a-z]+)$/);
    if (snsMatch && SNS_SLUG_MAP[snsMatch[1]]) {
        result.sns = SNS_SLUG_MAP[snsMatch[1]];
        return result;
    }

    // /ranking/{YYMM}/{sns} 패턴 (예: /ranking/2512/bilibili)
    const monthSnsMatch = path.match(/^\/ranking\/(\d{4})\/([a-z]+)$/);
    if (monthSnsMatch) {
        const yymm = monthSnsMatch[1]; // 예: '2512'
        const snsSlug = monthSnsMatch[2];
        if (SNS_SLUG_MAP[snsSlug]) {
            // YYMM → YYYY-MM 변환 (예: '2512' → '2025-12')
            result.month = '20' + yymm.substring(0, 2) + '-' + yymm.substring(2, 4);
            result.sns = SNS_SLUG_MAP[snsSlug];
        }
        return result;
    }

    // /idol/{slug} 패턴 (예: /idol/bts, /idol/세븐틴)
    const idolMatch = path.match(/^\/idol\/(.+)$/);
    if (idolMatch) {
        result.idolSlug = decodeURIComponent(idolMatch[1]);
        return result;
    }

    return result;
}

/**
 * SPA 라우팅 함수 (페이지 전환 + URL 변경 + SEO 메타 업데이트)
 * @param {string} pageId - 표시할 페이지 ID
 * @param {boolean} pushState - true면 history.pushState 실행 (기본값: true)
 */
function route(pageId, pushState = true) {
    // 섹션 토글 (d-none으로 숨김/표시)
    document.querySelectorAll('.page-section').forEach(el => el.classList.add('d-none'));
    document.getElementById('page-' + pageId).classList.remove('d-none');

    // nav active 상태 업데이트 (pageId 기반으로 안정적 매칭)
    document.querySelectorAll('.nav-link').forEach(el => {
        el.classList.remove('active');
        const onclick = el.getAttribute('onclick') || '';
        if (onclick.includes("'" + pageId + "'")) {
            el.classList.add('active');
        }
    });

    // 모바일 메뉴 닫기
    const navbarCollapse = document.getElementById('navbarNav');
    if (navbarCollapse && navbarCollapse.classList.contains('show')) {
        const bsCollapse = new bootstrap.Collapse(navbarCollapse, {
            toggle: false
        });
        bsCollapse.hide();
    }

    // ============================================================
    // 🌐 URL 변경 + SEO 메타 업데이트 + GA4 전송
    // ============================================================
    const meta = PAGE_META[pageId];
    if (meta) {
        // 브라우저 탭 제목 변경
        document.title = meta.title;

        // ★ URL 주소 변경 (history.pushState)
        if (pushState) {
            history.pushState({ pageId: pageId }, meta.title, meta.path);
        }

        // ★ SEO: meta description + OG 태그 동적 업데이트
        updateMetaDescription(pageId);

        // GA4 가상 페이지뷰 전송
        if (typeof gtag === 'function') {
            gtag('event', 'page_view', {
                page_title: meta.title,
                page_path: meta.path,
                page_location: window.location.origin + meta.path
            });
            console.log(`[GA4 PageView] ${meta.title} (${meta.path})`);
        }
    }

    // 각 페이지별 데이터 자동 로딩
    if (pageId === 'home' && cachedData.length === 0) loadData(true); // SNS 랭킹 데이터 로드
    if (pageId === 'news') loadEnterNews();
    if (pageId === 'links') loadLinks();
    if (pageId === 'jobs') loadJobs();
    if (pageId === 'vendors') loadVendors();
    if (pageId === 'douyin') loadDouyinChallenges();
    if (pageId === 'namu') loadNamu();
}

// ★ 브라우저 뒤로가기/앞으로가기 처리
window.addEventListener('popstate', (event) => {
    const pageId = event.state?.pageId || getPageIdFromPath(window.location.pathname);

    // SNS/월 상태 복원 (history state에 저장된 경우)
    if (event.state?.sns) {
        document.getElementById('sns').value = event.state.sns;
        document.getElementById('snsDropdown').innerHTML = SNS_DISPLAY[event.state.sns] || event.state.sns;
    }
    if (event.state?.month) {
        document.getElementById('month').value = event.state.month;
        document.getElementById('monthDropdown').innerHTML = formatYearMonth(event.state.month);
    }

    route(pageId, false); // pushState=false (history 중복 방지)
});

// ========================================
// 🚀 예측 프리로딩 (Predictive Preloading)
// ========================================

// 유틸: sleep 함수
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// ========================================
// 📊 아이돌 상세 모달
// ========================================

// SNS 로고 매핑
const SNS_LOGOS = {
    'weibo': 'https://www.weibo.com/favicon.ico',
    'chaohua': 'https://www.weibo.com/favicon.ico',
    'x': 'https://abs.twimg.com/favicons/twitter.ico',
    'bilibili': 'https://www.bilibili.com/favicon.ico',
    'youtube': 'https://www.youtube.com/s/desktop/e618e1bf/img/favicon_32x32.png',
    'qqmusic': 'https://y.qq.com/favicon.ico',
    'spotify': 'https://www.spotify.com/favicon.ico',
    'instagram': 'https://www.instagram.com/static/images/ico/favicon-192.png/68d99ba29cc8.png'
};

// SNS 이름 매핑
const SNS_NAMES = {
    'weibo_link': { label: '웨이보', key: 'weibo' },
    'weibo_superchat_link': { label: '차오화', key: 'chaohua' },
    'x_link': { label: 'X', key: 'x' },
    'bilibili_link': { label: '빌리빌리', key: 'bilibili' },
    'youtube_link': { label: '유튜브', key: 'youtube' },
    'qqmusic_link': { label: 'QQ뮤직', key: 'qqmusic' },
    'spotify_link': { label: '스포티파이', key: 'spotify' },
    'instagram_link': { label: '인스타그램', key: 'instagram' }
};

// ========================================
// 🚀 메타데이터 프리페칭 (Zero Latency)
// ========================================

/**
 * 정적 메타데이터 JSON 로드 (성별당 1회만 fetch, 이후 메모리 캐시)
 * 파일 구조: { generated, gender, data: [{name, group, gender, label, debut_year, namu_wiki, SNS링크들, note}] }
 * @param {string} gender - '남자' 또는 '여자'
 * @returns {Promise<Object|null>} 메타데이터 객체 또는 null
 */
async function loadStaticMetadataJSON(gender) {
    // 이미 메모리에 캐시되어 있으면 즉시 반환
    if (fullMetadataCache[gender]) return fullMetadataCache[gender];

    const fileName = gender === '남자' ? 'metadata-male.json' : 'metadata-female.json';
    try {
        const response = await fetch(`/data/${fileName}`);
        if (!response.ok) return null; // 파일이 없으면 null

        const jsonData = await response.json();
        fullMetadataCache[gender] = jsonData; // 메모리 캐시 저장

        // 개별 아이돌 메타데이터를 metadataCache에 분배 (즉시 접근 가능하게)
        if (jsonData.data && Array.isArray(jsonData.data)) {
            jsonData.data.forEach(item => {
                const key = `${item.name}_${gender}`;
                metadataCache[key] = item;
            });
            console.log(`📦 메타데이터 로드 완료 (${gender}): ${jsonData.data.length}명`);
        }

        return jsonData;
    } catch (e) {
        console.warn(`메타데이터 로드 실패 (${gender}):`, e);
        return null;
    }
}

/**
 * 메타데이터 정적 JSON 백그라운드 로드 (양쪽 성별)
 * @param {string} currentGender - 현재 선택된 성별 (우선 로드)
 */
async function loadStaticMetadata(currentGender) {
    console.log("🚀 메타데이터 정적 JSON 로드 시작...");

    // 1. 현재 성별 우선 로드
    await loadStaticMetadataJSON(currentGender);

    // 2. 반대 성별 로드
    const oppositeGender = currentGender === '남자' ? '여자' : '남자';
    await loadStaticMetadataJSON(oppositeGender);

    console.log("✅ 메타데이터 정적 JSON 로드 완료 (양쪽 성별)");
}

/**
 * 현재 화면 Top 10 아이돌 메타데이터 우선 로드 (Zero Latency)
 * 정적 JSON에서 즉시 추출하거나, 아직 로드 안 됐으면 전체 JSON 로드
 * @param {string} gender - 성별
 */
async function prefetchTopIdolsMetadata(gender) {
    // 이미 정적 메타데이터가 로드되어 있으면 아무것도 안 함 (이미 metadataCache에 분배됨)
    if (fullMetadataCache[gender]) {
        console.log(`⚡ 메타데이터 이미 로드됨 (${gender}), 스킵`);
        return;
    }

    // 아직 로드 안 됐으면 정적 JSON 전체 로드 (개별 API 호출 대신)
    await loadStaticMetadataJSON(gender);
}

// 아이돌 상세 모달 표시 (Optimistic UI)
async function showIdolModal(name, gender) {
    const cacheKey = `${name}_${gender}`;
    let data;

    // GA4 이벤트 추적
    trackEvent('idol_view', {
        idol_name: name,
        idol_gender: gender,
        current_sns: document.getElementById('sns').value,
        current_month: document.getElementById('month').value,
        event_category: 'content_interaction'
    });

    // 0. 모달을 즉시 열기 (낙관적 UI)
    const modal = new bootstrap.Modal(document.getElementById('idolModal'));
    modal.show();

    // 로딩 상태 표시 (기존 요소 유지)
    document.getElementById('idolName').textContent = name;
    document.getElementById('idolGroup').textContent = '로딩 중...';
    document.getElementById('idolInfo').innerHTML = `<div class="spinner-border spinner-border-sm me-2"></div>로딩 중...`;

    // SNS 링크 영역 초기화
    const snsContainer = document.getElementById('snsLinks');
    snsContainer.innerHTML = '<div class="text-center py-3"><div class="spinner-border spinner-border-sm text-primary"></div></div>';

    // 1. 메모리 캐시 확인 (Zero Latency Experience)
    if (metadataCache[cacheKey]) {
        console.log(`⚡ 메타데이터 즉시 로드: ${name}`);
        data = metadataCache[cacheKey];
    } else {
        // 2. 캐시 미스 → 정적 JSON 전체 로드 후 재확인
        console.log(`📦 메타데이터 정적 JSON 로드: ${name} (${gender})`);
        try {
            await loadStaticMetadataJSON(gender);
            data = metadataCache[cacheKey] || null;

            if (!data) {
                console.warn(`메타데이터 없음: ${name} (${gender})`);
                snsContainer.innerHTML = `<div class="alert alert-warning">해당 아이돌의 메타데이터가 없습니다.</div>`;
                return;
            }
        } catch (error) {
            console.error('메타데이터 로드 실패:', error);
            snsContainer.innerHTML = `<div class="alert alert-danger">데이터 로딩 중 오류가 발생했습니다.</div>`;
            return;
        }
    }

    if (data) {
        renderIdolModal(data, name);
    }
}

// 모달 UI 렌더링 분리
function renderIdolModal(data, name) {
    // 기본 정보
    document.getElementById('idolName').textContent = data.name || name;
    document.getElementById('idolGroup').textContent = data.group || '-';

    const labelText = data.label || '-';
    const debutText = data.debut_year ? data.debut_year + '년 데뷔' : '';
    document.getElementById('idolInfo').textContent =
        debutText ? `${labelText} • ${debutText}` : labelText;

    // 나무위키
    const namuSection = document.getElementById('namuWikiSection');
    const namuLink = document.getElementById('namuWikiLink');
    if (data.namu_wiki && data.namu_wiki.trim() !== '') {
        namuLink.href = data.namu_wiki;
        namuSection.style.display = 'block';
    } else {
        namuSection.style.display = 'none';
    }

    // SNS 링크
    const snsContainer = document.getElementById('snsLinks');
    snsContainer.innerHTML = '';

    let hasSnsLinks = false;
    Object.entries(SNS_NAMES).forEach(([key, info]) => {
        const url = data[key];
        if (url && url.trim() !== '') {
            const btn = createSnsButton(info.label, url, info.key);
            snsContainer.appendChild(btn);
            hasSnsLinks = true;
        }
    });

    if (!hasSnsLinks) {
        snsContainer.innerHTML = `<small class="text-muted">등록된 SNS 링크가 없습니다.</small>`;
    }

    // 메모
    const noteSection = document.getElementById('noteSection');
    const noteText = document.getElementById('idolNote');
    if (data.note && data.note.trim() !== '') {
        noteText.textContent = data.note;
        noteSection.style.display = 'block';
    } else {
        noteSection.style.display = 'none';
    }

    // 모달은 이미 showIdolModal에서 열렸으므로 여기서는 열지 않음
}

// SNS 버튼 생성
function createSnsButton(label, url, logoKey) {
    const a = document.createElement('a');
    a.href = url;
    a.target = '_blank';
    a.className = 'sns-icon-btn';
    a.rel = 'noopener noreferrer'; // 보안

    // GA4 클릭 이벤트 추적
    a.addEventListener('click', () => {
        trackEvent('sns_link_click', {
            sns_platform: label,
            link_url: url,
            event_category: 'outbound_link'
        });
    });

    const img = document.createElement('img');
    img.src = SNS_LOGOS[logoKey];
    img.alt = label;
    img.onerror = () => { img.style.display = 'none'; }; // 로고 로드 실패 시 숨김

    a.appendChild(img);
    a.appendChild(document.createTextNode(label));

    return a;
}

// ========================================
// 📰 엔터뉴스 기능
// ========================================

// 뉴스 데이터 메모리 캐시
let newsData = null;
let newsLoaded = false;
let isPrefetchingNews = false;

/**
 * 엔터뉴스 데이터 프리페칭 (7초 지연 호출)
 */
async function prefetchEnterNews() {
    // 이미 로드되었거나 프리페칭 중이면 스킵
    if (newsLoaded || isPrefetchingNews) {
        console.log('⏭️ 뉴스 프리페칭 스킵 (이미 로드됨 또는 진행 중)');
        return;
    }

    isPrefetchingNews = true;
    console.log('📰 뉴스 데이터 프리페칭 시작...');

    try {
        // 1단계: IndexedDB 캐시 확인
        const cachedNews = await getNewsCache().catch(() => null);
        if (cachedNews) {
            newsData = cachedNews;
            newsLoaded = true;
            console.log('⚡ 뉴스 프리페칭: IndexedDB 캐시 히트');
            return;
        }

        // 2단계: 정적 JSON 로드 (HTTP 캐시 우회)
        try {
            const staticRes = await fetch(`${NEWS_STATIC_URL}?v=${Date.now()}`, { cache: 'no-store' });
            if (staticRes.ok) {
                const data = await staticRes.json();
                if (data && data.length > 0) {
                    newsData = data;
                    newsLoaded = true;
                    await saveNewsCache(data);
                    console.log('✅ 뉴스 프리페칭: 정적 JSON 로드 완료');
                    return;
                }
            }
        } catch (e) {
            console.warn('정적 JSON 로드 실패, GAS API 폴백:', e);
        }

        // 3단계: GAS API 폴백
        if (!ENTER_NEWS_API) return;
        const response = await fetch(ENTER_NEWS_API);
        if (response.ok) {
            const data = await response.json();
            newsData = data;
            newsLoaded = true;
            await saveNewsCache(data);
            console.log('✅ 뉴스 프리페칭: GAS API 폴백 완료');
        }
    } catch (error) {
        console.warn('뉴스 프리페칭 실패:', error);
    } finally {
        isPrefetchingNews = false;
    }
}

/**
 * 엔터뉴스 데이터 로드 (IndexedDB 캐시 우선)
 */
async function loadEnterNews() {
    const loadingEl = document.getElementById('newsLoading');
    const containerEl = document.getElementById('newsContainer');

    // 메모리 캐시 사용 (프리페칭 후)
    if (newsLoaded && newsData) {
        console.log('✅ 뉴스 데이터 메모리 캐시 사용');
        renderEnterNews(newsData);
        // 백그라운드 업데이트
        updateNewsInBackground();
        return;
    }

    loadingEl.style.display = 'block';
    containerEl.style.display = 'none';

    try {
        // 🚀 1단계: IndexedDB 캐시 확인
        const cachedNews = await getNewsCache().catch(() => null);

        if (cachedNews) {
            console.log('⚡ IndexedDB 뉴스 캐시 히트!');
            newsData = cachedNews;
            newsLoaded = true;
            renderEnterNews(cachedNews);

            // 백그라운드 업데이트
            updateNewsInBackground();
            return;
        }

        // 🚀 2단계: 정적 JSON 로드
        console.log('📡 뉴스 캐시 미스, 정적 JSON 로드 중...');
        let data = null;

        try {
            const staticRes = await fetch(`${NEWS_STATIC_URL}?v=${Date.now()}`, { cache: 'no-store' });
            if (staticRes.ok) {
                const staticData = await staticRes.json();
                if (staticData && staticData.length > 0) {
                    data = staticData;
                    console.log('✅ 뉴스 정적 JSON 로드 성공');
                }
            }
        } catch (e) {
            console.warn('정적 JSON 로드 실패:', e);
        }

        // 🚀 3단계: 정적 JSON 실패 시 GAS API 폴백
        if (!data) {
            console.log('📡 GAS API 폴백 호출 중...');
            const response = await fetch(ENTER_NEWS_API);
            if (!response.ok) {
                throw new Error('네트워크 응답 오류');
            }
            data = await response.json();
        }

        newsData = data;
        newsLoaded = true;

        // IndexedDB에 저장
        saveNewsCache(data).catch(err => {
            console.warn('뉴스 캐시 저장 실패:', err);
        });

        renderEnterNews(data);

        trackEvent('enter_news_load', {
            news_count: data.length
        });

    } catch (error) {
        console.error('엔터뉴스 로드 실패:', error);
        containerEl.innerHTML = `
            <div class="col-12">
                <div class="alert alert-danger">
                    뉴스를 불러오는데 실패했습니다. 
                    <button class="btn btn-sm btn-outline-danger ms-2" onclick="loadEnterNews()">다시 시도</button>
                </div>
            </div>
        `;
        loadingEl.style.display = 'none';
        containerEl.style.display = 'block';
    }
}

/**
 * 백그라운드에서 뉴스 데이터 업데이트
 */
async function updateNewsInBackground() {
    console.log('📥 백그라운드에서 뉴스 데이터 업데이트 중...');

    // 뉴스 페이지가 현재 보이는 상태면 새 데이터로 다시 렌더
    const rerenderIfVisible = (data) => {
        const pageEl = document.getElementById('page-news');
        if (pageEl && !pageEl.classList.contains('d-none')) {
            renderEnterNews(data);
        }
    };

    try {
        // 정적 JSON 우선 시도 (HTTP 캐시 우회를 위해 캐시버스터 추가)
        const staticRes = await fetch(`${NEWS_STATIC_URL}?v=${Date.now()}`, { cache: 'no-store' });
        if (staticRes.ok) {
            const data = await staticRes.json();
            if (data && data.length > 0) {
                await saveNewsCache(data);
                newsData = data;
                rerenderIfVisible(data);
                console.log('✅ 뉴스 백그라운드 업데이트 완료 (정적 JSON)');
                return;
            }
        }
    } catch (e) {
        console.warn('정적 JSON 백그라운드 로드 실패:', e);
    }

    // GAS API 폴백
    try {
        const response = await fetch(ENTER_NEWS_API);
        if (response.ok) {
            const data = await response.json();
            await saveNewsCache(data);
            newsData = data;
            rerenderIfVisible(data);
            console.log('✅ 뉴스 백그라운드 업데이트 완료 (GAS API)');
        }
    } catch (error) {
        console.warn('뉴스 백그라운드 업데이트 실패:', error);
    }
}

/**
 * 엔터뉴스 렌더링
 */
function renderEnterNews(newsData) {
    const containerEl = document.getElementById('newsContainer');
    const loadingEl = document.getElementById('newsLoading');

    containerEl.innerHTML = '';

    if (!newsData || newsData.length === 0) {
        containerEl.innerHTML = `
            <div class="col-12">
                <div class="alert alert-info">표시할 뉴스가 없습니다.</div>
            </div>
        `;
        loadingEl.style.display = 'none';
        containerEl.style.display = 'block';
        return;
    }

    // 셔플 전, 데이터셋 내 가장 최신 collectTime을 업데이트 시간으로 표시
    const latestCollect = newsData
        .map(n => n.collectTime)
        .filter(Boolean)
        .sort()
        .pop();
    if (latestCollect) {
        const updateTime = new Date(latestCollect);
        document.getElementById('newsUpdateTime').textContent =
            updateTime.toLocaleString('ko-KR', {
                month: 'long',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit'
            });
    }

    // 매 렌더링마다 랜덤 셔플 (Fisher-Yates)
    const shuffled = [...newsData];
    for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    newsData = shuffled;

    newsData.forEach((news, index) => {
        const col = document.createElement('div');
        col.className = 'col-12';

        const card = document.createElement('div');
        card.className = 'card border-0 shadow-sm news-card';
        card.style.cursor = 'pointer';
        card.onclick = () => {
            window.open(news.link, '_blank');
            trackEvent('news_click', {
                news_title: news.title,
                news_keyword: news.keyword,
                news_index: index + 1
            });
        };

        const timeAgo = getTimeAgo(new Date(news.pubDate));

        card.innerHTML = `
            <div class="card-body">
                <div class="d-flex justify-content-between align-items-start mb-2">
                    <span class="badge bg-primary">${news.keyword}</span>
                </div>
                <h6 class="card-title fw-bold">${news.title}</h6>
                <p class="card-text text-muted small" style="
                    display: -webkit-box;
                    -webkit-line-clamp: 3;
                    -webkit-box-orient: vertical;
                    overflow: hidden;
                ">${news.description}</p>
                <div class="d-flex justify-content-between align-items-center mt-3">
                    <small class="text-muted">🕐 ${timeAgo}</small>
                </div>
            </div>
        `;

        col.appendChild(card);
        containerEl.appendChild(col);
    });

    loadingEl.style.display = 'none';
    containerEl.style.display = 'block';
}

/**
 * 시간 경과 표시
 */
function getTimeAgo(date) {
    if (isNaN(date.getTime())) return '날짜 없음';
    const now = new Date();
    const diff = Math.floor((now - date) / 1000);

    if (diff < 0) return '방금 전';
    if (diff < 60) return '방금 전';
    if (diff < 3600) return `${Math.floor(diff / 60)}분 전`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}시간 전`;
    if (diff < 2592000) return `${Math.floor(diff / 86400)}일 전`;
    return date.toLocaleDateString('ko-KR', { year: 'numeric', month: 'short', day: 'numeric' });
}



/**
 * 날짜 포맷 헬퍼 함수 (상대 시간 표시)
 */
function formatNewsDate(dateString) {
    const date = new Date(dateString);
    const now = new Date();
    const diff = Math.floor((now - date) / 1000 / 60); // 분 단위

    if (diff < 60) return `${diff}분 전`;
    if (diff < 1440) return `${Math.floor(diff / 60)}시간 전`;

    return date.toLocaleDateString('ko-KR', {
        month: 'short',
        day: 'numeric'
    });
}

// ========================================
// 📚 K-POP 링크 모음 페이지
// ========================================

let linksData = null;
let currentLinksCategory = null;
let linksLoaded = false;

// 카테고리 아이콘 매핑
const CATEGORY_ICONS = {
    '차트/집계': '📊',
    '소통/덕질': '💬',
    '커뮤니티': '🗣️',
    'SNS': '📱',
    '분석/랭킹': '📈'
};

// 프리페칭 플래그
let isPrefetchingLinks = false;

// 링크 데이터 프리페칭 (SNS 랭킹 로드 후 5초 지연 호출)
async function prefetchLinksData() {
    // 이미 로드되었거나 프리페칭 중이면 스킵
    if (linksLoaded || isPrefetchingLinks) {
        console.log('⏭️ 링크 프리페칭 스킵 (이미 로드됨 또는 진행 중)');
        return;
    }

    isPrefetchingLinks = true;
    console.log('🔗 링크 데이터 프리페칭 시작...');

    try {
        // IndexedDB 캐시 확인
        const cachedLinks = await getLinksCache().catch(() => null);
        if (cachedLinks) {
            linksData = cachedLinks;
            linksLoaded = true;
            console.log('⚡ 링크 프리페칭: IndexedDB 캐시 히트');
            return;
        }

        // API 호출
        const response = await fetch(`${API_URL}?action=getLinks`);
        const result = await response.json();

        if (result.status === 'success') {
            linksData = result.data;
            linksLoaded = true;

            // IndexedDB에 저장
            await saveLinksCache(linksData);
            console.log('✅ 링크 프리페칭 완료');
        }
    } catch (error) {
        console.warn('링크 프리페칭 실패:', error);
    } finally {
        isPrefetchingLinks = false;
    }
}

// 링크 데이터 로드 (IndexedDB 캐시 우선)
async function loadLinks() {
    // 이미 메모리에 로드된 경우 렌더링만 수행
    if (linksLoaded && linksData) {
        console.log('✅ 링크 데이터 메모리 캐시 사용');
        // 항상 렌더링 수행 (프리페칭 후 첫 진입 시)
        renderLinksCategories();
        const firstCategory = Object.keys(linksData)[0];
        if (firstCategory) {
            selectLinksCategory(firstCategory);
        }
        return;
    }

    const linksLoading = document.getElementById('linksLoading');
    const linksContainer = document.getElementById('linksContainer');
    const linksCategoryTabs = document.getElementById('linksCategoryTabs');

    linksLoading.style.display = 'block';
    linksContainer.innerHTML = '';
    linksCategoryTabs.innerHTML = '';

    try {
        // 🚀 1단계: IndexedDB 캐시 확인
        const cachedLinks = await getLinksCache().catch(() => null);

        if (cachedLinks) {
            console.log('⚡ IndexedDB 링크 캐시 히트!');
            linksData = cachedLinks;
            linksLoaded = true;

            // 즉시 렌더링
            renderLinksCategories();
            const firstCategory = Object.keys(linksData)[0];
            if (firstCategory) {
                selectLinksCategory(firstCategory);
            }

            linksLoading.style.display = 'none';

            // 백그라운드에서 최신 데이터 업데이트
            updateLinksInBackground();
            return;
        }

        // 🚀 2단계: IndexedDB 미스 → API 호출
        console.log('📡 링크 캐시 미스, API 호출 중...');
        const response = await fetch(`${API_URL}?action=getLinks`);
        const result = await response.json();

        if (result.status === 'success') {
            linksData = result.data;
            linksLoaded = true;

            // IndexedDB에 저장
            saveLinksCache(linksData).catch(err => {
                console.warn('링크 캐시 저장 실패:', err);
            });

            // 카테고리 탭 렌더링
            renderLinksCategories();

            // 첫 번째 카테고리 선택
            const firstCategory = Object.keys(linksData)[0];
            if (firstCategory) {
                selectLinksCategory(firstCategory);
            }

            console.log(`✅ 링크 데이터 로드 완료 (${result.updatedAt})`);

            // GA4 이벤트 추적
            if (typeof trackEvent === 'function') {
                trackEvent('links_page_load', {
                    category_count: Object.keys(linksData).length,
                    event_category: 'content_view'
                });
            }
        } else {
            throw new Error(result.message || '링크 로드 실패');
        }
    } catch (error) {
        console.error('링크 로드 실패:', error);
        linksContainer.innerHTML = `<div class="text-center text-danger py-5">링크를 불러오는데 실패했습니다.</div>`;
    } finally {
        linksLoading.style.display = 'none';
    }
}

// 백그라운드에서 링크 데이터 업데이트
async function updateLinksInBackground() {
    console.log('📥 백그라운드에서 링크 데이터 업데이트 중...');

    try {
        const response = await fetch(`${API_URL}?action=getLinks`);
        const result = await response.json();

        if (result.status === 'success') {
            // IndexedDB 업데이트
            await saveLinksCache(result.data);
            console.log('✅ 링크 캐시 백그라운드 업데이트 완료');

            // 데이터가 변경되었으면 메모리도 업데이트
            linksData = result.data;
        }
    } catch (error) {
        console.warn('링크 백그라운드 업데이트 실패:', error);
    }
}

// 카테고리 탭 렌더링
function renderLinksCategories() {
    const tabContainer = document.getElementById('linksCategoryTabs');
    if (!tabContainer || !linksData) return;

    // 카테고리 순서 정렬 (order 기준)
    const sortedCategories = Object.keys(linksData).sort((a, b) => {
        return (linksData[a].order || 0) - (linksData[b].order || 0);
    });

    tabContainer.innerHTML = sortedCategories.map(cat => `
        <button class="links-category-tab" data-category="${cat}" onclick="selectLinksCategory('${cat}')">
            ${cat}
        </button>
    `).join('');
}

// 카테고리 선택
function selectLinksCategory(category) {
    currentLinksCategory = category;

    // 탭 활성화 상태 업데이트
    document.querySelectorAll('.links-category-tab').forEach(tab => {
        tab.classList.toggle('active', tab.dataset.category === category);
    });

    // 검색창 초기화
    const searchInput = document.getElementById('linksSearchInput');
    if (searchInput) {
        searchInput.value = '';
    }

    renderLinksContent(category);

    // GA4 이벤트 추적
    if (typeof trackEvent === 'function') {
        trackEvent('links_category_select', {
            category: category,
            event_category: 'user_engagement'
        });
    }
}

// 서브카테고리 정렬 순서 (차트/집계)
const SUBCATEGORY_ORDER = {
    '차트/집계': ['음반 판매/집계', '국내 음원', '글로벌 음원']
};

// 링크 콘텐츠 렌더링
function renderLinksContent(category) {
    const container = document.getElementById('linksContainer');
    if (!container || !linksData) return;

    const categoryData = linksData[category];

    if (!categoryData || !categoryData.subcategories) {
        container.innerHTML = `<p class="text-muted text-center py-4">데이터가 없습니다.</p>`;
        return;
    }

    let html = '';

    // 서브카테고리 정렬
    let subcatEntries = Object.entries(categoryData.subcategories);
    if (SUBCATEGORY_ORDER[category]) {
        const order = SUBCATEGORY_ORDER[category];
        subcatEntries.sort((a, b) => {
            const indexA = order.indexOf(a[0]);
            const indexB = order.indexOf(b[0]);
            // 순서에 없는 항목은 맨 뒤로
            if (indexA === -1 && indexB === -1) return 0;
            if (indexA === -1) return 1;
            if (indexB === -1) return -1;
            return indexA - indexB;
        });
    }

    subcatEntries.forEach(([subcat, links]) => {
        html += `
            <div class="subcategory-section">
                <h5 class="subcategory-title">${subcat}</h5>
                <div class="links-grid">
                    ${links.map(link => createLinkCard(link)).join('')}
                </div>
            </div>
        `;
    });

    container.innerHTML = html;
}

// 링크 카드 생성
function createLinkCard(link) {
    const appButton = link.app_url
        ? `<a href="${link.app_url}" class="btn btn-outline-secondary" onclick="trackLinkClick('${link.name}', 'app')">앱</a>`
        : '';

    return `
        <div class="link-card">
            <div class="link-info">
                <h6 class="link-name">${link.name}</h6>
                <p class="link-desc">${link.description || ''}</p>
            </div>
            <div class="link-actions">
                <a href="${link.url}" target="_blank" rel="noopener" class="btn btn-primary" onclick="trackLinkClick('${link.name}', 'web')">바로가기</a>
                ${appButton}
            </div>
        </div>
    `;
}

// 링크 클릭 추적
function trackLinkClick(name, type) {
    if (typeof trackEvent === 'function') {
        trackEvent('link_click', {
            link_name: name,
            link_type: type, // 'web' or 'app'
            category: currentLinksCategory,
            event_category: 'outbound_link'
        });
    }
}

// 링크 검색
function searchLinks(term) {
    if (!term || !linksData) {
        // 검색어가 없으면 현재 카테고리 표시
        if (currentLinksCategory) {
            renderLinksContent(currentLinksCategory);
        }
        return;
    }

    const searchTerm = term.toLowerCase().replace(/\s/g, '');
    const results = [];

    Object.entries(linksData).forEach(([category, categoryData]) => {
        if (categoryData.subcategories) {
            Object.entries(categoryData.subcategories).forEach(([subcat, links]) => {
                links.forEach(link => {
                    const nameMatch = link.name.toLowerCase().replace(/\s/g, '').includes(searchTerm);
                    const descMatch = (link.description || '').toLowerCase().replace(/\s/g, '').includes(searchTerm);
                    const subcatMatch = subcat.toLowerCase().replace(/\s/g, '').includes(searchTerm);

                    if (nameMatch || descMatch || subcatMatch) {
                        results.push({ ...link, category, subcategory: subcat });
                    }
                });
            });
        }
    });

    renderLinksSearchResults(results, term);
}

// 검색 결과 렌더링
function renderLinksSearchResults(results, term) {
    const container = document.getElementById('linksContainer');
    if (!container) return;

    // 탭 활성화 해제
    document.querySelectorAll('.links-category-tab').forEach(tab => {
        tab.classList.remove('active');
    });

    if (results.length === 0) {
        container.innerHTML = `<p class="text-muted text-center py-4">"${term}"에 대한 검색 결과가 없습니다.</p>`;
        return;
    }

    container.innerHTML = `
        <div class="search-results-info">"${term}" 검색 결과: ${results.length}개</div>
        <div class="links-grid">
            ${results.map(link => createLinkCard(link)).join('')}
        </div>
    `;

    // GA4 이벤트 추적
    if (typeof trackEvent === 'function') {
        trackEvent('links_search', {
            search_term: term,
            result_count: results.length,
            event_category: 'engagement'
        });
    }
}

// 링크 검색 이벤트 리스너 설정
document.addEventListener('DOMContentLoaded', () => {
    const linksSearchInput = document.getElementById('linksSearchInput');
    if (linksSearchInput) {
        // 디바운스된 검색
        const debouncedLinksSearch = debounce(function () {
            const term = this.value.trim();
            if (term.length >= 2) {
                searchLinks(term);
            } else if (term.length === 0) {
                if (currentLinksCategory) {
                    selectLinksCategory(currentLinksCategory);
                }
            }
        }, 300);

        linksSearchInput.addEventListener('input', debouncedLinksSearch);
    }
});

// ========================================
// 💼 채용정보 기능
// ========================================

let jobsData = null;
let jobsLoaded = false;
let currentJobsCategory = 'all';
let isPrefetchingJobs = false;

/**
 * 채용정보 데이터 프리페칭
 */
async function prefetchJobsData() {
    if (jobsLoaded || isPrefetchingJobs) {
        console.log('⏭️ 채용 프리페칭 스킵');
        return;
    }

    isPrefetchingJobs = true;
    console.log('💼 채용 데이터 프리페칭 시작...');

    try {
        const cachedJobs = await getJobsCache().catch(() => null);
        if (cachedJobs) {
            jobsData = cachedJobs;
            jobsLoaded = true;
            console.log('⚡ 채용 프리페칭: IndexedDB 캐시 히트');
            return;
        }

        const response = await fetch('/data/jobs.json'); // 절대경로로 SPA 라우팅 문제 방지
        const result = await response.json();

        if (result.status === 'success') {
            // D-day 동적 계산
            result.data = computeDdays(result.data);
            jobsData = result;
            jobsLoaded = true;
            await saveJobsCache(result);
            console.log('✅ 채용 프리페칭 완료');
        }
    } catch (error) {
        console.warn('채용 프리페칭 실패:', error);
    } finally {
        isPrefetchingJobs = false;
    }
}

/**
 * 채용정보 데이터 로드
 */
async function loadJobs() {
    // 메모리 캐시 사용
    if (jobsLoaded && jobsData) {
        console.log('✅ 채용 데이터 메모리 캐시 사용');
        renderJobs(jobsData.data);
        updateJobsInBackground();
        return;
    }

    const loadingEl = document.getElementById('jobsLoading');
    const containerEl = document.getElementById('jobsContainer');

    loadingEl.style.display = 'block';
    containerEl.style.display = 'none';

    try {
        // IndexedDB 캐시 확인
        const cachedJobs = await getJobsCache().catch(() => null);

        if (cachedJobs) {
            console.log('⚡ IndexedDB 채용 캐시 히트!');
            jobsData = cachedJobs;
            jobsLoaded = true;
            renderJobs(cachedJobs.data);
            loadingEl.style.display = 'none';
            updateJobsInBackground();
            return;
        }

        // 정적 JSON 로드
        console.log('📡 채용 캐시 미스, JSON 로드 중...');
        const response = await fetch('/data/jobs.json'); // 절대경로로 SPA 라우팅 문제 방지
        const result = await response.json();

        if (result.status === 'success') {
            // D-day 동적 계산
            result.data = computeDdays(result.data);
            jobsData = result;
            jobsLoaded = true;

            saveJobsCache(result).catch(err => {
                console.warn('채용 캐시 저장 실패:', err);
            });

            renderJobs(result.data);
            console.log(`✅ 채용 데이터 로드 완료 (${result.data.length}개)`);

            if (typeof trackEvent === 'function') {
                trackEvent('jobs_page_load', {
                    job_count: result.data.length,
                    event_category: 'content_view'
                });
            }
        } else {
            throw new Error(result.message || '채용 로드 실패');
        }
    } catch (error) {
        console.error('채용 로드 실패:', error);
        containerEl.innerHTML = `<div class="col-12"><div class="alert alert-danger">채용정보를 불러오는데 실패했습니다.</div></div>`;
        containerEl.style.display = 'block';
    } finally {
        loadingEl.style.display = 'none';
    }
}

/**
 * 백그라운드에서 채용 데이터 업데이트
 */
async function updateJobsInBackground() {
    console.log('📥 백그라운드에서 채용 데이터 업데이트 중...');

    try {
        const response = await fetch('/data/jobs.json'); // 절대경로로 SPA 라우팅 문제 방지
        const result = await response.json();

        if (result.status === 'success') {
            // D-day 동적 계산
            result.data = computeDdays(result.data);
            await saveJobsCache(result);
            jobsData = result;
            console.log('✅ 채용 캐시 백그라운드 업데이트 완료');
        }
    } catch (error) {
        console.warn('채용 백그라운드 업데이트 실패:', error);
    }
}

/**
 * D-day 동적 계산 (정적 JSON에 dday 없으므로 프론트에서 계산)
 */
function computeDdays(jobs) {
    const now = new Date();
    now.setHours(0, 0, 0, 0);

    return jobs.filter(job => {
        const dl = job.deadline;
        if (!dl || dl === '상시채용') return true; // 상시채용 유지

        const deadlineDate = new Date(dl);
        deadlineDate.setHours(0, 0, 0, 0);
        const diffDays = Math.ceil((deadlineDate - now) / (1000 * 60 * 60 * 24));

        if (diffDays < 0) return false; // 만료 공고 제거

        job.dday = diffDays;
        return true;
    });
}

/**
 * 채용 카드 렌더링
 */
function renderJobs(jobs) {
    const containerEl = document.getElementById('jobsContainer');
    const loadingEl = document.getElementById('jobsLoading');

    containerEl.innerHTML = '';

    // 마감일 기준 오름차순 정렬 (마감일이 가까운 것이 먼저, 상시채용은 맨 뒤)
    const sortedJobs = [...jobs].sort((a, b) => {
        // order 필드가 둘 다 있으면 order 우선
        if (a.order && b.order) return a.order - b.order;

        // 상시채용 여부 확인
        const aIsAlways = !a.deadline || a.deadline === '상시채용';
        const bIsAlways = !b.deadline || b.deadline === '상시채용';

        // 둘 다 상시채용이면 순서 유지
        if (aIsAlways && bIsAlways) return 0;
        // 상시채용은 뒤로
        if (aIsAlways) return 1;
        if (bIsAlways) return -1;

        // 둘 다 마감일이 있으면 오름차순 정렬 (가까운 마감일 먼저)
        return new Date(a.deadline) - new Date(b.deadline);
    });

    // 필터 적용
    let filteredJobs = sortedJobs;
    if (currentJobsCategory !== 'all') {
        filteredJobs = sortedJobs.filter(job => job.category === currentJobsCategory);
    }

    if (!filteredJobs || filteredJobs.length === 0) {
        containerEl.innerHTML = `
            <div class="col-12">
                <div class="alert alert-info">
                    ${currentJobsCategory === 'all' ? '등록된 채용공고가 없습니다.' : `"${currentJobsCategory}" 분야 채용공고가 없습니다.`}
                </div>
            </div>
        `;
        loadingEl.style.display = 'none';
        containerEl.style.display = 'block';
        return;
    }

    // DocumentFragment로 묶어 DOM에 1회만 삽입 (리플로우 최소화)
    const fragment = document.createDocumentFragment();
    filteredJobs.forEach((job, index) => {
        const col = document.createElement('div');
        col.className = 'col-12 col-md-6 col-lg-4';
        col.innerHTML = createJobCard(job, index);
        fragment.appendChild(col);
    });
    containerEl.appendChild(fragment);

    loadingEl.style.display = 'none';
    containerEl.style.display = 'flex';
}

/**
 * 채용 카드 HTML 생성
 */
function createJobCard(job, index) {
    // 상시채용 여부 확인
    const isAlwaysOpen = job.deadline === '상시채용' || !job.deadline;

    // D-day 계산 및 텍스트 생성
    let ddayText = '';
    let ddayClass = 'normal';

    if (isAlwaysOpen) {
        ddayText = '상시';
        ddayClass = 'always'; // 회색 스타일
    } else if (job.dday !== undefined) {
        if (job.dday === 0) {
            ddayText = 'D-Day';
            ddayClass = 'urgent';
        } else if (job.dday > 0) {
            ddayText = `D-${job.dday}`;
            ddayClass = job.dday <= 3 ? 'urgent' : 'normal';
        } else {
            ddayText = '마감';
            ddayClass = 'expired';
        }
    }

    const isUrgent = !isAlwaysOpen && job.dday !== undefined && job.dday <= 3 && job.dday >= 0;

    const deadlineText = (job.deadline && job.deadline !== '상시채용')
        ? new Date(job.deadline).toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' })
        : (isAlwaysOpen ? '상시채용' : '');

    return `
        <div class="job-card ${isUrgent ? 'urgent' : ''}">
            <div class="job-card-header">
                <span class="job-company">${job.company || '-'}</span>
                ${ddayText ? `<span class="job-dday ${ddayClass}">${ddayText}</span>` : ''}
            </div>
            <h6 class="job-title">${job.position || '-'}</h6>
            <div class="job-info">
                <span>📍 ${job.location || '-'}</span>
                <span>👤 ${job.career || '무관'}</span>
                ${deadlineText ? `<span>📅 ${isAlwaysOpen ? '' : '~'}${deadlineText}</span>` : ''}
            </div>
            <span class="job-category-tag">${job.category || '기타'}</span>
            <div class="job-actions">
                <a href="${job.url}" target="_blank" rel="noopener" class="btn btn-primary" onclick="trackJobClick('${job.company}', '${job.position}', ${index})">
                    ${job.source || '상세보기'} 바로가기
                </a>
            </div>
        </div>
    `;
}

/**
 * 카테고리별 필터링
 */
function filterJobsByCategory(category) {
    currentJobsCategory = category;

    // 탭 활성화 상태 업데이트
    document.querySelectorAll('.jobs-category-tab').forEach(tab => {
        tab.classList.toggle('active', tab.dataset.category === category);
    });

    if (jobsData && jobsData.data) {
        renderJobs(jobsData.data);
    }

    if (typeof trackEvent === 'function') {
        trackEvent('jobs_filter', {
            category: category,
            event_category: 'user_engagement'
        });
    }
}

/**
 * 채용 클릭 추적
 */
function trackJobClick(company, position, index) {
    if (typeof trackEvent === 'function') {
        trackEvent('job_click', {
            company: company,
            position: position,
            index: index + 1,
            category: currentJobsCategory,
            event_category: 'outbound_link'
        });
    }
}

// ========================================
// 🇨🇳 도우인 챌린지 기능
// ========================================

// 도우인 GAS API URL (메인 API와 동일 프로젝트)
const DOUYIN_API_URL = API_URL;
const DOUYIN_STATIC_URL = 'data/douyin-challenges.json?v=' + Date.now();

let douyinData = null;
let douyinLoaded = false;
let isPrefetchingDouyin = false;

/**
 * 도우인 챌린지 데이터 프리페칭 (7초 지연 호출)
 * 로딩 순서: 정적 JSON → IndexedDB 캐시 → GAS API
 */
async function prefetchDouyinData() {
    if (isPrefetchingDouyin || douyinLoaded) return;
    isPrefetchingDouyin = true;

    try {
        console.log('🇨🇳 Starting Douyin challenges prefetch...');

        // 1. 정적 JSON 우선 (항상 최신 크롤링 데이터)
        try {
            const staticResp = await fetch(DOUYIN_STATIC_URL);
            if (staticResp.ok) {
                const staticData = await staticResp.json();
                if (staticData.success && staticData.challenges?.length > 0) {
                    douyinData = staticData;
                    douyinLoaded = true;

                    if (typeof IdolDB !== 'undefined') {
                        await IdolDB.set('douyinChallenges', {
                            data: staticData,
                            timestamp: Date.now()
                        });
                    }
                    console.log(`✅ Douyin loaded from static JSON: ${staticData.challenges.length} challenges`);
                    return;
                }
            }
        } catch (e) {
            console.log('Static douyin JSON not available, trying cache/API...');
        }

        // 2. IndexedDB 캐시 폴백 (정적 JSON 실패 시)
        if (typeof IdolDB !== 'undefined') {
            const cached = await IdolDB.get('douyinChallenges');
            if (cached && cached.data) {
                const cacheAge = Date.now() - (cached.timestamp || 0);
                const TTL = 3 * 60 * 60 * 1000; // 3시간

                if (cacheAge < TTL) {
                    douyinData = cached.data;
                    douyinLoaded = true;
                    console.log('📦 Douyin data loaded from cache');
                    return;
                }
            }
        }

        // 3. GAS API 폴백
        const response = await fetch(`${DOUYIN_API_URL}?action=getDouyinChallenges`);
        const result = await response.json();

        if (result.success) {
            douyinData = result;
            douyinLoaded = true;

            if (typeof IdolDB !== 'undefined') {
                await IdolDB.set('douyinChallenges', {
                    data: result,
                    timestamp: Date.now()
                });
            }

            console.log(`✅ Douyin prefetch complete: ${result.challenges?.length || 0} challenges`);
        }
    } catch (error) {
        console.warn('Douyin prefetch failed:', error);
    } finally {
        isPrefetchingDouyin = false;
    }
}

/**
 * 도우인 챌린지 데이터 로드 (IndexedDB 캐시 우선)
 */
async function loadDouyinChallenges() {
    const loading = document.getElementById('douyinLoading');
    const container = document.getElementById('douyinContainer');
    const updateTime = document.getElementById('douyinUpdateTime');

    // 이미 로드된 데이터가 있으면 바로 렌더링
    if (douyinLoaded && douyinData) {
        console.log('⚡ Using cached Douyin data');
        loading.style.display = 'none';
        container.style.display = 'flex';
        renderDouyinChallenges(douyinData);
        return;
    }

    // 로딩 표시
    loading.style.display = 'block';
    container.style.display = 'none';

    try {
        // 1. 정적 JSON 우선 (항상 최신 크롤링 데이터)
        let result = null;
        try {
            const staticResp = await fetch(DOUYIN_STATIC_URL);
            if (staticResp.ok) {
                const staticData = await staticResp.json();
                if (staticData.success && staticData.challenges?.length > 0) {
                    result = staticData;
                    console.log(`📄 Douyin loaded from static JSON: ${staticData.challenges.length} challenges`);
                }
            }
        } catch (e) {
            console.log('Static douyin JSON not available');
        }

        // 2. IndexedDB 캐시 폴백 (정적 JSON 실패 시)
        if (!result && typeof IdolDB !== 'undefined') {
            const cached = await IdolDB.get('douyinChallenges');
            if (cached && cached.data) {
                const cacheAge = Date.now() - (cached.timestamp || 0);
                const TTL = 3 * 60 * 60 * 1000; // 3시간

                if (cacheAge < TTL) {
                    console.log('📦 Loading Douyin from IndexedDB cache');
                    douyinData = cached.data;
                    douyinLoaded = true;

                    loading.style.display = 'none';
                    container.style.display = 'flex';
                    renderDouyinChallenges(douyinData);

                    updateDouyinInBackground();
                    return;
                }
            }
        }

        // 3. GAS API 폴백
        if (!result) {
            console.log('🌐 Fetching Douyin challenges from API...');
            const response = await fetch(`${DOUYIN_API_URL}?action=getDouyinChallenges`);
            result = await response.json();
        }

        if (result && result.success) {
            douyinData = result;
            douyinLoaded = true;

            // IndexedDB에 캐시 (IdolDB가 있을 때만)
            if (typeof IdolDB !== 'undefined') {
                await IdolDB.set('douyinChallenges', {
                    data: result,
                    timestamp: Date.now()
                });
            }

            loading.style.display = 'none';
            container.style.display = 'flex';
            renderDouyinChallenges(result);
        } else {
            throw new Error(result?.message || '데이터 로드 실패');
        }

    } catch (error) {
        console.error('Douyin load error:', error);
        loading.innerHTML = `
            <div class="alert alert-warning">
                <strong>데이터를 불러올 수 없습니다</strong><br>
                <small>${error.message}</small>
            </div>
        `;
    }
}

/**
 * 백그라운드에서 도우인 데이터 업데이트
 */
async function updateDouyinInBackground() {
    try {
        const response = await fetch(`${DOUYIN_API_URL}?action=getDouyinChallenges`);
        const result = await response.json();

        if (result.success) {
            douyinData = result;

            if (typeof IdolDB !== 'undefined') {
                await IdolDB.set('douyinChallenges', {
                    data: result,
                    timestamp: Date.now()
                });
            }

            console.log('🔄 Douyin data updated in background');
        }
    } catch (error) {
        console.warn('Background Douyin update failed:', error);
    }
}

/**
 * 도우인 챌린지 렌더링
 */
function renderDouyinChallenges(data) {
    const container = document.getElementById('douyinContainer');
    const updateTime = document.getElementById('douyinUpdateTime');

    // 주차 배지 표시 (updated_at 기준)
    const weekBadge = document.getElementById('douyinWeekBadge');
    if (weekBadge && data.updated_at) {
        const d = new Date(data.updated_at); // 데이터 업데이트 날짜
        const yy = String(d.getFullYear()).slice(2); // 연도 뒤 2자리
        const mm = d.getMonth() + 1; // 월
        const week = Math.ceil(d.getDate() / 7); // 주차 (1~5)
        weekBadge.textContent = `(${yy}년 ${mm}월 ${week}주차)`;
    }

    // 업데이트 시간 숨김 (비워두기)
    if (updateTime) {
        updateTime.innerHTML = '';
    }

    // 챌린지가 없으면 안내 메시지
    if (!data.challenges || data.challenges.length === 0) {
        container.innerHTML = `
            <div class="col-12">
                <div class="alert alert-info">
                    <strong>📢 준비 중</strong><br>
                    도우인 챌린지 데이터가 곧 업데이트됩니다.
                </div>
            </div>
        `;
        return;
    }

    // GA4 이벤트 추적
    if (typeof trackEvent === 'function') {
        trackEvent('douyin_view', {
            challenge_count: data.challenges.length,
            source: data.source,
            event_category: 'content_view'
        });
    }

    // 🔥 1~20위만 필터링 (20위 이후 데이터 제외)
    const filteredChallenges = data.challenges
        .filter(c => parseInt(c.rank) >= 1 && parseInt(c.rank) <= 20)
        .sort((a, b) => parseInt(a.rank) - parseInt(b.rank));

    // 챌린지 카드 렌더링
    container.innerHTML = filteredChallenges.map((challenge, index) =>
        createChallengeCard(challenge, index)
    ).join('');
}

/**
 * 챌린지 카드 HTML 생성 (CSS 스프라이트 방식 지원)
 * 
 * 스크린샷 레이아웃 기준:
 * - 이미지 높이: 1624px
 * - 헤더: 100px
 * - 각 항목: 69px
 * - 썸네일 Y 시작: 100 + (rank-1) * 69 + 10 (여백)
 */
/**
 * 챌린지 카드 HTML 생성 (CSS 스프라이트 방식 - 수정됨)
 * 
 * 🔥 수정 내용:
 * 1. 크롭 이미지 실제 크기(150px)를 기준으로 좌표 적용
 * 2. 이미지 원본 크기 유지 (스케일링 제거)
 * 3. 썸네일 표시 크기는 CSS로 조정
 */
function createChallengeCard(challenge, index) {
    const statusBadge = getStatusBadge(challenge.status);

    // 챌린지 URL: video_url (첫 번째 영상) > challenge_url > 검색 링크
    const challengeUrl = challenge.video_url || challenge.challenge_url || `https://www.douyin.com/search/${encodeURIComponent(challenge.title_zh)}`;

    // 한국어 제목 (AI가 생성한 요약의 첫 문장 또는 직접 번역)
    const titleKo = String(challenge.title_ko || (typeof challenge.summary_ko === 'string' ? challenge.summary_ko.split('.')[0] : '내용 없음') || challenge.title_zh);

    // 썸네일 HTML 생성
    let thumbnailHtml = '';
    const rank = parseInt(challenge.rank) || 0;

    // 순위별 스타일 (Fallback용)
    const getRankStyle = (r) => {
        if (r === 1) return { icon: '🥇', bg: 'linear-gradient(135deg, #FFD700 0%, #FFA500 100%)', color: '#fff' };
        if (r === 2) return { icon: '🥈', bg: 'linear-gradient(135deg, #C0C0C0 0%, #A0A0A0 100%)', color: '#fff' };
        if (r === 3) return { icon: '🥉', bg: 'linear-gradient(135deg, #CD7F32 0%, #8B4513 100%)', color: '#fff' };
        return { icon: '', bg: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)', color: '#fff' };
    };
    const style = getRankStyle(rank);

    if (challenge.cover_url) {
        // 개별 썸네일 이미지 (로컬 파일 또는 URL)
        thumbnailHtml = `
            <div class="douyin-thumbnail" style="width:60px; height:60px; border-radius:8px; overflow:hidden;">
                <img src="${challenge.cover_url}"
                     alt="${challenge.title_zh}"
                     referrerpolicy="no-referrer"
                     style="width:100%; height:100%; object-fit:cover;"
                     onerror="this.parentElement.innerHTML='<div class=\\'rank-badge\\' style=\\'background:${style.bg}; width:100%; height:100%; display:flex; align-items:center; justify-content:center; font-weight:bold; color:#fff; border-radius:8px;\\'>${rank}</div>'">
            </div>
        `;
    } else {
        // Fallback (이미지 없음)
        thumbnailHtml = `
            <div class="douyin-thumbnail" style="width:60px; height:60px;">
                <div class="rank-badge" style="background:${style.bg}; color:${style.color}; width:100%; height:100%; display:flex; align-items:center; justify-content:center; font-weight:bold; border-radius:8px; font-size:1.5rem;">
                    ${style.icon || rank}
                </div>
            </div>
        `;
    }

    return `
        <div class="col-12">
            <a href="${challengeUrl}" target="_blank" class="text-decoration-none" onclick="trackChallengeClick('${challenge.title_zh}', ${challenge.rank})">
                <div class="douyin-card p-3">
                    <div class="d-flex align-items-center gap-3">
                        <!-- 순위 배지 -->
                        <div class="douyin-rank-badge">
                            ${challenge.rank}
                        </div>
                        
                        <!-- 썸네일 (CSS 스프라이트 또는 개별 이미지) -->
                        ${thumbnailHtml}
                        
                        <!-- 콘텐츠 -->
                        <div class="flex-grow-1">
                            <!-- 제목 (한글 + 중국어) -->
                            <div class="mb-1">
                                <span class="h5 fw-bold text-dark">${titleKo}</span>
                                <span class="text-muted small ms-2" style="font-size: 0.85rem;">${challenge.title_zh}</span>
                            </div>
                            
                            <div class="mb-2">
                                <span class="badge bg-secondary">${challenge.participants} 참여</span>
                                ${statusBadge}
                            </div>
                            
                            ${challenge.trend_reason ? `
                                <div class="douyin-reason mb-2">
                                    <strong>🔥 유행 이유:</strong> ${challenge.trend_reason}
                                </div>
                            ` : ''}
                        </div>
                        
                        <!-- 바로가기 아이콘 -->
                        <div class="douyin-link-icon">
                            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" fill="currentColor" viewBox="0 0 16 16">
                                <path fill-rule="evenodd" d="M8.636 3.5a.5.5 0 0 0-.5-.5H1.5A1.5 1.5 0 0 0 0 4.5v10A1.5 1.5 0 0 0 1.5 16h10a1.5 1.5 0 0 0 1.5-1.5V7.864a.5.5 0 0 0-1 0V14.5a.5.5 0 0 1-.5.5h-10a.5.5 0 0 1-.5-.5v-10a.5.5 0 0 1 .5-.5h6.636a.5.5 0 0 0 .5-.5z"/>
                                <path fill-rule="evenodd" d="M16 .5a.5.5 0 0 0-.5-.5h-5a.5.5 0 0 0 0 1h3.793L6.146 9.146a.5.5 0 1 0 .708.708L15 1.707V5.5a.5.5 0 0 0 1 0v-5z"/>
                            </svg>
                        </div>
                    </div>
                </div>
            </a>
        </div>
    `;
}

/**
 * 챌린지 클릭 추적
 */
function trackChallengeClick(title, rank) {
    if (typeof trackEvent === 'function') {
        trackEvent('douyin_challenge_click', {
            challenge_title: title,
            challenge_rank: rank,
            event_category: 'outbound_link'
        });
    }
}

/**
 * 상태 배지 생성
 */
function getStatusBadge(status) {
    switch (status) {
        case 'new':
            return '<span class="badge bg-success">🆕 NEW</span>';
        case 'rising':
            return '<span class="badge bg-danger">🔥 급상승</span>';
        case 'falling':
            return '<span class="badge bg-secondary">📉 하락</span>';
        default:
            return '';
    }
}

/**
 * 🔥 Canvas 기반 썸네일 렌더링
 * 저장된 좌표(bbox)를 사용하여 스크린샷에서 정확히 썸네일 영역만 잘라서 표시
 */
function initCanvasThumbnails() {
    const canvases = document.querySelectorAll('.thumb-canvas');

    canvases.forEach(canvas => {
        const ctx = canvas.getContext('2d');
        const imgSrc = canvas.dataset.src;
        const x = parseInt(canvas.dataset.x) || 0;
        const y = parseInt(canvas.dataset.y) || 0;
        const width = parseInt(canvas.dataset.width) || 48;
        const height = parseInt(canvas.dataset.height) || 48;

        if (!imgSrc) return;

        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.referrerPolicy = 'no-referrer';

        img.onload = function () {
            // 원본 이미지에서 bbox 영역만 잘라서 60x60 캔버스에 그리기
            ctx.drawImage(img, x, y, width, height, 0, 0, 60, 60);
        };

        img.onerror = function () {
            // 에러 시 순위 배지로 fallback
            canvas.style.display = 'none';
            canvas.parentElement.classList.add('no-image');
        };

        img.src = imgSrc;
    });
}

// 도우인 챌린지 로드 후 Canvas 초기화
document.addEventListener('DOMContentLoaded', () => {
    // 기존 로드 완료 후 Canvas 초기화 (약간의 지연)
    setTimeout(initCanvasThumbnails, 500);
});

// 도우인 프리페칭 시작 (SNS 랭킹 로드 후 10초 지연)
setTimeout(() => {
    prefetchDouyinData();
}, 10000);

// ========================================
// 🏢 업체정보 기능
// ========================================

// 업체정보 전역 변수
let vendorsData = null;           // 업체 원본 데이터
let vendorsLoaded = false;        // 데이터 로드 완료 여부
let currentVendorCategory = 'all'; // 현재 선택된 대분류
let currentVendorSubcategory = 'all'; // 현재 선택된 소분류
let vendorCategories = {};        // 카테고리 구조 (API에서 수신)

/**
 * 업체정보 데이터 로드 (IndexedDB 캐시 우선)
 */
async function loadVendors() {
    // 메모리 캐시 사용
    if (vendorsLoaded && vendorsData) {
        console.log('✅ 업체 데이터 메모리 캐시 사용');
        renderVendors(vendorsData.data);
        updateVendorsInBackground(); // 백그라운드 갱신
        return;
    }

    const loadingEl = document.getElementById('vendorsLoading');
    const containerEl = document.getElementById('vendorsContainer');

    loadingEl.style.display = 'block';
    containerEl.style.display = 'none';

    try {
        // IndexedDB 캐시 확인
        const cachedVendors = await getVendorsCache().catch(() => null);

        if (cachedVendors) {
            console.log('⚡ IndexedDB 업체정보 캐시 히트!');
            vendorsData = cachedVendors;
            vendorsLoaded = true;
            vendorCategories = cachedVendors.categories || {};
            initVendorCategoryTabs(); // 카테고리 탭 초기화
            renderVendors(cachedVendors.data);
            // showVendorUpdateTime 삭제됨
            loadingEl.style.display = 'none';
            updateVendorsInBackground(); // 백그라운드 갱신
            return;
        }

        // API 호출
        console.log('📡 업체정보 캐시 미스, API 호출 중...');
        const response = await fetch(`${API_URL}?action=getVendors`);
        const result = await response.json();

        if (result.status === 'success') {
            vendorsData = result;
            vendorsLoaded = true;
            vendorCategories = result.categories || {};

            // IndexedDB에 캐시 저장
            saveVendorsCache(result).catch(err => {
                console.warn('업체정보 캐시 저장 실패:', err);
            });

            initVendorCategoryTabs(); // 카테고리 탭 초기화
            renderVendors(result.data);
            // showVendorUpdateTime 삭제됨
            console.log(`✅ 업체정보 로드 완료 (${result.data.length}개 업체)`);

            // GA4 이벤트 추적
            if (typeof trackEvent === 'function') {
                trackEvent('vendors_page_load', {
                    vendor_count: result.data.length,
                    event_category: 'content_view'
                });
            }
        } else {
            throw new Error(result.message || '업체정보 로드 실패');
        }
    } catch (error) {
        console.error('업체정보 로드 실패:', error);
        containerEl.innerHTML = `<div class="col-12"><div class="alert alert-danger">업체정보를 불러오는데 실패했습니다.</div></div>`;
        containerEl.style.display = 'block';
    } finally {
        loadingEl.style.display = 'none';
    }
}

/**
 * 백그라운드에서 업체정보 데이터 업데이트
 */
async function updateVendorsInBackground() {
    console.log('📥 백그라운드에서 업체정보 업데이트 중...');

    try {
        const response = await fetch(`${API_URL}?action=getVendors`);
        const result = await response.json();

        if (result.status === 'success') {
            await saveVendorsCache(result);
            vendorsData = result;
            vendorCategories = result.categories || {};
            console.log('✅ 업체정보 캐시 백그라운드 업데이트 완료');
        }
    } catch (error) {
        console.warn('업체정보 백그라운드 업데이트 실패:', error);
    }
}

/**
 * 카테고리 탭 초기화 (대분류)
 */
function initVendorCategoryTabs() {
    const tabsEl = document.getElementById('vendorCategoryTabs');
    if (!tabsEl) return;

    // 데이터에서 실제 사용되는 대분류만 추출
    const usedCategories = new Set();
    if (vendorsData && vendorsData.data) {
        vendorsData.data.forEach(v => usedCategories.add(v.category));
    }

    // '전체' 탭 + 카테고리 정의 순서대로 생성
    let html = `<button class="vendor-category-tab active" data-category="all" onclick="filterVendorsByCategory('all')">전체</button>`;

    // vendorCategories 키 순서대로 (없으면 데이터에서 추출한 순서)
    const categoryKeys = Object.keys(vendorCategories).length > 0
        ? Object.keys(vendorCategories)
        : [...usedCategories];

    categoryKeys.forEach(cat => {
        // 실제 데이터에 해당 카테고리가 있는 경우만 표시
        if (usedCategories.has(cat)) {
            html += `<button class="vendor-category-tab" data-category="${cat}" onclick="filterVendorsByCategory('${cat}')">${cat}</button>`;
        }
    });

    tabsEl.innerHTML = html;
}

/**
 * 대분류 카테고리 필터링
 * @param {string} category - 대분류 카테고리명 또는 'all'
 */
function filterVendorsByCategory(category) {
    currentVendorCategory = category;
    currentVendorSubcategory = 'all'; // 소분류 초기화

    // 대분류 탭 활성화 상태 업데이트
    document.querySelectorAll('.vendor-category-tab').forEach(tab => {
        tab.classList.toggle('active', tab.dataset.category === category);
    });

    // 소분류 탭 업데이트
    updateVendorSubcategoryTabs(category);

    // 렌더링
    if (vendorsData && vendorsData.data) {
        renderVendors(vendorsData.data);
    }

    // GA4 이벤트 추적
    if (typeof trackEvent === 'function') {
        trackEvent('vendor_filter', {
            category: category,
            event_category: 'user_engagement'
        });
    }
}

/**
 * 소분류 탭 업데이트
 * @param {string} category - 선택된 대분류
 */
function updateVendorSubcategoryTabs(category) {
    const subcatEl = document.getElementById('vendorSubcategoryTabs');
    if (!subcatEl) return;

    if (category === 'all') {
        subcatEl.style.display = 'none';
        return;
    }

    // 데이터에서 해당 대분류의 실제 소분류 추출
    const subcategories = new Set();
    if (vendorsData && vendorsData.data) {
        vendorsData.data
            .filter(v => v.category === category)
            .forEach(v => {
                if (v.subcategory) subcategories.add(v.subcategory);
            });
    }

    if (subcategories.size === 0) {
        subcatEl.style.display = 'none';
        return;
    }

    // 소분류 탭 생성
    let html = `<button class="vendor-subcategory-tab active" data-subcategory="all" onclick="filterVendorsBySubcategory('all')">전체</button>`;

    // vendorCategories에서 정의된 소분류 순서 사용
    const definedSubs = vendorCategories[category] || [];
    const orderedSubs = definedSubs.length > 0
        ? definedSubs.filter(s => subcategories.has(s))
        : [...subcategories];

    orderedSubs.forEach(sub => {
        html += `<button class="vendor-subcategory-tab" data-subcategory="${sub}" onclick="filterVendorsBySubcategory('${sub}')">${sub}</button>`;
    });

    subcatEl.innerHTML = html;
    subcatEl.style.display = 'flex';
}

/**
 * 소분류 필터링
 * @param {string} subcategory - 소분류명 또는 'all'
 */
function filterVendorsBySubcategory(subcategory) {
    currentVendorSubcategory = subcategory;

    // 소분류 탭 활성화 상태 업데이트
    document.querySelectorAll('.vendor-subcategory-tab').forEach(tab => {
        tab.classList.toggle('active', tab.dataset.subcategory === subcategory);
    });

    // 렌더링
    if (vendorsData && vendorsData.data) {
        renderVendors(vendorsData.data);
    }
}

/**
 * 검색 필터링 (업체명, 담당자명)
 */
function filterVendors() {
    if (vendorsData && vendorsData.data) {
        renderVendors(vendorsData.data);
    }
}

/**
 * 업체 카드 렌더링
 * @param {Array} vendors - 업체 데이터 배열
 */
function renderVendors(vendors) {
    const containerEl = document.getElementById('vendorsContainer');
    const loadingEl = document.getElementById('vendorsLoading');

    containerEl.innerHTML = '';

    // 필터 적용
    let filtered = [...vendors];

    // 대분류 필터
    if (currentVendorCategory !== 'all') {
        filtered = filtered.filter(v => v.category === currentVendorCategory);
    }

    // 소분류 필터
    if (currentVendorSubcategory !== 'all') {
        filtered = filtered.filter(v => v.subcategory === currentVendorSubcategory);
    }

    // 검색어 필터 (모든 필드 대조)
    const searchInput = document.getElementById('vendorSearchInput');
    const searchTerm = searchInput ? searchInput.value.trim().toLowerCase() : '';
    if (searchTerm) {
        filtered = filtered.filter(v => {
            // 시트의 모든 필드를 검색 대상에 포함
            const fields = [
                v.category, v.subcategory, v.company, v.contact,
                v.mobile, v.phone, v.email, v.website,
                v.sns, v.note, v.portfolio
            ];
            return fields.some(f => f && f.toLowerCase().includes(searchTerm));
        });
    }

    // 결과 없음
    if (!filtered || filtered.length === 0) {
        containerEl.innerHTML = `
            <div class="col-12 vendor-no-results">
                <p>${searchTerm ? '"' + searchTerm + '"에 대한 검색 결과가 없습니다.' : '데이터가 없습니다.'}</p>
            </div>
        `;
        loadingEl.style.display = 'none';
        containerEl.style.display = 'flex';
        return;
    }

    // 카드 생성
    filtered.forEach(vendor => {
        const col = document.createElement('div');
        col.className = 'col-12 col-md-6 col-lg-4';
        col.innerHTML = createVendorCard(vendor);
        containerEl.appendChild(col);
    });

    loadingEl.style.display = 'none';
    containerEl.style.display = 'flex';
}

/**
 * 업체 카드 HTML 생성 (간소화 - 업체명+카테고리만, 클릭 시 모달)
 * @param {Object} vendor - 업체 데이터 객체
 * @returns {string} - HTML 문자열
 */
function createVendorCard(vendor) {
    // 포트폴리오 보유 뱃지
    const pfBadge = (vendor.portfolio && vendor.portfolio.length > 0)
        ? '<span class="badge bg-info text-dark ms-1" style="font-size:0.65rem">PF</span>'
        : '';

    // 카테고리 뱃지 텍스트
    const badgeText = vendor.subcategory
        ? `${vendor.category} > ${vendor.subcategory}`
        : vendor.category;

    // vendor 데이터를 인코딩하여 onclick에 전달
    const vendorData = encodeURIComponent(JSON.stringify(vendor));

    return `
        <div class="vendor-card vendor-card-simple" onclick="openVendorDetail('${vendorData}')">
            <div class="vendor-card-header">
                <span class="vendor-company">${vendor.company}${pfBadge}</span>
                <span class="vendor-category-badge">${badgeText}</span>
            </div>
            <div class="vendor-card-action text-muted small mt-2">
                연락처 정보 보기
            </div>
        </div>
    `;
}

/**
 * 업체 상세 모달 열기
 * @param {string} encodedData - encodeURIComponent로 인코딩된 vendor JSON
 */
function openVendorDetail(encodedData) {
    const vendor = JSON.parse(decodeURIComponent(encodedData));

    // 업체명, 카테고리
    document.getElementById('vModalCompany').textContent = vendor.company;
    const catText = vendor.subcategory ? `${vendor.category} > ${vendor.subcategory}` : vendor.category;
    document.getElementById('vModalCategory').textContent = catText;

    // 담당자 (항상 표시, 데이터 없으면 공백)
    document.getElementById('vModalContact').textContent = vendor.contact || '';

    // 휴대전화 (항상 표시, 클릭 시 전화 연결)
    const mobileEl = document.getElementById('vModalMobile');
    if (vendor.mobile) {
        mobileEl.innerHTML = `<a href="tel:${vendor.mobile.replace(/[^0-9+\-]/g, '')}" class="text-decoration-none">${vendor.mobile}</a>`;
    } else {
        mobileEl.textContent = '';
    }

    // 일반전화 (항상 표시, 클릭 시 전화 연결)
    const phoneEl = document.getElementById('vModalPhone');
    if (vendor.phone) {
        phoneEl.innerHTML = `<a href="tel:${vendor.phone.replace(/[^0-9+\-]/g, '')}" class="text-decoration-none">${vendor.phone}</a>`;
    } else {
        phoneEl.textContent = '';
    }

    // 이메일 (하이퍼링크 없이 텍스트만, 복사 버튼 표시)
    const emailEl = document.getElementById('vModalEmail');
    const emailCopyBtn = document.getElementById('vModalEmailCopyBtn');
    if (vendor.email) {
        emailEl.textContent = vendor.email;
        emailCopyBtn.style.display = ''; // 복사 버튼 표시
    } else {
        emailEl.textContent = '';
        emailCopyBtn.style.display = 'none'; // 이메일 없으면 복사 버튼 숨김
    }

    // 홈페이지 (URL 텍스트로 표시, 클릭 시 이동)
    const websiteEl = document.getElementById('vModalWebsite');
    if (vendor.website) {
        const url = vendor.website.startsWith('http') ? vendor.website : 'https://' + vendor.website;
        websiteEl.innerHTML = `<a href="${url}" target="_blank" class="text-decoration-none">${vendor.website}</a>`;
    } else {
        websiteEl.textContent = '';
    }

    // SNS (인스타그램이면 인스타 아이콘, 그 외는 링크 텍스트)
    const snsEl = document.getElementById('vModalSns');
    if (vendor.sns) {
        const snsUrl = vendor.sns.startsWith('http') ? vendor.sns : 'https://' + vendor.sns;
        const isInstagram = vendor.sns.toLowerCase().includes('instagram.com') || vendor.sns.toLowerCase().includes('instagr.am');
        if (isInstagram) {
            // 인스타그램 아이콘 (Bootstrap Icons)
            snsEl.innerHTML = `<a href="${snsUrl}" target="_blank" class="text-decoration-none" title="Instagram"><i class="bi bi-instagram" style="font-size: 1.2rem; color: #E4405F;"></i></a>`;
        } else {
            snsEl.innerHTML = `<a href="${snsUrl}" target="_blank" class="text-decoration-none">${vendor.sns}</a>`;
        }
    } else {
        snsEl.textContent = '';
    }

    // 포트폴리오 (항상 표시)
    document.getElementById('vModalPortfolio').textContent = vendor.portfolio || '';

    // 비고 (항상 표시)
    document.getElementById('vModalNote').textContent = vendor.note || '';

    // 수정 요청 시 사용할 현재 업체 정보 저장
    window._currentVendorName = vendor.company;
    window._currentVendorCategory = vendor.category;

    // 모달 표시
    new bootstrap.Modal(document.getElementById('vendorDetailModal')).show();
}

/**
 * 이메일 주소 클립보드 복사
 */
function copyVendorEmail() {
    const email = document.getElementById('vModalEmail').textContent;
    if (!email) return;
    navigator.clipboard.writeText(email).then(() => {
        // 복사 성공 시 버튼 텍스트 임시 변경
        const btn = document.getElementById('vModalEmailCopyBtn');
        const original = btn.innerHTML;
        btn.innerHTML = `<i class="bi bi-check"></i> 복사됨`;
        setTimeout(() => { btn.innerHTML = original; }, 1500);
    }).catch(() => {
        alert('복사에 실패했습니다.');
    });
}

/**
 * 업체 등록/수정 요청 폼 모달 열기
 * @param {string} type - 'new'(신규 등록) 또는 'update'(수정 요청)
 */
function openVendorForm(type) {
    const titleEl = document.getElementById('vendorFormTitle');
    const typeInput = document.getElementById('vendorFormType');
    const companyInput = document.getElementById('vendorFormCompany');
    const categorySelect = document.getElementById('vendorFormCategory');
    const detailsArea = document.getElementById('vendorFormDetails');

    // 카테고리 옵션 채우기 (최초 1회)
    if (categorySelect.options.length === 0) {
        const defaultOpt = document.createElement('option');
        defaultOpt.value = '';
        defaultOpt.textContent = '선택';
        categorySelect.appendChild(defaultOpt);

        Object.keys(vendorCategories || {}).forEach(cat => {
            const opt = document.createElement('option');
            opt.value = cat;
            opt.textContent = cat;
            categorySelect.appendChild(opt);
        });
    }

    typeInput.value = type;

    if (type === 'new') {
        // 신규 등록
        titleEl.textContent = '신규 업체 등록 신청';
        companyInput.value = '';
        companyInput.readOnly = false;
        categorySelect.value = '';
        detailsArea.placeholder = '포트폴리오 URL, 업체 소개, 가능한 업무 범위 등을 적어주세요.';
    } else {
        // 수정 요청 - 상세 모달 닫기 (겹침 방지)
        const detailModal = bootstrap.Modal.getInstance(document.getElementById('vendorDetailModal'));
        if (detailModal) detailModal.hide();

        titleEl.textContent = '정보 수정 요청';
        companyInput.value = window._currentVendorName || '';
        companyInput.readOnly = true; // 업체명 수정 불가
        categorySelect.value = window._currentVendorCategory || '';
        detailsArea.placeholder = '수정할 내용이나 포트폴리오 URL 등을 적어주세요.';
    }

    // 나머지 필드 초기화
    document.getElementById('vendorFormContactName').value = '';
    document.getElementById('vendorFormMobile').value = '';
    document.getElementById('vendorFormPhone').value = '';
    document.getElementById('vendorFormEmail').value = '';
    document.getElementById('vendorFormWebsite').value = '';
    detailsArea.value = '';

    new bootstrap.Modal(document.getElementById('vendorFormModal')).show();
}

/**
 * 업체 등록/수정 요청 이메일 발송
 */
async function submitVendorForm() {
    const type = document.getElementById('vendorFormType').value;
    const company = document.getElementById('vendorFormCompany').value.trim();
    const category = document.getElementById('vendorFormCategory').value;
    const contactName = document.getElementById('vendorFormContactName').value.trim();
    const mobile = document.getElementById('vendorFormMobile').value.trim();
    const phone = document.getElementById('vendorFormPhone').value.trim();
    const email = document.getElementById('vendorFormEmail').value.trim();
    const website = document.getElementById('vendorFormWebsite').value.trim();
    const details = document.getElementById('vendorFormDetails').value.trim();

    // 필수 항목 검증 (업체명만 필수)
    if (!company) {
        alert('업체명은 필수 입력 항목입니다.');
        return;
    }

    // 연락처 정보 조합 (이메일에 포함)
    const contactParts = [];
    if (mobile) contactParts.push(`휴대전화: ${mobile}`);
    if (phone) contactParts.push(`일반전화: ${phone}`);
    if (email) contactParts.push(`이메일: ${email}`);
    if (website) contactParts.push(`홈페이지: ${website}`);
    const contactInfo = contactParts.join(' / ');

    // 버튼 로딩 상태
    const btn = document.getElementById('vendorFormSubmitBtn');
    const originalText = btn.textContent;
    btn.textContent = '전송 중...';
    btn.disabled = true;

    try {
        const payload = {
            action: 'sendVendorEmail',
            type: type,
            company: company,
            category: category,
            contact_name: contactName,
            contact_info: contactInfo,
            details: details
        };

        // GAS doPost 호출
        const response = await fetch(API_URL, {
            method: 'POST',
            body: JSON.stringify(payload)
        });
        const result = await response.json();

        if (result.status === 'success') {
            alert('요청이 성공적으로 전송되었습니다.\n관리자 확인 후 반영됩니다.');
            const modal = bootstrap.Modal.getInstance(document.getElementById('vendorFormModal'));
            if (modal) modal.hide();
        } else {
            throw new Error(result.message || '전송 실패');
        }
    } catch (error) {
        console.error('업체 요청 전송 실패:', error);
        alert('전송에 실패했습니다. 잠시 후 다시 시도해주세요.');
    } finally {
        btn.textContent = originalText;
        btn.disabled = false;
    }
}

/**
 * 마지막 업데이트 시간 표시
 * @param {string} isoString - ISO 8601 날짜 문자열
 */
function showVendorUpdateTime(isoString) {
    const el = document.getElementById('vendorUpdateTime');
    if (!el || !isoString) return;

    const date = new Date(isoString);
    const formatted = date.toLocaleDateString('ko-KR', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
    el.textContent = '마지막 업데이트: ' + formatted;
}

