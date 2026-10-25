import json
import sys

sys.stdout.reconfigure(encoding='utf-8')

fp = r"G:\내 드라이브\01.Work\04.AI.M.Contents\00.pumit\04.aimcontents.com\idol-sns-app\data\naver_search_volume_master.json"
with open(fp, encoding='utf-8') as f:
    d = json.load(f)

kws = d.get("keywords", [])

# Filter for pure Idol / K-POP related keywords
non_kpop = ["비트코인", "리플", "편의점", "이더리움", "안나앤모드", "블로그", "안나키즈", "리미떼두두", "도지코인", "코인", "아프리콧", "더애수", "애니", "MLB"]

filtered = [k for k in kws if not any(x in k['keyword'] for x in non_kpop)]

print(f"=== 네이버 공식 검색광고 API: K-POP & 아이돌 관련 검색량 TOP 25 ===")
print(f"{'순위':<4} | {'키워드':<20} | {'월간 총 검색량':<14} | {'모바일 검색량':<12} | {'모바일 비중'}")
print("-" * 70)
for idx, item in enumerate(filtered[:25]):
    mob_ratio = (item['mobile'] / item['total'] * 100) if item['total'] > 0 else 0
    print(f"{idx+1:<4} | {item['keyword']:<20} | {item['total']:<14,d} | {item['mobile']:<12,d} | {mob_ratio:>5.1f}%")

print("\n=== '초동 / 컴백 / 나무위키' 결합 키워드 검색량 분석 ===")
combo_kws = [k for k in kws if any(x in k['keyword'] for x in ["초동", "컴백", "나무위키", "순위", "음반"])]
for item in combo_kws[:15]:
    print(f" - {item['keyword']}: 월 {item['total']:,}회 (모바일: {item['mobile']:,})")
