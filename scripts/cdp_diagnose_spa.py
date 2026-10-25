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

# Click chip
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

# Check state of DOM
inspect_script = """
(() => {
    const namuSmartAnswer = document.getElementById('namuSmartAnswer');
    const namuSearchView = document.getElementById('namuSearchView');
    const namuRankingView = document.getElementById('namuRankingView');
    const namuGroupDetail = document.getElementById('namuGroupDetail');
    const input = document.getElementById('namuSearchInput');
    return {
        url: window.location.href,
        inputValue: input ? input.value : null,
        smartAnswerDisplay: namuSmartAnswer ? namuSmartAnswer.style.display : null,
        smartAnswerVisible: namuSmartAnswer ? namuSmartAnswer.offsetHeight > 0 : false,
        smartAnswerChildren: namuSmartAnswer ? namuSmartAnswer.children.length : 0,
        searchViewDisplay: namuSearchView ? namuSearchView.style.display : null,
        rankingViewDisplay: namuRankingView ? namuRankingView.style.display : null,
        groupDetailDisplay: namuGroupDetail ? namuGroupDetail.style.display : null,
        historyLength: window.history.length
    };
})()
"""
res = evaluate(ws, inspect_script, 4)
print("DOM state when AI answer shown:", res)

# Now what happens if user presses browser back?
# Let's see what window.history contains or what popstate does
back_test = """
(() => {
    // Listen to popstate
    let popstateFired = false;
    window.addEventListener('popstate', (e) => {
        popstateFired = true;
    });
    const beforeLen = window.history.length;
    return { beforeLen };
})()
"""
print("Back test setup:", evaluate(ws, back_test, 5))

try:
    requests.get(f"{CDP_HTTP}/json/close/{tab['id']}")
except:
    pass
