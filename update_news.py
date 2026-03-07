"""
엔터뉴스 수집 스크립트 — 174개 아이돌 그룹 뉴스 수집
Google News RSS + include/exclude 필터링
출력: data/news.json

사용법:
  C:/Python314/python.exe update_news.py
  C:/Python314/python.exe update_news.py --top 50    # 상위 50건
  C:/Python314/python.exe update_news.py --archive   # 아카이브 CSV 누적 저장
"""
import csv
import io
import json
import os
import sys
import re
import time
import urllib.request
import urllib.parse
import xml.etree.ElementTree as ET
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone, timedelta
from email.utils import parsedate_to_datetime

sys.stdout.reconfigure(encoding='utf-8')

# 경로 설정
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
OUTPUT_JSON = os.path.join(SCRIPT_DIR, 'data', 'news.json')
ARCHIVE_CSV = os.path.join(SCRIPT_DIR, 'data', 'news-archive.csv')

# 구글 시트 설정
SHEET_ID = '1vgTIwpNWxanGCOOD-KE3xBooaNW88zKFK_78rLdNNeU'
GROUPS_GID = '0'
FILTER_GID = '1151775317'


def fetch_csv(gid):
    """구글 시트에서 CSV 데이터 가져오기"""
    url = f'https://docs.google.com/spreadsheets/d/{SHEET_ID}/gviz/tq?tqx=out:csv&gid={gid}'
    with urllib.request.urlopen(url, timeout=15) as resp:
        return resp.read().decode('utf-8')


def load_groups():
    """아이돌 그룹 목록 로드"""
    text = fetch_csv(GROUPS_GID)
    reader = csv.DictReader(io.StringIO(text))
    groups = []
    for row in reader:
        name = row.get('name', '').strip()
        query = row.get('search_query', '').strip()
        if name and query:
            groups.append({'name': name, 'search_query': query})
    return groups


def load_filters():
    """include/exclude 키워드 필터 로드"""
    text = fetch_csv(FILTER_GID)
    reader = csv.DictReader(io.StringIO(text))
    includes = []
    excludes = []
    for row in reader:
        kw = row.get('keyword', '').strip()
        typ = row.get('type', '').strip()
        score = int(row.get('score', '0') or '0')
        if typ == 'include':
            includes.append((kw, score))
        elif typ == 'exclude':
            excludes.append(kw)
    return includes, excludes


def fetch_news_rss(query, max_items=3):
    """Google News RSS에서 뉴스 검색"""
    url = f'https://news.google.com/rss/search?q={urllib.parse.quote(query)}&hl=ko&gl=KR&ceid=KR:ko'
    try:
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req, timeout=10) as resp:
            xml_text = resp.read().decode('utf-8')
        root = ET.fromstring(xml_text)
        channel = root.find('channel')
        items = channel.findall('item') if channel is not None else []
        results = []
        for item in items[:max_items]:
            title = item.findtext('title', '')
            link = item.findtext('link', '')
            desc = re.sub(r'<[^>]*>', '', item.findtext('description', '')).strip()
            # &nbsp; 제거
            desc = desc.replace('\xa0', ' ').replace('&nbsp;', ' ').strip()
            pub_date = item.findtext('pubDate', '')
            results.append({
                'title': title,
                'link': link,
                'description': desc,
                'pubDate': pub_date
            })
        return results
    except Exception:
        return []


def apply_filters(news_list, keyword, includes, excludes, max_age_days=7):
    """include/exclude 키워드 필터 적용 + 날짜 필터"""
    filtered = []
    now = datetime.now(timezone.utc)
    cutoff = now - timedelta(days=max_age_days)

    for news in news_list:
        # 날짜 필터: max_age_days일 이내 기사만 허용
        try:
            pub_dt = parsedate_to_datetime(news['pubDate'])
            if pub_dt < cutoff:
                continue
        except Exception:
            pass  # 파싱 실패 시 날짜 필터 스킵

        text = news['title'] + ' ' + news['description']

        # exclude 키워드가 포함되면 제거
        if any(ex in text for ex in excludes):
            continue

        # include score 계산
        score = sum(s for kw, s in includes if kw in text)

        news['keyword'] = keyword
        news['score'] = score
        filtered.append(news)
    return filtered


def save_json(news_list, path, top_n):
    """뉴스 JSON 파일 저장"""
    collect_time = datetime.utcnow().isoformat() + 'Z'
    output = []
    for news in news_list[:top_n]:
        output.append({
            'keyword': news['keyword'],
            'title': news['title'],
            'description': news['description'],
            'link': news['link'],
            'pubDate': news['pubDate'],
            'score': news['score'],
            'collectTime': collect_time
        })

    os.makedirs(os.path.dirname(path), exist_ok=True)

    # Google Drive 안전 쓰기 (os.replace 사용 금지)
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(output, f, ensure_ascii=False, indent=2)
        f.flush()
        os.fsync(f.fileno())

    return len(output)


def append_archive(news_list, path):
    """뉴스 아카이브 CSV에 누적 저장 (URL 중복 체크)"""
    existing_links = set()
    if os.path.exists(path):
        with open(path, 'r', encoding='utf-8') as f:
            reader = csv.reader(f)
            next(reader, None)  # 헤더 스킵
            for row in reader:
                if len(row) >= 5:
                    existing_links.add(row[4])  # link 컬럼

    new_rows = []
    for news in news_list:
        if news['link'] not in existing_links:
            new_rows.append([
                datetime.utcnow().isoformat() + 'Z',
                news['keyword'],
                news['title'],
                news['description'],
                news['link'],
                news['pubDate'],
                news['score']
            ])

    if new_rows:
        write_header = not os.path.exists(path)
        with open(path, 'a', encoding='utf-8', newline='') as f:
            writer = csv.writer(f)
            if write_header:
                writer.writerow(['collectTime', 'keyword', 'title', 'description', 'link', 'pubDate', 'score'])
            writer.writerows(new_rows)
            f.flush()
            os.fsync(f.fileno())

    return len(new_rows)


def main():
    import argparse
    parser = argparse.ArgumentParser(description='엔터뉴스 수집')
    parser.add_argument('--top', type=int, default=30, help='출력할 뉴스 수 (기본: 30)')
    parser.add_argument('--archive', action='store_true', help='아카이브 CSV에 누적 저장')
    args = parser.parse_args()

    print('=== 엔터뉴스 수집 시작 ===')
    print(f'시간: {datetime.now().strftime("%Y-%m-%d %H:%M:%S")}')

    # 1. 시트 데이터 로딩
    groups = load_groups()
    includes, excludes = load_filters()
    print(f'그룹: {len(groups)}개, include: {len(includes)}개, exclude: {len(excludes)}개')

    # 2. 병렬 뉴스 검색
    all_news = []
    seen_links = set()
    start = time.time()

    def search_group(g):
        return g['name'], fetch_news_rss(g['search_query'], max_items=3)

    with ThreadPoolExecutor(max_workers=10) as executor:
        futures = {executor.submit(search_group, g): g for g in groups}
        done = 0
        for future in as_completed(futures):
            done += 1
            name, results = future.result()
            filtered = apply_filters(results, name, includes, excludes)
            for news in filtered:
                if news['link'] not in seen_links:
                    seen_links.add(news['link'])
                    all_news.append(news)
            if done % 50 == 0:
                print(f'  {done}/{len(groups)} 완료...')

    elapsed = time.time() - start
    print(f'검색 완료: {elapsed:.1f}초, 수집: {len(all_news)}건')

    # 3. score 높은순 + 최신순 정렬
    all_news.sort(key=lambda x: (-x['score'], x['pubDate']), reverse=False)

    # 4. JSON 저장
    saved = save_json(all_news, OUTPUT_JSON, args.top)
    print(f'저장: {OUTPUT_JSON} ({saved}건)')

    # 5. 아카이브 (옵션)
    if args.archive:
        new_count = append_archive(all_news, ARCHIVE_CSV)
        print(f'아카이브: {ARCHIVE_CSV} (신규 {new_count}건)')

    print('=== 완료 ===')


if __name__ == '__main__':
    main()
