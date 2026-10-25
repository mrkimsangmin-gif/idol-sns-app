import sqlite3
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding='utf-8')

p = Path(r"G:\내 드라이브\01.Work\04.AI.M.Contents\00.pumit\04.aimcontents.com\idol-sns-app\data\guyso.db")
conn = sqlite3.connect(p)
cur = conn.cursor()
tables = cur.execute("SELECT name FROM sqlite_master WHERE type='table';").fetchall()
print("Tables in data/guyso.db:")
for t in tables:
    name = t[0]
    count = cur.execute(f"SELECT count(*) FROM `{name}`;").fetchone()[0]
    print(f"  {name}: {count} rows")

res = cur.execute("PRAGMA integrity_check;").fetchall()
print("Integrity check:", res)
conn.close()
