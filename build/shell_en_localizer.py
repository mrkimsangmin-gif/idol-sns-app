# -*- coding: utf-8 -*-
"""
공통 영문 셸 변환기 (모든 en/ 빌더 스크립트에서 호출)
Base Shell (루트 index.html)에 남아있는 모든 공통 UI, 모달, 버튼, 접근성 속성, 플레이스홀더를 완벽하게 영문화함.
"""

def localize_shell_to_en(text: str) -> str:
    # 1. 접근성 (Aria & Title)
    reps = [
        ('aria-label="메뉴 열기"', 'aria-label="Open menu"'),
        ('aria-label="닫기"', 'aria-label="Close"'),
        ('aria-label="모바일 하단 탐색"', 'aria-label="Mobile Navigation"'),
        ('title="이메일 복사"', 'title="Copy email"'),
        
        # 2. 플레이스홀더 (Placeholders)
        ('placeholder="그룹 검색"', 'placeholder="Search Group"'),
        ('placeholder="그룹명 또는 아티스트 검색 (예: 르세라핌, 원어스)"', 'placeholder="Search group or artist (e.g. LE SSERAFIM, ONEUS)"'),
        ('placeholder="업체명 또는 키워드 검색"', 'placeholder="Search company or keyword"'),
        ('placeholder="성함"', 'placeholder="Contact Name"'),
        ('placeholder="수정할 내용이나 포트폴리오 URL 등을 적어주세요."', 'placeholder="Enter details or portfolio URL..."'),
        ('placeholder="그룹/멤버 검색 또는 질문"', 'placeholder="Search group, member, or question..."'),
        
        # 3. 드롭다운 및 필터 버튼
        ('>남자<', '>Male<'),
        ('>여자<', '>Female<'),
        ('>웨이보<', '>Weibo<'),
        ('>웨이보(슈퍼챗)<', '>Weibo (Super Topic)<'),
        ('>빌리빌리<', '>Bilibili<'),
        ('>QQ뮤직<', '>QQ Music<'),
        ('>X(트위터)<', '>X (Twitter)<'),
        ('>유튜브<', '>YouTube<'),
        ('>스포티파이<', '>Spotify<'),
        ('>인스타그램<', '>Instagram<'),
        ('>조회 월 선택<', '>Select Month<'),
        ('>오늘<', '>Today<'),
        
        # 4. 직무 필터 및 공통 액션 버튼
        ('>전체<', '>All<'),
        ('>마케팅<', '>Marketing<'),
        ('>영상<', '>Video / Media<'),
        ('>신인개발<', '>A&R / Casting<'),
        ('>매니지먼트<', '>Management<'),
        ('>프로듀싱<', '>Producing<'),
        ('>디자인<', '>Design<'),
        ('>영업<', '>Sales / Biz<'),
        ('>경영지원<', '>Operations / HR<'),
        ('>해외사업<', '>Global Business<'),
        ('>기타<', '>Other<'),
        ('>+ 신규업체 등록<', '>+ Add Vendor<'),
        ('>정보 수정 요청<', '>Request Edit<'),
        ('>취소<', '>Cancel<'),
        ('>요청 보내기<', '>Submit Request<'),
        ('>닫기<', '>Close<'),
        ('>복사<', '>Copy<'),
        
        # 5. 모달 및 폼 라벨
        ('>업체명<', '>Company Name<'),
        ('>카테고리<', '>Category<'),
        ('>신청자/담당자<', '>Contact Person<'),
        ('>휴대전화<', '>Mobile<'),
        ('>일반전화<', '>Phone<'),
        ('>이메일<', '>Email<'),
        ('>홈페이지<', '>Website<'),
        ('>상세 내용 (포트폴리오 등)<', '>Details / Portfolio<'),
        ('>담당자:<', '>Contact:<'),
        ('>휴대전화:<', '>Mobile:<'),
        ('>일반전화:<', '>Phone:<'),
        ('>이메일:<', '>Email:<'),
        ('>홈페이지:<', '>Website:<'),
        ('>포트폴리오<', '>Portfolio<'),
        ('>비고<', '>Notes<'),
        ('>SNS 링크<', '>SNS Links<'),
        ('>메모<', '>Memo<'),
        ('>일정 상세<', '>Schedule Details<'),
        
        # 6. 헤더 및 섹션 타이틀
        ('>실시간 엔터테인먼트 뉴스<', '>Real-time Entertainment News<'),
        ('>엔터테인먼트 채용정보<', '>Entertainment Careers<'),
        ('>엔터테인먼트 업체정보<', '>K-POP Vendor Directory<'),
        ('>K-POP 링크 모음<', '>K-POP Useful Links<'),
        ('>중국 도우인 인기 챌린지<', '>Douyin Trending Challenges<'),
        ('>K-POP 아이돌 컴백/데뷔 일정<', '>K-POP Comeback & Debut Schedule<'),
        
        # 7. 상태 및 로딩 문구
        ('>뉴스를 불러오는 중...<', '>Loading news...<'),
        ('>채용정보를 불러오는 중...<', '>Loading job openings...<'),
        ('>업체정보를 불러오는 중...<', '>Loading vendor directory...<'),
        ('>챌린지 데이터를 불러오는 중...<', '>Loading challenge trends...<'),
        ('>데이터를 불러오는 중...<', '>Loading data...<'),
        ('>데이터를 조회해주세요.<', '>Please select filters to view data.<'),
        
        # 8. 모바일 하단 내비 라벨
        ('>홈/랭킹<', '>Ranking<'),
        ('>컴백<', '>Comeback<'),
        ('>엔터뉴스<', '>News<'),
        ('>채용정보<', '>Jobs<'),
        ('>📚 나무위키에서 보기<', '>📚 View on Namuwiki<'),
        
        # 9. 면책조항 및 배너
        ('💼 본 채용 정보는 사람인·잡코리아 등 외부 채용 사이트에 등록된 공개 정보를 기반으로 한 링크 큐레이션 서비스입니다.',
         '💼 This job board is a link curation service based on publicly available postings from external recruitment sites.'),
        ('채용 관련 모든 상세 내용 및 지원은 원문 사이트에서 확인하시기 바랍니다.',
         'Please visit the original source site for full application requirements and submissions.')
    ]
    
    for old, new in reps:
        text = text.replace(old, new)
        
    return text
