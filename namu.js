// ========================================
// 📚 나무위키 검색 서비스
// ========================================

let namuIndexData = null;       // namu-index.json의 groups 배열
let namuRankingData = null;     // namu-ranking.json의 albums 배열
let namuCurrentGroup = null;    // 현재 표시 중인 그룹 상세 데이터
let namuCurrentChart = null;    // Chart.js 인스턴스
let namuIndexLoaded = false;    // 인덱스 로드 완료 여부
let namuRankingLoaded = false;  // 랭킹 로드 완료 여부
let namuRankingGender = 'all';  // 랭킹 성별 필터
let namuRankingYear = 'all';    // 랭킹 연도 필터
var groupAliasData = null;      // group-aliases.json 전체 데이터
var searchIndexData = null;     // search-index.json 역인덱스 데이터
var groupEmbedIndex = null;     // group-embed-index.json (lazy load, 임베딩 유사도 검색용)

// 캐시 버스팅 버전
const NAMU_DATA_VERSION = '20260803';

// ============================================================
// 진입점
// ============================================================

async function loadNamu() {
    if (!namuIndexLoaded) {
        document.getElementById('namuLoading').style.display = 'block';
        document.getElementById('namuSearchView').style.display = 'none';
        try {
            // 인덱스 + 별칭 + 역인덱스를 병렬 로드
            var [indexRes, aliasRes, searchIdxRes] = await Promise.all([
                fetch('/data/namu-index.json?v=' + NAMU_DATA_VERSION),
                fetch('/data/group-aliases.json?v=' + NAMU_DATA_VERSION).catch(function() { return null; }),
                fetch('/data/search-index.json?v=' + NAMU_DATA_VERSION).catch(function() { return null; })
            ]);
            var indexJson = await indexRes.json();
            // namu-index.json 구조: { generated, version, total, groups: [...] }
            namuIndexData = indexJson.groups;
            namuIndexLoaded = true;
            console.log('📚 나무위키 인덱스 로드 완료 (' + namuIndexData.length + '개 그룹)');

            // 별칭 데이터 로드
            if (aliasRes && aliasRes.ok) {
                groupAliasData = await aliasRes.json();
                console.log('🏷️ 별칭 데이터 로드 완료 (' + Object.keys(groupAliasData.groups || {}).length + '개 그룹)');
            }

            // 역인덱스 데이터 로드
            if (searchIdxRes && searchIdxRes.ok) {
                searchIndexData = await searchIdxRes.json();
                console.log('🔎 검색 인덱스 로드 완료 (' + (searchIndexData._meta ? searchIndexData._meta.total_terms : 0) + '개 용어)');
            }

            // 멤버-그룹 역인덱스 구축 (스마트 검색용)
            if (typeof buildMemberGroupIndex === 'function') buildMemberGroupIndex();
            // 추천 질문 칩 초기 렌더링
            if (typeof renderRecommendedChips === 'function') renderRecommendedChips();
        } catch (error) {
            console.error('나무위키 인덱스 로드 실패:', error);
            document.getElementById('namuSearchView').innerHTML =
                '<div class="text-center py-5 text-muted">데이터를 불러올 수 없습니다.</div>';
            document.getElementById('namuLoading').style.display = 'none';
            return;
        }
        document.getElementById('namuLoading').style.display = 'none';
        document.getElementById('namuSearchView').style.display = 'block';
    }

    // URL에 slug가 있으면 그룹 상세로 진입 (/namu/{slug} 또는 /namu/group/{slug})
    const path = window.location.pathname;
    const slugMatch = path.match(/^\/namu\/(?:group\/)?([a-z0-9_-]+)\/?$/);
    if (slugMatch && slugMatch[1] !== 'ranking') {
        loadNamuGroupBySlug(slugMatch[1]);
    } else if (path === '/namu/ranking') {
        // 랭킹 URL 직접 진입 시 랭킹 뷰 표시
        document.getElementById('namuSearchView').style.display = 'none';
        document.getElementById('namuRankingView').style.display = 'block';
        loadNamuRanking();
    } else {
        // 목록 뷰 표시 + 이전 검색 상태 초기화
        document.getElementById('namuGroupDetail').style.display = 'none';
        document.getElementById('namuSearchView').style.display = 'block';
        // 검색 입력창 비우기
        var searchInput = document.getElementById('namuSearchInput');
        if (searchInput) searchInput.value = '';
        // 스마트 검색 답변 숨기기
        var smartAnswer = document.getElementById('namuSmartAnswer');
        if (smartAnswer) { smartAnswer.style.display = 'none'; smartAnswer.innerHTML = ''; }
        // 자동완성 드롭다운 숨기기
        var searchResults = document.getElementById('namuSearchResults');
        if (searchResults) { searchResults.style.display = 'none'; searchResults.innerHTML = ''; }
        // 추천 질문 칩 다시 표시
        var chips = document.getElementById('namuRecommendedChips');
        if (chips) chips.style.display = '';
    }

    trackEvent('namu_page_load', {
        group_count: namuIndexData.length,
        event_category: 'content_view'
    });
}

// ============================================================
// 검색 자동완성
// ============================================================

(function setupNamuSearch() {
    document.addEventListener('DOMContentLoaded', function () {
        const input = document.getElementById('namuSearchInput');
        if (!input) return;

        let searchTimeout = null;

        input.addEventListener('input', function () {
            const term = this.value.trim().toLowerCase().replace(/\s/g, '');

            if (term.length < 1) {
                document.getElementById('namuSearchResults').style.display = 'none';
                return;
            }

            if (!namuIndexData) return;

            // 한글명, 영문명, 소속사, 별칭으로 검색
            const results = namuIndexData.filter(function (g) {
                if (g.name.toLowerCase().replace(/\s/g, '').includes(term) ||
                    g.name_en.toLowerCase().replace(/\s/g, '').includes(term) ||
                    (g.agency || '').toLowerCase().replace(/\s/g, '').includes(term)) {
                    return true;
                }
                // 별칭 매칭 (groupAliasData가 로드된 경우)
                if (groupAliasData && groupAliasData.groups) {
                    var aliasEntry = groupAliasData.groups[g.name];
                    if (aliasEntry && aliasEntry.aliases) {
                        for (var ai = 0; ai < aliasEntry.aliases.length; ai++) {
                            if (aliasEntry.aliases[ai].toLowerCase().replace(/\s/g, '').includes(term)) {
                                return true;
                            }
                        }
                    }
                    // 팬덤명 매칭
                    if (aliasEntry && aliasEntry.fandom &&
                        aliasEntry.fandom.toLowerCase().includes(term)) {
                        return true;
                    }
                }
                return false;
            });

            renderNamuSearchDropdown(results.slice(0, 8));

            // GA4 (debounced)
            clearTimeout(searchTimeout);
            if (term.length >= 2) {
                searchTimeout = setTimeout(function () {
                    trackEvent('namu_search', {
                        search_term: term,
                        result_count: results.length,
                        event_category: 'engagement'
                    });
                }, 1000);
            }
        });

        // Enter 키: 스마트 검색 실행
        input.addEventListener('keydown', function (e) {
            if (e.key === 'Enter') {
                e.preventDefault();
                document.getElementById('namuSearchResults').style.display = 'none';
                if (this.value.trim().length >= 2 && typeof handleSmartSearch === 'function') {
                    handleSmartSearch(this.value.trim());
                }
            }
        });

        // 드롭다운 외부 클릭 시 닫기
        document.addEventListener('click', function (e) {
            if (!e.target.closest('.namu-search-container')) {
                document.getElementById('namuSearchResults').style.display = 'none';
            }
        });
    });
})();

// ============================================================
// 검색 드롭다운
// ============================================================

function renderNamuSearchDropdown(results) {
    var container = document.getElementById('namuSearchResults');
    if (results.length === 0) {
        container.style.display = 'none';
        return;
    }

    var html = [];
    for (var i = 0; i < results.length; i++) {
        var g = results[i];
        var genderClass = g.gender === '여자' ? 'female' : 'male';
        var genderIcon = g.gender === '여자' ? '♀' : '♂';
        var debutText = g.debut_year ? g.debut_year + '년 데뷔' : '';

        html.push(
            '<div class="namu-search-item" onclick="loadNamuGroupBySlug(\'' + g.slug + '\')">' +
            '<span class="namu-search-gender ' + genderClass + '">' + genderIcon + '</span>' +
            '<div class="namu-search-info">' +
            '<div class="namu-search-name">' + g.name + ' <small class="text-muted">' + g.name_en + '</small></div>' +
            '<div class="namu-search-meta">' + (g.agency || '-') + ' · ' + debutText + '</div>' +
            '</div>' +
            '<span class="text-muted small">' + g.album_count + '앨범 · ' + g.member_count + '명</span>' +
            '</div>'
        );
    }
    container.innerHTML = html.join('');
    container.style.display = 'block';
}

// ============================================================
// 그룹 카드 그리드
// ============================================================


// ============================================================
// 그룹 상세 로딩
// ============================================================

async function loadNamuGroupBySlug(slug) {
    // 뷰 전환
    document.getElementById('namuSearchView').style.display = 'none';
    document.getElementById('namuRankingView').style.display = 'none';
    document.getElementById('namuGroupDetail').style.display = 'block';
    document.getElementById('namuSearchInput').value = '';
    document.getElementById('namuSearchResults').style.display = 'none';

    // 로딩 표시
    document.getElementById('namuDetailContent').innerHTML =
        '<div class="text-center py-5">' +
        '<div class="spinner-border text-primary" role="status"></div>' +
        '<p class="mt-2 text-muted">그룹 정보를 불러오는 중...</p></div>';

    try {
        var response = await fetch('/data/namu-groups/' + slug + '.json?v=' + NAMU_DATA_VERSION);
        if (!response.ok) throw new Error('Group not found');
        namuCurrentGroup = await response.json();

        // URL 업데이트 + SEO 메타 태그 동적 갱신
        var groupTitle = namuCurrentGroup.name + ' (' + namuCurrentGroup.name_en + ') | 나무위키 | 아이엠콘텐츠';
        history.pushState({ pageId: 'namu', namuSlug: slug }, groupTitle, '/namu/' + slug + '/');
        document.title = groupTitle;

        // SEO: meta description + OG 태그 동적 업데이트 (AI 봇/소셜 공유 대응)
        var info = namuCurrentGroup.info || {};
        var memberNames = (info['멤버목록'] || (namuCurrentGroup.members || []).map(function(m){ return m.name; }).join(', '));
        var groupDesc = namuCurrentGroup.name + '(' + namuCurrentGroup.name_en + ') - ' +
            (info['소속사'] || '') + ' 소속 K-POP ' + (info['활동유형'] || '아이돌 그룹') +
            '. 데뷔일: ' + (info['데뷔일'] || '') +
            ', 멤버: ' + memberNames +
            (info['팬덤명'] ? ', 팬덤: ' + info['팬덤명'] : '') +
            '. 앨범 판매량, 멤버 프로필, 나무위키 정보를 제공합니다.';
        var descMeta = document.querySelector('meta[name="description"]');
        if (descMeta) descMeta.setAttribute('content', groupDesc);
        var ogDesc = document.querySelector('meta[property="og:description"]');
        if (ogDesc) ogDesc.setAttribute('content', groupDesc);
        var ogTitle = document.querySelector('meta[property="og:title"]');
        if (ogTitle) ogTitle.setAttribute('content', groupTitle);
        var ogUrl = document.querySelector('meta[property="og:url"]');
        if (ogUrl) ogUrl.setAttribute('content', 'https://aimcontents.com/namu/' + slug + '/');
        var canonical = document.querySelector('link[rel="canonical"]');
        if (canonical) canonical.setAttribute('href', 'https://aimcontents.com/namu/' + slug + '/');

        // SEO: 동적 Schema.org JSON-LD 삽입 (AI 봇 인용 최적화)
        updateNamuGroupJsonLd(namuCurrentGroup, slug);

        renderNamuGroupHeader(namuCurrentGroup);
        switchNamuDetailTab('profile');

        trackEvent('namu_group_view', {
            group_name: namuCurrentGroup.name,
            group_slug: slug,
            event_category: 'content_view'
        });
    } catch (error) {
        console.error('그룹 상세 로드 실패:', error);
        document.getElementById('namuDetailContent').innerHTML =
            '<div class="text-center py-5 text-muted">그룹 정보를 불러올 수 없습니다.</div>';
    }
}

function backToNamuList() {
    document.getElementById('namuGroupDetail').style.display = 'none';
    document.getElementById('namuSearchView').style.display = 'block';
    namuCurrentGroup = null;

    if (namuCurrentChart) {
        namuCurrentChart.destroy();
        namuCurrentChart = null;
    }

    history.pushState({ pageId: 'namu' }, '아이돌 정보 (소속사/팬덤/데뷔일) | 아이엠콘텐츠', '/namu');
    document.title = '아이돌 정보 (소속사/팬덤/데뷔일) | 아이엠콘텐츠';

    // SEO: 목록 페이지 메타 태그 복원 + 동적 JSON-LD 제거
    if (typeof updateMetaDescription === 'function') updateMetaDescription('namu');
    removeNamuGroupJsonLd();
}

// ============================================================
// SEO: 동적 Schema.org JSON-LD (그룹 상세 페이지용)
// ============================================================

function updateNamuGroupJsonLd(group, slug) {
    // 기존 동적 JSON-LD 제거
    var existing = document.getElementById('namu-dynamic-jsonld');
    if (existing) existing.remove();

    var info = group.info || {};
    var members = (group.members || []).map(function(m) {
        return { '@type': 'Person', 'name': m.name, 'birthDate': m['생년월일'] || '' };
    });
    // 앨범 중 판매량 있는 것만 (상위 5개)
    var albums = (group.albums || []).filter(function(a) {
        return a['초동_한터'] && a['초동_한터'] !== '-' && a['초동_한터'] !== '';
    }).slice(0, 5).map(function(a) {
        return { '@type': 'MusicAlbum', 'name': a.title, 'datePublished': a['발매일'] || '', 'albumProductionType': a.type || '' };
    });

    var jsonLd = {
        '@context': 'https://schema.org',
        '@type': 'MusicGroup',
        'name': group.name,
        'alternateName': group.name_en,
        'url': 'https://aimcontents.com/namu/' + slug + '/',
        'genre': 'K-POP',
        'foundingDate': info['데뷔일'] || '',
        'numberOfEmployees': (group.members || []).length,
        'member': members
    };
    if (info['소속사']) jsonLd['parentOrganization'] = { '@type': 'Organization', 'name': info['소속사'] };
    if (info['팬덤명']) jsonLd['funder'] = info['팬덤명'];
    if (albums.length > 0) jsonLd['album'] = albums;

    var script = document.createElement('script');
    script.id = 'namu-dynamic-jsonld';
    script.type = 'application/ld+json';
    script.textContent = JSON.stringify(jsonLd);
    document.head.appendChild(script);
}

function removeNamuGroupJsonLd() {
    var existing = document.getElementById('namu-dynamic-jsonld');
    if (existing) existing.remove();
}

// ============================================================
// 그룹 헤더
// ============================================================

function renderNamuGroupHeader(group) {
    var genderBadgeClass = group.gender === '여자' ? 'bg-danger-subtle text-danger' : 'bg-primary-subtle text-primary';
    var namuLink = group.namu_url
        ? '<a href="' + group.namu_url + '" target="_blank" rel="noopener" class="btn btn-outline-success btn-sm ms-2">나무위키에서 보기</a>'
        : '';

    document.getElementById('namuGroupHeader').innerHTML =
        '<div class="d-flex align-items-center gap-2 flex-wrap">' +
        '<h3 class="fw-bold mb-0">' + group.name + '</h3>' +
        '<span class="text-muted">' + group.name_en + '</span>' +
        '<span class="badge ' + genderBadgeClass + '">' + group.gender + '</span>' +
        namuLink +
        '</div>';
}

// ============================================================
// 상세 탭 전환
// ============================================================

function switchNamuDetailTab(tabId) {
    document.querySelectorAll('.namu-detail-tab').forEach(function (t) {
        t.classList.toggle('active', t.dataset.dtab === tabId);
    });

    if (namuCurrentChart && tabId !== 'chart') {
        namuCurrentChart.destroy();
        namuCurrentChart = null;
    }

    var content = document.getElementById('namuDetailContent');

    switch (tabId) {
        case 'profile': renderNamuProfile(content, namuCurrentGroup); break;
        case 'members': renderNamuMembers(content, namuCurrentGroup); break;
        case 'discography': renderNamuDiscography(content, namuCurrentGroup); break;
        case 'chart': renderNamuChart(content, namuCurrentGroup); break;
        case 'streaming': renderNamuStreaming(content, namuCurrentGroup); break;
    }

    trackEvent('namu_tab_switch', {
        tab: tabId,
        group_name: namuCurrentGroup ? namuCurrentGroup.name : '',
        event_category: 'engagement'
    });
}

// ============================================================
// 프로필 탭
// ============================================================

function renderNamuProfile(container, group) {
    var info = group.info || {};
    if (typeof info !== 'object' || Array.isArray(info)) info = {};

    var infoFields = [
        { key: '소속사', icon: '🏢' },
        { key: '레이블', icon: '💿' },
        { key: '데뷔일', icon: '📅' },
        { key: '결성일', icon: '📋' },
        { key: '활동유형', icon: '🎤' },
        { key: '팬덤명', icon: '💕' },
        { key: '응원봉', icon: '🔦' },
        { key: '멤버수', icon: '👥' },
        { key: '유통사', icon: '📦' },
        { key: '그룹명뜻', icon: '💡' }
    ];

    var snsFields = ['인스타그램', '유튜브', 'X(트위터)', '틱톡'];

    var infoHtml = '';
    for (var i = 0; i < infoFields.length; i++) {
        var f = infoFields[i];
        var val = info[f.key];
        if (!val || val === '') continue;
        infoHtml += '<li class="list-group-item px-0"><strong>' + f.icon + ' ' + f.key + ':</strong> ' + val + '</li>';
    }

    var snsHtml = '';
    var hasSns = false;
    for (var j = 0; j < snsFields.length; j++) {
        var url = info[snsFields[j]];
        if (url && url !== '') {
            hasSns = true;
            snsHtml += '<a href="' + url + '" target="_blank" rel="noopener" class="btn btn-outline-secondary btn-sm">' + snsFields[j] + '</a>';
        }
    }

    // 스트리밍 통계 섹션
    var streamHtml = '';
    var st = group.streaming || {};
    var sp = st.spotify || {};
    var yt = st.ytmusic || {};

    if (sp.monthly_listeners || yt.total_views) {
        streamHtml += '<h5 class="fw-bold mt-4 mb-3">스트리밍</h5>';
        streamHtml += '<div class="row g-2 mb-3">';

        if (sp.monthly_listeners) {
            var mlStr = sp.monthly_listeners >= 1000000
                ? (sp.monthly_listeners / 1000000).toFixed(1) + 'M'
                : sp.monthly_listeners >= 1000
                ? (sp.monthly_listeners / 1000).toFixed(0) + 'K'
                : sp.monthly_listeners.toLocaleString();
            var spUrl = sp.spotify_id ? 'https://open.spotify.com/artist/' + sp.spotify_id : '#';
            streamHtml += '<div class="col-6"><div class="card bg-light border-0 p-2 text-center">' +
                '<div class="text-muted small">Spotify 월간 리스너</div>' +
                '<div class="fw-bold fs-5" style="color:#1DB954">' + mlStr + '</div>' +
                '<a href="' + spUrl + '" target="_blank" class="btn btn-sm btn-outline-success mt-1" style="font-size:0.7rem">Spotify에서 보기</a>' +
                '</div></div>';
        }

        if (yt.total_views) {
            var tvStr = yt.total_views >= 1000000000
                ? (yt.total_views / 1000000000).toFixed(1) + 'B'
                : yt.total_views >= 1000000
                ? (yt.total_views / 1000000).toFixed(0) + 'M'
                : yt.total_views.toLocaleString();
            streamHtml += '<div class="col-6"><div class="card bg-light border-0 p-2 text-center">' +
                '<div class="text-muted small">YT Music 총 조회수</div>' +
                '<div class="fw-bold fs-5" style="color:#FF0000">' + tvStr + '</div>' +
                '<div class="text-muted" style="font-size:0.7rem">' + (yt.track_count || 0) + '곡</div>' +
                '</div></div>';
        }
        streamHtml += '</div>';

        // Spotify Top 트랙
        var topTracks = (sp.top_tracks || []);
        if (topTracks.length > 0) {
            streamHtml += '<div class="small fw-bold mb-1" style="color:#1DB954">Spotify Top 트랙</div>';
            streamHtml += '<ul class="list-group list-group-flush small">';
            for (var ti = 0; ti < topTracks.length; ti++) {
                var tt = topTracks[ti];
                var pcStr = tt.play_count >= 1000000
                    ? (tt.play_count / 1000000).toFixed(1) + 'M'
                    : tt.play_count >= 1000
                    ? (tt.play_count / 1000).toFixed(0) + 'K'
                    : tt.play_count.toLocaleString();
                var trackUrl = tt.uri ? 'https://open.spotify.com/track/' + tt.uri.split(':').pop() : '#';
                streamHtml += '<li class="list-group-item px-0 py-1 d-flex justify-content-between">' +
                    '<a href="' + trackUrl + '" target="_blank" class="text-decoration-none text-dark">' + (ti + 1) + '. ' + tt.title + '</a>' +
                    '<span class="text-muted">' + pcStr + '</span></li>';
            }
            streamHtml += '</ul>';
        }
    }

    container.innerHTML =
        '<div class="card border-0 shadow-sm p-3">' +
        '<h5 class="fw-bold mb-3">기본 정보</h5>' +
        '<ul class="list-group list-group-flush">' + infoHtml + '</ul>' +
        (hasSns ? '<h5 class="fw-bold mt-4 mb-3">SNS</h5><div class="d-flex flex-wrap gap-2">' + snsHtml + '</div>' : '') +
        streamHtml +
        '</div>';
}

// ============================================================
// 멤버 탭
// ============================================================

function renderNamuMembers(container, group) {
    var members = group.members || [];
    if (members.length === 0) {
        container.innerHTML = '<div class="text-center py-4 text-muted">멤버 정보가 없습니다.</div>';
        return;
    }

    var html = '<div class="row g-3">';
    for (var i = 0; i < members.length; i++) {
        var m = members[i];
        html += '<div class="col-6 col-md-4 col-lg-3">' +
            '<div class="card border-0 shadow-sm h-100 p-3">' +
            '<h6 class="fw-bold mb-2">' + (m.name || '-') + '</h6>' +
            (m['본명'] ? '<div class="text-muted small">' + m['본명'] + '</div>' : '') +
            (m['생년월일'] ? '<div class="small mt-1">🎂 ' + m['생년월일'] + '</div>' : '') +
            (m['출신지'] ? '<div class="small">📍 ' + m['출신지'] + '</div>' : '') +
            (m['역할'] ? '<div class="small">🎵 ' + m['역할'] + '</div>' : '') +
            (m.info ? '<div class="text-muted small mt-2" style="font-size:0.75rem;">' + m.info + '</div>' : '') +
            '</div></div>';
    }
    html += '</div>';
    container.innerHTML = html;
}

// ============================================================
// 디스코그래피 탭
// ============================================================

function renderNamuDiscography(container, group) {
    var albums = group.albums || [];
    if (albums.length === 0) {
        container.innerHTML = '<div class="text-center py-4 text-muted">앨범 정보가 없습니다.</div>';
        return;
    }

    // 발매일 역순 정렬
    var sorted = albums.slice().sort(function (a, b) {
        var dateA = (a['발매일'] || '').replace(/\./g, '-');
        var dateB = (b['발매일'] || '').replace(/\./g, '-');
        return dateB.localeCompare(dateA);
    });

    var rows = '';
    for (var i = 0; i < sorted.length; i++) {
        var a = sorted[i];
        var hanterVal = a['초동_한터'] && a['초동_한터'] !== '-' ? a['초동_한터'] : '-';
        var circleVal = a['초동_써클'] && a['초동_써클'] !== '-' ? a['초동_써클'] : '-';
        var hasSales = hanterVal !== '-' || circleVal !== '-';
        var salesClass = hasSales ? 'fw-bold' : 'text-muted';

        rows += '<tr>' +
            '<td class="fw-bold">' + (a.title || '-') + '</td>' +
            '<td><span class="badge bg-light text-dark">' + (a.type || '-') + '</span></td>' +
            '<td>' + (a['발매일'] || '-') + '</td>' +
            '<td class="text-end ' + salesClass + '">' + hanterVal + '</td>' +
            '<td class="text-end ' + salesClass + '">' + circleVal + '</td>' +
            '</tr>';
    }

    container.innerHTML =
        '<div class="table-responsive">' +
        '<table class="table table-hover namu-album-table">' +
        '<thead><tr>' +
        '<th>앨범명</th><th>유형</th><th>발매일</th>' +
        '<th class="text-end">초동(한터)</th><th class="text-end">초동(써클)</th>' +
        '</tr></thead>' +
        '<tbody>' + rows + '</tbody>' +
        '</table></div>' +
        '<small class="text-muted">* 판매량의 ** 표시는 나무위키 원본의 근사치입니다</small>';
}

// ============================================================
// 스트리밍 탭 — Spotify + YTMusic 곡별 데이터
// ============================================================

function _fmtViews(n) {
    // 조회수 포맷: 1.2B, 345M, 12K
    if (!n || n === 0) return '-';
    if (n >= 1e9) return (n / 1e9).toFixed(1) + 'B';
    if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
    if (n >= 1e3) return (n / 1e3).toFixed(0) + 'K';
    return n.toLocaleString();
}

function renderNamuStreaming(container, group) {
    var st = group.streaming || {};
    var sp = st.spotify || {};
    var yt = st.ytmusic || {};

    if (!sp.monthly_listeners && !yt.total_views) {
        container.innerHTML = '<div class="text-center py-4 text-muted">스트리밍 데이터가 없습니다.</div>';
        return;
    }

    var html = '';

    // === 요약 카드 ===
    html += '<div class="row g-2 mb-4">';
    if (sp.monthly_listeners) {
        html += '<div class="col-6 col-md-3"><div class="card border-0 shadow-sm p-2 text-center">' +
            '<div class="text-muted small">Spotify 월간 리스너</div>' +
            '<div class="fw-bold fs-5" style="color:#1DB954">' + _fmtViews(sp.monthly_listeners) + '</div>' +
            '</div></div>';
    }
    if (yt.total_views) {
        html += '<div class="col-6 col-md-3"><div class="card border-0 shadow-sm p-2 text-center">' +
            '<div class="text-muted small">YT Music 총 조회수</div>' +
            '<div class="fw-bold fs-5" style="color:#FF0000">' + _fmtViews(yt.total_views) + '</div>' +
            '</div></div>';
    }
    if (yt.track_count) {
        html += '<div class="col-6 col-md-3"><div class="card border-0 shadow-sm p-2 text-center">' +
            '<div class="text-muted small">YT Music 곡 수</div>' +
            '<div class="fw-bold fs-5">' + yt.track_count + '곡</div>' +
            '</div></div>';
    }
    if (yt.mean_views) {
        html += '<div class="col-6 col-md-3"><div class="card border-0 shadow-sm p-2 text-center">' +
            '<div class="text-muted small">곡당 평균 조회수</div>' +
            '<div class="fw-bold fs-5">' + _fmtViews(yt.mean_views) + '</div>' +
            '</div></div>';
    }
    html += '</div>';

    // === Spotify Top 트랙 테이블 ===
    var topTracks = sp.top_tracks || [];
    if (topTracks.length > 0) {
        html += '<h6 class="fw-bold mb-2" style="color:#1DB954">Spotify Top 트랙</h6>';
        html += '<div class="table-responsive mb-4"><table class="table table-sm table-hover">';
        html += '<thead><tr><th>#</th><th>곡명</th><th class="text-end">재생수</th><th></th></tr></thead><tbody>';
        for (var i = 0; i < topTracks.length; i++) {
            var t = topTracks[i];
            var trackUrl = t.uri ? 'https://open.spotify.com/track/' + t.uri.split(':').pop() : '#';
            html += '<tr>' +
                '<td>' + (i + 1) + '</td>' +
                '<td>' + t.title + '</td>' +
                '<td class="text-end fw-bold">' + _fmtViews(t.play_count) + '</td>' +
                '<td><a href="' + trackUrl + '" target="_blank" class="btn btn-sm btn-outline-success py-0" style="font-size:0.7rem">Play</a></td>' +
                '</tr>';
        }
        html += '</tbody></table></div>';
    }

    // === YTMusic 앨범별 곡 테이블 ===
    var ytAlbums = yt.albums || [];
    if (ytAlbums.length > 0) {
        html += '<h6 class="fw-bold mb-2" style="color:#FF0000">YouTube Music 앨범별 조회수</h6>';
        for (var ai = 0; ai < ytAlbums.length; ai++) {
            var album = ytAlbums[ai];
            var tracks = album.tracks || [];
            if (tracks.length === 0) continue;

            var albumTotal = 0;
            for (var tj = 0; tj < tracks.length; tj++) {
                albumTotal += (tracks[tj].youtube_views || 0);
            }

            html += '<div class="mb-3">';
            html += '<div class="d-flex justify-content-between align-items-center mb-1">' +
                '<span class="fw-bold small">' + album.title + ' <span class="text-muted fw-normal">(' + (album.year || '') + ')</span></span>' +
                '<span class="text-muted small">' + _fmtViews(albumTotal) + '</span></div>';

            html += '<div class="table-responsive"><table class="table table-sm mb-0" style="font-size:0.85rem">';
            html += '<thead><tr><th>#</th><th>곡명</th><th class="text-end">조회수</th><th></th></tr></thead><tbody>';

            // 조회수 내림차순 정렬
            var sortedTracks = tracks.slice().sort(function(a, b) {
                return (b.youtube_views || 0) - (a.youtube_views || 0);
            });

            for (var tk = 0; tk < sortedTracks.length; tk++) {
                var tr = sortedTracks[tk];
                var ytUrl = tr.video_id ? 'https://music.youtube.com/watch?v=' + tr.video_id : '#';
                var viewsClass = (tr.youtube_views || 0) >= 10000000 ? 'fw-bold' : '';
                html += '<tr>' +
                    '<td class="text-muted">' + (tk + 1) + '</td>' +
                    '<td>' + tr.title + '</td>' +
                    '<td class="text-end ' + viewsClass + '">' + _fmtViews(tr.youtube_views) + '</td>' +
                    '<td><a href="' + ytUrl + '" target="_blank" class="text-danger" style="font-size:0.7rem;text-decoration:none">▶</a></td>' +
                    '</tr>';
            }
            html += '</tbody></table></div></div>';
        }
    }

    if (st.collected_at) {
        html += '<small class="text-muted">수집일: ' + st.collected_at + '</small>';
    }

    container.innerHTML = html;
}

// ============================================================
// 판매량 차트 탭
// ============================================================

function parseSalesValue(str) {
    if (!str || str === '-' || str === '') return 0;
    return parseInt(str.replace(/[,*]/g, ''), 10) || 0;
}

function renderNamuChart(container, group) {
    var albums = group.albums || [];

    // 초동 데이터 있는 앨범만, 발매일 오름차순
    var chartAlbums = albums.filter(function (a) {
        return (a['초동_한터'] && a['초동_한터'] !== '-') ||
            (a['초동_써클'] && a['초동_써클'] !== '-');
    }).sort(function (a, b) {
        var dateA = (a['발매일'] || '').replace(/\./g, '-');
        var dateB = (b['발매일'] || '').replace(/\./g, '-');
        return dateA.localeCompare(dateB);
    });

    if (chartAlbums.length === 0) {
        container.innerHTML = '<div class="text-center py-4 text-muted">판매량 데이터가 있는 앨범이 없습니다.</div>';
        return;
    }

    if (typeof Chart === 'undefined') {
        container.innerHTML = '<div class="text-center py-4 text-muted">차트 라이브러리를 불러오는 중입니다. 잠시 후 다시 시도해주세요.</div>';
        return;
    }

    container.innerHTML = '<canvas id="namuSalesChart" style="max-height: 400px;"></canvas>';

    var labels = chartAlbums.map(function (a) { return a.title; });
    var hanterData = chartAlbums.map(function (a) { return parseSalesValue(a['초동_한터']); });
    var circleData = chartAlbums.map(function (a) { return parseSalesValue(a['초동_써클']); });

    var hasHanter = hanterData.some(function (v) { return v > 0; });
    var hasCircle = circleData.some(function (v) { return v > 0; });

    var datasets = [];
    if (hasHanter) {
        datasets.push({
            label: '초동 (한터)',
            data: hanterData,
            backgroundColor: 'rgba(0, 97, 242, 0.7)',
            borderColor: '#0061f2',
            borderWidth: 1
        });
    }
    if (hasCircle) {
        datasets.push({
            label: '초동 (써클)',
            data: circleData,
            backgroundColor: 'rgba(0, 198, 249, 0.7)',
            borderColor: '#00c6f9',
            borderWidth: 1
        });
    }

    if (namuCurrentChart) {
        namuCurrentChart.destroy();
        namuCurrentChart = null;
    }

    var ctx = document.getElementById('namuSalesChart').getContext('2d');
    namuCurrentChart = new Chart(ctx, {
        type: 'bar',
        data: { labels: labels, datasets: datasets },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { position: 'top' },
                tooltip: {
                    callbacks: {
                        label: function (context) {
                            return context.dataset.label + ': ' + context.raw.toLocaleString() + '장';
                        }
                    }
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    ticks: {
                        callback: function (value) {
                            if (value >= 1000000) return (value / 1000000).toFixed(1) + 'M';
                            if (value >= 1000) return (value / 1000).toFixed(0) + 'K';
                            return value;
                        }
                    }
                },
                x: {
                    ticks: {
                        maxRotation: 45,
                        minRotation: 0
                    }
                }
            }
        }
    });
}

// ============================================================
// 크로스 그룹 랭킹
// ============================================================

async function loadNamuRanking() {
    if (namuRankingLoaded && namuRankingData) {
        renderNamuRanking();
        return;
    }

    try {
        var response = await fetch('/data/namu-ranking.json?v=' + NAMU_DATA_VERSION);
        var rankingJson = await response.json();
        // namu-ranking.json 구조: plain array 또는 { albums: [...] }
        var rawAlbums = Array.isArray(rankingJson) ? rankingJson : (rankingJson.albums || []);
        // numeric 필드 보강 (없으면 문자열에서 파싱)
        rawAlbums.forEach(function(a) {
            if (!a['초동_써클_numeric']) {
                var ccSrc = a['초동_써클'] || '0';
                a['초동_써클_numeric'] = parseInt(ccSrc.replace(/[,*]/g, '')) || 0;
            }
            if (!a['초동_한터_numeric']) {
                var htSrc = a['초동_한터'] || '0';
                a['초동_한터_numeric'] = parseInt(htSrc.replace(/[,*]/g, '')) || 0;
            }
            // 한터 우선 정렬용 (한터 값 있으면 한터, 없으면 써클)
            if (!a['초동_best_numeric']) {
                a['초동_best_numeric'] = a['초동_한터_numeric'] || a['초동_써클_numeric'];
            }
            if (!a['group_slug']) a['group_slug'] = a['slug'] || '';
        });
        namuRankingData = rawAlbums;
        namuRankingLoaded = true;

        // 연도 필터 생성
        var yearSet = {};
        for (var i = 0; i < namuRankingData.length; i++) {
            var year = (namuRankingData[i].release_date || '').substring(0, 4);
            if (year.length === 4) yearSet[year] = true;
        }
        var years = Object.keys(yearSet).sort().reverse();

        var yearSelect = document.getElementById('namuRankingYear');
        // 기존 옵션 초기화 (전체 연도만 유지)
        while (yearSelect.options.length > 1) {
            yearSelect.remove(1);
        }
        for (var j = 0; j < years.length; j++) {
            var opt = document.createElement('option');
            opt.value = years[j];
            opt.textContent = years[j] + '년';
            yearSelect.appendChild(opt);
        }

        renderNamuRanking();

        trackEvent('namu_ranking_load', {
            album_count: namuRankingData.length,
            event_category: 'content_view'
        });
    } catch (error) {
        console.error('나무위키 랭킹 로드 실패:', error);
        document.getElementById('namuRankingBody').innerHTML =
            '<tr><td colspan="6" class="text-center text-muted py-4">랭킹 데이터를 불러올 수 없습니다.</td></tr>';
    }
}

function filterNamuRanking(type, value) {
    if (type === 'gender') {
        namuRankingGender = value;
        document.querySelectorAll('#namuRankingView .namu-filter-btn').forEach(function (btn) {
            btn.classList.toggle('active', btn.dataset.gender === value);
        });
    } else if (type === 'year') {
        namuRankingYear = value;
    }
    renderNamuRanking();
}

function renderNamuRanking() {
    if (!namuRankingData) return;

    var filtered = namuRankingData.slice();

    // 성별 필터
    if (namuRankingGender !== 'all') {
        filtered = filtered.filter(function (a) { return a.gender === namuRankingGender; });
    }

    // 연도 필터
    if (namuRankingYear !== 'all') {
        filtered = filtered.filter(function (a) { return (a.release_date || '').startsWith(namuRankingYear); });
    }

    // 초동 내림차순 (한터 우선 → 써클 폴백)
    filtered.sort(function (a, b) {
        return (b['초동_best_numeric'] || 0) - (a['초동_best_numeric'] || 0);
    });

    var tbody = document.getElementById('namuRankingBody');
    var limit = Math.min(filtered.length, 100);
    var rows = '';

    for (var i = 0; i < limit; i++) {
        var a = filtered[i];
        var salesVal = a['초동_한터'] && a['초동_한터'] !== '-' ? a['초동_한터'] : (a['초동_써클'] || '-');
        var salesNum = a['초동_best_numeric'] || 0;
        var salesClass = salesNum >= 1000000 ? 'fw-bold text-danger' : '';

        rows += '<tr onclick="loadNamuGroupBySlug(\'' + a.group_slug + '\')" style="cursor:pointer;">' +
            '<td class="fw-bold text-primary">' + (i + 1) + '</td>' +
            '<td><div class="fw-bold">' + a.group_name + '</div><small class="text-muted">' + a.group_name_en + '</small></td>' +
            '<td>' + a.album_title + '</td>' +
            '<td><span class="badge bg-light text-dark">' + (a.album_type || '-') + '</span></td>' +
            '<td>' + (a.release_date || '-') + '</td>' +
            '<td class="text-end ' + salesClass + '">' + salesVal + '</td>' +
            '</tr>';
    }

    tbody.innerHTML = rows;

    if (filtered.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" class="text-center text-muted py-4">해당 조건의 앨범이 없습니다.</td></tr>';
    }
}
