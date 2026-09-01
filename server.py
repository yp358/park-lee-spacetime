import http.server
import socketserver
import os
import sys

DIRECTORY = os.path.abspath(os.path.dirname(__file__))

class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DIRECTORY, **kwargs)

def start_server():
    for port in [5173, 8080, 8000, 3001, 3002]:
        try:
            httpd = socketserver.TCPServer(("", port), Handler)
            print("==================================================", flush=True)
            print("📜 THE PUBLIC — Constitutional Web Server", flush=True)
            print("🏛  Park-Lee Spacetime (Public Domain)", flush=True)
            print(f"👉 Running at: http://localhost:{port}", flush=True)
            print("==================================================", flush=True)
            httpd.serve_forever()
            return
        except OSError as e:
            if e.errno == 48:
                continue
            else:
                raise e

if __name__ == "__main__":
    start_server()
