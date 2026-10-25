import sqlite3
import shutil
import sys

sys.stdout.reconfigure(encoding='utf-8')

conn = sqlite3.connect(r"C:\temp\guyso_test.db")
cur = conn.cursor()
tables = cur.execute("SELECT name FROM sqlite_master WHERE type='table';").fetchall()
print(f"Total tables: {len(tables)}")
for t in tables:
    name = t[0]
    count = cur.execute(f"SELECT count(*) FROM `{name}`;").fetchone()[0]
    print(f"  {name}: {count:,} rows")

check = cur.execute("PRAGMA integrity_check;").fetchall()
print("Integrity check:", check)
conn.close()
