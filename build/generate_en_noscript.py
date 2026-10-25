# -*- coding: utf-8 -*-
"""
Converts the original Korean <noscript> block in index.html into a 100% English SEO static directory.
- Replaces /namu/<slug> with /en/namu/<slug>/
- Translates headings, captions, column headers, and intro text
"""
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

def convert_noscript_to_en(noscript_html: str) -> str:
    t = noscript_html
    
    # 1. Main Headings and intros
    t = t.replace(
        '<h1>아이엠콘텐츠 (aimcontents.com) - K-POP 아이돌 종합 데이터 플랫폼</h1>',
        '<h1>AIMCONTENTS (aimcontents.com) - Comprehensive K-POP Idol Analytics Platform</h1>'
    )
    t = t.replace(
        '아이엠콘텐츠는 <strong>188개 K-POP 아이돌 그룹</strong>의 SNS·틱톡 팔로워 순위(틱톡, 유튜브, 인스타그램, 웨이보, 빌리빌리, QQ뮤직, X(트위터), 스포티파이, 도우인), \n  숏폼 참여율(ER), 컴백/데뷔 일정, 앨범 초동 판매량, 멤버 프로필, 소속사 정보를 정기 업데이트하여 제공하는 K-POP 전문 데이터 플랫폼입니다.',
        'AIMCONTENTS is a dedicated K-POP data analytics platform providing regular updates on social media & TikTok follower rankings (TikTok, YouTube, Instagram, Weibo, Bilibili, QQ Music, X/Twitter, Spotify, Douyin), short-form engagement rates (ER), comeback schedules, album first-week sales, verified member profiles, and agency information for <strong>188 K-POP idol groups</strong>.'
    )
    t = t.replace(
        '<h2><a href="/ranking">K-POP 아이돌 SNS & 틱톡 팔로워 순위</a></h2>',
        '<h2><a href="/en/">K-POP Idol SNS & TikTok Follower Rankings</a></h2>'
    )
    t = t.replace(
        '주요 플랫폼의 월별·주간 팔로워/구독자 수 및 숏폼 인게이지먼트 랭킹을 제공합니다.',
        'Provides monthly and weekly follower/subscriber statistics and short-form engagement rankings across all major global platforms.'
    )
    t = t.replace(
        '<h2><a href="/namu">K-POP 아이돌 데이터베이스 (174개 그룹)</a></h2>',
        '<h2><a href="/en/">K-POP Idol Database (174 Groups)</a></h2>'
    )
    t = t.replace(
        '1세대부터 5세대까지 K-POP 아이돌 그룹의 소속사, 데뷔일, 팬덤명, 리더, 멤버 프로필, 앨범 디스코그래피, 초동/누적 판매량을 제공합니다. \n  나무위키 기반 데이터를 정제하여 앨범별 한터차트/써클차트 판매량을 비교할 수 있습니다.',
        'Comprehensive profiles from 1st to 5th generation K-POP idol groups covering management agencies, debut dates, fandom names, leadership, member profiles, full discographies, and verified Hanteo/Circle sales benchmarks.'
    )
    
    # 2. Section Titles & Captions
    t = t.replace('<h3>걸그룹 (79개)</h3>', '<h3>Girl Groups (79 Groups)</h3>')
    t = t.replace('<caption>K-POP 걸그룹 목록 - 소속사, 데뷔연도, 멤버 정보</caption>',
                  '<caption>K-POP Girl Groups Directory - Agency, Debut Year, and Members</caption>')
    t = t.replace('<h3>보이그룹 (95개)</h3>', '<h3>Boy Groups (95 Groups)</h3>')
    t = t.replace('<caption>K-POP 보이그룹 목록 - 소속사, 데뷔연도, 멤버 정보</caption>',
                  '<caption>K-POP Boy Groups Directory - Agency, Debut Year, and Members</caption>')
                  
    # 3. Table Headers
    t = t.replace('<th>그룹명</th><th>소속사</th><th>데뷔</th><th>인원</th><th>멤버</th>',
                  '<th>Group Name</th><th>Agency</th><th>Debut</th><th>Count</th><th>Members</th>')
                  
    # 4. URLs: href="/namu/<slug>" -> href="/en/namu/<slug>/"
    t = re.sub(r'href="/namu/([^"]+)"', r'href="/en/namu/\1/"', t)
    
    return t
