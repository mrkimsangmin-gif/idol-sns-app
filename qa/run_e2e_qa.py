"""
run_e2e_qa.py
실제 사용자 쿼리(user_query) 기반 E2E 테스트 러너.

'가짜 100% PASS'를 방지하기 위해 parse_query_sim을 통해
실제 JS parseSmartQuery() 파이프라인을 시뮬레이션 후 검색 실행.

사용법:
  python qa/run_e2e_qa.py             # 전체 E2E 테스트
  python qa/run_e2e_qa.py --fail-only # 실패 케이스만 출력
  python qa/run_e2e_qa.py --verbose   # 상세 결과 포함
"""

import json
import sys
import io
import argparse
from pathlib import Path
from datetime import datetime

# Windows 터미널 인코딩 강제 UTF-8
if sys.stdout.encoding != 'utf-8':
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')

sys.path.insert(0, str(Path(__file__).parent))
from parse_query_sim import parse_query, FIELD_ALIASES
from search_simulator import search_info_field, search_group_raw, search_multi_field

BASE_DIR = Path(__file__).parent.parent
SUITE_PATH = Path(__file__).parent / "test_suite.json"
REPORT_PATH = Path(__file__).parent / "e2e_report.json"

# ANSI 색상
GREEN = '\033[92m'
RED = '\033[91m'
YELLOW = '\033[93m'
CYAN = '\033[96m'
BOLD = '\033[1m'
RESET = '\033[0m'


def e2e_run_case(case: dict) -> dict:
    """
    user_query 필드를 이용해 실제 JS 파이프라인을 시뮬레이션.
    1. parse_query(user_query) → intent
    2. info 필드 선행 체크 (JS executeGroupRawSearch 동작 일치)
    3. 검색 실행 → expected_contains 확인
    """
    user_query = case.get('user_query') or case.get('query', '')
    intent = parse_query(user_query)

    # parse_query 실패
    if intent is None:
        return _make_result(case, None, "PARSE_FAILED",
                            f"parse_query({user_query!r}) → None (그룹 인식 실패)")

    result_text = None
    status = "NOT_RUN"
    parse_note = f"parse→{intent['type']} slug={intent['slug']}"

    if intent['type'] == 'navigate':
        return _make_result(case, None, "NAVIGATE",
                            "navigate 인텐트: 검색 없음", parse_note=parse_note)

    slug = intent['slug']

    if intent['type'] == 'info_field':
        # 직접 info_field 조회
        result_text, status = search_info_field(slug, intent['info_key'])
        # JS executeGroupRawSearch처럼: info 키 없으면 raw_search 폴백
        if status in ('KEY_NOT_FOUND', 'EMPTY_VALUE'):
            result_text, status = search_group_raw(slug, intent['info_key'])
            parse_note += " (info_fallback→raw)"

    elif intent['type'] == 'raw_search':
        keyword = intent['keyword']

        # JS executeGroupRawSearch는 info 필드를 먼저 확인 (공백 제거 후 대소문자 무시 키 매칭)
        info_result, info_status = search_info_field(slug, keyword.replace(' ', ''))
        if info_status == "OK":
            result_text, status = info_result, "OK"
            parse_note += " (info_first_hit)"
        else:
            result_text, status = search_group_raw(slug, keyword)

    elif intent['type'] == 'multi_field':
        info_keys = intent.get('info_keys', [])
        result_text, status = search_multi_field(slug, info_keys)

    # 결과 평가
    # allow_no_result: 허위 전제 방지 테스트 — NO_RESULTS/FALSE_PREMISE면 PASS
    if case.get('allow_no_result') and status in ('NO_RESULTS', 'FALSE_PREMISE', 'KEY_NOT_FOUND'):
        return _make_result(case, result_text, status, None, passed=True, parse_note=parse_note)

    if status not in ('OK',) or result_text is None:
        return _make_result(case, result_text, status,
                            f"STATUS={status}", parse_note=parse_note)

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

    return _make_result(case, result_text, status, failure_reason,
                        passed=passed, parse_note=parse_note)


def _make_result(case, result_text, status, failure_reason,
                 passed=None, parse_note='') -> dict:
    if passed is None:
        passed = False
    return {
        'id': case['id'],
        'category': case['category'],
        'user_query': case.get('user_query', case.get('query', '')),
        'passed': passed,
        'status': status,
        'failure_reason': failure_reason,
        'parse_note': parse_note,
        'result_preview': (result_text or '')[:250],
        'expected_contains': case.get('expected_contains', []),
        'notes': case.get('notes', ''),
    }


def main():
    parser = argparse.ArgumentParser(description='나무 스마트 검색 E2E QA 러너')
    parser.add_argument('--fail-only', '-f', action='store_true', help='실패만 출력')
    parser.add_argument('--verbose', '-v', action='store_true', help='상세 결과 포함')
    parser.add_argument('--category', '-c', help='특정 카테고리만 (예: F)')
    args = parser.parse_args()

    with open(SUITE_PATH, encoding='utf-8') as f:
        suite = json.load(f)

    if args.category:
        suite = [c for c in suite if c['category'] == args.category.upper()]

    # user_query 없는 케이스 경고
    no_uq = [c['id'] for c in suite if not c.get('user_query')]
    if no_uq:
        print(f"{YELLOW}⚠ user_query 없는 케이스: {no_uq} → query 필드로 대체{RESET}")

    print(f"\n{BOLD}=== E2E QA 테스트 (실제 사용자 쿼리 파이프라인) ==={RESET}")
    print(f"테스트 케이스: {len(suite)}개\n")

    results = []
    cat_stats: dict[str, dict] = {}

    for case in suite:
        r = e2e_run_case(case)
        results.append(r)
        cat = case['category']
        cat_stats.setdefault(cat, {'pass': 0, 'fail': 0})
        if r['passed']:
            cat_stats[cat]['pass'] += 1
        else:
            cat_stats[cat]['fail'] += 1

        if not r['passed'] or (not args.fail_only):
            icon = f"{GREEN}[PASS]{RESET}" if r['passed'] else f"{RED}[FAIL]{RESET}"
            print(f"  [{r['id']}] {icon}  {r['user_query']}")
            if args.verbose or not r['passed']:
                print(f"       parse: {r['parse_note']}")
                if not r['passed']:
                    print(f"       {YELLOW}원인: {r['failure_reason']}{RESET}")
                    print(f"       {CYAN}결과: {r['result_preview'][:150]!r}{RESET}")
                    print(f"       기대: {r['expected_contains']}")

    # 요약
    total_pass = sum(r['passed'] for r in results)
    total = len(results)
    pct = total_pass / total * 100 if total else 0

    print(f"\n{BOLD}=== 카테고리별 결과 ==={RESET}")
    labels = {'A': 'A. 정형 데이터', 'B': 'B. raw 키워드', 'D': 'D. 복합 쿼리',
              'E': 'E. 별칭 처리', 'F': 'F. 엣지 케이스'}
    for cat in sorted(cat_stats.keys()):
        s = cat_stats[cat]
        t = s['pass'] + s['fail']
        p = s['pass'] / t * 100 if t else 0
        bar = GREEN if p == 100 else (YELLOW if p >= 70 else RED)
        print(f"  {bar}{labels.get(cat, cat)}: {s['pass']}/{t} ({p:.0f}%){RESET}")

    print(f"\n{BOLD}총합: {total_pass}/{total} PASS ({pct:.0f}%){RESET}")

    failed = [r for r in results if not r['passed']]
    if failed:
        print(f"\n{RED}{BOLD}실패 케이스 ({len(failed)}건):{RESET}")
        for r in failed:
            print(f"  [{r['id']}] {r['user_query']} → {r['failure_reason']}")
        print(f"\n{CYAN}→ 실패한 케이스의 namu-smart-search.js를 수정 후 재실행하세요.{RESET}")
    else:
        print(f"\n{GREEN}{BOLD}✓ 모든 E2E 테스트 통과 — 실제 사용자 경험 정상{RESET}")

    # JSON 리포트
    report = {
        'generated_at': datetime.now().isoformat(),
        'mode': 'e2e',
        'summary': {'total': total, 'pass': total_pass, 'fail': len(failed), 'pass_rate': round(pct, 1)},
        'category_stats': cat_stats,
        'failed_cases': failed,
        'all_results': results,
    }
    with open(REPORT_PATH, 'w', encoding='utf-8') as f:
        json.dump(report, f, ensure_ascii=False, indent=2)
    print(f"\nE2E 리포트 저장: {REPORT_PATH}")

    return 0 if not failed else 1


if __name__ == '__main__':
    sys.exit(main())
