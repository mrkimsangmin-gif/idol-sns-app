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

test_slugs = ["aespa", "ive", "newjeans", "riize", "le-sserafim"]

for slug in test_slugs:
    url = f"https://aimcontents.com/namu/{slug}/"
    tab = get_tab()
    try:
        ws = create_connection(tab.get("webSocketDebuggerUrl"), timeout=15)
        send_cdp(ws, "Page.enable")
        send_cdp(ws, "Page.navigate", {"url": url}, 2)
        time.sleep(3)
        
        # Click discography
        click_script = """
        (() => {
            const btns = Array.from(document.querySelectorAll('button, a, .nav-link'));
            const b = btns.find(x => x.innerText.includes('디스코그래피'));
            if (b) b.click();
            return !!b;
        })()
        """
        evaluate(ws, click_script, 3)
        time.sleep(1.5)
        
        check_script = """
        (() => {
            const table = document.querySelector('#discography-tab-pane table, .tab-pane.active table, table.table');
            const ths = Array.from(document.querySelectorAll('th')).map(th => th.innerText.trim());
            const rows = Array.from(document.querySelectorAll('tr')).map(r => 
                Array.from(r.querySelectorAll('td, th')).map(c => c.innerText.trim())
            ).filter(r => r.length >= 5);
            return {
                headers: ths.slice(0, 6),
                sampleRows: rows.slice(0, 4)
            };
        })()
        """
        res = evaluate(ws, check_script, 4)
        print(f"\n[{slug.upper()}] Headers: {res.get('headers')}")
        for r in res.get('sampleRows', []):
            print("  " + " | ".join(r))
        ws.close()
    finally:
        try:
            requests.get(f"{CDP_HTTP}/json/close/{tab['id']}")
        except:
            pass
