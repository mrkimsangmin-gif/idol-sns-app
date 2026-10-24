# -*- coding: utf-8 -*-
import sys
sys.path.insert(0, r"G:\내 드라이브\01.Work\04.AI.M.Contents\00.pumit\04.aimcontents.com\idol-sns-app\07.hanteo")
from comeback_alert import get_gmail_service

service = get_gmail_service()
def get_all_messages(query):
    all_msgs = []
    page_token = None
    while True:
        res = service.users().messages().list(userId="me", q=query, pageToken=page_token, maxResults=500).execute()
        msgs = res.get("messages", [])
        all_msgs.extend(msgs)
        page_token = res.get("nextPageToken")
        if not page_token:
            break
    return all_msgs

cb_unread = get_all_messages('subject:"Google 알리미" subject:"컴백" is:unread')
db_unread = get_all_messages('subject:"Google 알리미" subject:"데뷔" is:unread')
all_unread = get_all_messages('subject:"Google 알리미" is:unread')

print(f"Total unread '컴백': {len(cb_unread)}")
print(f"Total unread '데뷔': {len(db_unread)}")
print(f"Total unread 'Google 알리미': {len(all_unread)}")
