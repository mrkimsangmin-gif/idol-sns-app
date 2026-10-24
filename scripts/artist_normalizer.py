# -*- coding: utf-8 -*-
"""
scripts/artist_normalizer.py — K-POP 아티스트 한/영 표기 및 Slug 표준화 모듈
"""

import re
from pathlib import Path
import json

# 알려진 대표 아티스트 이명(Alias) 및 표준 정규화 사전
ARTIST_ALIASES = {
    # TWS
    "tws": ("TWS", "tws", "남자"),
    "투어스": ("TWS", "tws", "남자"),
    
    # NCT DREAM
    "nctdream": ("NCT DREAM", "nct-dream", "남자"),
    "nct드림": ("NCT DREAM", "nct-dream", "남자"),
    "엔시티드림": ("NCT DREAM", "nct-dream", "남자"),
    "nct": ("NCT DREAM", "nct-dream", "남자"),

    # TXT
    "투모로우바이투게더": ("투모로우바이투게더", "txt", "남자"),
    "txt": ("투모로우바이투게더", "txt", "남자"),

    # ATEEZ
    "에이티즈": ("에이티즈", "ateez", "남자"),
    "ateez": ("에이티즈", "ateez", "남자"),

    # H1-KEY
    "하이키": ("하이키", "h1-key", "여자"),
    "h1key": ("하이키", "h1-key", "여자"),

    # RESCENE
    "리센느": ("리센느", "rescene", "여자"),
    "rescene": ("리센느", "rescene", "여자"),

    # P1Harmony
    "피원하모니": ("피원하모니", "p1harmony", "남자"),
    "p1harmony": ("피원하모니", "p1harmony", "남자"),

    # DRAGON PONY
    "드래곤포니": ("드래곤포니", "dragon-pony", "남자"),
    "dragonpony": ("드래곤포니", "dragon-pony", "남자"),

    # UNCHILD
    "언차일드": ("언차일드", "unchild", "여자"),
    "unchild": ("언차일드", "unchild", "여자"),

    # KEYVITUP
    "키빗업": ("키빗업", "keyvitup", "남자"),
    "keyvitup": ("키빗업", "keyvitup", "남자"),

    # LNGSHOT
    "롱샷": ("롱샷", "lngshot", "남자"),
    "lngshot": ("롱샷", "lngshot", "남자"),

    # 솔로
    "규현": ("규현", "kyuhyun", "남자"),
    "홍이삭": ("홍이삭", "hong-isaac", "남자"),
}

def normalize_artist(name: str):
    """
    아티스트명을 정규화하여 (표준 한글/영문명, 표준 slug, 기본 성별) 반환
    """
    clean_key = re.sub(r'[^a-zA-Z0-9가-힣]', '', name).lower()
    
    if clean_key in ARTIST_ALIASES:
        return ARTIST_ALIASES[clean_key]
    
    # 사전에 없으면 기본 변환
    slug = re.sub(r'[^a-z0-9]+', '-', name.lower()).strip('-')
    if not slug:
        # 한글만 있는 경우
        import hashlib
        slug = f"art-{hashlib.md5(name.encode()).hexdigest()[:6]}"
    return (name, slug, "남자")
