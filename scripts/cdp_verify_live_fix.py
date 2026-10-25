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
ws = create_connection(tab.get("webSocketDebuggerUrl"), timeout=25)
send_cdp(ws, "Page.enable")
# Hard reload bypassing cache
send_cdp(ws, "Network.enable")
send_cdp(ws, "Network.setCacheDisabled", {"cacheDisabled": True})
send_cdp(ws, "Page.navigate", {"url": url}, 2)
time.sleep(5)

# 1. Click 2024 걸그룹 chip
click_chip = """
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
res_click = evaluate(ws, click_chip, 3)
print("1. Click chip:", res_click)
time.sleep(3)

# 2. Check state after search
check_search = """
(() => {
    const ans = document.getElementById('namuSmartAnswer');
    return {
        url: window.location.href,
        ansVisible: ans && ans.style.display !== 'none',
        searchViewVisible: document.getElementById('namuSearchView').style.display !== 'none',
        historyLength: window.history.length
    };
})()
"""
res_search = evaluate(ws, check_search, 4)
print("2. State after search:", res_search)

# 3. Simulate browser back
print("3. Executing window.history.back()...")
evaluate(ws, "window.history.back()", 5)
time.sleep(2)

# 4. Check state after back
check_after_back = """
(() => {
    const ans = document.getElementById('namuSmartAnswer');
    const sv = document.getElementById('namuSearchView');
    const chips = document.getElementById('namuRecommendedChips');
    return {
        url: window.location.href,
        ansVisible: ans && ans.style.display !== 'none' && ans.innerHTML !== '',
        searchViewVisible: sv && sv.style.display !== 'none',
        chipsVisible: chips && chips.style.display !== 'none'
    };
})()
"""
res_after_back = evaluate(ws, check_after_back, 6)
print("4. State after history.back():", res_after_back)

try:
    requests.get(f"{CDP_HTTP}/json/close/{tab['id']}")
except:
    pass
