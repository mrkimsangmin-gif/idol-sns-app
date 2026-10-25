# -*- coding: utf-8 -*-
"""
cdp_hanteo_home.py — 한터차트 메인 홈페이지 및 차트 탭 CDP 탐색
"""

import sys, json, time, requests
from websocket import create_connection

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

def explore_hanteo():
    tab = get_tab()
    ws = create_connection(tab.get("webSocketDebuggerUrl"), timeout=20)
    send_cdp(ws, "Page.enable")

    # Navigate to hanteochart main page
    print("Navigating to https://www.hanteochart.com ...")
    send_cdp(ws, "Page.navigate", {"url": "https://www.hanteochart.com"}, 2)
    time.sleep(4)

    script_main = """
    (() => {
        const title = document.title;
        const navLinks = Array.from(document.querySelectorAll('a')).map(a => ({ text: a.innerText.trim(), href: a.href }));
        return { title, navLinks: navLinks.filter(l => l.text) };
    })()
    """
    res_main = evaluate(ws, script_main, 3)
    print("Home Title:", res_main.get("title"))
    print(f"Total Nav Links: {len(res_main.get('navLinks', []))}")
    for l in res_main.get("navLinks", [])[:15]:
        print(" ", l)

    # Now navigate to weekly chart page
    print("\nNavigating to https://www.hanteochart.com/chart/album/weekly ...")
    send_cdp(ws, "Page.navigate", {"url": "https://www.hanteochart.com/chart/album/weekly"}, 4)
    time.sleep(4)

    # Let's inspect the date pickers / dropdowns on the chart page
    script_chart = """
    (() => {
        const title = document.title;
        // check select elements or buttons with dates
        const buttons = Array.from(document.querySelectorAll('button, select, div[class*="date"], div[class*="select"]')).map(el => ({
            tag: el.tagName,
            className: el.className,
            text: el.innerText.trim().slice(0, 50)
        })).filter(b => b.text && (b.text.includes('202') || b.text.includes('주') || b.text.includes('월')));

        // Check album rows displayed right now
        const rows = Array.from(document.querySelectorAll('tr, div[class*="item"], div[class*="row"]')).map(r => r.innerText.trim()).filter(t => t.includes('1') && t.includes('\\n'));
        const bodySnippet = document.body.innerText.split('\\n').map(l => l.trim()).filter(l => l).slice(0, 50);

        return { title, buttons: buttons.slice(0, 10), bodySnippet };
    })()
    """
    res_chart = evaluate(ws, script_chart, 5)
    print("Chart Title:", res_chart.get("title"))
    print("Date / Dropdown Elements:", res_chart.get("buttons"))
    print("\nBody Snippet (first 30 lines):")
    for l in res_chart.get("bodySnippet", [])[:30]:
        print("  |", l)

    # Close tab
    requests.get(f"{CDP_HTTP}/json/close/{tab.get('id')}")

if __name__ == "__main__":
    explore_hanteo()
