# -*- coding: utf-8 -*-
"""
cdp_check_charts.py — Chrome CDP로 써클차트 및 한터차트 실제 웹페이지 전수 확인
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

def check_hanteo_page(url):
    print(f"\n==========================================")
    print(f"Checking Hanteo URL: {url}")
    tab = get_tab()
    ws = create_connection(tab.get("webSocketDebuggerUrl"), timeout=15)
    send_cdp(ws, "Page.enable")
    send_cdp(ws, "Page.navigate", {"url": url}, 2)
    time.sleep(4)
    
    script = """
    (() => {
        const text = document.body.innerText;
        const title = document.title;
        const lines = text.split('\\n').map(l => l.trim()).filter(l => l);
        // find itsnotover or idntt
        const matches = [];
        for (let i = 0; i < lines.length; i++) {
            if (lines[i].toLowerCase().includes('itsnotover') || lines[i].includes('아이덴티티') || lines[i].toLowerCase().includes('idntt')) {
                matches.push(lines.slice(Math.max(0, i-3), Math.min(lines.length, i+5)).join(' | '));
            }
        }
        return { title, matches: matches.slice(0, 10), sample_lines: lines.slice(0, 20) };
    })()
    """
    res = evaluate(ws, script, 3)
    print(f"Page Title: {res.get('title')}")
    print(f"Matches ({len(res.get('matches', []))}):")
    for m in res.get("matches", []):
        print("  ->", m)
        
    requests.get(f"{CDP_HTTP}/json/close/{tab.get('id')}")

def check_circle_page(url):
    print(f"\n==========================================")
    print(f"Checking Circle URL: {url}")
    tab = get_tab()
    ws = create_connection(tab.get("webSocketDebuggerUrl"), timeout=15)
    send_cdp(ws, "Page.enable")
    send_cdp(ws, "Page.navigate", {"url": url}, 2)
    time.sleep(4)
    
    script = """
    (() => {
        const text = document.body.innerText;
        const title = document.title;
        const lines = text.split('\\n').map(l => l.trim()).filter(l => l);
        const matches = [];
        for (let i = 0; i < lines.length; i++) {
            if (lines[i].toLowerCase().includes('itsnotover') || lines[i].includes('아이덴티티') || lines[i].toLowerCase().includes('idntt')) {
                matches.push(lines.slice(Math.max(0, i-2), Math.min(lines.length, i+4)).join(' | '));
            }
        }
        // Also get rank 100 sales if possible
        return { title, matches: matches.slice(0, 10), sample_lines: lines.slice(0, 25) };
    })()
    """
    res = evaluate(ws, script, 3)
    print(f"Page Title: {res.get('title')}")
    print(f"Matches ({len(res.get('matches', []))}):")
    for m in res.get("matches", []):
        print("  ->", m)
    requests.get(f"{CDP_HTTP}/json/close/{tab.get('id')}")

if __name__ == "__main__":
    check_hanteo_page("https://www.hanteochart.com/chart/album/monthly")
    check_circle_page("https://circlechart.kr/page_chart/album.circle?nationGbn=T&termGbn=month&hitYear=2026&targetTime=08&yearTime=3")
    check_circle_page("https://circlechart.kr/page_chart/album.circle?nationGbn=T&termGbn=month&hitYear=2026&targetTime=07&yearTime=3")
