import sys, re
sys.stdout.reconfigure(encoding='utf-8')

test_files = [
    'en/namu/triples/index.html',
    'en/namu/aespa/index.html',
    'namu/triples/index.html',
    'namu/aespa/index.html'
]

for path in test_files:
    with open(path, 'r', encoding='utf-8') as f:
        html = f.read()
    has_track_col = ('Key Tracks' in html) or ('주요 곡' in html)
    has_recording = 'MusicRecording' in html
    tracks = re.findall(r'"@type":\s*"MusicRecording",\s*"name":\s*"([^"]+)"', html)
    if not tracks:
        tracks = re.findall(r'"name":\s*"([^"]+)",\s*"@type":\s*"MusicRecording"', html)
    print(f"[{path}]")
    print(f"  - Table Track Column: {has_track_col}")
    print(f"  - Schema.org MusicRecording count: {len(tracks)}")
    print(f"  - First 4 tracks in Schema: {tracks[:4]}")
