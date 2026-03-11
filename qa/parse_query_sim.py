"""
parse_query_sim.py
JS parseSmartQuery()의 그룹+키워드 추출 핵심 로직을 Python으로 복제.
group-aliases.json을 이용해 그룹명/alias 매핑 후 키워드 또는 info_key 분류.

E2E 테스트에서 '실제 사용자 입력 → 검색 파라미터' 파이프라인 검증에 사용.
"""

import json
import re
from pathlib import Path

BASE_DIR = Path(__file__).parent.parent
ALIASES_PATH = BASE_DIR / "data" / "group-aliases.json"

# JS FIELD_ALIASES 핵심 항목 동기화
# (이 목록에 있는 키워드는 info_field로 라우팅, 없으면 raw_search)
FIELD_ALIASES: dict[str, str] = {
    '소속사': '소속사', '기획사': '소속사', '회사': '소속사', '엔터': '소속사',
    '데뷔': '데뷔일', '데뷔일': '데뷔일', '데뷔년도': '데뷔일',
    '팬덤': '팬덤명', '팬덤명': '팬덤명', '팬클럽': '팬덤명',
    '멤버수': '멤버수', '인원': '멤버수',
    'mbti': 'MBTI', 'MBTI': 'MBTI', '엠비티아이': 'MBTI',
}

# JS QUERY_SUFFIXES 주요 항목 (길이 내림차순)
_QUERY_SUFFIXES = sorted([
    '추천해 주세요', '추천해주세요', '알려주세요', '알려줘요', '알고 싶어요',
    '알고싶어요', '추천해줘', '알려줘', '해주세요', '뭐야', '뭐에요', '뭐예요',
    '인가요', '인가', '이 무엇인가요', '이 뭔가요', '이 뭐야', '뭔지', '뭘까',
    '해줘', '요',
], key=len, reverse=True)

_group_index: dict | None = None


def _load_group_index() -> dict:
    """group-aliases.json 로드 후 alias→{slug, name} 역인덱스 구축"""
    global _group_index
    if _group_index is not None:
        return _group_index
    with open(ALIASES_PATH, encoding='utf-8') as f:
        data = json.load(f)
    groups = data.get('groups', {})
    index: dict = {}
    for name, info in groups.items():
        slug = info.get('slug', '')
        entry = {'slug': slug, 'name': name}
        # 그룹 공식명
        index[name.lower().replace(' ', '')] = entry
        # alias 목록
        for alias in info.get('aliases', []):
            index[alias.lower().replace(' ', '')] = entry
    _group_index = index
    return index


def find_group(term: str) -> dict | None:
    """그룹명/alias로 {slug, name} 반환. 없으면 None."""
    index = _load_group_index()
    key = term.lower().replace(' ', '')
    return index.get(key)


def _normalize(query: str) -> str:
    """JS normalizeQuery() 핵심 로직: 물음표·조사·꼬리 표현 제거"""
    q = query.strip()
    # 물음표/느낌표/마침표 제거
    q = re.sub(r'[?？!！.。,，~]+$', '', q).strip()
    # 꼬리 표현 제거 (길이 내림차순으로 한 번만)
    for suffix in _QUERY_SUFFIXES:
        if q.endswith(suffix) and len(q) > len(suffix):
            q = q[:-len(suffix)].strip()
            break
    # 조사 제거 ("소속사는" → "소속사", 잔여 2글자 이하면 보존)
    q = re.sub(r'(\S{2,})[을를이가은는의]$', r'\1', q).strip()
    return q


def _extract_fields(text: str) -> list[str] | None:
    """
    JS extractFields() 복제: "소속사와 팬덤명" → ['소속사', '팬덤명']
    반환값: 매핑된 필드 키 목록 (모두 FIELD_ALIASES에 있을 때만), 없으면 None
    """
    if not text:
        return None
    parts = re.split(r'[과와]|이랑|하고|,|및', text)
    parts = [p.strip().rstrip('등').rstrip('들').strip() for p in parts if p.strip()]
    fields = []
    for part in parts:
        key = FIELD_ALIASES.get(part) or FIELD_ALIASES.get(part.lower())
        if key:
            if key not in fields:
                fields.append(key)
        else:
            return None  # 하나라도 미매핑이면 multi_field 아님
    return fields if len(fields) >= 2 else None


def parse_query(user_query: str) -> dict | None:
    """
    JS parseSmartQuery()의 그룹+키워드 추출 부분 복제.
    Returns:
      {'type': 'info_field', 'slug': str, 'info_key': str}
      {'type': 'raw_search', 'slug': str, 'keyword': str}
      {'type': 'navigate', 'slug': str, 'name': str}
      None  ← 그룹 인식 실패
    """
    q = _normalize(user_query)
    words = q.split()

    # 앞에서부터 점점 긴 문자열로 그룹 매칭 시도 (JS 6-2 multi-word 패턴과 동일)
    for i in range(1, len(words) + 1):
        group_part = ' '.join(words[:i])
        group = find_group(group_part)
        if group:
            remaining = ' '.join(words[i:]).strip()
            if not remaining:
                # 그룹명만 입력 → navigate
                return {'type': 'navigate', 'slug': group['slug'], 'name': group['name']}

            # multi_field 판별: "소속사와 팬덤명" 등 복합 필드 쿼리
            multi_fields = _extract_fields(remaining)
            if multi_fields:
                return {
                    'type': 'multi_field',
                    'slug': group['slug'],
                    'info_keys': multi_fields,
                }

            # FIELD_ALIASES 단일 매칭 → info_field
            field_key = FIELD_ALIASES.get(remaining) or FIELD_ALIASES.get(remaining.lower())
            if field_key:
                return {
                    'type': 'info_field',
                    'slug': group['slug'],
                    'info_key': field_key,
                }

            # raw_search
            return {
                'type': 'raw_search',
                'slug': group['slug'],
                'keyword': remaining,
            }

    return None
