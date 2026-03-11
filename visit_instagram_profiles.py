"""
Instagram Profile Visitor - ADB Automation
태블릿에서 170+ K-POP 그룹 인스타그램 프로필을 자동 방문하여 인게이지먼트 데이터 생성

Usage: python visit_instagram_profiles.py [--start N] [--count N] [--delay N]
  --start N   : Start from Nth account (0-based, default: 0)
  --count N   : Visit only N accounts (default: all)
  --delay N   : Delay between visits in seconds (default: 5)
"""

import subprocess
import json
import glob
import os
import sys
import time
import argparse
import random
import re

# Fix encoding for Windows console
sys.stdout.reconfigure(encoding='utf-8', errors='replace')

SERIAL = "5HUG1CQU6NLB30XM894"
NAMU_DIR = os.path.join(os.path.dirname(__file__), "data", "namu-groups")

def adb(cmd, timeout=15):
    """Run ADB command and return output."""
    full_cmd = f"adb -s {SERIAL} {cmd}"
    try:
        result = subprocess.run(full_cmd, shell=True, capture_output=True, timeout=timeout)
        return result.stdout.decode('utf-8', errors='replace').strip()
    except subprocess.TimeoutExpired:
        return ""
    except Exception:
        return ""

def load_instagram_accounts():
    """Load all Instagram usernames from namu-groups JSON files."""
    accounts = []
    seen = set()
    for f in sorted(glob.glob(os.path.join(NAMU_DIR, "*.json"))):
        try:
            with open(f, "r", encoding="utf-8") as fh:
                data = json.load(fh)
                if isinstance(data, list):
                    data = data[0] if data else {}
                info = data.get("info", {})
                insta = info.get("인스타그램", "")
                name = data.get("name", "")
                name_en = data.get("name_en", "")
                if insta and insta.strip():
                    username = insta.rstrip("/").split("/")[-1]
                    if username and username not in seen:
                        seen.add(username)
                        accounts.append({
                            "name": name,
                            "name_en": name_en,
                            "username": username,
                            "url": insta
                        })
        except Exception:
            pass
    return accounts

def open_instagram_profile(username):
    """Open Instagram profile via deep link."""
    # Use Instagram deep link URI
    adb(f'shell am start -a android.intent.action.VIEW -d "https://www.instagram.com/{username}/" com.instagram.android')

def scroll_down(times=3):
    """Swipe down on screen to simulate browsing."""
    for _ in range(times):
        # Swipe from middle-bottom to middle-top (800x1280 screen)
        y_start = 900 + random.randint(-50, 50)
        y_end = 300 + random.randint(-50, 50)
        x = 400 + random.randint(-30, 30)
        duration = random.randint(200, 400)
        adb(f"shell input swipe {x} {y_start} {x} {y_end} {duration}")
        time.sleep(0.8 + random.random() * 0.5)

def tap_first_post():
    """Tap the first post in the profile grid, scroll, then go back.
    On 800x1280 screen, Instagram grid has 3 columns (~267px each).
    Profile header is ~450px tall, so first row of posts starts around y=500-550.
    First post center: ~(133, 530)
    """
    # Tap first post in grid
    x = 133 + random.randint(-20, 20)
    y = 530 + random.randint(-20, 20)
    adb(f"shell input tap {x} {y}")
    time.sleep(2 + random.random())  # Wait for post to load

    # Scroll down to see comments/likes
    adb(f"shell input swipe 400 900 400 400 {random.randint(250, 400)}")
    time.sleep(1 + random.random() * 0.5)

    # Scroll down once more
    adb(f"shell input swipe 400 800 400 350 {random.randint(250, 400)}")
    time.sleep(0.8 + random.random() * 0.5)

    # Go back to profile
    adb("shell input keyevent KEYCODE_BACK")
    time.sleep(1 + random.random() * 0.5)

def try_follow():
    """Check if follow button exists and tap it. Returns True if followed."""
    # Dump UI hierarchy
    adb('shell uiautomator dump /data/local/tmp/ui.xml', timeout=10)
    xml = adb('shell cat /data/local/tmp/ui.xml', timeout=10)
    if not xml:
        return False

    # Find the follow button by resource-id
    # text="팔로우" means not following, text="팔로잉" means already following
    match = re.search(
        r'resource-id="com\.instagram\.android:id/profile_header_follow_button"[^>]*text="([^"]*)"[^>]*bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"',
        xml
    )
    if not match:
        # Try alternate attribute order (text before resource-id)
        match = re.search(
            r'text="([^"]*)"[^>]*resource-id="com\.instagram\.android:id/profile_header_follow_button"[^>]*bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"',
            xml
        )
    if match:
        btn_text = match.group(1)
        if btn_text == "팔로우":
            x1, y1, x2, y2 = int(match.group(2)), int(match.group(3)), int(match.group(4)), int(match.group(5))
            tap_x = (x1 + x2) // 2
            tap_y = (y1 + y2) // 2
            adb(f"shell input tap {tap_x} {tap_y}")
            time.sleep(0.5 + random.random() * 0.3)
            return True
        # Already following
        return False
    return False

def wake_and_unlock():
    """Wake up and unlock the device if needed."""
    # Check if screen is on
    screen_state = adb("shell dumpsys power | grep 'mWakefulness='")
    if "Awake" not in screen_state:
        adb("shell input keyevent KEYCODE_WAKEUP")
        time.sleep(1)
        # Swipe to unlock
        adb("shell input swipe 400 1000 400 300 300")
        time.sleep(1)

def main():
    parser = argparse.ArgumentParser(description="Visit K-POP Instagram profiles on tablet")
    parser.add_argument("--start", type=int, default=0, help="Start index (0-based)")
    parser.add_argument("--count", type=int, default=0, help="Number of accounts to visit (0=all)")
    parser.add_argument("--delay", type=int, default=5, help="Delay between visits (seconds)")
    args = parser.parse_args()

    # Check device
    devices = subprocess.run("adb devices", shell=True, capture_output=True, text=True).stdout
    if SERIAL not in devices:
        print(f"ERROR: Device {SERIAL} not connected")
        return

    accounts = load_instagram_accounts()
    total = len(accounts)
    print(f"Loaded {total} Instagram accounts", flush=True)

    # Apply start/count
    start = min(args.start, total)
    end = total if args.count == 0 else min(start + args.count, total)
    accounts = accounts[start:end]
    print(f"Visiting accounts {start+1} to {end} ({len(accounts)} accounts)", flush=True)
    print(f"Estimated time: ~{len(accounts) * (args.delay + 8)} seconds", flush=True)
    print(flush=True)

    wake_and_unlock()

    for i, acct in enumerate(accounts):
        idx = start + i + 1
        print(f"[{idx}/{end}] {acct['name']} ({acct['name_en']}) -> @{acct['username']}", end=" ")

        open_instagram_profile(acct["username"])
        time.sleep(2.5 + random.random())  # Wait for profile to load

        # Follow if not already following
        followed = try_follow()
        follow_tag = "+F" if followed else ""

        scroll_down(2)  # Scroll through posts

        tap_first_post()  # Open first post, browse, then back

        scroll_down(1)  # One more scroll on profile

        print(f"OK {follow_tag}", flush=True)

        # Delay between visits (randomized slightly)
        if i < len(accounts) - 1:
            delay = args.delay + random.uniform(-1, 2)
            time.sleep(max(2, delay))

    print(f"\nDone! Visited {len(accounts)} profiles.")

if __name__ == "__main__":
    main()
