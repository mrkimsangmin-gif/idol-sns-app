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
    // Click '디스코그래피' tab if exists
    const buttons = Array.from(document.querySelectorAll('button, a, .nav-link, [role="tab"]'));
    const discoBtn = buttons.find(b => b.innerText.includes('디스코그래피') || b.innerText.includes('판매량'));
    if (discoBtn) {
        discoBtn.click();
    }
    return {
        clicked: !!discoBtn,
        btnText: discoBtn ? discoBtn.innerText : null
    };
})()
"""

btn_info = evaluate(ws, script, 3)
print("Button info:", btn_info)
time.sleep(2)

script2 = """
(() => {
    const text = document.body.innerText;
    const lines = text.split('\\n').map(l => l.trim()).filter(l => l);
    const hits = [];
    for (let i = 0; i < lines.length; i++) {
        if (lines[i].includes('itsnotover') || lines[i].includes('unevermet') || lines[i].includes('yesweare')) {
            hits.push(lines.slice(Math.max(0, i - 2), Math.min(lines.length, i + 8)).join(' | '));
        }
    }
    return hits;
})()
"""
hits = evaluate(ws, script2, 4)
for h in hits:
    print("\nHit:", h)

try:
    requests.get(f"{CDP_HTTP}/json/close/{tab['id']}")
except:
    pass
