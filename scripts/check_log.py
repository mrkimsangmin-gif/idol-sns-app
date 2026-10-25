import sqlite3
import sys

sys.stdout.reconfigure(encoding='utf-8')

conn = sqlite3.connect("C:/temp/guyso_test.db")
print("=== Latest 5 entries for circle_weekly ===")
for r in conn.execute("SELECT * FROM collection_log WHERE chart='circle_weekly' ORDER BY rowid DESC LIMIT 5"):
    print(r)

print("\n=== Latest 5 entries overall ===")
for r in conn.execute("SELECT * FROM collection_log ORDER BY rowid DESC LIMIT 5"):
    print(r)

conn.close()
