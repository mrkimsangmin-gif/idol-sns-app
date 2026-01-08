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

// ⚠️ 엔터뉴스 GAS 웹앱 URL
const ENTER_NEWS_API = "https://script.google.com/macros/s/AKfycbx76m7zd2J8omcDpzPP7DZoM6WhVEGr_gFMXwTv_AWmJB4234IxUKrRCuIw-oMsSGj4/exec";

// 전역 캐시 변수
let cachedData = [];       // API에서 받은 원시 데이터 저장
let cachedMonths = [];     // 사용 가능한 월 목록
let metadataCache = {};    // 아이돌 메타데이터 캐시 {name_gender: {data}}

// 프리페칭 상태 관리 (최적화)
let isPrefetching = false;           // 데이터 프리페칭 진행 중 플래그
let isMetadataPrefetching = false;   // 메타데이터 프리페칭 진행 중 플래그
let metadataLoadedFor = new Set();   // 이미 로드된 성별 추적 (예: Set(['남자', '여자']))
let isLoadingFull = false;           // 전체 데이터 백그라운드 로딩 중 플래그

// 초기 로드 (점진적 로딩: IndexedDB → API)
async function loadData(isInit = true) {
    console.log("⚡ Loading data with IndexedDB cache...");
    showLoading(true);

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

    try {
        // 🚀 0단계: IndexedDB에서 월 목록 조회
        let monthsFromDB = await getMonths(gender, sns).catch(() => null);

        if (monthsFromDB && monthsFromDB.length > 0) {
            console.log('⚡ 월 목록 IndexedDB 히트!');
            cachedMonths = monthsFromDB;
            updateMonthOptions(cachedMonths);

            // 최신 2개월 데이터 IndexedDB에서 로드 시도
            const latestMonth = cachedMonths[cachedMonths.length - 1];
            const prevMonth = cachedMonths.length > 1 ? cachedMonths[cachedMonths.length - 2] : null;

            const latestData = await getSnsData(gender, sns, latestMonth).catch(() => null);
            const prevData = prevMonth ? await getSnsData(gender, sns, prevMonth).catch(() => null) : null;

            if (latestData && latestData.length > 0) {
                console.log('⚡⚡ IndexedDB에서 즉시 로드 성공!');
                cachedData = prevData ? [...prevData, ...latestData] : latestData;

                // 최신 월 선택
                document.getElementById('month').value = latestMonth;
                document.getElementById('monthDropdown').innerHTML = formatYearMonth(latestMonth);

                // 즉시 렌더링 (0.1초 이내)
                renderList(latestMonth);

                // ⭐ Top 10 메타데이터 우선 로드
                prefetchTopIdolsMetadata(gender);

                showLoading(false);

                // 백그라운드에서 전체 데이터 업데이트
                setTimeout(() => loadFullDataInBackground(gender, sns), 100);
                return; // 조기 반환 (캐시 히트)
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

// 로딩 스피너 제어
function showLoading(isLoading) {
    const resultArea = document.getElementById('result-area');
    if (isLoading) {
        resultArea.innerHTML = '<div class="text-center py-5"><div class="spinner-border text-primary"></div><p class="mt-2">최신 데이터 불러오는 중...</p></div>';
    } else {
        // ✅ 로딩 완료 시 스피너만 제거 (카드는 renderList에서 처리)
        const spinner = resultArea.querySelector('.spinner-border');
        if (spinner) {
            spinner.parentElement.remove();
        }
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

        // 아이돌별 데이터 집계 (현재 선택된 gender, sns만 필터링)
        const idolMap = {};

        cachedData.forEach(item => {
            // 현재 선택된 gender, sns만 처리 (스프레드시트에는 gender 컬럼이 없으므로 API에서 온 데이터 기준으로만 필터링)
            // 참고: 현재 cachedData에는 gender 정보가 없어서 다른 방식으로 필터링 필요

            if (!idolMap[item.name]) {
                idolMap[item.name] = {
                    name: item.name,
                    group: item.group,
                    current: 0,
                    base: 0,
                    logo: item.logo || 'https://via.placeholder.com/60' // 로고가 없다면 대체 이미지
                };
            }

            if (item.date === targetMonth) idolMap[item.name].current = item.count;
            if (item.date === baseMonth) idolMap[item.name].base = item.count;
        });

        // 증감률 계산 및 정렬
        const rankedList = Object.values(idolMap)
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
            .filter(item => {
                // 검색 필터링 (띄어쓰기 무시)
                const searchInput = document.getElementById('searchInput');
                if (!searchInput) return true;

                const searchTerm = searchInput.value.trim().toLowerCase().replace(/\s/g, ''); // 공백 제거
                if (!searchTerm) return true;

                const nameNoSpace = item.name.toLowerCase().replace(/\s/g, ''); // 공백 제거
                const groupNoSpace = item.group.toLowerCase().replace(/\s/g, ''); // 공백 제거

                const nameMatch = nameNoSpace.includes(searchTerm);
                const groupMatch = groupNoSpace.includes(searchTerm);

                return nameMatch || groupMatch;
            })
            .sort((a, b) => b.current - a.current);

        // ✅ 렌더링 시작 전 기존 카드 모두 제거
        listContainer.innerHTML = '';

        // ✅ HTML을 배열에 수집 (성능 최적화)
        const htmlArray = [];

        rankedList.forEach((item, index) => {
            // 순위 계산 (동일 수치는 동일 순위)
            let rank;
            if (index === 0) {
                rank = 1;
            } else {
                const prevItem = rankedList[index - 1];
                if (item.current === prevItem.current) {
                    // 동일 수치면 이전 순위와 같음
                    rank = prevItem.rank;
                } else {
                    // 다른 수치면 index + 1 (건너뛰기)
                    rank = index + 1;
                }
            }
            item.rank = rank; // 순위 저장

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
                        <h5 class="m-0 fw-bold">${item.name}</h5>
                        <small class="text-muted">${item.group}</small>
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
    event.target.classList.add('active');
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

/**
 * 엔터뉴스 데이터 로드
 */
async function loadEnterNews() {
    if (!ENTER_NEWS_API) {
        alert('엔터뉴스 API가 설정되지 않았습니다.');
        return;
    }

    const loadingEl = document.getElementById('newsLoading');
    const containerEl = document.getElementById('newsContainer');

    loadingEl.style.display = 'block';
    containerEl.style.display = 'none';

    try {
        const response = await fetch(ENTER_NEWS_API);

        if (!response.ok) {
            throw new Error('네트워크 응답 오류');
        }

        const newsData = await response.json();
        renderEnterNews(newsData);

        trackEvent('enter_news_load', {
            news_count: newsData.length
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
        col.className = 'col-md-6 col-lg-4';

        const card = document.createElement('div');
        card.className = 'card h-100 border-0 shadow-sm news-card';
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
                    <small class="text-muted">#${index + 1}</small>
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
    return `${Math.floor(diff / 86400)}일 전`;
}

