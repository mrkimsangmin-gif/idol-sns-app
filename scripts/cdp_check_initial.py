# -*- coding: utf-8 -*-
"""
cdp_check_initial.py — 한터차트 '초동 기록' 페이지 직접 확인
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

def check_initial():
    tab = get_tab()
    ws = create_connection(tab.get("webSocketDebuggerUrl"), timeout=20)
    send_cdp(ws, "Page.enable")

    # Navigate to initial chodong page
    url = "https://www.hanteochart.com/ko/honors/initial"
    print(f"Navigating to {url} ...")
    send_cdp(ws, "Page.navigate", {"url": url}, 2)
    time.sleep(5)

    script = """
    (() => {
        const text = document.body.innerText;
        const lines = text.split('\\n').map(l => l.trim()).filter(l => l);
        
        // Find inputs or search boxes
        const inputs = Array.from(document.querySelectorAll('input')).map(i => ({
            type: i.type, placeholder: i.placeholder, className: i.className
        }));

        // Search for idntt / itsnotover in lines
        const matches = [];
        for (let i = 0; i < lines.length; i++) {
            if (lines[i].toLowerCase().includes('itsnotover') || lines[i].includes('아이덴티티') || lines[i].toLowerCase().includes('idntt')) {
                matches.push(lines.slice(Math.max(0, i-2), Math.min(lines.length, i+3)).join(' | '));
            }
        }

        return {
            title: document.title,
            inputs: inputs,
            matches: matches,
            bodySnippet: lines.slice(0, 35)
        };
    })()
    """
    res = evaluate(ws, script, 3)
    print("Page Title:", res.get("title"))
    print("Inputs:", res.get("inputs"))
    print(f"Matches for idntt ({len(res.get('matches', []))}):")
    for m in res.get("matches", []):
        print("  ->", m)

    print("\nBody Snippet:")
    for l in res.get("bodySnippet", []):
        print("  |", l)

    # If there is a search input, let's type 'idntt' or '아이덴티티'
    if res.get("inputs"):
        print("\nSearching via input field...")
        type_script = """
        (() => {
            const input = document.querySelector('input');
            if (input) {
                input.value = 'idntt';
                input.dispatchEvent(new Event('input', { bubbles: true }));
                input.dispatchEvent(new Event('change', { bubbles: true }));
                return true;
            }
            return false;
        })()
        """
        evaluate(ws, type_script, 4)
        time.sleep(3)
        res_after = evaluate(ws, "document.body.innerText.split('\\n').map(l => l.trim()).filter(l => l).slice(0, 40)", 5)
        print("After search:")
        for l in (res_after or []):
            if any(w in l.lower() for w in ['idntt', '아이덴티티', 'itsnotover', '초동', '판매량']):
                print("  * ", l)

    requests.get(f"{CDP_HTTP}/json/close/{tab.get('id')}")

if __name__ == "__main__":
    check_initial()
