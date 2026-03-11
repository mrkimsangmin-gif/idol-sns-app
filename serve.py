"""SPA 로컬 개발 서버 — 정적 파일 없으면 index.html 반환"""
import http.server
import os

ROOT = os.path.dirname(os.path.abspath(__file__))

class SPAHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def end_headers(self):
        # 개발 서버: 모든 응답에 캐시 방지 헤더 추가
        self.send_header('Cache-Control', 'no-cache, no-store, must-revalidate')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        super().end_headers()

    def do_GET(self):
        # 쿼리스트링 제거
        path = self.path.split('?')[0]
        file_path = os.path.join(ROOT, path.lstrip('/'))

        # 실제 파일/디렉터리가 있으면 그대로 서빙
        if os.path.exists(file_path) and not os.path.isdir(file_path):
            return super().do_GET()

        # 디렉터리면 index.html 확인
        if os.path.isdir(file_path):
            index = os.path.join(file_path, 'index.html')
            if os.path.exists(index):
                return super().do_GET()

        # 나머지는 index.html로 폴백 (SPA 라우팅)
        self.path = '/index.html'
        return super().do_GET()

if __name__ == '__main__':
    PORT = 8080
    with http.server.HTTPServer(('', PORT), SPAHandler) as server:
        print(f'SPA 서버 시작: http://localhost:{PORT}')
        server.serve_forever()
