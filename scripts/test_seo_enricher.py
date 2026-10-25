import sys
import json
from pathlib import Path

sys.stdout.reconfigure(encoding='utf-8')
ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from build.seo_enricher import generate_seo_enrichment

with open(ROOT / "data/namu-groups/idntt.json", encoding='utf-8') as f:
    d = json.load(f)

res = generate_seo_enrichment(d)
print("=== Natural Text ===")
print(res['natural_text'])
print("\n=== Extra QAs ===")
for q, a in res['extra_qas']:
    print(f"Q: {q}\nA: {a}\n")

print("=== Visually Hidden HTML ===")
print(res['sr_only_html'])
