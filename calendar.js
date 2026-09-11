// ============================================================
// 📅 자체 K-POP 컴백/데뷔 캘린더 모듈 (calendar.js)
// ============================================================
let calendarEvents = [];
let currentCalYear = 2026;
let currentCalMonth = 9; // 1-12
let calFilter = 'all'; // all, comeback, debut
let calSearchQuery = '';

async function loadComebackCalendar() {
    const container = document.getElementById('calendarContainer');
    if (!container) return;
    
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
    document.querySelectorAll('.cal-filter-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.filter === type);
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
            const badgeClass = isDebut ? 'cal-badge-debut' : 'cal-badge-comeback';
            const cleanTitle = ev.title.replace(/\(Comeback\)|\(Debut\)/gi, '').trim();
            
            gridHtml += `<div class="cal-event-badge ${badgeClass}" onclick="openCalEventModal('${ev.id}')" title="${cleanTitle}">`;
            gridHtml += `<span class="cal-event-dot"></span>`;
            gridHtml += `<span class="cal-event-text">${cleanTitle}</span>`;
            gridHtml += `</div>`;
        });

        gridHtml += '</div></div>';
    }

    gridHtml += '</div>';

    // 하단 라인업 피드
    let summaryHtml = '<div class="mt-4"><h3 class="fs-6 fw-bold mb-3">이번 달 컴백/데뷔 라인업 (' + filtered.length + '팀)</h3>';
    if (filtered.length === 0) {
        summaryHtml += '<div class="text-center py-4 text-muted">해당 조건의 컴백/데뷔 일정이 없습니다.</div>';
    } else {
        summaryHtml += '<div class="row g-2">';
        filtered.forEach(ev => {
            const isDebut = ev.title.includes('데뷔') || ev.title.includes('Debut');
            const badgeClass = isDebut ? 'badge bg-warning text-dark' : 'badge bg-primary';
            const cleanTitle = ev.title.replace(/\(Comeback\)|\(Debut\)/gi, '').trim();
            const d = ev.date.split('-').slice(1).join('/');
            
            summaryHtml += `<div class="col-12 col-md-6 col-lg-4">`;
            summaryHtml += `<div class="cal-summary-card p-2 border rounded bg-white shadow-sm d-flex justify-content-between align-items-center" onclick="openCalEventModal('${ev.id}')" style="cursor:pointer;">`;
            summaryHtml += `  <div><span class="fw-bold me-2 text-dark">${d}</span> <span class="${badgeClass} me-1">${isDebut ? '데뷔' : '컴백'}</span> <strong>${cleanTitle}</strong></div>`;
            summaryHtml += `  <i class="bi bi-chevron-right text-muted small"></i>`;
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
