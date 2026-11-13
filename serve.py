#!/usr/bin/env python3
"""
Local development server for Document OCR.

Use this instead of `python -m http.server`. The stdlib server sends no
cache-control headers, so browsers happily keep serving a stale js/*.js after
you edit it — which looks exactly like a code bug ("X is not a function" for a
function that is plainly there on disk).

This server tells the browser never to cache anything, so a plain reload always
runs the current files.

    python serve.py            # http://localhost:8000
    python serve.py 8080       # another port
"""

import http.server
import socketserver
import sys
import os

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
ROOT = os.path.dirname(os.path.abspath(__file__))


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()

    def log_message(self, fmt, *args):
        # One quiet line per request; the stdlib default is noisier.
        sys.stderr.write("%s %s\n" % (self.command, self.path))


class ReusableServer(socketserver.TCPServer):
    allow_reuse_address = True


if __name__ == "__main__":
    with ReusableServer(("127.0.0.1", PORT), NoCacheHandler) as httpd:
        print("Document OCR -> http://localhost:%d  (no-cache)" % PORT)
        print("Serving %s" % ROOT)
        print("Ctrl+C to stop.")
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nstopped")
