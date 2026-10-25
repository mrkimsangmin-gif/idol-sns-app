import sys
from pathlib import Path

sys.stdout.reconfigure(encoding='utf-8')
sys_path = r'G:\내 드라이브\01.Work\05.초록뱀\00.work_ai\tools\gdrive'
sys.path.insert(0, sys_path)
from gdrive_search import search_drive

queries = [
    "fullText contains 'itsnotover' and fullText contains '초동'",
    "fullText contains 'itsnotover' and fullText contains '한터'",
    "fullText contains '아이덴티티' and fullText contains 'itsnotover'",
    "name contains '초동' and mimeType contains 'image'",
]

for q in queries:
    res = search_drive(q, max_results=10)
    print(f"\nQuery: {q} -> Found: {len(res)}")
    for f in res:
        print(f"  {f.get('name')} | {f.get('mimeType')} | {f.get('modifiedTime')}")
