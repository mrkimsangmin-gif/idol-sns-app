// ============================================================
// 📅 자체 K-POP 컴백/데뷔 캘린더 모듈 (calendar.js)
// ============================================================
var calendarEvents = [];
var currentCalYear = 2026;
var currentCalMonth = 9; // 1-12
var calFilter = 'all'; // all, comeback, debut
var calGenderFilter = 'all'; // all, male, female
var calSearchQuery = '';
var calendarGenderMap = null; // slug or clean name -> '남자' | '여자'

async function ensureGenderMap() {
    if (calendarGenderMap) return;
    calendarGenderMap = {};
    try {
        const resp = await fetch('/data/namu-index.json?v=' + Date.now());
        const data = await resp.json();
        (data.groups || []).forEach(g => {
            const gen = g.gender || '';
            if (g.slug) calendarGenderMap[g.slug.toLowerCase()] = gen;
            if (g.name) calendarGenderMap[g.name.toLowerCase().replace(/\s/g, '')] = gen;
            if (g.name_en) calendarGenderMap[g.name_en.toLowerCase().replace(/\s/g, '')] = gen;
        });
    } catch (e) {
        console.warn('Failed to load namu-index.json for gender map', e);
    }
}

// 나무위키 인덱스에 아직 등록되지 않았거나 매칭되지 않은 그룹 보완 매핑 (전수조사 완료)
const fallbackGenderMap = {
    // 보이그룹
    'verivery': '남자',
    '베리베리': '남자',
    'big-ocean': '남자',
    '빅오션': '남자',
    'w3way': '남자',
    '위웨이': '남자',
    'b1a4': '남자',
    '비원에이포': '남자',
    'exo': '남자',
    '엑소': '남자',
    'nct wish': '남자',
    'nctwish': '남자',
    '엔시티위시': '남자',
    'genus': '남자',
    '제너스': '남자',
    'tnx': '남자',
    '티엔엑스': '남자',
    '미완소년': '남자',
    'v01d': '남자',
    '보이드': '남자',
    'b:dawn': '남자',
    'bdawn': '남자',
    '비던': '남자',
    'btob': '남자',
    '비투비': '남자',
    'bigbang': '남자',
    '빅뱅': '남자',
    '씨엔블루': '남자',
    'cnblue': '남자',
    'onewe': '남자',
    '원위': '남자',
    'splayit': '남자',
    '에스플릿': '남자',

    // 걸그룹 / 여성 솔로
    'x-in': '여자',
    '엑신': '여자',
    'hype princess': '여자',
    '하입프린세스': '여자',
    'xg': '여자',
    '엑스지': '여자',
    'girlset': '여자',
    '걸셋': '여자',
    'i.o.i': '여자',
    '아이오아이': '여자',
    '에이핑크': '여자',
    'apink': '여자',
    '제니': '여자',
    'jennie': '여자',
    'katseye': '여자',
    '캣츠아이': '여자',
    'queenz eye': '여자',
    '퀸즈아이': '여자'
};

function getEventGender(ev) {
    const slug = (ev.slug || '').toLowerCase();
    if (fallbackGenderMap[slug]) return fallbackGenderMap[slug];

    if (calendarGenderMap && slug && calendarGenderMap[slug]) {
        return calendarGenderMap[slug];
    }
    
    // 제목 전체(공백 제거) 및 토큰 검사
    const rawTitle = (ev.title || '').replace(/\(Comeback\)|\(Debut\)/gi, '').trim();
    const cleanFull = rawTitle.toLowerCase().replace(/\s/g, '');
    if (fallbackGenderMap[cleanFull]) return fallbackGenderMap[cleanFull];
    if (calendarGenderMap && calendarGenderMap[cleanFull]) return calendarGenderMap[cleanFull];

    const tokens = rawTitle.toLowerCase().split(/[\(\)\/\s]+/).filter(t => t.length >= 2);
    for (const token of tokens) {
        if (fallbackGenderMap[token]) return fallbackGenderMap[token];
        if (calendarGenderMap && calendarGenderMap[token]) return calendarGenderMap[token];
    }

    return '';
}

async function loadComebackCalendar() {
    const container = document.getElementById('calendarContainer');
    if (!container) return;
    
    await ensureGenderMap();

    if (calendarEvents.length === 0) {
        try {
            const resp = await fetch('/data/calendar.json?v=' + Date.now());
            const data = await resp.json();
            calendarEvents = data.events || [];
        } catch (e) {
            console.error('Failed to load calendar.json', e);
        }
    }
    renderCustomCalendar();
}

function changeCalMonth(delta) {
    currentCalMonth += delta;
    if (currentCalMonth > 12) {
        currentCalMonth = 1;
        currentCalYear++;
    } else if (currentCalMonth < 1) {
        currentCalMonth = 12;
        currentCalYear--;
    }
    renderCustomCalendar();
}

function setCalToday() {
    const now = new Date();
    currentCalYear = now.getFullYear();
    currentCalMonth = now.getMonth() + 1;
    renderCustomCalendar();
}

function filterCalendar(type) {
    calFilter = type;
    document.querySelectorAll('.cal-type-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.type === type);
    });
    renderCustomCalendar();
}

function filterCalGender(gender) {
    calGenderFilter = gender;
    document.querySelectorAll('.cal-gender-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.gender === gender);
    });
    renderCustomCalendar();
}

function searchCalendar(q) {
    calSearchQuery = q.trim().toLowerCase();
    renderCustomCalendar();
}

function renderCustomCalendar() {
    const container = document.getElementById('calendarContainer');
    if (!container) return;

    const monthStr = `${currentCalYear}-${String(currentCalMonth).padStart(2, '0')}`;
    const monthLabel = document.getElementById('calCurrentMonthLabel');
    if (monthLabel) monthLabel.innerText = `${currentCalYear}년 ${currentCalMonth}월`;

    // 이번 달 필터링된 이벤트
    const filtered = calendarEvents.filter(ev => {
        if (!ev.date) return false;
        if (!ev.date.startsWith(monthStr)) return false;
        
        const titleLower = ev.title.toLowerCase();
        const isDebut = titleLower.includes('debut') || titleLower.includes('데뷔');
        if (calFilter === 'comeback' && isDebut) return false;
        if (calFilter === 'debut' && !isDebut) return false;

        const gen = getEventGender(ev);
        if (calGenderFilter === 'male' && gen === '여자') return false;
        if (calGenderFilter === 'female' && gen === '남자') return false;
        
        if (calSearchQuery) {
            const text = (ev.title + ' ' + (ev.description || '') + ' ' + (ev.slug || '')).toLowerCase();
            if (!text.includes(calSearchQuery)) return false;
        }
        return true;
    });

    const firstDayIndex = new Date(currentCalYear, currentCalMonth - 1, 1).getDay();
    const daysInMonth = new Date(currentCalYear, currentCalMonth, 0).getDate();

    let gridHtml = '';
    const weekdays = ['일', '월', '화', '수', '목', '금', '토'];

    gridHtml += '<div class="cal-scroll-hint d-md-none text-primary bg-primary-subtle py-1 px-2 rounded small text-center mb-2"><i class="bi bi-arrows-expand me-1"></i>👉 달력을 좌우로 밀어서(스크롤) 전체 요일을 볼 수 있습니다</div>';
    gridHtml += '<div class="cal-scroll-wrapper">';
    gridHtml += '<div class="cal-scroll-inner">';
    gridHtml += '<div class="cal-grid-header">';
    weekdays.forEach((wd, i) => {
        const isSun = i === 0 ? ' text-danger' : (i === 6 ? ' text-primary' : '');
        gridHtml += `<div class="cal-header-cell${isSun}">${wd}</div>`;
    });
    gridHtml += '</div>';

    gridHtml += '<div class="cal-grid-body">';
    
    // 이전 달 빈 칸
    for (let i = 0; i < firstDayIndex; i++) {
        gridHtml += '<div class="cal-cell cal-cell-empty"></div>';
    }

    const today = new Date();
    const isThisYearMonth = today.getFullYear() === currentCalYear && (today.getMonth() + 1) === currentCalMonth;
    const todayDate = today.getDate();

    for (let d = 1; d <= daysInMonth; d++) {
        const dStr = `${monthStr}-${String(d).padStart(2, '0')}`;
        const isToday = isThisYearMonth && d === todayDate;
        const dayEvents = filtered.filter(ev => ev.date === dStr);

        gridHtml += `<div class="cal-cell${isToday ? ' cal-today' : ''}">`;
        gridHtml += `<div class="cal-date-number">${d}${isToday ? ' <span class="badge bg-primary cal-today-badge">오늘</span>' : ''}</div>`;
        gridHtml += '<div class="cal-events-list">';

        dayEvents.forEach(ev => {
            const isDebut = ev.title.includes('데뷔') || ev.title.includes('Debut');
            const gen = getEventGender(ev);
            let badgeClass = 'cal-badge-boy';
            if (gen === '여자') {
                badgeClass = 'cal-badge-girl';
            } else if (gen !== '남자') {
                badgeClass = 'cal-badge-neutral';
            }
            if (isDebut) {
                badgeClass += ' cal-badge-is-debut';
            }

            const cleanTitle = ev.title.replace(/\(Comeback\)|\(Debut\)/gi, '').trim();
            const debutTag = isDebut ? '<span class="cal-debut-tag">데뷔</span>' : '';
            
            gridHtml += `<div class="cal-event-badge ${badgeClass}" onclick="openCalEventModal('${ev.id}')" title="${cleanTitle}${isDebut ? ' (데뷔)' : ''}">`;
            gridHtml += `<span class="cal-event-dot"></span>`;
            gridHtml += `<span class="cal-event-text">${cleanTitle}</span>${debutTag}`;
            gridHtml += `</div>`;
        });

        gridHtml += '</div></div>';
    }

    gridHtml += '</div>'; // cal-grid-body
    gridHtml += '</div>'; // cal-scroll-inner
    gridHtml += '</div>'; // cal-scroll-wrapper

    // 하단 라인업 피드
    let summaryHtml = '<div class="mt-4"><h3 class="fs-6 fw-bold mb-3">이번 달 컴백/데뷔 라인업 (' + filtered.length + '팀)</h3>';
    if (filtered.length === 0) {
        summaryHtml += '<div class="text-center py-4 text-muted">해당 조건의 컴백/데뷔 일정이 없습니다.</div>';
    } else {
        summaryHtml += '<div class="row g-2">';
        filtered.forEach(ev => {
            const isDebut = ev.title.includes('데뷔') || ev.title.includes('Debut');
            const gen = getEventGender(ev);
            let genderBadge = '';
            if (gen === '여자') {
                genderBadge = '<span class="badge bg-danger-subtle text-danger border border-danger-subtle me-1">👧 걸그룹</span>';
            } else if (gen === '남자') {
                genderBadge = '<span class="badge bg-primary-subtle text-primary border border-primary-subtle me-1">👦 보이그룹</span>';
            }
            const typeBadge = isDebut ? '<span class="badge bg-warning text-dark me-1">데뷔</span>' : '<span class="badge bg-secondary me-1">컴백</span>';
            const cleanTitle = ev.title.replace(/\(Comeback\)|\(Debut\)/gi, '').trim();
            const d = ev.date.split('-').slice(1).join('/');
            
            summaryHtml += `<div class="col-12 col-md-6 col-lg-4">`;
            summaryHtml += `<div class="cal-summary-card p-2 border rounded bg-white shadow-sm d-flex align-items-center justify-content-between gap-2" onclick="openCalEventModal('${ev.id}')" style="cursor:pointer;">`;
            summaryHtml += `  <div class="d-flex align-items-center flex-wrap gap-1 text-truncate" style="min-width:0;">`;
            summaryHtml += `    <span class="fw-bold text-dark me-1 flex-shrink-0">${d}</span>${genderBadge}${typeBadge}<span class="fw-semibold text-truncate">${cleanTitle}</span>`;
            summaryHtml += `  </div>`;
            summaryHtml += `  <i class="bi bi-chevron-right text-muted small flex-shrink-0"></i>`;
            summaryHtml += `</div></div>`;
        });
        summaryHtml += '</div>';
    }
    summaryHtml += '</div>';

    container.innerHTML = gridHtml + summaryHtml;
}

function openCalEventModal(eventId) {
    const ev = calendarEvents.find(e => e.id === eventId);
    if (!ev) return;

    const modalTitle = document.getElementById('calModalTitle');
    const modalBody = document.getElementById('calModalBody');
    const modalFooter = document.getElementById('calModalFooter');
    if (!modalTitle || !modalBody) return;

    const cleanTitle = ev.title.replace(/\(Comeback\)|\(Debut\)/gi, '').trim();
    const isDebut = ev.title.includes('데뷔') || ev.title.includes('Debut');

    modalTitle.innerHTML = `<span class="badge ${isDebut ? 'bg-warning text-dark' : 'bg-primary'} me-2">${isDebut ? '데뷔' : '컴백'}</span> ${cleanTitle}`;
    
    let body = `<div class="mb-3"><span class="text-muted">예정 일시:</span> <strong class="text-dark">${ev.date}</strong></div>`;
    
    if (ev.description) {
        body += `<div class="p-3 bg-light rounded mb-3 small text-secondary">${ev.description}</div>`;
    }

    if (ev.url) {
        body += `<div class="mb-3"><a href="${ev.url}" target="_blank" class="btn btn-sm btn-outline-secondary"><i class="bi bi-newspaper me-1"></i>보도자료 원문 기사 보기 <i class="bi bi-box-arrow-up-right ms-1"></i></a></div>`;
    }

    if (ev.slug) {
        body += `<a href="/namu/${ev.slug}/" class="text-decoration-none d-block p-3 border rounded border-primary bg-primary bg-opacity-10 cal-profile-link-card transition-all" onclick="closeCalModalBeforeNav()">`;
        body += `  <div class="d-flex justify-content-between align-items-center">`;
        body += `    <div><div class="fw-bold text-primary">${cleanTitle} 상세 프로필</div><small class="text-muted">멤버 정보, 앨범 디스코그래피, 스트리밍</small></div>`;
        body += `    <span class="btn btn-sm btn-primary"><i class="bi bi-person-badge me-1"></i>팀 정보</span>`;
        body += `  </div>`;
        body += `</a>`;
    }

    modalBody.innerHTML = body;

    const startDate = ev.date.replace(/-/g, '');
    const gcalUrl = `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent('[K-POP] ' + cleanTitle + (isDebut ? ' 데뷔' : ' 컴백'))}&dates=${startDate}/${startDate}&details=${encodeURIComponent(ev.description || '아이엠콘텐츠 K-POP 일정')}&location=대한민국`;
    
    modalFooter.innerHTML = `
        <a href="${gcalUrl}" target="_blank" class="btn btn-sm btn-outline-success"><i class="bi bi-google me-1"></i>내 구글 캘린더에 담기</a>
        <button type="button" class="btn btn-sm btn-secondary" data-bs-dismiss="modal">닫기</button>
    `;

    const modalEl = document.getElementById('calEventModal');
    if (modalEl) {
        const bsModal = bootstrap.Modal.getOrCreateInstance(modalEl);
        bsModal.show();
    }
}

function closeCalModalBeforeNav() {
    const modalEl = document.getElementById('calEventModal');
    if (modalEl) {
        const bsModal = bootstrap.Modal.getInstance(modalEl);
        if (bsModal) bsModal.hide();
    }
}
