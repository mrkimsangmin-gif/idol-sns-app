import re
import html

def esc(s):
    return html.escape(str(s if s is not None else ""), quote=True)

def generate_seo_enrichment(g):
    """
    검색 로봇 전용(sr-only + JSON-LD) 나이순, 막내/최연장자, 초동 판매량 요약 생성
    방문자 화면에는 시각적 노이즈를 일절 주지 않으면서(W3C sr-only 표준)
    네이버 스마트블록/구글 봇에게만 완벽한 자연어 팩트를 제공한다.
    """
    name = g.get('name', '')
    name_en = g.get('name_en', '')
    members = g.get('members', [])
    albums = g.get('albums', [])
    info = g.get('info', {}) or {}
    agency = info.get('소속사', '') or g.get('agency', '')
    debut = info.get('데뷔일', '') or g.get('debut', '')
    
    today_year = 2026

    # 1. Member age stats
    valid_births = []
    for m in members:
        b = str(m.get('생년월일', '')).strip()
        match = re.search(r'(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})', b)
        if match:
            y = int(match.group(1))
            age = today_year - y
            valid_births.append({
                'name': m.get('name'),
                'year': y,
                'age': age,
                'birth_str': b
            })

    age_sentence = ""
    oldest = None
    youngest = None
    avg_age = None
    if valid_births:
        valid_births.sort(key=lambda x: x['birth_str']) # Oldest first
        oldest = valid_births[0]
        youngest = valid_births[-1]
        avg_age = round(sum(x['age'] for x in valid_births) / len(valid_births), 1)
        if len(valid_births) > 1 and oldest['name'] != youngest['name']:
            age_sentence = (
                f"멤버 {len(valid_births)}인의 평균 나이는 만 {avg_age}세이며, "
                f"최연장자(맏이)는 {oldest['name']}({oldest['year']}년생, 만 {oldest['age']}세), "
                f"최연소(막내)는 {youngest['name']}({youngest['year']}년생, 만 {youngest['age']}세)입니다."
            )
        else:
            age_sentence = f"멤버 나이는 만 {avg_age}세입니다."

    # 2. Chodong sales stats
    physical_albums = [
        a for a in albums 
        if (a.get('초동_써클_numeric', 0) > 0 or a.get('초동_한터_numeric', 0) > 0 or 
            (a.get('초동_써클') and a.get('초동_써클') not in ['-', '']))
    ]

    chodong_sentence = ""
    latest_alb = None
    best_alb = None
    if physical_albums:
        latest_alb = physical_albums[-1]
        cho_h = str(latest_alb.get('초동_한터', '')).strip()
        cho_c = str(latest_alb.get('초동_써클', '')).strip()
        cho_parts = []
        if cho_h and cho_h != '-': cho_parts.append(f"한터 {cho_h}장")
        if cho_c and cho_c != '-': cho_parts.append(f"써클 {cho_c}장")
        latest_cho_str = " / ".join(cho_parts) if cho_parts else ""

        def get_max_val(a):
            return max(a.get('초동_한터_numeric', 0) or 0, a.get('초동_써클_numeric', 0) or 0)
        
        best_alb = max(physical_albums, key=get_max_val)
        best_h = str(best_alb.get('초동_한터', '')).strip()
        best_c = str(best_alb.get('초동_써클', '')).strip()
        best_parts = []
        if best_h and best_h != '-': best_parts.append(f"한터 {best_h}장")
        if best_c and best_c != '-': best_parts.append(f"써클 {best_c}장")
        best_cho_str = " / ".join(best_parts) if best_parts else ""

        if latest_alb['title'] == best_alb['title']:
            if latest_cho_str:
                chodong_sentence = f"역대 음반 최고 초동 판매량 기록은 최신 앨범 '{latest_alb.get('title')}'의 {latest_cho_str}입니다."
        else:
            p1 = f"최신 앨범 '{latest_alb.get('title')}'은 초동 {latest_cho_str}을 기록하였으며" if latest_cho_str else ""
            p2 = f"역대 자체 최고 초동 앨범은 '{best_alb.get('title')}'({best_cho_str})입니다." if best_cho_str else ""
            chodong_sentence = f"{p1}, {p2}".strip(", ")

    # 자연어 문장 종합
    intro = f"{agency} 소속 {name}" if agency else name
    if debut: intro += f"({debut} 데뷔)"
    
    parts = [f"{intro}의 핵심 데이터 분석 요약입니다."]
    if age_sentence: parts.append(age_sentence)
    if chodong_sentence: parts.append(chodong_sentence)
    parts.append("아이엠콘텐츠 데이터랩에서 유튜브·틱톡·인스타그램 글로벌 SNS 일간 순위 추이와 음반 판매량 차트를 한눈에 확인할 수 있습니다.")

    natural_text = " ".join(parts)

    # 1) W3C 표준 sr-only HTML 블록 (검색엔진 봇 100% 수집, 사람 눈에는 안 보임)
    sr_only_html = (
        f'<div class="visually-hidden" style="position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0;">\n'
        f'  <h2>{esc(name)} 멤버 나이순, 막내, 역대 앨범 초동 판매량 핵심 요약</h2>\n'
        f'  <p>{esc(natural_text)}</p>\n'
        f'</div>'
    )

    # 2) Q&A FAQ 추가 (나이/막내/초동 AEO 직답)
    extra_qas = []
    if age_sentence:
        extra_qas.append((
            f"{name}의 멤버 나이와 막내는 누구인가요?",
            f"{name} {age_sentence}"
        ))
    if chodong_sentence:
        extra_qas.append((
            f"{name}의 역대 음반 초동 판매량 기록은 얼마인가요?",
            f"{name} {chodong_sentence}"
        ))

    return {
        "natural_text": natural_text,
        "sr_only_html": sr_only_html,
        "extra_qas": extra_qas,
        "avg_age": avg_age,
        "oldest": oldest,
        "youngest": youngest,
        "latest_alb": latest_alb,
        "best_alb": best_alb
    }


def generate_seo_enrichment_en(g):
    """
    글로벌 구글 검색엔진 및 AI 챗봇(ChatGPT, Perplexity 등) 전용 영문 요약 (sr-only + JSON-LD)
    """
    name = g.get('name_en', '') or g.get('name', '')
    name_kr = g.get('name', '')
    members = g.get('members', [])
    albums = g.get('albums', [])
    info = g.get('info', {}) or {}
    agency = info.get('소속사', '') or g.get('agency', '')
    debut = info.get('데뷔일', '') or g.get('debut', '')
    
    today_year = 2026

    # 1. Member age stats
    valid_births = []
    for m in members:
        b = str(m.get('생년월일', '')).strip()
        match = re.search(r'(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})', b)
        if match:
            y = int(match.group(1))
            age = today_year - y
            m_name = m.get('name', '')
            valid_births.append({
                'name': m_name,
                'year': y,
                'age': age,
                'birth_str': b
            })

    age_sentence = ""
    oldest = None
    youngest = None
    avg_age = None
    if valid_births:
        valid_births.sort(key=lambda x: x['birth_str']) # Oldest first
        oldest = valid_births[0]
        youngest = valid_births[-1]
        avg_age = round(sum(x['age'] for x in valid_births) / len(valid_births), 1)
        if len(valid_births) > 1 and oldest['name'] != youngest['name']:
            age_sentence = (
                f"The average age of the {len(valid_births)} members is {avg_age} years old. "
                f"The oldest member is {oldest['name']} (born {oldest['year']}, age {oldest['age']}), "
                f"and the youngest (maknae) is {youngest['name']} (born {youngest['year']}, age {youngest['age']})."
            )
        else:
            age_sentence = f"The average age of the member(s) is {avg_age} years old."

    # 2. Chodong sales stats
    physical_albums = [
        a for a in albums 
        if (a.get('초동_써클_numeric', 0) > 0 or a.get('초동_한터_numeric', 0) > 0 or 
            (a.get('초동_써클') and a.get('초동_써클') not in ['-', '']))
    ]

    chodong_sentence = ""
    latest_alb = None
    best_alb = None
    if physical_albums:
        latest_alb = physical_albums[-1]
        cho_h = str(latest_alb.get('초동_한터', '')).strip()
        cho_c = str(latest_alb.get('초동_써클', '')).strip()
        cho_parts = []
        if cho_h and cho_h != '-': cho_parts.append(f"Hanteo {cho_h}")
        if cho_c and cho_c != '-': cho_parts.append(f"Circle {cho_c}")
        latest_cho_str = " / ".join(cho_parts) if cho_parts else ""

        def get_max_val(a):
            return max(a.get('초동_한터_numeric', 0) or 0, a.get('초동_써클_numeric', 0) or 0)
        
        best_alb = max(physical_albums, key=get_max_val)
        best_h = str(best_alb.get('초동_한터', '')).strip()
        best_c = str(best_alb.get('초동_써클', '')).strip()
        best_parts = []
        if best_h and best_h != '-': best_parts.append(f"Hanteo {best_h}")
        if best_c and best_c != '-': best_parts.append(f"Circle {best_c}")
        best_cho_str = " / ".join(best_parts) if best_parts else ""

        if latest_alb['title'] == best_alb['title']:
            if latest_cho_str:
                chodong_sentence = f"The all-time highest first-week album sales record is held by their latest release '{latest_alb.get('title')}' with {latest_cho_str} copies sold."
        else:
            p1 = f"Their latest album '{latest_alb.get('title')}' recorded first-week sales of {latest_cho_str}" if latest_cho_str else ""
            p2 = f"their all-time best-selling first-week album is '{best_alb.get('title')}' ({best_cho_str} copies)" if best_cho_str else ""
            chodong_sentence = f"{p1}, while {p2}.".strip(", ")

    intro = f"{name} ({name_kr})" if name_kr and name_kr != name else name
    if agency: intro += f", managed by {agency}"
    if debut: intro += f" (debuted on {debut})"
    
    parts = [f"Here is the verified data summary for {intro}."]
    if age_sentence: parts.append(age_sentence)
    if chodong_sentence: parts.append(chodong_sentence)
    parts.append("Explore real-time daily global SNS growth (YouTube, TikTok, Instagram) and verified discography sales trends on AIMCONTENTS Data Lab.")

    natural_text = " ".join(parts)

    sr_only_html = (
        f'<div class="visually-hidden" style="position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0;">\n'
        f'  <h2>{esc(name)} Members Age, Youngest (Maknae), and First-Week Album Sales Summary</h2>\n'
        f'  <p>{esc(natural_text)}</p>\n'
        f'</div>'
    )

    extra_qas = []
    if age_sentence:
        extra_qas.append((
            f"What is the average age of {name} members and who is the youngest (maknae)?",
            f"{name}: {age_sentence}"
        ))
    if chodong_sentence:
        extra_qas.append((
            f"What is the highest first-week album sales record for {name}?",
            f"{name}: {chodong_sentence}"
        ))

    return {
        "natural_text": natural_text,
        "sr_only_html": sr_only_html,
        "extra_qas": extra_qas,
        "avg_age": avg_age,
        "oldest": oldest,
        "youngest": youngest,
        "latest_alb": latest_alb,
        "best_alb": best_alb
    }
