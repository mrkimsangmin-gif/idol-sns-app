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
    const text = document.body.innerText;
    const lines = text.split('\\n').map(l => l.trim()).filter(l => l);
    // Find lines around 디스코그래피
    const idx = lines.findIndex(l => l.includes('디스코그래피'));
    if (idx !== -1) {
        return lines.slice(idx, idx + 35);
    }
    return lines.slice(0, 30);
})()
"""

lines = evaluate(ws, script, 3)
for l in lines:
    print(l)

try:
    requests.get(f"{CDP_HTTP}/json/close/{tab['id']}")
except:
    pass
