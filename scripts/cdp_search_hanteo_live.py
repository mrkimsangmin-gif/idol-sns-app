# -*- coding: utf-8 -*-
"""
cdp_search_hanteo_live.py — Chrome CDP로 실제 한터차트 사이트에서 itsnotover 직접 검색 및 캡처
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

def search_hanteo():
    # 1. Open search page on hanteochart.com
    search_url = "https://www.hanteochart.com/search?q=itsnotover"
    print(f"Navigating to: {search_url}")
    tab = get_tab()
    ws = create_connection(tab.get("webSocketDebuggerUrl"), timeout=20)
    send_cdp(ws, "Page.enable")
    send_cdp(ws, "Page.navigate", {"url": search_url}, 2)
    time.sleep(5)

    script = """
    (() => {
        const text = document.body.innerText;
        const links = Array.from(document.querySelectorAll('a')).map(a => ({ text: a.innerText.trim(), href: a.href }));
        const lines = text.split('\\n').map(l => l.trim()).filter(l => l);
        return {
            title: document.title,
            lines: lines.slice(0, 40),
            links: links.filter(l => l.text.toLowerCase().includes('itsnotover') || l.text.includes('아이덴티티') || l.href.includes('album'))
        };
    })()
    """
    res = evaluate(ws, script, 3)
    print("Page Title:", res.get("title"))
    print("Sample Lines:", res.get("lines")[:15])
    print("Album Links:", res.get("links"))

    album_url = None
    for l in res.get("links", []):
        if "album" in l.get("href", ""):
            album_url = l.get("href")
            break

    if not album_url:
        # Try direct album URL by album id 900561994 (from image filename in our captured json)
        album_url = "https://www.hanteochart.com/album/900561994"

    print(f"\nNavigating to Album detail page: {album_url}")
    send_cdp(ws, "Page.navigate", {"url": album_url}, 4)
    time.sleep(5)

    script_album = """
    (() => {
        const text = document.body.innerText;
        const lines = text.split('\\n').map(l => l.trim()).filter(l => l);
        return {
            title: document.title,
            lines: lines
        };
    })()
    """
    res_alb = evaluate(ws, script_album, 5)
    print("Album Page Title:", res_alb.get("title"))
    print("\n--- Album Page Text Content ---")
    for l in res_alb.get("lines", []):
        if any(w in l for w in ['초동', '판매량', '차트', '발매일', '점수', '지수', '집계', 'hanteo', 'Hanteo', 'itsnotover', 'idntt']):
            print("  *", l)

    # Close tab
    requests.get(f"{CDP_HTTP}/json/close/{tab.get('id')}")

if __name__ == "__main__":
    search_hanteo()
