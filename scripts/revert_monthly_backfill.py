import glob, json, sys

sys.stdout.reconfigure(encoding='utf-8')
files = glob.glob(r'G:\내 드라이브\01.Work\04.AI.M.Contents\00.pumit\04.aimcontents.com\idol-sns-app\data\namu-groups\*.json')
fixed_cnt = 0

for f in files:
    with open(f, encoding='utf-8') as fp:
        d = json.load(fp)
    mod = False
    for a in d.get('albums', []):
        biko = a.get('비고', '')
        if '한터 월간 실측치' in biko:
            a['초동_한터'] = ''
            a.pop('초동_한터_numeric', None)
            clean_biko = biko.replace(', 한터 월간 실측치', '').replace('한터 월간 실측치', '').strip(' ,')
            a['비고'] = clean_biko
            mod = True
            fixed_cnt += 1
            print(f"Reverted [{d.get('name')}]: {a.get('title')}")

        # Also for itsnotover, set exact Week 29 Circle chodong: 277,887
        if a.get('title') == 'itsnotover':
            a['초동_써클'] = '277,887'
            a['초동_써클_numeric'] = 277887
            a['누적_써클'] = '278,868'
            a['누적_써클_numeric'] = 278868
            mod = True

    if mod:
        with open(f, 'w', encoding='utf-8') as fp:
            json.dump(d, fp, ensure_ascii=False, indent=2)

print(f"\nTotal reverted/cleaned: {fixed_cnt}")
