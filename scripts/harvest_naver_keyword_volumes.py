import time
import base64
import hmac
import hashlib
import requests
import json
import glob
import os
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding='utf-8')

# API Credentials
API_KEY = "01000000005dde155fb696992710466f3f8b27bce2bab95185b147c1abc1a02ba9c66cbf79"
SECRET_KEY = "AQAAAABd3hVftpaZJxBGbz+LJ7zi64BtV+kEYH0rsFjgZJvUDA=="
CUSTOMER_ID = "4313277"
BASE_URL = "https://api.naver.com"

def get_header(method, uri):
    timestamp = str(round(time.time() * 1000))
    signature = hmac.new(
        SECRET_KEY.encode('utf-8'),
        f"{timestamp}.{method}.{uri}".encode('utf-8'),
        hashlib.sha256
    ).digest()
    return {
        "X-Timestamp": timestamp,
        "X-API-KEY": API_KEY,
        "X-Customer": CUSTOMER_ID,
        "X-Signature": base64.b64encode(signature).decode('utf-8'),
        "Content-Type": "application/json"
    }

def fetch_keyword_stats(hint_keywords):
    uri = "/keywordstool"
    params = {
        "hintKeywords": ",".join(hint_keywords),
        "showDetail": "1"
    }
    headers = get_header("GET", uri)
    try:
        res = requests.get(f"{BASE_URL}{uri}", params=params, headers=headers, timeout=15)
        if res.status_code == 200:
            return res.json().get("keywordList", [])
    except Exception as e:
        print(f"Error fetching {hint_keywords}: {e}")
    return []

# 1. Load idol group names
groups_dir = r"G:\내 드라이브\01.Work\04.AI.M.Contents\00.pumit\04.aimcontents.com\idol-sns-app\data\namu-groups"
files = glob.glob(os.path.join(groups_dir, "*.json"))

group_names = []
for f in files:
    try:
        with open(f, encoding='utf-8') as fp:
            d = json.load(fp)
            name = d.get("name", "").strip()
            if name and name not in group_names:
                group_names.append(name)
    except:
        pass

print(f"Loaded {len(group_names)} unique idol group names.")

# 2. Add top category keywords
category_keywords = [
    "아이돌", "초동", "컴백", "나무위키", "음반판매량",
    "아이돌순위", "걸그룹순위", "보이그룹순위", "케이팝", "K-POP"
]

all_target_keywords = list(dict.fromkeys(group_names + category_keywords))
print(f"Total targets to query: {len(all_target_keywords)}")

# 3. Batch query in chunks of 5
results_map = {}

for i in range(0, len(all_target_keywords), 5):
    chunk = all_target_keywords[i:i+5]
    print(f"Querying [{i+1}/{len(all_target_keywords)}]: {chunk}...")
    kw_list = fetch_keyword_stats(chunk)
    
    for item in kw_list:
        kw = item.get("relKeyword", "")
        pc_str = str(item.get("monthlyPcQcCnt", "0"))
        mob_str = str(item.get("monthlyMobileQcCnt", "0"))
        
        pc = int(pc_str) if pc_str.isdigit() else (5 if "<" in pc_str else 0)
        mob = int(mob_str) if mob_str.isdigit() else (5 if "<" in mob_str else 0)
        total = pc + mob
        
        if kw not in results_map or total > results_map[kw]["total"]:
            results_map[kw] = {
                "keyword": kw,
                "total": total,
                "mobile": mob,
                "pc": pc,
                "compIdx": item.get("compIdx", "-")
            }
    time.sleep(0.3) # Respect rate limits

# 4. Save results
output_file = r"G:\내 드라이브\01.Work\04.AI.M.Contents\00.pumit\04.aimcontents.com\idol-sns-app\data\naver_search_volume_master.json"
sorted_results = sorted(results_map.values(), key=lambda x: x["total"], reverse=True)

with open(output_file, "w", encoding='utf-8') as fp:
    json.dump({
        "generated_at": time.strftime("%Y-%m-%d %H:%M:%S"),
        "total_keywords_indexed": len(sorted_results),
        "keywords": sorted_results
    }, fp, ensure_ascii=False, indent=2)

print(f"\n=======================================================")
print(f"Successfully collected {len(sorted_results)} keyword volume records!")
print(f"Saved to: {output_file}")
print(f"=======================================================")

print("\n--- TOP 30 K-POP / 아이돌 키워드 월간 검색량 순위 ---")
print(f"{'순위':<4} | {'키워드':<22} | {'총 검색량':<12} | {'모바일':<10} | {'PC':<8} | {'모바일비중'}")
print("-" * 75)
for idx, item in enumerate(sorted_results[:30]):
    mob_ratio = (item['mobile'] / item['total'] * 100) if item['total'] > 0 else 0
    print(f"{idx+1:<4} | {item['keyword']:<22} | {item['total']:<12,d} | {item['mobile']:<10,d} | {item['pc']:<8,d} | {mob_ratio:>5.1f}%")
