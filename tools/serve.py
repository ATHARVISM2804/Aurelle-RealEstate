# Local dev server: never caches (edits show on a normal reload) and accepts
# POST /api/enquiry, appending each lead to leads/leads.csv (production uses api/enquiry.js).
import csv, functools, http.server, json, os
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FIELDS = ['at', 'type', 'name', 'phone', 'email', 'unit', 'budget', 'contact', 'message', 'page', 'utm_source', 'utm_medium', 'utm_campaign']

class Handler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()

    def do_POST(self):
        if self.path != '/api/enquiry':
            return self.send_error(404)
        try:
            data = json.loads(self.rfile.read(min(int(self.headers.get('Content-Length', 0)), 20000)))
            if not (str(data.get('name', '')).strip() and str(data.get('email', '')).strip() and str(data.get('phone', '')).strip()):
                return self.send_error(400)
        except Exception:
            return self.send_error(400)
        path = os.path.join(ROOT, 'leads', 'leads.csv')
        os.makedirs(os.path.dirname(path), exist_ok=True)
        new = not os.path.exists(path)
        with open(path, 'a', newline='') as f:
            w = csv.DictWriter(f, fieldnames=FIELDS, extrasaction='ignore')
            if new: w.writeheader()
            w.writerow({k: str(data.get(k, ''))[:2000] for k in FIELDS})
        body = b'{"ok":true}'
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

http.server.ThreadingHTTPServer(('127.0.0.1', 8790), functools.partial(Handler, directory=ROOT)).serve_forever()
