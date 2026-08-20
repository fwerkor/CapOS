#!/usr/bin/env bash
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_BIN="${APP_BIN:-/tmp/capos-webdesktop-app-smoke}"
TMPDIR="$(mktemp -d)"
SESSION_ID="0123456789abcdef0123456789abcdef0123456789abcdef"
SESSION_DIR="/tmp/capos-webdesktop/sessions"
SESSION_PATH="$SESSION_DIR/$SESSION_ID.session"
SERVER_PID=""
cleanup(){ [[ -n "$SERVER_PID" ]] && kill "$SERVER_PID" 2>/dev/null || true; rm -f "$SESSION_PATH"; rm -rf "$TMPDIR"; }
trap cleanup EXIT

if [[ ! -x "$APP_BIN" ]]; then
  g++ -std=gnu++17 -I"$ROOT_DIR/package/capos/capos-webdesktop/src" \
    -o "$APP_BIN" "$ROOT_DIR/package/capos/capos-webdesktop/src/app.cpp" -lcrypt -lssl -lcrypto
fi
mkdir -p "$SESSION_DIR"
cat >"$SESSION_PATH" <<SESSION
id=$SESSION_ID
username=testuser
uid=1000
is_sudo=1
created_at=1700000000
expires_at=4102444800
SESSION

env SNAP_NAME=demo python3 - "$TMPDIR/port" <<'PY' &
import socket,sys
port_file=sys.argv[1]
s=socket.socket(); s.setsockopt(socket.SOL_SOCKET,socket.SO_REUSEADDR,1); s.bind(("127.0.0.1",0)); s.listen(10)
open(port_file,"w").write(str(s.getsockname()[1]))
while True:
    c,_=s.accept()
    with c:
        data=b""
        while b"\r\n\r\n" not in data:
            chunk=c.recv(4096)
            if not chunk: break
            data+=chunk
        body=b'<html><head></head><body><a href="/next">next</a></body></html>'
        c.sendall(b"HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nSet-Cookie: upstream=1; Path=/\r\nLocation: /next\r\nContent-Length: "+str(len(body)).encode()+b"\r\n\r\n"+body)
PY
SERVER_PID=$!
for _ in $(seq 1 50); do [[ -s "$TMPDIR/port" ]] && break; sleep .1; done
test -s "$TMPDIR/port"
PORT="$(cat "$TMPDIR/port")"

output="$(env -i PATH="$PATH" REQUEST_METHOD=GET PATH_INFO=/demo/ QUERY_STRING= HTTP_COOKIE="capos_session=$SESSION_ID" "$APP_BIN" </dev/null)"
grep -q "Status: 200 OK" <<<"$output"
grep -q "Set-Cookie: upstream=1; Path=/cgi-bin/cap/app/demo" <<<"$output"
grep -q "Location: /cgi-bin/cap/app/demo/next" <<<"$output"
grep -q 'href="/cgi-bin/cap/app/demo/next"' <<<"$output"
grep -q "Content-Length:" <<<"$output"
[[ "$PORT" =~ ^[0-9]+$ ]]
echo "webdesktop auto-discovery proxy smoke passed"
