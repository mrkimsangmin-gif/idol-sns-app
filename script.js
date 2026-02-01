// ========================================
// 📊 Google Analytics 4 유틸리티
// ========================================

/**
 * GA4 이벤트 전송 헬퍼 함수
 * @param {string} eventName - 이벤트 이름
 * @param {Object} params - 이벤트 파라미터
 */
function trackEvent(eventName, params = {}) {
    // GA4가 로드되지 않았거나 로컬 환경이면 무시
    if (typeof gtag !== 'function' || window.location.hostname === 'localhost') {
        console.log(`[Analytics] ${eventName}`, params);
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
const API_URL = "https://script.google.com/macros/s/AKfycby7Hw0e4CZmJnwWjHRsTVk0kEoktiDMjaOgWvLRauq_5pRF1D-nScDJ3vUWfcp5Re-A/exec";

// ⚠️ 엔터뉴스 GAS 웹앱 URL (action=getNews 파라미터 추가)
const ENTER_NEWS_API = "https://script.google.com/macros/s/AKfycbwV5QEzJGijfTyamsmsdYUIwoHLcjwyyJlcBXUdKu71-mWNy2rmFhl1K3B1GYIIx5e-/exec?action=getNews";

// 전역 캐시 변수
let cachedData = [];       // API에서 받은 원시 데이터 저장
let cachedMonths = [];     // 사용 가능한 월 목록
let metadataCache = {};    // 아이돌 메타데이터 캐시 {name_gender: {data}}

// 프리페칭 상태 관리 (최적화)
let isPrefetching = false;           // 데이터 프리페칭 진행 중 플래그
let isMetadataPrefetching = false;   // 메타데이터 프리페칭 진행 중 플래그
let metadataLoadedFor = new Set();   // 이미 로드된 성별 추적 (예: Set(['남자', '여자']))
let isLoadingFull = false;           // 전체 데이터 백그라운드 로딩 중 플래그

/**
 * 정적 JSON 데이터 로드 (즉시 렌더링용)
 * 기본 화면(남자/웨이보/최신월/Top30) 데이터를 정적 파일에서 즉시 로드
 * @returns {Promise<Object|null>} - 정적 데이터 또는 null
 */
async function loadStaticInitialData() {
    try {
        const response = await fetch('./data/initial-data.json');
        if (!response.ok) return null;

        const data = await response.json();

        // 데이터가 비어있으면 null 반환
        if (!data.data || data.data.length === 0) {
            console.warn('⚠️ 정적 데이터가 비어있음, GAS API 사용');
            return null;
        }

        // 데이터 신선도 확인 (45일 이상 오래되면 무시)
        const generated = new Date(data.generated);
        const age = Date.now() - generated.getTime();
        const MAX_AGE = 45 * 24 * 60 * 60 * 1000; // 45일

        if (age > MAX_AGE) {
            console.warn('⚠️ 정적 데이터 만료됨, GAS API 사용');
            return null;
        }

        return data;
    } catch (e) {
        console.warn('정적 데이터 로드 실패:', e);
        return null;
    }
}

// 초기 로드 (점진적 로딩: 정적 JSON → IndexedDB → API)
async function loadData(isInit = true) {
    console.log("⚡ Loading data...");

    const gender = document.getElementById('gender').value;
    const sns = document.getElementById('sns').value;

    // 🚀 0단계: 정적 JSON 즉시 로드 (남자/웨이보 기본값인 경우)
    if (isInit && gender === '남자' && sns === '웨이보') {
        const staticData = await loadStaticInitialData();
        if (staticData) {
            console.log('⚡⚡⚡ 정적 데이터 즉시 로드! (0ms)');

            cachedData = staticData.data;
            cachedMonths = staticData.meta.allMonths;

            // 현재 필터 저장
            window.currentFilter = { gender, sns };

            updateMonthOptions(cachedMonths);
            document.getElementById('month').value = staticData.meta.latestMonth;
            document.getElementById('monthDropdown').innerHTML = formatYearMonth(staticData.meta.latestMonth);

            // 즉시 렌더링 (0.1초 이내!)
            renderList(staticData.meta.latestMonth);

            // Top 10 메타데이터 프리페칭
            prefetchTopIdolsMetadata(gender);

            showLoading(false);

            // 백그라운드에서 전체 데이터 로드 (최신 데이터 동기화)
            setTimeout(() => loadFullDataInBackground(gender, sns), 100);
            return;
        }
    }

    // 기존 로직 (IndexedDB → API)
    showLoading(true);

    // gender와 sns는 이미 위에서 선언됨 (정적 데이터 로드 실패 시 이쪽으로 진입)

    // gender나 sns가 변경되면 기존 메모리 캐시 초기화
    if (window.currentFilter &&
        (window.currentFilter.gender !== gender || window.currentFilter.sns !== sns)) {
        console.log('Filter changed, clearing memory cache');
        cachedData = [];
    }

    // 현재 필터 저장
    window.currentFilter = { gender, sns };

    try {
        // 🚀 0단계: IndexedDB에서 월 목록 조회 (Stale-While-Revalidate)
        const monthsResult = await getMonthsWithStale(gender, sns).catch(() => ({ data: null, isStale: false }));
        let monthsFromDB = monthsResult.data;
        let needsMonthsRefresh = monthsResult.isStale;

        if (monthsFromDB && monthsFromDB.length > 0) {
            console.log(monthsResult.isStale ? '⏰ 월 목록 Stale 데이터 사용 (백그라운드 갱신 예정)' : '⚡ 월 목록 IndexedDB 히트!');
            cachedMonths = monthsFromDB;
            updateMonthOptions(cachedMonths);

            // 최신 2개월 데이터 IndexedDB에서 로드 시도 (Stale-While-Revalidate)
            const latestMonth = cachedMonths[cachedMonths.length - 1];
            const prevMonth = cachedMonths.length > 1 ? cachedMonths[cachedMonths.length - 2] : null;

            const latestResult = await getSnsDataWithStale(gender, sns, latestMonth).catch(() => ({ data: null, isStale: false }));
            const prevResult = prevMonth ? await getSnsDataWithStale(gender, sns, prevMonth).catch(() => ({ data: null, isStale: false })) : { data: null, isStale: false };

            const latestData = latestResult.data;
            const prevData = prevResult.data;
            const needsDataRefresh = latestResult.isStale || prevResult.isStale || needsMonthsRefresh;

            if (latestData && latestData.length > 0) {
                console.log(needsDataRefresh ? '⏰ Stale 데이터로 즉시 렌더링 (백그라운드 갱신 예정)' : '⚡⚡ IndexedDB에서 즉시 로드 성공!');
                cachedData = prevData ? [...prevData, ...latestData] : latestData;

                // 최신 월 선택
                document.getElementById('month').value = latestMonth;
                document.getElementById('monthDropdown').innerHTML = formatYearMonth(latestMonth);

                // 즉시 렌더링 (0.1초 이내) - 캐시 만료 여부와 무관하게 즉시 표시
                renderList(latestMonth);

                // ⭐ Top 10 메타데이터 우선 로드
                prefetchTopIdolsMetadata(gender);

                showLoading(false);

                // 백그라운드에서 전체 데이터 업데이트 (Stale 데이터인 경우 더 빠르게 갱신)
                const refreshDelay = needsDataRefresh ? 50 : 100;
                setTimeout(() => loadFullDataInBackground(gender, sns), refreshDelay);
                return; // 조기 반환 (캐시 히트 또는 Stale 데이터 사용)
            }
        }


        // 🚀 1단계: IndexedDB 미스 → API 호출 (상위 10개 우선)
        console.log('📡 IndexedDB 미스, API 호출 중...');
        const quickUrl = `${API_URL}?gender=${gender}&sns=${sns}&init=true&limit=10&sortByCount=true`;
        const quickResponse = await fetch(quickUrl);
        const quickResult = await quickResponse.json();

        if (quickResult.status === 'success') {
            cachedData = quickResult.data;
            cachedMonths = quickResult.meta.allMonths;

            // IndexedDB에 월 목록 저장
            saveMonths(gender, sns, cachedMonths).catch(err => {
                console.warn('월 목록 저장 실패:', err);
            });

            updateMonthOptions(cachedMonths);

            // 최신 월 선택
            if (cachedMonths.length > 0) {
                const latestMonth = cachedMonths[cachedMonths.length - 1];
                const monthInput = document.getElementById('month');

                // ✅ 필터 변경 시 월 값 강제 초기화
                if (cachedData.length <= 20) {
                    monthInput.value = latestMonth;
                    document.getElementById('monthDropdown').innerHTML = formatYearMonth(latestMonth);
                } else if (!monthInput.value) {
                    monthInput.value = latestMonth;
                    document.getElementById('monthDropdown').innerHTML = formatYearMonth(latestMonth);
                }
            }

            // 상위 10개 즉시 렌더링 ✨
            renderList(document.getElementById('month').value);

            // ⭐ 즉시 Top 10 메타데이터 로드 (Zero Latency)
            prefetchTopIdolsMetadata(gender);

            console.log(`⚡ Quick view loaded: ${cachedData.length} top idols (${quickResult.meta.returned}/${quickResult.meta.total})`);

            showLoading(false);

            // 📥 2단계: 나머지 데이터 백그라운드 로드
            loadFullDataInBackground(gender, sns);

        } else {
            console.error(quickResult.message);
            alert("데이터를 불러오는데 실패했습니다: " + quickResult.message);
            showLoading(false);
        }
    } catch (error) {
        console.error("Error loading data:", error);
        alert("데이터 로딩 중 오류가 발생했습니다.");
    } finally {
        // ✅ 성공/실패 관계없이 로딩 스피너 제거 보장
        showLoading(false);
    }
}

// 특정 월 데이터 로드 (월 변경 시, 10개 우선 로딩)
async function loadSpecificMonth(month) {
    console.log(`⚡ Loading top 10 idols for ${month}...`);
    showLoading(true);

    const gender = document.getElementById('gender').value;
    const sns = document.getElementById('sns').value;

    try {
        // 🚀 1단계: 상위 10개만 초고속 로드
        const quickUrl = `${API_URL}?gender=${gender}&sns=${sns}&month=${month}&limit=10&sortByCount=true`;
        const quickResponse = await fetch(quickUrl);
        const quickResult = await quickResponse.json();

        if (quickResult.status === 'success') {
            const monthData = quickResult.data;

            // 캐시에 추가/업데이트
            cachedData = cachedData.filter(d => d.date !== month);
            cachedData.push(...monthData);

            // 상위 10개 즉시 렌더링 ✨
            renderList(month);

            // ⭐ Top 10 메타데이터 우선 로드
            prefetchTopIdolsMetadata(gender);

            console.log(`⚡ Quick view loaded: ${monthData.length} top idols for ${month} (${quickResult.meta.returned}/${quickResult.meta.total})`);

            showLoading(false);

            // 📥 2단계: 나머지 데이터 백그라운드 로드
            loadFullMonthInBackground(gender, sns, month);

        } else {
            console.error(quickResult.message);
            alert('데이터를 불러오는데 실패했습니다: ' + quickResult.message);
            showLoading(false);
        }
    } catch (error) {
        console.error('Error loading month data:', error);
        alert('데이터 로딩 중 오류가 발생했습니다.');
    } finally {
        // ✅ 모든 경로에서 로딩 해제 보장
        showLoading(false);
    }
}

// 나머지 데이터 백그라운드 로딩 (사용자에게 보이지 않음)
async function loadFullDataInBackground(gender, sns) {
    if (isLoadingFull) {
        console.log('⏭️ Full data loading already in progress');
        return;
    }

    isLoadingFull = true;
    console.log('📥 Loading full data in background...');

    try {
        const fullUrl = `${API_URL}?gender=${gender}&sns=${sns}&init=true`;
        const fullResponse = await fetch(fullUrl);
        const fullResult = await fullResponse.json();

        if (fullResult.status === 'success') {
            cachedData = fullResult.data;
            console.log(`✅ Full data loaded: ${cachedData.length} records`);

            // IndexedDB에 월별 데이터 저장
            const monthMap = {};
            cachedData.forEach(item => {
                if (!monthMap[item.date]) {
                    monthMap[item.date] = [];
                }
                monthMap[item.date].push(item);
            });

            // 각 월별 데이터를 IndexedDB에 저장
            for (const month in monthMap) {
                saveSnsData(gender, sns, month, monthMap[month]).catch(err => {
                    console.warn(`월 데이터 저장 실패 (${month}):`, err);
                });
            }

            // 현재 표시 중인 월 다시 렌더링 (전체 데이터로)
            const currentMonth = document.getElementById('month').value;
            renderList(currentMonth);

            // 메타데이터 프리페칭 시작 (모달 즉시 열기 위함)  
            prefetchMetadata();

            // 🔗 5초 후 링크 데이터 프리페칭 (지연된 백그라운드 로드)
            setTimeout(() => {
                prefetchLinksData();
            }, 5000);

            // 📰 7초 후 뉴스 데이터 프리페칭 (지연된 백그라운드 로드)
            setTimeout(() => {
                prefetchEnterNews();
            }, 7000);
        }
    } catch (error) {
        console.warn('Background loading failed:', error);
    } finally {
        isLoadingFull = false;
    }
}

// 특정 월 전체 데이터 백그라운드 로딩
async function loadFullMonthInBackground(gender, sns, month) {
    console.log(`📥 Loading full data for ${month} in background...`);

    try {
        const fullUrl = `${API_URL}?gender=${gender}&sns=${sns}&month=${month}`;
        const fullResponse = await fetch(fullUrl);
        const fullResult = await fullResponse.json();

        if (fullResult.status === 'success') {
            // 캐시에서 해당 월 데이터 제거 후 전체 데이터로 교체
            cachedData = cachedData.filter(d => d.date !== month);
            cachedData.push(...fullResult.data);

            console.log(`✅ Full data loaded for ${month}: ${fullResult.data.length} records`);

            // IndexedDB에 저장
            saveSnsData(gender, sns, month, fullResult.data).catch(err => {
                console.warn(`월 데이터 저장 실패 (${month}):`, err);
            });

            // 현재 표시 중인 월이면 다시 렌더링
            const currentMonth = document.getElementById('month').value;
            if (currentMonth === month) {
                renderList(month);
            }

            // 메타데이터 프리페칭 시작 (모달 즉시 열기 위함)
            prefetchMetadata();
        }
    } catch (error) {
        console.warn(`Background loading failed for ${month}:`, error);
    }
}


document.addEventListener('DOMContentLoaded', () => {
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

    // 초기 로드 시작
    loadData(true);
});



// 월 선택 변경 핸들러 (필요시 서버 요청)
async function handleMonthChange() {
    const selectedMonth = document.getElementById('month').value;

    // 현재 월의 인덱스 찾기
    const monthIndex = cachedMonths.indexOf(selectedMonth);
    const baseMonth = monthIndex > 0 ? cachedMonths[monthIndex - 1] : selectedMonth;

    // 필요한 데이터가 이미 캐시에 있는지 확인
    const hasCurrentMonth = cachedData.some(d => d.date === selectedMonth);
    const hasBaseMonth = cachedData.some(d => d.date === baseMonth);

    if (hasCurrentMonth && hasBaseMonth) {
        // 데이터가 있으면 바로 렌더링
        console.log(`Using cached data for ${selectedMonth}`);
        renderList(selectedMonth);
    } else {
        // 데이터가 없으면 해당 월만 로드
        console.log(`Fetching data for ${selectedMonth}...`);
        await loadSpecificMonth(selectedMonth);
    }
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
            listContainer.innerHTML = '<div class="text-center py-5"><div class="spinner-border text-secondary"></div><p class="mt-2">추가 데이터 로딩 중...</p></div>';
            return;
        }

        // ✅ 2단계: 전체 캐시 데이터 확인
        if (!cachedData || cachedData.length === 0) {
            console.error('❌ No cached data available');
            listContainer.innerHTML = '<div class="text-center p-5 text-muted">데이터가 없습니다.</div>';
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
        // 표시 텍스트 (차오화 → 웨이보(슈퍼챗))
        const displayText = value === '차오화' ? '웨이보(슈퍼챗)' : value;
        document.getElementById('snsDropdown').innerHTML = displayText;
        // sns 변경 시 데이터 재로드
        loadData(true);
    } else if (type === 'month') {
        document.getElementById('month').value = value;
        document.getElementById('monthDropdown').innerHTML = formatYearMonth(value);
        // 월 변경 시 렌더링만
        handleMonthChange();
    }
}

function formatYearMonth(ym) {
    if (!ym) return '';
    try {
        const parts = ym.split('-');
        if (parts.length === 2) {
            const shortYear = parts[0].substring(2); // '2025' -> '25'
            const month = parseInt(parts[1]); // '11' -> 11
            return `${shortYear}년${month}월`;
        }
    } catch (e) { return ym; }
    return ym;
}

function route(pageId) {
    document.querySelectorAll('.page-section').forEach(el => el.classList.add('d-none'));
    document.getElementById('page-' + pageId).classList.remove('d-none');

    document.querySelectorAll('.nav-link').forEach(el => el.classList.remove('active'));
    // event 객체가 있을 때만 실행 (안전장치 추가)
    if (typeof event !== 'undefined' && event.target) {
        event.target.classList.add('active');
    }

    // 모바일 메뉴 닫기
    const navbarCollapse = document.getElementById('navbarNav');
    if (navbarCollapse && navbarCollapse.classList.contains('show')) {
        const bsCollapse = new bootstrap.Collapse(navbarCollapse, {
            toggle: false
        });
        bsCollapse.hide();
    }

    // ============================================================
    // 📊 GA4 가상 페이지뷰 전송 (SPA 페이지 전환 추적)
    // ============================================================
    const PAGE_META = {
        home: { path: '/', title: 'SNS Ranking | 아이엠콘텐츠' },
        comeback: { path: '/comeback', title: '컴백일정 | 아이엠콘텐츠' },
        news: { path: '/news', title: '엔터뉴스 | 아이엠콘텐츠' },
        links: { path: '/links', title: '링크모음 | 아이엠콘텐츠' },
        jobs: { path: '/jobs', title: '채용정보 | 아이엠콘텐츠' },
        douyin: { path: '/douyin', title: '중국트렌드 | 아이엠콘텐츠' },
        team: { path: '/team', title: 'Team | 아이엠콘텐츠' }
    };

    const meta = PAGE_META[pageId];
    if (meta) {
        // 브라우저 탭 제목 변경 (SEO/UX 개선)
        document.title = meta.title;

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

    // 엔터뉴스 페이지 진입 시 자동으로 최신 뉴스 로딩
    if (pageId === 'news') {
        loadEnterNews();
    }

    // 링크모음 페이지 진입 시 자동으로 링크 로딩
    if (pageId === 'links') {
        loadLinks();
    }

    // 채용정보 페이지 진입 시 자동으로 채용 로딩
    if (pageId === 'jobs') {
        loadJobs();
    }

    // 도우인 챌린지 페이지 진입 시 자동으로 데이터 로딩
    if (pageId === 'douyin') {
        loadDouyinChallenges();
    }
}

// ========================================
// 🚀 예측 프리로딩 (Predictive Preloading)
// ========================================

// 유틸: sleep 함수
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// 조용히 프리페칭 (UI 변경 없음)
async function prefetchMonth(month, gender = null, sns = null) {
    // gender, sns가 제공되지 않으면 현재 선택값 사용
    const targetGender = gender || document.getElementById('gender').value;
    const targetSns = sns || document.getElementById('sns').value;

    try {
        const url = `${API_URL}?gender=${targetGender}&sns=${targetSns}&month=${month}`;
        const response = await fetch(url);
        const result = await response.json();

        if (result.status === 'success') {
            // 새 데이터를 캐시에 병합
            result.data.forEach(newItem => {
                const exists = cachedData.some(
                    item => item.name === newItem.name &&
                        item.date === newItem.date
                );
                if (!exists) {
                    cachedData.push(newItem);
                }
            });

            const genderLabel = targetGender === document.getElementById('gender').value ? '동일 성별' : '반대 성별';
            console.log(`📦 Prefetched: ${genderLabel} ${month} (${result.data.length} records)`);
        }
    } catch (error) {
        // 실패해도 사용자에게 알리지 않음 (백그라운드 작업)
        console.warn(`Prefetch failed for ${month}:`, error);
    }
}

// 스마트 프리페칭 시작 (최적화됨)
async function startPrefetching() {
    // 중복 실행 방지
    if (isPrefetching) {
        console.log('⏭️ Prefetching already in progress, skipping...');
        return;
    }

    isPrefetching = true; // 플래그 설정

    try {
        // 네트워크 상태 확인 (느린 네트워크나 Save-Data 모드에서는 비활성화)
        if (navigator.connection) {
            if (navigator.connection.saveData) {
                console.log('⚠️ Save-Data mode, prefetching disabled');
                return;
            }
            if (navigator.connection.effectiveType === '2g') {
                console.log('⚠️ Slow network detected, prefetching disabled');
                return;
            }
        }

        const currentMonth = document.getElementById('month').value;
        const currentGender = document.getElementById('gender').value;
        const currentSns = document.getElementById('sns').value;
        const monthIndex = cachedMonths.indexOf(currentMonth);

        // 반대 성별 결정
        const oppositeGender = currentGender === '남자' ? '여자' : '남자';

        // 프리로딩 우선순위 큐 (최적화: 6개 → 3개)
        const prefetchQueue = [];

        // ===== 1순위: 동일 성별 이전 월 (사용자가 과거 데이터를 볼 가능성 높음) =====
        if (monthIndex > 0) {
            prefetchQueue.push({
                month: cachedMonths[monthIndex - 1],
                gender: currentGender,
                priority: 1,
                label: '동일 성별 이전 월'
            });
        }

        // ===== 2순위: 반대 성별 동일월 (성별 전환 버튼 클릭 가능성) =====
        if (monthIndex >= 0) {
            prefetchQueue.push({
                month: currentMonth,
                gender: oppositeGender,
                priority: 2,
                label: '반대 성별 동일월'
            });
        }

        // ===== 3순위: 반대 성별 전월 =====
        if (monthIndex > 0) {
            prefetchQueue.push({
                month: cachedMonths[monthIndex - 1],
                gender: oppositeGender,
                priority: 3,
                label: '반대 성별 전월'
            });
        }

        // 실제로 로드가 필요한 항목만 필터링 (사전 체크)
        const itemsToLoad = [];
        for (const item of prefetchQueue) {
            const targetMonthIndex = cachedMonths.indexOf(item.month);
            const baseMonth = targetMonthIndex > 0 ? cachedMonths[targetMonthIndex - 1] : item.month;

            const hasCurrentMonth = cachedData.some(d => d.date === item.month);
            const hasBaseMonth = cachedData.some(d => d.date === baseMonth);

            if (!hasCurrentMonth || !hasBaseMonth) {
                itemsToLoad.push({ ...item, baseMonth });
            }
        }

        if (itemsToLoad.length === 0) {
            console.log('✅ All needed data already cached, skipping prefetch');
            return;
        }

        console.log(`🚀 Starting prefetch (${itemsToLoad.length}/${prefetchQueue.length} items needed):`);
        itemsToLoad.forEach(item => {
            console.log(`  ${item.priority}. ${item.label}: ${item.gender} ${item.month}`);
        });

        // 우선순위별로 순차적으로 프리페칭
        for (const item of itemsToLoad) {
            await prefetchMonth(item.month, item.gender, currentSns);

            // 각 요청 사이 500ms 대기 (서버 부하 방지)
            await sleep(500);
        }

        console.log('✅ Prefetching complete');
    } finally {
        isPrefetching = false; // 완료 또는 에러 시 플래그 해제
    }
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
    'spotify': 'https://www.spotify.com/favicon.ico'
};

// SNS 이름 매핑
const SNS_NAMES = {
    'weibo_link': { label: '웨이보', key: 'weibo' },
    'weibo_superchat_link': { label: '차오화', key: 'chaohua' },
    'x_link': { label: 'X', key: 'x' },
    'bilibili_link': { label: '빌리빌리', key: 'bilibili' },
    'youtube_link': { label: '유튜브', key: 'youtube' },
    'qqmusic_link': { label: 'QQ뮤직', key: 'qqmusic' },
    'spotify_link': { label: '스포티파이', key: 'spotify' }
};

// ========================================
// 🚀 메타데이터 프리페칭 (Zero Latency)
// ========================================

async function prefetchMetadata() {
    // 중복 실행 방지
    if (isMetadataPrefetching) {
        console.log('⏭️ Metadata prefetching already in progress, skipping...');
        return;
    }

    isMetadataPrefetching = true; // 플래그 설정

    try {
        console.log("🚀 Starting metadata prefetch...");

        // 현재 선택된 성별
        const currentGender = document.getElementById('gender').value;
        // 반대 성별
        const oppositeGender = currentGender === '남자' ? '여자' : '남자';

        // 1. 현재 화면의 아이돌 데이터 우선 로드 (중요)
        if (!metadataLoadedFor.has(currentGender)) {
            await fetchAndCacheMetadata(currentGender);
        } else {
            console.log(`✓ Metadata already loaded for ${currentGender}`);
        }

        // 2. 서버 부하 분산을 위해 잠시 대기
        await sleep(1000);

        // 3. 반대 성별 데이터 로드
        if (!metadataLoadedFor.has(oppositeGender)) {
            await fetchAndCacheMetadata(oppositeGender);
        } else {
            console.log(`✓ Metadata already loaded for ${oppositeGender}`);
        }

        console.log("✅ All metadata background loading complete");
    } finally {
        isMetadataPrefetching = false; // 완료 또는 에러 시 플래그 해제
    }
}

async function fetchAndCacheMetadata(gender) {
    try {
        const response = await fetch(`${API_URL}?action=allMetadata&gender=${gender}`);
        const result = await response.json();

        if (result.status === 'success') {
            result.data.forEach(item => {
                const key = `${item.name}_${gender}`;
                metadataCache[key] = item;
            });
            console.log(`📦 Metadata cached: ${result.data.length} items for ${gender}`);
            metadataLoadedFor.add(gender); // 로드 완료 추적
        }
    } catch (e) {
        console.warn(`Metadata prefetch failed for ${gender}:`, e);
    }
}

/**
 * 현재 화면 Top 10 아이돌 메타데이터 우선 로드 (Zero Latency)
 * 첫 클릭 시 2~3초 로딩 문제 해결
 */
async function prefetchTopIdolsMetadata(gender) {
    try {
        console.log("🚀 Starting Top 10 metadata prefetch...");

        // 현재 화면에 표시된 카드에서 아이돌 이름 추출
        const cards = document.querySelectorAll('.idol-card');
        const top10Names = [];

        cards.forEach((card, index) => {
            if (index < 10) {  // 상위 10개만
                const name = card.getAttribute('data-idol-name');
                if (name) top10Names.push(name);
            }
        });

        if (top10Names.length === 0) {
            console.log('⚠️ No idol cards found for prefetching');
            return;
        }

        console.log(`🎯 Prefetching metadata for ${top10Names.length} idols: ${top10Names.slice(0, 3).join(', ')}...`);

        // 각 아이돌별로 메타데이터 로드 (병렬 처리)
        const promises = top10Names.map(async (name) => {
            const cacheKey = `${name}_${gender}`;

            // 이미 캐시되어 있으다면 스킵
            if (metadataCache[cacheKey]) {
                return;
            }

            try {
                const response = await fetch(`${API_URL}?action=metadata&name=${encodeURIComponent(name)}&gender=${encodeURIComponent(gender)}`);
                const result = await response.json();

                if (result.status === 'success') {
                    metadataCache[cacheKey] = result.data;
                    console.log(`✅ Cached: ${name}`);
                }
            } catch (e) {
                console.warn(`Failed to prefetch ${name}:`, e);
            }
        });

        // 모든 요청 동시 실행 (병렬 처리)
        await Promise.all(promises);

        console.log("✅ Top 10 metadata prefetch complete");

    } catch (e) {
        console.warn('Top 10 metadata prefetch failed:', e);
    }
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
    document.getElementById('idolInfo').innerHTML = '<div class="spinner-border spinner-border-sm me-2"></div>로딩 중...';

    // SNS 링크 영역 초기화
    const snsContainer = document.getElementById('snsLinks');
    snsContainer.innerHTML = '<div class="text-center py-3"><div class="spinner-border spinner-border-sm text-primary"></div></div>';

    // 1. 캐시 확인 (Zero Latency Experience)
    if (metadataCache[cacheKey]) {
        console.log(`⚡ Instant load from cache: ${name}`);
        data = metadataCache[cacheKey];
    } else {
        // 2. 캐시 미스 시 직접 로딩 (Fallback)
        console.log(`Loading metadata for ${name} (${gender})`);
        try {
            const response = await fetch(`${API_URL}?action=metadata&name=${encodeURIComponent(name)}&gender=${encodeURIComponent(gender)}`);
            const result = await response.json();

            if (result.status === 'success') {
                data = result.data;
                // 다음을 위해 캐시 저장
                metadataCache[cacheKey] = data;
            } else {
                console.error('Metadata load failed:', result.message);
                snsContainer.innerHTML = `<div class="alert alert-danger">메타데이터를 불러올 수 없습니다.<br>${result.message}</div>`;
                return;
            }
        } catch (error) {
            console.error('Error loading metadata:', error);
            snsContainer.innerHTML = '<div class="alert alert-danger">데이터 로딩 중 오류가 발생했습니다.</div>';
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
    const debutText = data.debut_year ? `${data.debut_year}년 데뷔` : '';
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
        snsContainer.innerHTML = '<small class="text-muted">등록된 SNS 링크가 없습니다.</small>';
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
        // IndexedDB 캐시 확인
        const cachedNews = await getNewsCache().catch(() => null);
        if (cachedNews) {
            newsData = cachedNews;
            newsLoaded = true;
            console.log('⚡ 뉴스 프리페칭: IndexedDB 캐시 히트');
            return;
        }

        // API 호출
        if (!ENTER_NEWS_API) return;

        const response = await fetch(ENTER_NEWS_API);
        if (response.ok) {
            const data = await response.json();
            newsData = data;
            newsLoaded = true;

            // IndexedDB에 저장
            await saveNewsCache(data);
            console.log('✅ 뉴스 프리페칭 완료');
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
    if (!ENTER_NEWS_API) {
        alert('엔터뉴스 API가 설정되지 않았습니다.');
        return;
    }

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

        // 🚀 2단계: IndexedDB 미스 → API 호출
        console.log('📡 뉴스 캐시 미스, API 호출 중...');
        const response = await fetch(ENTER_NEWS_API);

        if (!response.ok) {
            throw new Error('네트워크 응답 오류');
        }

        const data = await response.json();
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

    try {
        const response = await fetch(ENTER_NEWS_API);
        if (response.ok) {
            const data = await response.json();
            await saveNewsCache(data);
            newsData = data;
            console.log('✅ 뉴스 캐시 백그라운드 업데이트 완료');
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

    if (newsData.length > 0 && newsData[0].collectTime) {
        const updateTime = new Date(newsData[0].collectTime);
        document.getElementById('newsUpdateTime').textContent =
            updateTime.toLocaleString('ko-KR', {
                month: 'long',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit'
            });
    }

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
    const now = new Date();
    const diff = Math.floor((now - date) / 1000);

    if (diff < 60) return '방금 전';
    if (diff < 3600) return `${Math.floor(diff / 60)}분 전`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}시간 전`;
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
        linksContainer.innerHTML = '<div class="text-center text-danger py-5">링크를 불러오는데 실패했습니다.</div>';
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
        container.innerHTML = '<p class="text-muted text-center py-4">데이터가 없습니다.</p>';
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

        const response = await fetch(`${API_URL}?action=getJobs`);
        const result = await response.json();

        if (result.status === 'success') {
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

        // API 호출
        console.log('📡 채용 캐시 미스, API 호출 중...');
        const response = await fetch(`${API_URL}?action=getJobs`);
        const result = await response.json();

        if (result.status === 'success') {
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
        containerEl.innerHTML = '<div class="col-12"><div class="alert alert-danger">채용정보를 불러오는데 실패했습니다.</div></div>';
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
        const response = await fetch(`${API_URL}?action=getJobs`);
        const result = await response.json();

        if (result.status === 'success') {
            await saveJobsCache(result);
            jobsData = result;
            console.log('✅ 채용 캐시 백그라운드 업데이트 완료');
        }
    } catch (error) {
        console.warn('채용 백그라운드 업데이트 실패:', error);
    }
}

/**
 * 채용 카드 렌더링
 */
function renderJobs(jobs) {
    const containerEl = document.getElementById('jobsContainer');
    const loadingEl = document.getElementById('jobsLoading');

    containerEl.innerHTML = '';

    // 필터 적용
    let filteredJobs = jobs;
    if (currentJobsCategory !== 'all') {
        filteredJobs = jobs.filter(job => job.category === currentJobsCategory);
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

    filteredJobs.forEach((job, index) => {
        const col = document.createElement('div');
        col.className = 'col-12 col-md-6 col-lg-4';
        col.innerHTML = createJobCard(job, index);
        containerEl.appendChild(col);
    });

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

// 도우인 전용 GAS API URL (별도 프로젝트)
const DOUYIN_API_URL = 'https://script.google.com/macros/s/AKfycbz497bYijjPFuydRCNSY7hdDtI0f78Dov5pUSzgd5IC1xfj3LNKrVwQa9aDnQIU_Gq4fQ/exec';

let douyinData = null;
let douyinLoaded = false;
let isPrefetchingDouyin = false;

/**
 * 도우인 챌린지 데이터 프리페칭 (7초 지연 호출)
 */
async function prefetchDouyinData() {
    if (isPrefetchingDouyin || douyinLoaded) return;
    isPrefetchingDouyin = true;

    try {
        console.log('🇨🇳 Starting Douyin challenges prefetch...');

        // IndexedDB 캐시 확인 (IdolDB가 있을 때만)
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

        // API 호출
        const response = await fetch(`${DOUYIN_API_URL}?action=getDouyinChallenges`);
        const result = await response.json();

        if (result.success) {
            douyinData = result;
            douyinLoaded = true;

            // IndexedDB에 캐시 (IdolDB가 있을 때만)
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
        // 1. IndexedDB 캐시 확인 (IdolDB가 있을 때만)
        if (typeof IdolDB !== 'undefined') {
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

                    // 백그라운드에서 업데이트 체크
                    updateDouyinInBackground();
                    return;
                }
            }
        }

        // 2. API 호출
        console.log('🌐 Fetching Douyin challenges from API...');
        const response = await fetch(`${DOUYIN_API_URL}?action=getDouyinChallenges`);
        const result = await response.json();

        if (result.success) {
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
            throw new Error(result.message || '데이터 로드 실패');
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

    // 챌린지 URL (도우인 검색 링크)
    const challengeUrl = challenge.challenge_url || `https://www.douyin.com/search/${encodeURIComponent(challenge.title_zh)}`;

    // 한국어 제목 (AI가 생성한 요약의 첫 문장 또는 직접 번역)
    const titleKo = String(challenge.title_ko || (typeof challenge.summary_ko === 'string' ? challenge.summary_ko.split('.')[0] : "내용 없음") || challenge.title_zh);

    // 🔥 썸네일 HTML 생성 - CSS Sprite 방식 (좌표 수정됨)
    let thumbnailHtml = '';
    const rank = parseInt(challenge.rank) || 0;
    const bbox = challenge.thumbnail_bbox || {};

    // 좌표 유효성 확인
    const hasValidCoords = bbox.x > 0 && bbox.y >= 0 && bbox.width > 0 && bbox.height > 0;

    // 순위별 스타일 (Fallback용)
    const getRankStyle = (r) => {
        if (r === 1) return { icon: '🥇', bg: 'linear-gradient(135deg, #FFD700 0%, #FFA500 100%)', color: '#fff' };
        if (r === 2) return { icon: '🥈', bg: 'linear-gradient(135deg, #C0C0C0 0%, #A0A0A0 100%)', color: '#fff' };
        if (r === 3) return { icon: '🥉', bg: 'linear-gradient(135deg, #CD7F32 0%, #8B4513 100%)', color: '#fff' };
        return { icon: '', bg: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)', color: '#fff' };
    };
    const style = getRankStyle(rank);

    if (challenge.cover_url && challenge.cover_url.includes('drive.google.com') && hasValidCoords) {
        // 🔥 수정된 CSS Sprite 적용
        // 
        // 핵심 변경점:
        // 1. 크롭 이미지 원본 크기(150px)를 기준으로 좌표 적용
        // 2. 썸네일 표시 영역(60x60)에 맞게 스케일링
        //
        // bbox 예시: {x: 73, y: 0, width: 77, height: 100}
        // - x=73: 왼쪽에서 73px 위치가 썸네일 시작점
        // - width=77: 썸네일 너비
        // - height=100: 썸네일 높이 (2000px / 20 = 100)

        // 🔥 표시할 썸네일 크기 (정사각형으로 표시)
        const displaySize = 60;

        // 🔥 원본 이미지에서 크롭할 영역의 스케일 계산
        // 정사각형으로 표시하기 위해 width와 height 중 작은 값 기준
        const cropSize = Math.min(bbox.width, bbox.height);
        const scale = displaySize / cropSize;

        // 🔥 실제 이미지 크기 (크롭 이미지는 150px 너비)
        const cropImageWidth = 150;  // 서버에서 저장한 크롭 이미지 너비

        // 스케일링된 이미지 크기
        const scaledImageWidth = Math.round(cropImageWidth * scale);

        // 스케일링된 좌표
        const scaledX = Math.round(bbox.x * scale);
        const scaledY = Math.round(bbox.y * scale);

        thumbnailHtml = `
            <div class="douyin-thumbnail" style="
                width: ${displaySize}px; 
                height: ${displaySize}px; 
                overflow: hidden; 
                position: relative;
                border-radius: 8px;
                background: #f0f0f0;
            ">
                <img src="${challenge.cover_url}" 
                     alt="${challenge.title_zh}" 
                     referrerpolicy="no-referrer"
                     style="
                         width: ${scaledImageWidth}px; 
                         max-width: none; 
                         height: auto; 
                         position: absolute; 
                         left: -${scaledX}px; 
                         top: -${scaledY}px;
                     "
                     onerror="this.parentElement.innerHTML='<div class=\\'rank-badge\\' style=\\'background:${style.bg}; width:100%; height:100%; display:flex; align-items:center; justify-content:center; font-weight:bold; color:#fff; border-radius:8px;\\'>${rank}</div>'">
            </div>
        `;
    } else if (challenge.cover_url && !challenge.cover_url.includes('drive.google.com')) {
        // 개별 URL (API에서 직접 제공하는 경우)
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
