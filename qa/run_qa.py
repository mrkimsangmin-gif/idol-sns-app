"""
run_qa.py
나무 스마트 검색 자동 품질 테스트 러너

사용법:
  python qa/run_qa.py                  # 전체 테스트
  python qa/run_qa.py --category B     # B 카테고리만
  python qa/run_qa.py --fail-only      # 실패 케이스만 출력
  python qa/run_qa.py --fix-prompt     # Claude Code 수정 프롬프트 생성
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

# qa/ 디렉토리에서 실행 가능하도록 경로 설정
sys.path.insert(0, str(Path(__file__).parent))
from search_simulator import run_case

BASE_DIR = Path(__file__).parent.parent
SUITE_PATH = Path(__file__).parent / "test_suite.json"
REPORT_PATH = Path(__file__).parent / "qa_report.json"
FIX_PROMPT_PATH = Path(__file__).parent / "fix_prompt.md"

# ANSI 색상 (터미널 출력)
GREEN = '\033[92m'
RED = '\033[91m'
YELLOW = '\033[93m'
CYAN = '\033[96m'
BOLD = '\033[1m'
RESET = '\033[0m'
PASS_ICON = '[PASS]'
FAIL_ICON = '[FAIL]'


def category_label(cat: str) -> str:
    labels = {
        'A': 'A. 정형 데이터 (info 필드)',
        'B': 'B. raw_text 키워드 검색',
        'C': 'C. LLM 추론 필요',
        'D': 'D. 복합 쿼리 / 크로스 그룹',
        'E': 'E. 별칭/축약어 처리',
        'F': 'F. 엣지 케이스',
        'G': 'G. 환각 방지',
    }
    return labels.get(cat, cat)


def print_result(r: dict, verbose: bool = True):
    icon = f"{GREEN}{PASS_ICON}{RESET}" if r['passed'] else f"{RED}{FAIL_ICON}{RESET}"
    print(f"  [{r['id']}] {icon}  {r['query']}")
    if not r['passed'] and verbose:
        print(f"       {YELLOW}원인: {r['failure_reason']}{RESET}")
        print(f"       {CYAN}실제 결과: {r['result_preview'][:120]!r}{RESET}")
        if r['expected_contains']:
            print(f"       기대 키워드: {r['expected_contains']}")


def generate_fix_prompt(failed: list[dict]) -> str:
    """실패 케이스를 분석해 Claude Code 수정 프롬프트 생성"""
    lines = [
        "# QA 자동 테스트 실패 리포트",
        f"생성 시각: {datetime.now().strftime('%Y-%m-%d %H:%M')}",
        f"실패 건수: {len(failed)}건",
        "",
        "아래 실패 케이스들을 분석하고 `namu-smart-search.js`를 수정해주세요.",
        "",
        "## 실패 케이스 목록",
        "",
    ]

    # 패턴별 그룹화
    pattern_groups: dict[str, list] = {}
    for r in failed:
        p = r.get('failure_pattern') or 'UNKNOWN'
        pattern_groups.setdefault(p, []).append(r)

    pattern_desc = {
        'A': '섹션 헤더 노이즈 (목차 TOC에서 키워드 히트 → 빈 내용)',
        'B': '불용어로 인한 엉뚱한 라인 히트 (상황/현황 등 범용 단어)',
        'C': '토큰화 단독 라인 필터 (4-5자 키워드 라인이 length <= 5 필터에 걸림)',
        'UNKNOWN': '기타 미분류 실패',
    }

    for pat, cases in pattern_groups.items():
        lines.append(f"### 패턴 {pat}: {pattern_desc.get(pat, pat)}")
        for r in cases:
            lines.append(f"- **[{r['id']}]** `{r['query']}`")
            lines.append(f"  - 원인: `{r['failure_reason']}`")
            lines.append(f"  - 실제 결과: `{r['result_preview'][:150]}`")
            lines.append(f"  - 기대 키워드: `{r['expected_contains']}`")
        lines.append("")

    lines += [
        "## 수정 지시",
        "",
        "1. 각 실패 케이스의 `data/namu-raw/{slug}.txt` 파일을 직접 확인해서 원인을 파악하세요.",
        "2. `namu-smart-search.js`의 해당 로직(RAW_TEXT_NOISE, RAW_TEXT_KW_STOPWORDS, 텍스트 윈도우 등)을 수정하세요.",
        "3. 수정 후 `python qa/run_qa.py`를 다시 실행해서 PASS 여부를 확인하세요.",
        "4. 이전에 PASS였던 케이스가 FAIL로 바뀌지 않았는지 회귀 테스트를 확인하세요.",
        "",
        "수정이 완료되면 `qa/search_simulator.py`의 동일 로직도 동기화해주세요.",
    ]
    return '\n'.join(lines)


def main():
    parser = argparse.ArgumentParser(description='나무 스마트 검색 QA 러너')
    parser.add_argument('--category', '-c', help='특정 카테고리만 실행 (예: B)')
    parser.add_argument('--fail-only', '-f', action='store_true', help='실패만 출력')
    parser.add_argument('--fix-prompt', action='store_true', help='Claude Code 수정 프롬프트 저장')
    parser.add_argument('--quiet', '-q', action='store_true', help='요약만 출력')
    args = parser.parse_args()

    with open(SUITE_PATH, encoding='utf-8') as f:
        suite = json.load(f)

    # 필터 적용
    if args.category:
        suite = [c for c in suite if c['category'] == args.category.upper()]

    print(f"\n{BOLD}=== 나무위키 스마트 검색 QA 테스트 ==={RESET}")
    print(f"테스트 케이스: {len(suite)}개\n")

    results = []
    cat_stats: dict[str, dict] = {}

    for case in suite:
        cat = case['category']
        r = run_case(case)
        results.append(r)

        if cat not in cat_stats:
            cat_stats[cat] = {'pass': 0, 'fail': 0}
        if r['passed']:
            cat_stats[cat]['pass'] += 1
        else:
            cat_stats[cat]['fail'] += 1

        # 실패 케이스는 항상 출력, PASS는 quiet 모드에서 생략
        if not r['passed'] or (not args.quiet and not args.fail_only):
            print_result(r, verbose=not r['passed'])

    # 카테고리별 요약
    total_pass = sum(r['passed'] for r in results)
    total = len(results)
    pct = total_pass / total * 100 if total else 0

    print(f"\n{BOLD}=== 카테고리별 결과 ==={RESET}")
    for cat in sorted(cat_stats.keys()):
        s = cat_stats[cat]
        t = s['pass'] + s['fail']
        p = s['pass'] / t * 100 if t else 0
        bar = GREEN if p == 100 else (YELLOW if p >= 70 else RED)
        print(f"  {bar}{category_label(cat)}: {s['pass']}/{t} ({p:.0f}%){RESET}")

    print(f"\n{BOLD}총합: {total_pass}/{total} PASS ({pct:.0f}%){RESET}")

    # 실패 케이스
    failed = [r for r in results if not r['passed']]
    if failed:
        print(f"\n{RED}{BOLD}실패 케이스 ({len(failed)}건):{RESET}")
        for r in failed:
            print(f"  [{r['id']}] {r['query']} → {r['failure_reason']}")

    # JSON 리포트 저장
    report = {
        'generated_at': datetime.now().isoformat(),
        'summary': {
            'total': total,
            'pass': total_pass,
            'fail': len(failed),
            'pass_rate': round(pct, 1),
        },
        'category_stats': cat_stats,
        'failed_cases': failed,
        'all_results': results,
    }
    with open(REPORT_PATH, 'w', encoding='utf-8') as f:
        json.dump(report, f, ensure_ascii=False, indent=2)
    print(f"\n리포트 저장: {REPORT_PATH}")

    # Claude Code 수정 프롬프트 생성
    if args.fix_prompt and failed:
        prompt_text = generate_fix_prompt(failed)
        with open(FIX_PROMPT_PATH, 'w', encoding='utf-8') as f:
            f.write(prompt_text)
        print(f"수정 프롬프트 저장: {FIX_PROMPT_PATH}")
        print(f"\n{CYAN}Claude Code에 다음 명령 실행:{RESET}")
        print(f'  claude -p "$(cat {FIX_PROMPT_PATH})"')
    elif failed and not args.fix_prompt:
        print(f"\n{CYAN}수정 프롬프트 생성: python qa/run_qa.py --fix-prompt{RESET}")

    return 0 if not failed else 1


if __name__ == '__main__':
    sys.exit(main())
