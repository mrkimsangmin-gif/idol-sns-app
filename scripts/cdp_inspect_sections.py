import requests
import json
import time
from websocket import create_connection
import sys

sys.stdout.reconfigure(encoding='utf-8')

CDP_HTTP = "http://127.0.0.1:9222"

def get_tab():
    res = requests.put(f"{CDP_HTTP}/json/new?about:blank")
    return res.json()

def send_cdp(ws, method, params=None, req_id=1):
    payload = {"id": req_id, "method": method, "params": params or {}}
    ws.send(json.dumps(payload))
    while True:
        resp = json.loads(ws.recv())
        if resp.get("id") == req_id:
            return resp

def evaluate(ws, expr, req_id=100):
    res = send_cdp(ws, "Runtime.evaluate", {"expression": expr, "returnByValue": True, "awaitPromise": True}, req_id)
    return res.get("result", {}).get("result", {}).get("value")

url = "https://aimcontents.com/namu/idntt/"
tab = get_tab()
ws = create_connection(tab.get("webSocketDebuggerUrl"), timeout=20)
send_cdp(ws, "Page.enable")
send_cdp(ws, "Page.navigate", {"url": url}, 2)
time.sleep(5)

script = """
(() => {
    const disco = document.querySelector('section:has(table) h2');
    const sections = Array.from(document.querySelectorAll('section')).map(s => {
        const h = s.querySelector('h2, h3');
        const t = s.querySelector('table');
        if (!t) return null;
        const ths = Array.from(t.querySelectorAll('th')).map(th => th.innerText.trim());
        const trs = Array.from(t.querySelectorAll('tr')).map(tr => 
            Array.from(tr.querySelectorAll('td, th')).map(c => c.innerText.trim())
        );
        return {
            title: h ? h.innerText.trim() : 'no title',
            headers: ths,
            rows: trs
        };
    }).filter(x => x);
    return sections;
})()
"""

sections = evaluate(ws, script, 3)
for s in sections:
    print(f"\n=== Section: {s['title']} ===")
    print(f"Headers: {s['headers']}")
    for r in s['rows']:
        print(" | ".join(r))

try:
    requests.get(f"{CDP_HTTP}/json/close/{tab['id']}")
except:
    pass
