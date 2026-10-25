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

url = "https://aimcontents.com/namu/"
tab = get_tab()
ws = create_connection(tab.get("webSocketDebuggerUrl"), timeout=20)
send_cdp(ws, "Page.enable")
send_cdp(ws, "Page.navigate", {"url": url}, 2)
time.sleep(4)

# 1. Click chip
click_script = """
(() => {
    const chips = Array.from(document.querySelectorAll('button, a, .badge, .chip, span')).filter(el => 
        el.innerText && el.innerText.includes('2024년') && el.innerText.includes('걸그룹')
    );
    if (chips.length > 0) {
        chips[0].click();
        return true;
    }
    return false;
})()
"""
evaluate(ws, click_script, 3)
time.sleep(3)

# 2. Check current URL and close button if any
check_ui = """
(() => {
    const closeBtns = Array.from(document.querySelectorAll('#namuSmartAnswer button, #namuSmartAnswer a')).map(b => ({
        text: b.innerText,
        className: b.className,
        onclick: b.getAttribute('onclick')
    }));
    return {
        url: window.location.href,
        historyLength: window.history.length,
        closeBtns: closeBtns
    };
})()
"""
print("Smart Answer UI buttons:", evaluate(ws, check_ui, 4))

try:
    requests.get(f"{CDP_HTTP}/json/close/{tab['id']}")
except:
    pass
