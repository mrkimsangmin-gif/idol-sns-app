# -*- coding: utf-8 -*-
"""
Gemini API 기반 엔터뉴스 영문 번역 모듈 (10건 청크 분할 + 재시도)
- 입력: data/news.json (국내 한글 기사 30~50건)
- 출력: data/news-en.json (영문화된 K-POP 헤드라인 및 디스크립션)
"""
import os
import sys
import json
import time
import urllib.request
from pathlib import Path

sys.stdout.reconfigure(encoding='utf-8')

BASE_DIR = Path(__file__).resolve().parent
NEWS_KO_PATH = BASE_DIR / "data" / "news.json"
NEWS_EN_PATH = BASE_DIR / "data" / "news-en.json"

def get_gemini_key():
    key = os.environ.get("GEMINI_API_KEY", "")
    if key:
        return key
    secrets_cmd = BASE_DIR / "06.jobs" / "credentials" / "secrets.cmd"
    if secrets_cmd.exists():
        try:
            with open(secrets_cmd, "r", encoding="utf-8", errors="ignore") as f:
                for line in f:
                    if line.strip().startswith("set GEMINI_API_KEY="):
                        return line.strip().split("=", 1)[1].strip()
        except Exception:
            pass
    return ""

def translate_chunk(chunk, gemini_key):
    url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key={gemini_key}"
    prompt = (
        "You are an expert K-POP entertainment journalist. Translate and adapt the following Korean K-POP news items "
        "into natural, professional, high-impact English headlines and concise descriptions (in the style of Soompi / Billboard K-Town).\n"
        "Return a strictly valid JSON array of objects with keys: 'id' (number), 'title_en' (string), and 'desc_en' (string).\n\n"
        f"Input items:\n{json.dumps(chunk, ensure_ascii=False, indent=2)}"
    )

    payload = {
        "contents": [{"parts": [{"text": prompt}]}],
        "generationConfig": {
            "responseMimeType": "application/json",
            "temperature": 0.2
        }
    }

    req = urllib.request.Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"}
    )

    with urllib.request.urlopen(req, timeout=40) as resp:
        res_data = json.loads(resp.read().decode("utf-8"))
        raw_text = res_data["candidates"][0]["content"]["parts"][0]["text"]
        return json.loads(raw_text)

def translate_news_batch():
    if not NEWS_KO_PATH.exists():
        print(f"[뉴스 번역] 파일 없음: {NEWS_KO_PATH}")
        return False

    with open(NEWS_KO_PATH, "r", encoding="utf-8") as f:
        news_items = json.load(f)

    if not news_items:
        print("[뉴스 번역] 기사 데이터가 비어 있습니다.")
        return False

    gemini_key = get_gemini_key()
    if not gemini_key:
        print("[뉴스 번역] GEMINI_API_KEY를 찾을 수 없습니다.")
        return False

    print(f"[뉴스 번역] 총 {len(news_items)}건 기사 영문화 시작 (10건씩 분할 처리)...")

    items_to_translate = []
    for idx, item in enumerate(news_items):
        clean_title = item.get("title", "").split(" - ")[0].strip()
        clean_desc = item.get("description", "").strip()
        items_to_translate.append({
            "id": idx,
            "keyword": item.get("keyword", ""),
            "title": clean_title,
            "desc": clean_desc[:100]
        })

    chunk_size = 10
    trans_map = {}
    for i in range(0, len(items_to_translate), chunk_size):
        chunk = items_to_translate[i:i+chunk_size]
        print(f"  - 청크 {i//chunk_size + 1}/{(len(items_to_translate)-1)//chunk_size + 1} 처리 중 ({len(chunk)}건)...")
        success = False
        for attempt in range(3):
            try:
                res_list = translate_chunk(chunk, gemini_key)
                for t in res_list:
                    if "id" in t:
                        trans_map[t["id"]] = t
                success = True
                break
            except Exception as e:
                print(f"    [재시도 {attempt+1}/3] 오류: {e}")
                time.sleep(2)
        if not success:
            print(f"    [경고] 청크 {i//chunk_size + 1} 번역 실패 (원문 폴백 사용)")

    news_en = []
    for idx, item in enumerate(news_items):
        en_info = trans_map.get(idx, {})
        news_en.append({
            "keyword": item.get("keyword", ""),
            "title": en_info.get("title_en") or item.get("title", ""),
            "description": en_info.get("desc_en") or item.get("description", ""),
            "link": item.get("link", ""),
            "pubDate": item.get("pubDate", ""),
            "score": item.get("score", 0),
            "collectTime": item.get("collectTime", ""),
            "title_ko": item.get("title", ""),
            "desc_ko": item.get("description", "")
        })

    with open(NEWS_EN_PATH, "w", encoding="utf-8") as f:
        json.dump(news_en, f, ensure_ascii=False, indent=2)

    print(f"[뉴스 번역 완료] {len(news_en)}건 영문 뉴스 저장 완료: {NEWS_EN_PATH}")
    return True

if __name__ == "__main__":
    translate_news_batch()
