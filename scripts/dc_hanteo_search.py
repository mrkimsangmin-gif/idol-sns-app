# -*- coding: utf-8 -*-
"""
dc_hanteo_search.py — Chrome CDP를 통해 디시인사이드 한터차트 갤러리 검색
"""

import sys, json, time, urllib.parse, requests
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

def search_dc(query):
    # DC Hanteo Chart Gallery: id=hanteo (or hanteochart)
    for gall_id in ["hanteo", "hanteochart"]:
        enc = urllib.parse.quote(query)
        url = f"https://gall.dcinside.com/mgallery/board/lists?id={gall_id}&s_type=search_subject_memo&s_keyword={enc}"
        print(f"\n--- Searching gallery '{gall_id}' for '{query}' ---")
        print(f"URL: {url}")
        
        tab = get_tab()
        ws_url = tab.get("webSocketDebuggerUrl")
        ws = create_connection(ws_url, timeout=10)
        
        send_cdp(ws, "Page.enable")
        send_cdp(ws, "Page.navigate", {"url": url}, 2)
        time.sleep(3)
        
        script = """
        (() => {
            const rows = document.querySelectorAll('tr.ub-content.us-post');
            const results = [];
            rows.forEach(r => {
                const num = r.querySelector('.gall_num')?.innerText.trim();
                const titleEl = r.querySelector('.gall_tit a');
                const title = titleEl?.innerText.trim();
                const link = titleEl?.href;
                const writer = r.querySelector('.gall_writer')?.innerText.trim();
                const date = r.querySelector('.gall_date')?.title || r.querySelector('.gall_date')?.innerText.trim();
                const count = r.querySelector('.gall_count')?.innerText.trim();
                if (title) {
                    results.push({ num, title, link, writer, date, count });
                }
            });
            return { count: results.length, results: results.slice(0, 15), page_title: document.title, location: window.location.href };
        })()
        """
        data = evaluate(ws, script, 3)
        print(f"Page title: {data.get('page_title')}")
        print(f"Current URL: {data.get('location')}")
        print(f"Total posts found: {data.get('count')}")
        for p in data.get('results', []):
            print(f"[{p.get('num')}] {p.get('date')} | {p.get('title')} ({p.get('writer')}) -> {p.get('link')}")

        # Close tab
        tab_id = tab.get("id")
        try:
            requests.get(f"{CDP_HTTP}/json/close/{tab_id}")
        except: pass

if __name__ == "__main__":
    q = sys.argv[1] if len(sys.argv) > 1 else "아이덴티티"
    search_dc(q)
