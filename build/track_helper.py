import re

IGNORE_WORDS = {
    '선공개곡', '선공개 싱글', '선공개', '디지털 싱글', '싱글', '싱글 1집', '싱글 2집', '미니 1집', '미니 2집',
    '정규 1집', '정규 2집', '데뷔 음반', '리패키지', '리믹스', 'OST', '스페셜', '피처링', '콜라보', '협업곡',
    '한터 주간 실측치', '한터 일간 실측치', '써클 주간', '써클 월간', '초동', '누적', '발매'
}

def extract_tracks(album):
    """
    Extracts high-quality track titles for an album.
    1. Check if 'tracks' already present
    2. Extract from '비고'
    3. If single/digital single and no tracks, album title itself is usually the title track
    """
    if album.get('tracks') and isinstance(album['tracks'], list):
        return [t.strip() for t in album['tracks'] if t and isinstance(t, str)]
    
    biko = album.get('비고', '')
    title = album.get('title', '').strip()
    alb_type = album.get('type', '')
    
    tracks = []
    if biko and isinstance(biko, str):
        s = biko.strip()
        # Remove prefixes
        s = re.sub(r'^(타이틀곡|TITLE|타이틀|선공개곡|선공개|후속곡)\s*[:：]?\s*', '', s, flags=re.IGNORECASE)
        s = re.sub(r'.*?타이틀곡\s*[:：]?\s*', '', s)
        
        # Split by comma or slash
        raw_parts = [p.strip() for p in re.split(r'[,/]', s)]
        for p in raw_parts:
            # Strip trailing unbalanced quotes or spaces, keep internal parentheses
            p = p.strip('\'"“”‘’[]').strip()
            if p in IGNORE_WORDS or any(ig in p for ig in ['실측치', '시즌 스페셜', '협업곡']):
                continue
            if len(p) >= 2 and len(p) <= 45 and not p.isdigit():
                if p not in tracks:
                    tracks.append(p)
                    
    # If no track found from biko and it's a single, title is the song
    if not tracks and any(k in alb_type for k in ['싱글', 'Single']):
        # Clean title (e.g. "Ditto (선공개 싱글)" -> "Ditto")
        clean_t = re.sub(r'\s*\([^)]*(싱글|Single|OST|Remix|Ver)[^)]*\)', '', title).strip()
        if clean_t and clean_t not in IGNORE_WORDS:
            tracks.append(clean_t)
            
    return tracks
