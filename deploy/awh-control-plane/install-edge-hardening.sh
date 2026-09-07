#!/bin/sh
set -eu
LC_ALL=C
export LC_ALL

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
SITE=${AWH_NGINX_SITE:-/etc/nginx/sites-enabled/awh-preview.conf}
NGINX_MAIN=${AWH_NGINX_MAIN:-/etc/nginx/nginx.conf}
EDGE_SOURCE="$ROOT/deploy/nginx/awh-edge-hardening.conf"
LEGACY_SOURCE="$ROOT/deploy/nginx/awh-legacy-control-compat.conf"
JAIL_SOURCE="$ROOT/deploy/fail2ban/awh-nginx-botsearch.local"
EDGE_TARGET=/etc/nginx/conf.d/awh-edge-hardening.conf
JAIL_TARGET=/etc/fail2ban/jail.d/awh-nginx-botsearch.local
BACKUP_ROOT=/var/backups/awh-hub/config
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
BACKUP="$BACKUP_ROOT/edge-$STAMP"

test "$(id -u)" -eq 0 || { echo "EDGE_HARDENING_REQUIRES_ROOT" >&2; exit 2; }
for f in "$SITE" "$NGINX_MAIN" "$EDGE_SOURCE" "$LEGACY_SOURCE" "$JAIL_SOURCE"; do test -f "$f" || { echo "EDGE_HARDENING_INPUT_MISSING=$f" >&2; exit 2; }; done
command -v nginx >/dev/null 2>&1 || { echo "EDGE_HARDENING_NGINX_MISSING" >&2; exit 2; }
command -v python3 >/dev/null 2>&1 || { echo "EDGE_HARDENING_PYTHON_MISSING" >&2; exit 2; }

mkdir -p "$BACKUP"
cp -p "$SITE" "$BACKUP/awh-preview.conf"
cp -p "$NGINX_MAIN" "$BACKUP/nginx.conf"
if test -f "$EDGE_TARGET"; then cp -p "$EDGE_TARGET" "$BACKUP/awh-edge-hardening.conf"; else : > "$BACKUP/no-edge"; fi
if test -f "$JAIL_TARGET"; then cp -p "$JAIL_TARGET" "$BACKUP/awh-nginx-botsearch.local"; else : > "$BACKUP/no-jail"; fi

rollback() {
  cp -p "$BACKUP/awh-preview.conf" "$SITE"
  cp -p "$BACKUP/nginx.conf" "$NGINX_MAIN"
  if test -f "$BACKUP/no-edge"; then rm -f "$EDGE_TARGET"; else cp -p "$BACKUP/awh-edge-hardening.conf" "$EDGE_TARGET"; fi
  if test -f "$BACKUP/no-jail"; then rm -f "$JAIL_TARGET"; else cp -p "$BACKUP/awh-nginx-botsearch.local" "$JAIL_TARGET"; fi
  nginx -t >/dev/null 2>&1 && systemctl reload nginx || true
  fail2ban-client reload >/dev/null 2>&1 || true
}
trap 'code=$?; if test "$code" -ne 0; then rollback; echo "EDGE_HARDENING_ROLLBACK=PASS" >&2; fi; exit "$code"' EXIT HUP INT TERM

install -m 0644 "$EDGE_SOURCE" "$EDGE_TARGET"
install -m 0644 "$JAIL_SOURCE" "$JAIL_TARGET"

python3 - "$SITE" "$LEGACY_SOURCE" <<'PY'
from pathlib import Path
import sys,re
site=Path(sys.argv[1])
legacy=Path(sys.argv[2]).read_text().strip()+"\n"
text=site.read_text()

# Release-pinned JS/CSS are immutable; HTML/JSON revalidate and API is no-store.
text=text.replace('add_header Cache-Control "no-store" always;', 'add_header Cache-Control $awh_cache_control always;', 1)

# Redirects must preserve POST/body for old workers and non-browser clients.
text=text.replace('return 301 https://kruart.online$request_uri;', 'return 308 https://kruart.online$request_uri;')

marker='server_name 157-85-108-142.sslip.io;'
compat='location ^~ /api/v1/control/'
if marker not in text:
    raise SystemExit('legacy ssl server authority missing')
if compat not in text:
    pattern=re.compile(r'''server\s*\{\s*
\s*listen\s+443\s+ssl\s+http2;\s*
\s*server_name\s+157-85-108-142\.sslip\.io;\s*
\s*ssl_certificate\s+/etc/letsencrypt/live/157-85-108-142\.sslip\.io/fullchain\.pem;\s*
\s*ssl_certificate_key\s+/etc/letsencrypt/live/157-85-108-142\.sslip\.io/privkey\.pem;\s*
\s*return\s+(?:301|308)\s+https://kruart\.online\$request_uri;\s*
\}''', re.X)
    text,n=pattern.subn(legacy.strip(),text,count=1)
    if n!=1:
        raise SystemExit('legacy redirect block shape changed; refusing blind edit')

login='location = /api/v1/auth/login {'
if login in text and 'limit_req zone=awh_auth' not in text:
    text=text.replace(login, login+'\n        limit_req zone=awh_auth burst=10 nodelay;',1)

site.write_text(text)
PY

python3 - "$NGINX_MAIN" <<'PY'
from pathlib import Path
import sys
p=Path(sys.argv[1]); s=p.read_text()
old='ssl_protocols TLSv1 TLSv1.1 TLSv1.2 TLSv1.3;'
new='ssl_protocols TLSv1.2 TLSv1.3;'
if old in s:
    p.write_text(s.replace(old,new,1))
elif new not in s:
    raise SystemExit('ssl_protocols authority changed; refusing blind edit')
PY

nginx -t
if command -v fail2ban-client >/dev/null 2>&1; then fail2ban-client -t; fi
systemctl reload nginx
if command -v fail2ban-client >/dev/null 2>&1; then fail2ban-client reload; fi

# Verify the intended runtime contract, not merely command success.
nginx -T 2>/dev/null | grep -q 'server_tokens off;'
nginx -T 2>/dev/null | grep -q 'gzip_types'
nginx -T 2>/dev/null | grep -q 'map $uri $awh_cache_control'
nginx -T 2>/dev/null | grep -q 'limit_req zone=awh_auth'
nginx -T 2>/dev/null | grep -q 'location ^~ /api/v1/control/'
if command -v fail2ban-client >/dev/null 2>&1; then fail2ban-client status nginx-botsearch >/dev/null; fi

trap - EXIT HUP INT TERM
echo "EDGE_HARDENING=PASS"
echo "EDGE_HARDENING_BACKUP=$BACKUP"
