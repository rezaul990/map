#!/usr/bin/env python3
"""Static server for the dashboard.

Same idea as `python3 -m http.server`, with two differences that matter while a
layout problem is being chased:

* text assets (html/css/js/json) are sent with `Cache-Control: no-store`, so the
  browser can never show a half-old build;
* `.geojson` and `.json` are served as `application/json`.

Usage: python3 serve.py [port] [--bind host]
"""
import functools
import http.server
import socketserver
import sys

TEXT_TYPES = (".html", ".css", ".js", ".mjs", ".json", ".geojson", ".svg", ".txt", ".md")


class Handler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        path = self.path.split("?")[0].split("#")[0]
        if path.endswith(TEXT_TYPES) or path.endswith("/"):
            # always the newest build while developing
            self.send_header("Cache-Control", "no-store, must-revalidate")
        self.send_header("Access-Control-Allow-Origin", "*")
        super().end_headers()

    def guess_type(self, path):
        if path.endswith((".json", ".geojson")):
            return "application/json"
        return super().guess_type(path)


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    port = int(args[0]) if args else 8080
    host = "0.0.0.0"
    if "--bind" in sys.argv:
        host = sys.argv[sys.argv.index("--bind") + 1]
    socketserver.TCPServer.allow_reuse_address = True
    handler = functools.partial(Handler, directory=".")
    with socketserver.ThreadingTCPServer((host, port), handler) as httpd:
        print(f"serving {'.'} on http://{host}:{port} (no-store for text assets)", flush=True)
        httpd.serve_forever()


if __name__ == "__main__":
    main()
