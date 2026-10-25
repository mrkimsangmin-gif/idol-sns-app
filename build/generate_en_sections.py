import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SHELL = ROOT / "index.html"
OUT_DIR = ROOT / "en"
OUT_NEWS_DIR = ROOT / "en" / "news"

def replace_once(text, old, new, label):
    if text.count(old) != 1:
        raise RuntimeError(f"[앵커 불일치] '{label}' 발생횟수={text.count(old)} (1이어야 함)")
    return text.replace(old, new)

def build_en_home_and_news():
    raw = SHELL.read_text(encoding="utf-8")

    # 1. EN Home (en/index.html)
    t_home = raw
    t_home = replace_once(t_home, '<html lang="ko">', '<html lang="en">', "html lang en")
    t_home = replace_once(
        t_home,
        "<title>아이돌 SNS 팔로워 순위 - 틱톡·유튜브·인스타·웨이보·도우인 | 아이엠콘텐츠</title>",
        "<title>K-POP Idol SNS & Discography Analytics | AIMCONTENTS</title>",
        "title en"
    )
    seo_links = (
        '<link rel="canonical" href="https://aimcontents.com/en/">\n'
        '    <link rel="alternate" hreflang="ko" href="https://aimcontents.com/">\n'
        '    <link rel="alternate" hreflang="en" href="https://aimcontents.com/en/">\n'
        '    <link rel="alternate" hreflang="x-default" href="https://aimcontents.com/">'
    )
    t_home = replace_once(t_home, '<link rel="canonical" href="https://aimcontents.com/">', seo_links, "canonical en")
    
    # Nav labels
    t_home = replace_once(t_home, "route('home')\">SNS랭킹</a>", "route('home')\">SNS Ranking</a>", "nav ranking en")
    t_home = replace_once(t_home, '/monthly/2026-09/boys/">월간차트<', '/monthly/2026-09/boys/">Monthly Chart<', "nav monthly en")
    t_home = replace_once(t_home, "route('namu')\">나무위키<", "route('namu')\">Profiles<", "nav namu en")
    t_home = replace_once(t_home, "route('comeback')\">컴백일정</a>", "route('comeback')\">Comebacks</a>", "nav comeback en")
    t_home = replace_once(t_home, "route('news')\">엔터뉴스</a>", "route('news')\">News</a>", "nav news en")
    t_home = replace_once(t_home, "route('douyin')\">중국트렌드</a>", "route('douyin')\">China Trends</a>", "nav douyin en")
    t_home = replace_once(t_home, "route('jobs')\">채용정보</a>", "route('jobs')\">Jobs</a>", "nav jobs en")
    t_home = replace_once(t_home, "route('links')\">링크모음</a>", "route('links')\">Links</a>", "nav links en")
    t_home = replace_once(t_home, "route('vendors')\">업체정보</a>", "route('vendors')\">Vendors</a>", "nav vendors en")
    t_home = replace_once(t_home, 'href="/insight/index_insight.html">인사이트</a>', 'href="/insight/index_insight.html">Insights</a>', "nav insights en")

    # Add toggle to EN
    pos_ins = t_home.find('index_insight.html')
    pos_end_ul = t_home.find('</ul>', pos_ins) + 5
    nav_tail = t_home[pos_ins:pos_end_ul]
    lang_btn_en = (
        '<li class="nav-item ms-lg-2 my-1 my-lg-0">'
        '<a class="btn btn-sm btn-outline-secondary d-inline-flex align-items-center gap-1" '
        'href="https://aimcontents.com/"><i class="bi bi-globe"></i> 한국어</a></li>'
        '\n                </ul>'
    )
    t_home = replace_once(t_home, nav_tail, nav_tail[:-5] + lang_btn_en, "nav lang toggle en")

    # Home Main Headings and UI translation
    t_home = replace_once(t_home, '<h1 class="mb-3 fw-bold fs-5">K-POP 아이돌 SNS 팔로워 순위</h1>',
                          '<h1 class="mb-3 fw-bold fs-5">K-POP Idol SNS Followers & Growth Ranking</h1>', "home h1 en")

    # Mobile bottom navigation
    t_home = replace_once(t_home, '                <span class="mobile-nav-label">홈/랭킹</span>',
                          '                <span class="mobile-nav-label">Rankings</span>', "mob nav home")
    t_home = replace_once(t_home, '                <span class="mobile-nav-label">컴백</span>',
                          '                <span class="mobile-nav-label">Comebacks</span>', "mob nav comeback")
    t_home = replace_once(t_home, '                <span class="mobile-nav-label">엔터뉴스</span>',
                          '                <span class="mobile-nav-label">News</span>', "mob nav news")
    t_home = replace_once(t_home, '                <span class="mobile-nav-label">채용정보</span>',
                          '                <span class="mobile-nav-label">Jobs</span>', "mob nav jobs")

    # Headings
    t_home = replace_once(t_home, '<h2 class="fw-bold fs-5 mb-0">K-POP 아이돌 컴백/데뷔 일정</h2>',
                          '<h2 class="fw-bold fs-5 mb-0">K-POP Idol Comeback & Debut Schedule</h2>', "h2 comeback")
    t_home = replace_once(t_home, '<h5 class="modal-title fw-bold" id="calModalTitle">일정 상세</h5>',
                          '<h5 class="modal-title fw-bold" id="calModalTitle">Schedule Details</h5>', "h5 calModal")
    t_home = replace_once(t_home, '<h2 class="mb-3 fw-bold fs-5">실시간 엔터테인먼트 뉴스</h2>',
                          '<h2 class="mb-3 fw-bold fs-5">Real-Time K-POP Entertainment News</h2>', "h2 news")
    t_home = replace_once(t_home, '<h2 class="mb-3 fw-bold fs-5">K-POP 링크 모음</h2>',
                          '<h2 class="mb-3 fw-bold fs-5">K-POP Official & Community Links</h2>', "h2 links")
    t_home = replace_once(t_home, '<h2 class="mb-3 fw-bold fs-5">엔터테인먼트 채용정보</h2>',
                          '<h2 class="mb-3 fw-bold fs-5">K-POP Entertainment Career Opportunities</h2>', "h2 jobs")
    t_home = replace_once(t_home, '<h2 class="fw-bold m-0 fs-5">엔터테인먼트 업체정보</h2>',
                          '<h2 class="fw-bold m-0 fs-5">K-POP Industry Vendor Directory</h2>', "h2 vendors")
    t_home = replace_once(t_home, '<h5 class="modal-title fw-bold" id="vModalCompany">업체명</h5>',
                          '<h5 class="modal-title fw-bold" id="vModalCompany">Company Details</h5>', "h5 vModalCompany")
    t_home = replace_once(t_home, '<h5 class="modal-title fw-bold" id="vendorFormTitle">신규 업체 등록</h5>',
                          '<h5 class="modal-title fw-bold" id="vendorFormTitle">Register New Vendor</h5>', "h5 vendorFormTitle")
    t_home = replace_once(t_home, '<h2 class="mb-3 fw-bold fs-5">중국 도우인 인기 챌린지 <span id="douyinWeekBadge" class="douyin-week-badge"></span></h2>',
                          '<h2 class="mb-3 fw-bold fs-5">Douyin K-POP Trending Challenges <span id="douyinWeekBadge" class="douyin-week-badge"></span></h2>', "h2 douyin")
    t_home = replace_once(t_home, '<h2 class="mb-3 fw-bold fs-5">K-POP 아이돌 나무위키 검색</h2>',
                          '<h2 class="mb-3 fw-bold fs-5">K-POP Idol Database & Profile Search</h2>', "h2 namu")

    # Namu Detail tabs & back button
    t_home = replace_once(t_home, '<button class="btn btn-outline-secondary btn-sm mb-3" onclick="backToNamuList()">← 목록으로</button>',
                          '<button class="btn btn-outline-secondary btn-sm mb-3" onclick="backToNamuList()">← Back to Directory</button>', "namu back")
    t_home = replace_once(t_home, '<button class="namu-detail-tab active" data-dtab="profile" onclick="switchNamuDetailTab(\'profile\')">프로필</button>',
                          '<button class="namu-detail-tab active" data-dtab="profile" onclick="switchNamuDetailTab(\'profile\')">Profile</button>', "namu tab profile")
    t_home = replace_once(t_home, '<button class="namu-detail-tab" data-dtab="members" onclick="switchNamuDetailTab(\'members\')">멤버</button>',
                          '<button class="namu-detail-tab" data-dtab="members" onclick="switchNamuDetailTab(\'members\')">Members</button>', "namu tab members")
    t_home = replace_once(t_home, '<button class="namu-detail-tab" data-dtab="discography" onclick="switchNamuDetailTab(\'discography\')">디스코그래피</button>',
                          '<button class="namu-detail-tab" data-dtab="discography" onclick="switchNamuDetailTab(\'discography\')">Discography</button>', "namu tab disco")
    t_home = replace_once(t_home, '<button class="namu-detail-tab" data-dtab="chart" onclick="switchNamuDetailTab(\'chart\')">판매량 차트</button>',
                          '<button class="namu-detail-tab" data-dtab="chart" onclick="switchNamuDetailTab(\'chart\')">Sales Chart</button>', "namu tab chart")
    t_home = replace_once(t_home, '<button class="namu-detail-tab" data-dtab="streaming" onclick="switchNamuDetailTab(\'streaming\')">스트리밍</button>',
                          '<button class="namu-detail-tab" data-dtab="streaming" onclick="switchNamuDetailTab(\'streaming\')">Streaming</button>', "namu tab streaming")

    # Namu ranking table filters & headers
    t_home = replace_once(t_home, '<button class="namu-filter-btn active" data-gender="all" onclick="filterNamuRanking(\'gender\', \'all\')">전체</button>',
                          '<button class="namu-filter-btn active" data-gender="all" onclick="filterNamuRanking(\'gender\', \'all\')">All</button>', "namu filter all")
    t_home = replace_once(t_home, '<button class="namu-filter-btn" data-gender="여자" onclick="filterNamuRanking(\'gender\', \'여자\')">여자</button>',
                          '<button class="namu-filter-btn" data-gender="여자" onclick="filterNamuRanking(\'gender\', \'여자\')">Female</button>', "namu filter female")
    t_home = replace_once(t_home, '<button class="namu-filter-btn" data-gender="남자" onclick="filterNamuRanking(\'gender\', \'남자\')">남자</button>',
                          '<button class="namu-filter-btn" data-gender="남자" onclick="filterNamuRanking(\'gender\', \'남자\')">Male</button>', "namu filter male")
    t_home = replace_once(t_home, '<option value="all">전체 연도</option>',
                          '<option value="all">All Years</option>', "namu opt all years")
    t_home = replace_once(t_home, '<th>그룹</th>', '<th>Group</th>', "th group")
    t_home = replace_once(t_home, '<th>앨범</th>', '<th>Album</th>', "th album")
    t_home = replace_once(t_home, '<th>유형</th>', '<th>Type</th>', "th type")
    t_home = replace_once(t_home, '<th>발매일</th>', '<th>Release</th>', "th release")
    t_home = replace_once(t_home, '<th class="text-end">초동</th>', '<th class="text-end">First Week Sales</th>', "th initial")

    # Idol modal
    t_home = replace_once(t_home, '📚 나무위키에서 보기', '📚 View on NamuWiki', "namuwiki modal btn")
    t_home = replace_once(t_home, '<label class="form-label fw-bold small">SNS 링크</label>',
                          '<label class="form-label fw-bold small">Official SNS Links</label>', "sns links label")
    t_home = replace_once(t_home, '<label class="form-label fw-bold small">메모</label>',
                          '<label class="form-label fw-bold small">Notes</label>', "notes label")

    # Calendar controls
    t_home = replace_once(t_home, '<i class="bi bi-chevron-left"></i> 이전달</button>',
                          '<i class="bi bi-chevron-left"></i> Prev</button>', "cal prev")
    t_home = replace_once(t_home, '다음달 <i class="bi bi-chevron-right"></i></button>',
                          'Next <i class="bi bi-chevron-right"></i></button>', "cal next")
    t_home = replace_once(t_home, 'onclick="setCalToday()">오늘</button>',
                          'onclick="setCalToday()">Today</button>', "cal today")

    # Vendor & Job action buttons & modals
    t_home = replace_once(t_home, '+ 신규업체 등록', '+ Register Vendor', "new vendor btn")
    t_home = replace_once(t_home, '<span id="vModalCategory" class="badge bg-secondary mb-3 d-inline-block">카테고리</span>',
                          '<span id="vModalCategory" class="badge bg-secondary mb-3 d-inline-block">Category</span>', "vModalCategory")
    t_home = replace_once(t_home, '<strong>담당자:</strong>', '<strong>Contact:</strong>', "vModal contact")
    t_home = replace_once(t_home, '<strong>휴대전화:</strong>', '<strong>Mobile:</strong>', "vModal mobile")
    t_home = replace_once(t_home, '<strong>일반전화:</strong>', '<strong>Phone:</strong>', "vModal phone")
    t_home = replace_once(t_home, '<strong>이메일:</strong>', '<strong>Email:</strong>', "vModal email")
    t_home = replace_once(t_home, '<strong>홈페이지:</strong>', '<strong>Website:</strong>', "vModal website")
    t_home = replace_once(t_home, '<label class="fw-bold small text-muted">포트폴리오</label>',
                          '<label class="fw-bold small text-muted">Portfolio</label>', "vModal pf")
    t_home = replace_once(t_home, '<label class="fw-bold small text-muted">비고</label>',
                          '<label class="fw-bold small text-muted">Notes</label>', "vModal notes")
    t_home = replace_once(t_home, '<i class="bi bi-clipboard"></i> <span>복사</span>',
                          '<i class="bi bi-clipboard"></i> <span>Copy</span>', "vModal copy")
    t_home = replace_once(t_home, '정보 수정 요청', 'Request Edit', "vModal edit")
    t_home = replace_once(t_home, '<button type="button" class="btn btn-secondary btn-sm" data-bs-dismiss="modal">닫기</button>',
                          '<button type="button" class="btn btn-secondary btn-sm" data-bs-dismiss="modal">Close</button>', "vModal close")
    t_home = replace_once(t_home, '<button type="button" class="btn btn-secondary" data-bs-dismiss="modal">취소</button>',
                          '<button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Cancel</button>', "vForm cancel")
    t_home = replace_once(t_home, 'onclick="submitVendorForm()">요청 보내기</button>',
                          'onclick="submitVendorForm()">Submit Request</button>', "vForm submit")

    # Modal aria-label and tooltips
    t_home = t_home.replace('aria-label="닫기"', 'aria-label="Close"')
    t_home = t_home.replace('title="이메일 복사"', 'title="Copy Email"')

    # Search and Form Placeholders (전체 인풋 placeholder 영문화)
    t_home = replace_once(t_home, 'placeholder="그룹 검색"',
                          'placeholder="Search Group"', "ph searchGroup")
    t_home = replace_once(t_home, 'placeholder="그룹명 또는 아티스트 검색 (예: 르세라핌, 원어스)"',
                          'placeholder="Search group or artist (e.g. LE SSERAFIM, ONEUS)"', "ph searchCal")
    t_home = replace_once(t_home, 'placeholder="업체명 또는 키워드 검색"',
                          'placeholder="Search company or keyword"', "ph searchVendor")
    t_home = replace_once(t_home, 'placeholder="성함"',
                          'placeholder="Contact Name"', "ph vendorName")
    t_home = replace_once(t_home, 'placeholder="수정할 내용이나 포트폴리오 URL 등을 적어주세요."',
                          'placeholder="Enter details or portfolio URL..."', "ph vendorDetails")
    t_home = replace_once(t_home, 'placeholder="그룹/멤버 검색 또는 질문"',
                          'placeholder="Search group/member or ask a question"', "ph searchNamu")

    # Loading & empty placeholder strings
    t_home = replace_once(t_home, '<p class="mt-2 text-muted">채용정보를 불러오는 중...</p>',
                          '<p class="mt-2 text-muted">Loading job openings...</p>', "jobs loading")
    t_home = replace_once(t_home, '<p class="mt-2 text-muted">업체정보를 불러오는 중...</p>',
                          '<p class="mt-2 text-muted">Loading vendor directory...</p>', "vendors loading")
    t_home = replace_once(t_home, '<p class="mt-2 text-muted">챌린지 데이터를 불러오는 중...</p>',
                          '<p class="mt-2 text-muted">Loading trending challenges...</p>', "douyin loading")
    t_home = replace_once(t_home, '<p class="mt-2 text-muted">데이터를 불러오는 중...</p>',
                          '<p class="mt-2 text-muted">Loading database...</p>', "namu loading")
    t_home = replace_once(t_home, '<div class="text-center py-5">데이터를 조회해주세요.</div>',
                          '<div class="text-center py-5">Loading ranking data...</div>', "ranking placeholder")

    # Static Dropdown initial labels & options
    t_home = replace_once(t_home, 'id="genderDropdown" data-bs-toggle="dropdown" data-bs-auto-close="true"\n                                aria-expanded="false">\n                                남자',
                          'id="genderDropdown" data-bs-toggle="dropdown" data-bs-auto-close="true"\n                                aria-expanded="false">\n                                Male', "gender initial")
    t_home = replace_once(t_home, 'onclick="updateFilter(\'gender\', \'남자\'); return false;">남자</a>',
                          'onclick="updateFilter(\'gender\', \'남자\'); return false;">Male</a>', "gender opt male")
    t_home = replace_once(t_home, 'onclick="updateFilter(\'gender\', \'여자\'); return false;">여자</a>',
                          'onclick="updateFilter(\'gender\', \'여자\'); return false;">Female</a>', "gender opt female")
    
    # SNS dropdown initial label & options
    t_home = replace_once(t_home, 'id="snsDropdown" data-bs-toggle="dropdown" data-bs-auto-close="true"\n                                aria-expanded="false">\n                                웨이보',
                          'id="snsDropdown" data-bs-toggle="dropdown" data-bs-auto-close="true"\n                                aria-expanded="false">\n                                Weibo', "sns initial")
    t_home = replace_once(t_home, 'onclick="updateFilter(\'sns\', \'웨이보\'); return false;">웨이보</a>',
                          'onclick="updateFilter(\'sns\', \'웨이보\'); return false;">Weibo</a>', "sns opt weibo")
    t_home = replace_once(t_home, 'onclick="updateFilter(\'sns\', \'차오화\'); return false;">웨이보(슈퍼챗)</a>',
                          'onclick="updateFilter(\'sns\', \'차오화\'); return false;">Weibo (Super Topic)</a>', "sns opt chaohua")
    t_home = replace_once(t_home, 'onclick="updateFilter(\'sns\', \'빌리빌리\'); return false;">빌리빌리</a>',
                          'onclick="updateFilter(\'sns\', \'빌리빌리\'); return false;">Bilibili</a>', "sns opt bilibili")
    t_home = replace_once(t_home, 'onclick="updateFilter(\'sns\', \'QQ뮤직\'); return false;">QQ뮤직</a>',
                          'onclick="updateFilter(\'sns\', \'QQ뮤직\'); return false;">QQ Music</a>', "sns opt qqmusic")
    t_home = replace_once(t_home, 'onclick="updateFilter(\'sns\', \'X(트위터)\'); return false;">X(트위터)</a>',
                          'onclick="updateFilter(\'sns\', \'X(트위터)\'); return false;">X (Twitter)</a>', "sns opt twitter")
    t_home = replace_once(t_home, 'onclick="updateFilter(\'sns\', \'유튜브\'); return false;">유튜브</a>',
                          'onclick="updateFilter(\'sns\', \'유튜브\'); return false;">YouTube</a>', "sns opt youtube")
    t_home = replace_once(t_home, 'onclick="updateFilter(\'sns\', \'스포티파이\'); return false;">스포티파이</a>',
                          'onclick="updateFilter(\'sns\', \'스포티파이\'); return false;">Spotify</a>', "sns opt spotify")
    t_home = replace_once(t_home, 'onclick="updateFilter(\'sns\', \'인스타그램\'); return false;">인스타그램</a>',
                          'onclick="updateFilter(\'sns\', \'인스타그램\'); return false;">Instagram</a>', "sns opt instagram")

    t_home = replace_once(t_home, 'id="monthDropdown" data-bs-toggle="dropdown" data-bs-auto-close="true"\n                                aria-expanded="false">\n                                조회 월 선택',
                          'id="monthDropdown" data-bs-toggle="dropdown" data-bs-auto-close="true"\n                                aria-expanded="false">\n                                Select Month', "month initial")

    # Jobs Category tabs in static HTML
    jobs_tabs_ko = (
        '            <div id="jobsCategoryTabs" class="jobs-category-tabs mb-3">\n'
        '                <button class="jobs-category-tab active" data-category="all" onclick="filterJobsByCategory(\'all\')">\n'
        '                    전체\n'
        '                </button>\n'
        '                <button class="jobs-category-tab" data-category="마케팅" onclick="filterJobsByCategory(\'마케팅\')">\n'
        '                    마케팅\n'
        '                </button>\n'
        '                <button class="jobs-category-tab" data-category="영상" onclick="filterJobsByCategory(\'영상\')">\n'
        '                    영상\n'
        '                </button>\n'
        '                <button class="jobs-category-tab" data-category="신인개발" onclick="filterJobsByCategory(\'신인개발\')">\n'
        '                    신인개발\n'
        '                </button>\n'
        '                <button class="jobs-category-tab" data-category="매니지먼트" onclick="filterJobsByCategory(\'매니지먼트\')">\n'
        '                    매니지먼트\n'
        '                </button>\n'
        '                <button class="jobs-category-tab" data-category="프로듀싱" onclick="filterJobsByCategory(\'프로듀싱\')">\n'
        '                    프로듀싱\n'
        '                </button>\n'
        '                <button class="jobs-category-tab" data-category="디자인" onclick="filterJobsByCategory(\'디자인\')">\n'
        '                    디자인\n'
        '                </button>\n'
        '                <button class="jobs-category-tab" data-category="IT" onclick="filterJobsByCategory(\'IT\')">\n'
        '                    IT\n'
        '                </button>\n'
        '                <button class="jobs-category-tab" data-category="영업" onclick="filterJobsByCategory(\'영업\')">\n'
        '                    영업\n'
        '                </button>\n'
        '                <button class="jobs-category-tab" data-category="경영지원" onclick="filterJobsByCategory(\'경영지원\')">\n'
        '                    경영지원\n'
        '                </button>\n'
        '                <button class="jobs-category-tab" data-category="해외사업" onclick="filterJobsByCategory(\'해외사업\')">\n'
        '                    해외사업\n'
        '                </button>\n'
        '                <button class="jobs-category-tab" data-category="기타" onclick="filterJobsByCategory(\'기타\')">\n'
        '                    기타\n'
        '                </button>\n'
        '            </div>'
    )
    jobs_tabs_en = (
        '            <div id="jobsCategoryTabs" class="jobs-category-tabs mb-3">\n'
        '                <button class="jobs-category-tab active" data-category="all" onclick="filterJobsByCategory(\'all\')">\n'
        '                    All\n'
        '                </button>\n'
        '                <button class="jobs-category-tab" data-category="마케팅" onclick="filterJobsByCategory(\'마케팅\')">\n'
        '                    Marketing\n'
        '                </button>\n'
        '                <button class="jobs-category-tab" data-category="영상" onclick="filterJobsByCategory(\'영상\')">\n'
        '                    Video / Media\n'
        '                </button>\n'
        '                <button class="jobs-category-tab" data-category="신인개발" onclick="filterJobsByCategory(\'신인개발\')">\n'
        '                    A&R / Casting\n'
        '                </button>\n'
        '                <button class="jobs-category-tab" data-category="매니지먼트" onclick="filterJobsByCategory(\'매니지먼트\')">\n'
        '                    Management\n'
        '                </button>\n'
        '                <button class="jobs-category-tab" data-category="프로듀싱" onclick="filterJobsByCategory(\'프로듀싱\')">\n'
        '                    Music Production\n'
        '                </button>\n'
        '                <button class="jobs-category-tab" data-category="디자인" onclick="filterJobsByCategory(\'디자인\')">\n'
        '                    Creative Design\n'
        '                </button>\n'
        '                <button class="jobs-category-tab" data-category="IT" onclick="filterJobsByCategory(\'IT\')">\n'
        '                    IT & Tech\n'
        '                </button>\n'
        '                <button class="jobs-category-tab" data-category="영업" onclick="filterJobsByCategory(\'영업\')">\n'
        '                    Business Sales\n'
        '                </button>\n'
        '                <button class="jobs-category-tab" data-category="경영지원" onclick="filterJobsByCategory(\'경영지원\')">\n'
        '                    Operations & HR\n'
        '                </button>\n'
        '                <button class="jobs-category-tab" data-category="해외사업" onclick="filterJobsByCategory(\'해외사업\')">\n'
        '                    Global Business\n'
        '                </button>\n'
        '                <button class="jobs-category-tab" data-category="기타" onclick="filterJobsByCategory(\'기타\')">\n'
        '                    Others\n'
        '                </button>\n'
        '            </div>'
    )
    t_home = replace_once(t_home, jobs_tabs_ko, jobs_tabs_en, "jobs tabs en")

    # Vendor Category '전체'
    t_home = replace_once(t_home, '<div id="vendorCategoryTabs" class="vendor-category-tabs mb-2">\n                <button class="vendor-category-tab active" data-category="all" onclick="filterVendorsByCategory(\'all\')">\n                    전체\n                </button>\n            </div>',
                          '<div id="vendorCategoryTabs" class="vendor-category-tabs mb-2">\n                <button class="vendor-category-tab active" data-category="all" onclick="filterVendorsByCategory(\'all\')">\n                    All\n                </button>\n            </div>', "vendor tab all")

    # Replace SEO Static Content at the bottom with English translation
    pos_seo_start = t_home.find('id="seo-static-content"')
    if pos_seo_start != -1:
        pos_article_open = t_home.rfind('<article', 0, pos_seo_start)
        pos_article_close = t_home.find('</article>', pos_seo_start) + len('</article>')
        old_seo_block = t_home[pos_article_open:pos_article_close]
        
        new_seo_block = (
            '    <article id="seo-static-content" style="max-width: 800px; margin: 80px auto; padding: 20px;">\n'
            '        <h2>K-POP Idol SNS Followers & Global Discography Analytics - AIMCONTENTS</h2>\n'
            '        <p>AIMCONTENTS tracks monthly subscriber and follower metrics across YouTube, TikTok, Instagram, Weibo, and Spotify for leading K-POP idol groups worldwide.</p>\n'
            '        <h3>Verified Multi-Platform Follower Rankings</h3>\n'
            '        <p>Explore real-time growth indicators, verified discography tracklists, first-week album sales, and cross-platform fandom trends across 1st to 5th generation K-POP idols.</p>\n'
            '    </article>'
        )
        t_home = replace_once(t_home, old_seo_block, new_seo_block, "seo static block en")

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    (OUT_DIR / "index.html").write_text(t_home, encoding="utf-8")
    print(f"Created: {OUT_DIR / 'index.html'}")

    # 2. EN News (en/news/index.html)
    t_news = t_home
    t_news = replace_once(
        t_news,
        "<title>K-POP Idol SNS & Discography Analytics | AIMCONTENTS</title>",
        "<title>Latest K-POP Entertainment News & Industry Headlines | AIMCONTENTS</title>",
        "title news en"
    )
    # switch visible section from home to news
    t_news = replace_once(t_news, '<section id="page-home" class="page-section">',
                          '<section id="page-home" class="page-section d-none">', "page-home hide")
    t_news = replace_once(t_news, '<section id="page-news" class="page-section d-none">',
                          '<section id="page-news" class="page-section">', "page-news show")
    t_news = replace_once(t_news, '<p class="text-muted small mb-3">업데이트: <span id="newsUpdateTime">-</span></p>',
                          '<p class="text-muted small mb-3">Updated: <span id="newsUpdateTime">-</span></p>', "news updated en")
    t_news = replace_once(t_news, '<p class="mt-2 text-muted">뉴스를 불러오는 중...</p>',
                          '<p class="mt-2 text-muted">Loading latest K-POP headlines...</p>', "news loading en")
    
    # Update canonical for news
    seo_links_news = (
        '<link rel="canonical" href="https://aimcontents.com/en/news/">\n'
        '    <link rel="alternate" hreflang="ko" href="https://aimcontents.com/news">\n'
        '    <link rel="alternate" hreflang="en" href="https://aimcontents.com/en/news/">\n'
        '    <link rel="alternate" hreflang="x-default" href="https://aimcontents.com/news">'
    )
    t_news = replace_once(t_news, seo_links, seo_links_news, "canonical news en")

    OUT_NEWS_DIR.mkdir(parents=True, exist_ok=True)
    (OUT_NEWS_DIR / "index.html").write_text(t_news, encoding="utf-8")
    print(f"Created: {OUT_NEWS_DIR / 'index.html'}")

if __name__ == "__main__":
    build_en_home_and_news()
