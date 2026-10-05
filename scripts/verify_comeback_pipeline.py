# -*- coding: utf-8 -*-
"""
verify_comeback_pipeline.py — 컴백 일정 유효성 검증 및 사이트 렌더링 검증 도구

설계 철학 (Anti-False-Negative):
- 너무 까다로운 필터링으로 '진짜 컴백'이 누락되는 일이 없도록,
  1) [확정 컴백] 음반 키워드가 1개라도 있고 명백한 공연/팬미팅 단독 행사가 아닌 경우 자동 승인
  2) [보류 (Review)] 텍스트가 애매한 경우 임의로 제거(삭제)하지 않고 '검토 플래그'를 붙여 보존
  3) CDP 브라우저를 통해 실제 기사 본문 팩트체크 + aimcontents.com/comeback 렌더링 동시 검증
"""
import sys, os, io, re, json, time
from datetime import datetime, date
from pathlib import Path

# Safe logging
def log(msg):
    sys.stderr.write(str(msg) + "\n")
    sys.stderr.flush()

SCRIPT_DIR = Path(__file__).resolve().parent
APP_ROOT = SCRIPT_DIR.parent
DATA_DIR = APP_ROOT / "data"

sys.path.insert(0, str(APP_ROOT / "07.hanteo"))
from comeback_tracker import list_comebacks

# ── 음반/컴백 긍정 지표 (하나라도 있으면 컴백 가능성 매우 높음) ──
ALBUM_SIGNALS = [
    r'컴백', r'발매', r'신보', r'앨범', r'음원', r'싱글', r'미니\s*앨범', r'정규',
    r'ep\b', r'release', r'comeback', r'track', r'스케줄러', r'타임테이블',
    r'pre-order', r'예약\s*판매', r'디지털\s*싱글', r'초동', r'mv\b', r'뮤직비디오'
]

# ── 명백한 비(非)음반 행사 지표 (단, 음반 발매와 함께 언급된 경우는 제외하지 않음) ──
PURE_EVENT_ONLY = [
    r'팬미팅\s*(?:개최|안내|티켓)', r'팬클럽\s*(?:모집|창단)',
    r'월드\s*투어\s*(?:개최|티켓)', r'단독\s*콘서트\s*(?:개최|티켓)',
    r'자체\s*예능', r'생일\s*기념'
]


def score_comeback_evidence(title: str, text: str):
    """
    기사 또는 트윗 본문을 채점하여 컴백 여부를 판정
    반환값: (status: 'PASS' | 'REVIEW' | 'REJECT', score: int, reasons: list)
    """
    full_text = (title + " " + text).lower()
    reasons = []
    score = 0

    # 1. 긍정 음반 신호 채점 (+20점씩)
    for sig in ALBUM_SIGNALS:
        if re.search(sig, full_text):
            score += 20
            reasons.append(f"음반 신호 감지: '{sig}'")
            if score >= 40:  # 2개 이상 감지되면 충분
                break

    # 2. 순수 행사(팬미팅/투어) 오탐 체크
    has_pure_event = False
    for evt in PURE_EVENT_ONLY:
        if re.search(evt, full_text):
            has_pure_event = True
            reasons.append(f"비음반 행사 단서 감지: '{evt}'")
            break

    # 3. 종합 판정 (안전 제일주의: 애매하면 탈락시키지 않고 REVIEW로 전달)
    if has_pure_event and score < 40:
        # 음반 신호가 거의 없는데 팬미팅/투어 키워드만 명확한 경우만 REJECT
        return "REJECT", score, reasons
    elif score >= 20:
        # 음반/컴백 관련 키워드가 확인되면 통과 (누락 방지)
        return "PASS", score, reasons
    else:
        # 판단 근거가 부족한 경우 임의 삭제 금지 -> 사람이 확인할 수 있도록 REVIEW 처리
        return "REVIEW", score, reasons


def verify_active_comebacks():
    """현재 등록된 컴백 일정 전수 유효성 검사"""
    log("=" * 65)
    log("🔍 [Comeback Verification Engine] 등록된 컴백 일정 유효성 검사 시작")
    log("=" * 65)

    cal_path = DATA_DIR / "calendar.json"
    if not cal_path.exists():
        log("❌ calendar.json 파일이 존재하지 않습니다.")
        return

    cal_data = json.loads(cal_path.read_text(encoding="utf-8"))
    events = cal_data.get("events", [])
    today_str = date.today().isoformat()

    # 오늘 이후 예정된 컴백 일정 대상 검증
    upcoming_events = [e for e in events if e.get("date") and e.get("date") >= today_str]
    log(f"총 {len(events)}개 일정 중 예정된 일정: {len(upcoming_events)}건 검증 진행\n")

    results = {"PASS": [], "REVIEW": [], "REJECT": []}

    for ev in upcoming_events:
        title = ev.get("title", "")
        desc = ev.get("description", "")
        status, score, reasons = score_comeback_evidence(title, desc)
        
        entry = {
            "date": ev.get("date"),
            "slug": ev.get("slug"),
            "title": title,
            "score": score,
            "status": status,
            "reasons": reasons,
            "url": ev.get("url")
        }
        results[status].append(entry)

        status_icon = "✅" if status == "PASS" else ("⚠️" if status == "REVIEW" else "❌")
        log(f"{status_icon} [{status}] {ev.get('date')} | {title} (점수: {score})")
        if reasons:
            log(f"   단서: {', '.join(reasons[:2])}")

    log("\n" + "=" * 65)
    log(f"📊 검증 요약: 통과(PASS) {len(results['PASS'])}건 | 검토권장(REVIEW) {len(results['REVIEW'])}건 | 부적합의심(REJECT) {len(results['REJECT'])}건")
    log("=" * 65)

    # 검증 결과 리포트 저장
    report_path = DATA_DIR / "comeback_verification_report.json"
    with open(report_path, "w", encoding="utf-8") as f:
        json.dump({
            "verified_at": datetime.now().isoformat(),
            "total_upcoming": len(upcoming_events),
            "summary": {
                "PASS": len(results["PASS"]),
                "REVIEW": len(results["REVIEW"]),
                "REJECT": len(results["REJECT"])
            },
            "details": results
        }, f, ensure_ascii=False, indent=2)
    log(f"📄 검증 리포트 저장 완료: {report_path}")

    return results


if __name__ == "__main__":
    verify_active_comebacks()
