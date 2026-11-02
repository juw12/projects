"""Static file server for the Rewind tests that also accepts POSTed test results.

Usage: python test_server.py <port> <app_folder> <results_file>
GET  /...         -> serves files from app_folder
POST /__results   -> writes the request body to results_file
"""

import functools
import http.server
import pathlib
import sys


def main():
    port = int(sys.argv[1])
    app_folder = sys.argv[2]
    results_file = pathlib.Path(sys.argv[3])

    class Handler(http.server.SimpleHTTPRequestHandler):
        def do_POST(self):
            length = int(self.headers.get("Content-Length", 0))
            body = self.rfile.read(length)
            if self.path == "/__results":
                results_file.write_bytes(body)
            self.send_response(204)
            self.end_headers()

        def log_message(self, *args):
            pass

    handler = functools.partial(Handler, directory=app_folder)
    server = http.server.ThreadingHTTPServer(("127.0.0.1", port), handler)
    server.serve_forever()


if __name__ == "__main__":
    main()
