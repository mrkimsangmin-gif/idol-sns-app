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
print(f"Navigating to {url}...")
tab = get_tab()
ws = create_connection(tab.get("webSocketDebuggerUrl"), timeout=20)
send_cdp(ws, "Page.enable")
send_cdp(ws, "Page.navigate", {"url": url}, 2)
time.sleep(4)

# 1. Check current URL and find the chip
script1 = """
(() => {
    const chips = Array.from(document.querySelectorAll('button, a, .badge, .chip, span')).filter(el => 
        el.innerText && el.innerText.includes('2024년') && el.innerText.includes('걸그룹')
    );
    return {
        url: window.location.href,
        chips: chips.map(c => ({
            tag: c.tagName,
            text: c.innerText,
            href: c.getAttribute('href'),
            onclick: c.getAttribute('onclick'),
            className: c.className
        }))
    };
})()
"""
res1 = evaluate(ws, script1, 3)
print("Initial state:", res1)

# 2. Click the chip
script2 = """
(() => {
    const chips = Array.from(document.querySelectorAll('button, a, .badge, .chip, span')).filter(el => 
        el.innerText && el.innerText.includes('2024년') && el.innerText.includes('걸그룹')
    );
    if (chips.length > 0) {
        chips[0].click();
        return { clicked: true, text: chips[0].innerText };
    }
    return { clicked: false };
})()
"""
res2 = evaluate(ws, script2, 4)
print("Click result:", res2)
time.sleep(3)

# 3. Check state after click
script3 = """
(() => {
    return {
        url: window.location.href,
        historyLength: window.history.length,
        hasPopstateListener: true,
        title: document.title
    };
})()
"""
res3 = evaluate(ws, script3, 5)
print("After click state:", res3)

# 4. Try browser back via CDP (Page.navigateToHistoryEntry or window.history.back())
script4 = """
(() => {
    const beforeUrl = window.location.href;
    window.history.back();
    return { beforeUrl: beforeUrl };
})()
"""
res4 = evaluate(ws, script4, 6)
print("Triggered history.back():", res4)
time.sleep(2)

script5 = """
(() => {
    return {
        urlAfterBack: window.location.href,
        visibleTextSample: document.body.innerText.slice(0, 300)
    };
})()
"""
res5 = evaluate(ws, script5, 7)
print("After history.back():", res5)

try:
    requests.get(f"{CDP_HTTP}/json/close/{tab['id']}")
except:
    pass
