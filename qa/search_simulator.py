"""
search_simulator.py
namu-smart-search.js의 검색 로직을 Python으로 복제
executeGroupRawSearch / executeMemberRawSearch / info_field 조회를 시뮬레이션
"""

import re
import json
from pathlib import Path

BASE_DIR = Path(__file__).parent.parent
NAMU_RAW_DIR = BASE_DIR / "data" / "namu-raw"
NAMU_GROUPS_DIR = BASE_DIR / "data" / "namu-groups"


def _get_group_members(slug: str) -> list[str]:
    """그룹 JSON에서 멤버 이름 목록 반환 (허위 전제 감지용)"""
    json_path = NAMU_GROUPS_DIR / f"{slug}.json"
    if not json_path.exists():
        return []
    with open(json_path, encoding='utf-8') as f:
        data = json.load(f)
    return [m.get('name', '') for m in data.get('members', []) if m.get('name')]

# ── JS 필터 상수 동기화 ────────────────────────────────────────────────────────
RAW_TEXT_NOISE = re.compile(
    r'나무위키는|나무위키가 |^[A-Z\s/\-]+$'
    r'|^[\.\s]*\[편집\]|자세한 내용은|문서를 참고하십시오|^\.\s',
    re.MULTILINE
)
RAW_TEXT_TRACKLIST = re.compile(r'[｜|]{2,}|작사\s*작곡|트랙\s*곡명')
RAW_TEXT_KW_STOPWORDS = re.compile(
    r'^(상황|경우|현황|정보|내용|관련|방법|이유|결과|현재|최근|지금'
    r'|어떻게|뭐|무엇|어디|언제|왜|얼마|몇)$'
)


# ── 핵심 스코어링 함수 ─────────────────────────────────────────────────────────
def score_raw_line(line: str, keyword: str) -> int:
    """JS scoreRawLine() 동일 로직"""
    score = 0
    if RAW_TEXT_NOISE.search(line):
        return -1
    if RAW_TEXT_TRACKLIST.search(line):
        return -1
    # 독립 단어로 등장 (앞 글자가 한글/영문이 아닌 경우)
    pattern = re.compile(
        r'(?:^|[^가-힣a-zA-Z])' + re.escape(keyword), re.IGNORECASE
    )
    if pattern.search(line):
        score += 50
    else:
        return -1
    if re.search(r'\d', line):
        score += 30
    if re.search(r'cm|kg|세|명|만|억', line):
        score += 20
    if re.search(r'멤버|평균|최대|최소|전원|모두', line):
        score += 20
    if 10 <= len(line) <= 200:
        score += 10
    return score


def _clean_window(text: str) -> str:
    """텍스트 윈도우 클린업 — JS와 동일한 필터 적용"""
    text = re.sub(r'\[편집\]', '', text)
    text = re.sub(r'\[\d+\]', '', text)
    text = re.sub(r'자세한 내용은[^\n]*', '', text)
    text = re.sub(r'문서를 참고하십시오[^\n]*', '', text)
    text = re.sub(r'\n+', ' ', text)
    text = re.sub(r'\s{2,}', ' ', text)
    return text.strip()


def proximity_window(raw_text: str, sub_kws: list[str], forward_span: int = 500) -> str | None:
    """
    멀티 키워드 근접 윈도우:
    첫 번째 서브 키워드 이후 forward_span 문자 내에 나머지 키워드가 모두 등장하는 구간 반환.
    tokenized 텍스트에서 "UN 연설"처럼 각 단어가 별도 라인에 있을 때 대응.
    """
    if len(sub_kws) < 2:
        return None
    raw_lower = raw_text.lower()
    anchor = sub_kws[0].lower()
    others = [kw.lower() for kw in sub_kws[1:]]

    best_text, best_score = None, -1
    pos = 0
    while pos < len(raw_text):
        idx = raw_lower.find(anchor, pos)
        if idx == -1:
            break

        # anchor 이후 forward_span 범위에서만 나머지 키워드 탐색 (전방향)
        fwd_end = min(len(raw_text), idx + forward_span)
        fwd = raw_lower[idx:fwd_end]

        if all(kw in fwd for kw in others):
            # 모든 키워드 발견 → anchor 기준 텍스트 윈도우 추출
            start = max(0, idx - 80)
            while start > 0 and raw_text[start - 1] != '\n':
                start -= 1
            end = min(len(raw_text), idx + 200)  # 200자: proximity window 추출 범위
            while end < len(raw_text) and raw_text[end] != '\n':
                end += 1
            ctx = _clean_window(raw_text[start:end])
            if len(ctx) < 15:
                pos = idx + 1
                continue
            # 추출된 window 내에도 모든 키워드가 실제로 있는지 재확인
            # (qualify는 500자 기준이지만 window는 150자 → 불일치 방지)
            ctx_lower = ctx.lower()
            if not all(kw in ctx_lower for kw in [anchor] + others):
                pos = idx + 1
                continue
            digits = len(re.findall(r'\d{4}', ctx))
            date_entries = len(re.findall(r'\d{4}\.\s*\d{2}', ctx))
            q = digits - date_entries * 5 + 5  # 근접 보너스 +5
            if q > best_score:
                best_score, best_text = q, ctx
        pos = idx + 1

    return best_text


def best_text_window(raw_text: str, keyword: str) -> str | None:
    """
    전체 텍스트 전수 스캔 → 숫자 밀도 최고 윈도우 선택
    JS 텍스트 윈도우 폴백과 동일 로직
    """
    raw_lower = raw_text.lower()
    kw_lower = keyword.lower()
    best_text, best_score = None, float('-inf')
    pos = 0
    while pos < len(raw_text):
        idx = raw_lower.find(kw_lower, pos)
        if idx == -1:
            break
        start = max(0, idx - 80)
        # 스코어링 범위를 200자로 제한 (150자 누락, 300자 노이즈 과다, 200자 적정)
        end = min(len(raw_text), idx + 200)
        while start > 0 and raw_text[start - 1] != '\n':
            start -= 1
        while end < len(raw_text) and raw_text[end] != '\n':
            end += 1
        ctx = _clean_window(raw_text[start:end])
        if len(ctx) < 15:
            pos = idx + 1
            continue
        # 4자리 연도만 카운트 (섹션번호 10~15 같은 2자리 숫자까지 제외)
        digits = len(re.findall(r'\d{4}', ctx))
        # yyyy.mm 형식 날짜 패턴은 트랙리스트/앨범 목록 지표 → 패널티 적용
        date_entries = len(re.findall(r'\d{4}\.\s*\d{2}', ctx))
        # dots 패널티 제거 — 콘텐츠 내 마침표가 정상 텍스트도 불이익 주는 문제 방지
        q = digits - date_entries * 5
        if q > best_score:
            best_score, best_text = q, ctx
        pos = idx + 1
    return best_text


# ── 메인 검색 함수들 ──────────────────────────────────────────────────────────
def search_group_raw(slug: str, keyword: str) -> tuple[str | None, str]:
    """
    executeGroupRawSearch Python 시뮬레이션
    Returns: (result_text, status)
      status: "OK" | "FILE_NOT_FOUND" | "NO_RESULTS"
    """
    txt_path = NAMU_RAW_DIR / f"{slug}.txt"
    if not txt_path.exists():
        return None, "FILE_NOT_FOUND"

    raw_text = txt_path.read_text(encoding='utf-8')

    # 불용어 제거 핵심 키워드 (_kwCore)
    kw_parts = keyword.split()
    kw_core_parts = [
        w for w in kw_parts
        if len(w) >= 2 and not RAW_TEXT_KW_STOPWORDS.match(w)
    ]
    kw_search = ' '.join(kw_core_parts) if kw_core_parts else keyword

    # ① 라인별 스코어링 + 섹션헤더 컨텍스트 윈도우
    lines = raw_text.split('\n')
    scored = []
    ctx_added: set[int] = set()

    for i, line in enumerate(lines):
        trimmed = line.strip()
        if len(trimmed) <= 5:
            continue
        if kw_search.lower() not in trimmed.lower():
            continue
        s = score_raw_line(trimmed, kw_search)
        if s <= 0:
            continue
        is_header = len(trimmed) < 25 and not re.search(r'\d', trimmed)
        if i not in ctx_added:
            scored.append({'text': trimmed, 'score': round(s * 0.3) if is_header else s})
            ctx_added.add(i)
        if is_header:
            for j in range(i + 1, min(i + 6, len(lines))):
                if j in ctx_added:
                    continue
                ctx = lines[j].strip()
                if len(ctx) <= 5:
                    continue
                if RAW_TEXT_NOISE.search(ctx) or RAW_TEXT_TRACKLIST.search(ctx):
                    continue
                ctx_added.add(j)
                scored.append({'text': ctx, 'score': round(s * 0.7)})

    scored.sort(key=lambda x: -x['score'])

    # ② 다중 단어 폴백
    if not scored and ' ' in kw_search:
        sub_kws = [
            w for w in kw_search.split()
            if len(w) >= 2 and not RAW_TEXT_KW_STOPWORDS.match(w)
        ]
        if sub_kws:
            # ② -a. 근접 윈도우 우선: 모든 서브 키워드가 forward 500자 이내에 공존하는 구간
            # tokenized 텍스트에서 "UN 연설"처럼 각 단어가 별도 라인에 있을 때 대응
            if len(sub_kws) >= 2:
                prox = proximity_window(raw_text, sub_kws)
                if prox:
                    scored = [{'text': prox, 'score': 75}]

        if sub_kws and not scored:
            for line in lines:
                trimmed = line.strip()
                if len(trimmed) <= 5:
                    continue
                if RAW_TEXT_NOISE.search(trimmed) or RAW_TEXT_TRACKLIST.search(trimmed):
                    continue
                s_lower = trimmed.lower()
                match_cnt = sum(1 for kw in sub_kws if kw.lower() in s_lower)
                if match_cnt == 0:
                    continue
                sub_score = 30 * match_cnt
                if re.search(r'\d', trimmed):
                    sub_score += 20
                if re.search(r'cm|kg|세|명|만|억|위|주|회|개', trimmed):
                    sub_score += 15
                if 10 <= len(trimmed) <= 200:
                    sub_score += 10
                scored.append({'text': trimmed, 'score': sub_score})
            scored.sort(key=lambda x: -x['score'])

    # ③ 텍스트 윈도우 폴백 (결과 없거나 품질 낮을 때)
    # 헤더 파생 컨텍스트 라인 최대 score = round(50*0.7) = 35 → 이 이하면 window로 교체
    needs_win = not scored or scored[0]['score'] <= 35
    if needs_win:
        best_win = best_text_window(raw_text, kw_search)
        if best_win:
            if scored and scored[0]['score'] <= 35:
                # 헤더 파생 저품질 결과를 window로 교체
                scored = [{'text': best_win, 'score': 50}]
            else:
                scored.append({'text': best_win, 'score': 50})
                scored.sort(key=lambda x: -x['score'])

    if not scored:
        return None, "NO_RESULTS"

    # ── 허위 전제 감지 ──────────────────────────────────────────────────────────
    # keyword에 그룹 멤버명이 포함되어 있지만, 상위 5개 결과 어디에도
    # 멤버명+다른_키워드가 공존하지 않으면 허위 전제로 판단 → 결과 무효화
    # 예: "김채원이 AKB48 활동 기간" → 사쿠라의 AKB48 텍스트가 반환되는 것 차단
    members = _get_group_members(slug)
    if members:
        kw_parts_check = kw_search.split()
        # 조사 제거 패턴 (이/가/은/는/의/를/을/에/도/만/으로/서/부터/까지/와/과)
        _josa = re.compile(r'[이가은는의를을에도만으로서부터까지와과]$')
        for kp in kw_parts_check:
            kp_norm = _josa.sub('', kp)
            if len(kp_norm) < 2:
                continue
            if kp_norm in members:
                # 멤버명 발견: 다른 키워드 목록 구성
                # 일반적인 단어(활동/기간/출전/기록 등)는 제외 — JS와 동일한 필터 적용
                _fp_generic = {
                    '활동', '기간', '출전', '기록', '경력', '이력', '시절', '시기', '때', '언제',
                    '참여', '포지션', '역할', '이유', '어떻게', '점수', '수상', '내역', '역사',
                    '정보', '내용', '관련', '참가', '활약', '참전', '데뷔', '솔로', '멤버'
                }
                other_kws = [
                    _josa.sub('', k).lower()
                    for k in kw_parts_check
                    if _josa.sub('', k) != kp_norm
                    and len(_josa.sub('', k)) >= 2
                    and _josa.sub('', k) not in _fp_generic
                ]
                if other_kws:
                    # 상위 5개 결과에서 멤버명 + 다른 키워드 공존 라인 확인
                    top5_texts = [s['text'] for s in scored[:5]]
                    combined = any(
                        kp_norm in text and any(ok in text.lower() for ok in other_kws)
                        for text in top5_texts
                    )
                    if not combined:
                        # 허위 전제 감지 → 결과 무효화
                        return None, "FALSE_PREMISE"
                break

    top_score = scored[0]['score']
    sentences = [s for s in scored if s['score'] >= top_score * 0.6][:5]
    return '\n'.join(s['text'] for s in sentences), "OK"


def search_info_field(slug: str, info_key: str) -> tuple[str | None, str]:
    """
    detail.info[key] 직접 매핑
    Returns: (value, status)
    """
    json_path = NAMU_GROUPS_DIR / f"{slug}.json"
    if not json_path.exists():
        return None, "FILE_NOT_FOUND"
    with open(json_path, encoding='utf-8') as f:
        data = json.load(f)
    info = data.get('info', {})
    # 공백 무시 대소문자 무시 매칭
    key_norm = info_key.replace(' ', '').lower()
    for k, v in info.items():
        if k.replace(' ', '').lower() == key_norm:
            if v:
                return str(v), "OK"
            return None, "EMPTY_VALUE"
    return None, "KEY_NOT_FOUND"


def search_multi_field(slug: str, info_keys: list[str]) -> tuple[str | None, str]:
    """
    복합 필드 조회 (executeGroupMultiField 시뮬레이션)
    """
    json_path = NAMU_GROUPS_DIR / f"{slug}.json"
    if not json_path.exists():
        return None, "FILE_NOT_FOUND"
    with open(json_path, encoding='utf-8') as f:
        data = json.load(f)
    info = data.get('info', {})
    results = []
    for key in info_keys:
        key_norm = key.replace(' ', '').lower()
        for k, v in info.items():
            if k.replace(' ', '').lower() == key_norm and v:
                results.append(f"{k}: {v}")
                break
    if not results:
        return None, "NO_RESULTS"
    return '\n'.join(results), "OK"


def run_case(case: dict) -> dict:
    """단일 테스트 케이스 실행"""
    search_type = case.get('search_type', 'raw_search')
    slug = case['slug']
    result_text = None
    status = "NOT_RUN"

    if search_type == 'info_field':
        result_text, status = search_info_field(slug, case['info_key'])
    elif search_type == 'raw_search':
        result_text, status = search_group_raw(slug, case['keyword'])
    elif search_type == 'multi_field':
        result_text, status = search_multi_field(slug, case['info_keys'])

    if status != "OK" or result_text is None:
        passed = False
        failure_reason = f"STATUS={status}"
    else:
        result_lower = result_text.lower()
        missing = [kw for kw in case.get('expected_contains', [])
                   if kw.lower() not in result_lower]
        noisy = [p for p in case.get('expected_not_contains', [])
                 if p.lower() in result_lower]
        passed = not missing and not noisy
        parts = []
        if missing:
            parts.append(f"MISSING={missing}")
        if noisy:
            parts.append(f"NOISE={noisy}")
        failure_reason = ' | '.join(parts) if parts else None

    return {
        'id': case['id'],
        'category': case['category'],
        'query': case['query'],
        'passed': passed,
        'status': status,
        'failure_reason': failure_reason,
        'result_preview': (result_text or '')[:250],
        'expected_contains': case.get('expected_contains', []),
        'notes': case.get('notes', ''),
        'failure_pattern': case.get('failure_pattern'),
    }
