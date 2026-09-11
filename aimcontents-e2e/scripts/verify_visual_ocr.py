# -*- coding: utf-8 -*-
"""
verify_visual_ocr.py

Google Drive Cloud OCR 연동 E2E 시각 검증 및 실패 스크린샷 자동 판독 도구
- 캔버스/차트/인포그래픽 등 DOM으로 읽을 수 없는 이미지 속 텍스트 검증
- E2E 테스트 실패 시 생성된 test-failed-*.png 이미지의 텍스트 OCR 진단
"""

import sys
import argparse
from pathlib import Path

# 워크스페이스 루트의 tools/gdrive 모듈 임포트
CURRENT_DIR = Path(__file__).resolve().parent
WORKSPACE_ROOT = CURRENT_DIR.parents[4] / '05.초록뱀' / '00.work_ai'
GDRIVE_DIR = WORKSPACE_ROOT / 'tools' / 'gdrive'

if GDRIVE_DIR.exists():
    sys.path.insert(0, str(GDRIVE_DIR))
else:
    # 대체 경로 탐색
    alt_dir = Path(r'G:\내 드라이브\01.Work\05.초록뱀\00.work_ai\tools\gdrive')
    if alt_dir.exists():
        sys.path.insert(0, str(alt_dir))

try:
    from gdrive_search import search_drive
except ImportError:
    print('[Error] tools/gdrive/gdrive_search.py 모듈을 찾을 수 없습니다.')
    sys.exit(1)

def search_ocr_screenshots(query_text, limit=5):
    print(f'\n[Google Drive Cloud OCR] 이미지 및 스캔본 내 \'{query_text}\' 텍스트 검색 중...')
    items = search_drive(query_text, max_results=limit, mime_type='image/')
    
    if not items:
        print(f'  (일치하는 이미지 텍스트를 찾지 못했습니다: {query_text})')
        return []

    print(f'  -> {len(items)}건의 OCR 일치 이미지 발견:')
    for idx, item in enumerate(items, 1):
        print(f'  {idx}. [OCR 적중] {item.get("name")} (수정: {item.get("modifiedTime", "")[:10]})')
        print(f'     웹 링크: {item.get("webViewLink", "")}')
    return items

def inspect_recent_failures():
    test_results_dir = CURRENT_DIR.parent / 'test-results'
    print(f'\n[실패 스크린샷 진단] {test_results_dir} 스캔 중...')
    
    if not test_results_dir.exists():
        print('  (현재 로컬에 실패한 test-results 디렉토리가 없습니다)')
        return

    failed_images = list(test_results_dir.glob('**/*failed*.png'))
    if not failed_images:
        print('  (발견된 실패 스크린샷 이미지가 없습니다. 모든 테스트 정상)')
        return

    print(f'  발견된 실패 이미지: {len(failed_images)}개')
    for img in failed_images:
        print(f'  - {img.name} ({img.stat().st_size:,} bytes)')
        print(f'    경로: {img.relative_to(CURRENT_DIR.parent)}')

def main():
    if hasattr(sys.stdout, 'reconfigure'):
        try:
            sys.stdout.reconfigure(encoding='utf-8')
        except Exception:
            pass

    parser = argparse.ArgumentParser(description='Google Drive Cloud OCR Visual Verifier')
    parser.add_argument('query', nargs='?', default='', help='이미지/차트 내에서 검증할 텍스트')
    parser.add_argument('--inspect-failures', action='store_true', help='로컬 test-results 실패 스크린샷 점검')
    parser.add_argument('--limit', type=int, default=5, help='검색 결과 수')
    args = parser.parse_args()

    if args.inspect-failures if hasattr(args, 'inspect-failures') else args.inspect_failures:
        inspect_recent_failures()
        return

    if not args.query:
        print('사용법:')
        print('  python scripts/verify_visual_ocr.py "검증할 텍스트"')
        print('  python scripts/verify_visual_ocr.py --inspect-failures')
        return

    search_ocr_screenshots(args.query, limit=args.limit)

if __name__ == '__main__':
    main()
