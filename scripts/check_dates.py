import sqlite3
import sys

sys.stdout.reconfigure(encoding='utf-8')

conn = sqlite3.connect(r"C:\temp\guyso_test.db")
cur = conn.cursor()

print("--- Latest Dates in guyso.db ---")
tables_dates = [
    ("melon_daily", "date"),
    ("genie_daily", "date"),
    ("bugs_daily", "date"),
    ("circle_weekly", "year, week"),
    ("collection_log", "timestamp"),
]

for item in tables_dates:
    t = item[0]
    col = item[1]
    try:
        if "," in col:
            res = cur.execute(f"SELECT {col} FROM `{t}` ORDER BY rowid DESC LIMIT 3").fetchall()
        else:
            res = cur.execute(f"SELECT {col} FROM `{t}` ORDER BY `{col}` DESC LIMIT 3").fetchall()
        print(f"{t}: {res}")
    except Exception as e:
        print(f"{t}: error {e}")

conn.close()
