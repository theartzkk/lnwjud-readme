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
FILTER_SOURCE="$ROOT/deploy/fail2ban/awh-nginx-scanner.conf"
EDGE_TARGET=/etc/nginx/conf.d/awh-edge-hardening.conf
JAIL_TARGET=/etc/fail2ban/jail.d/awh-nginx-botsearch.local
FILTER_TARGET=/etc/fail2ban/filter.d/awh-nginx-scanner.conf
NGINX_AVAILABLE=${AWH_NGINX_SITES_AVAILABLE:-/etc/nginx/sites-available}
NGINX_ENABLED=${AWH_NGINX_SITES_ENABLED:-/etc/nginx/sites-enabled}
BACKUP_ROOT=/var/backups/awh-hub/config
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
BACKUP="$BACKUP_ROOT/edge-$STAMP"
BACKEND_BACKUP="$BACKUP/domain-backends"

test "$(id -u)" -eq 0 || { echo "EDGE_HARDENING_REQUIRES_ROOT" >&2; exit 2; }
for f in "$SITE" "$NGINX_MAIN" "$EDGE_SOURCE" "$LEGACY_SOURCE" "$JAIL_SOURCE" "$FILTER_SOURCE"; do test -f "$f" || { echo "EDGE_HARDENING_INPUT_MISSING=$f" >&2; exit 2; }; done
command -v nginx >/dev/null 2>&1 || { echo "EDGE_HARDENING_NGINX_MISSING" >&2; exit 2; }
command -v python3 >/dev/null 2>&1 || { echo "EDGE_HARDENING_PYTHON_MISSING" >&2; exit 2; }

mkdir -p "$BACKUP" "$BACKEND_BACKUP"
cp -p "$SITE" "$BACKUP/awh-preview.conf"
cp -p "$NGINX_MAIN" "$BACKUP/nginx.conf"
if test -f "$EDGE_TARGET"; then cp -p "$EDGE_TARGET" "$BACKUP/awh-edge-hardening.conf"; else : > "$BACKUP/no-edge"; fi
if test -f "$JAIL_TARGET"; then cp -p "$JAIL_TARGET" "$BACKUP/awh-nginx-botsearch.local"; else : > "$BACKUP/no-jail"; fi
if test -f "$FILTER_TARGET"; then cp -p "$FILTER_TARGET" "$BACKUP/awh-nginx-scanner.conf"; else : > "$BACKUP/no-filter"; fi
for backend in "$NGINX_AVAILABLE"/awh-site-*.conf; do
  test -e "$backend" || continue
  test -f "$backend" && test ! -L "$backend" || { echo "EDGE_HARDENING_BACKEND_UNSAFE=$backend" >&2; exit 2; }
  cp -p "$backend" "$BACKEND_BACKUP/$(basename "$backend")"
done

rollback() {
  cp -p "$BACKUP/awh-preview.conf" "$SITE"
  cp -p "$BACKUP/nginx.conf" "$NGINX_MAIN"
  if test -f "$BACKUP/no-edge"; then rm -f "$EDGE_TARGET"; else cp -p "$BACKUP/awh-edge-hardening.conf" "$EDGE_TARGET"; fi
  if test -f "$BACKUP/no-jail"; then rm -f "$JAIL_TARGET"; else cp -p "$BACKUP/awh-nginx-botsearch.local" "$JAIL_TARGET"; fi
  if test -f "$BACKUP/no-filter"; then rm -f "$FILTER_TARGET"; else cp -p "$BACKUP/awh-nginx-scanner.conf" "$FILTER_TARGET"; fi
  for backend in "$BACKEND_BACKUP"/*.conf; do
    test -f "$backend" || continue
    cp -p "$backend" "$NGINX_AVAILABLE/$(basename "$backend")"
  done
  nginx -t >/dev/null 2>&1 && systemctl reload nginx || true
  fail2ban-client reload >/dev/null 2>&1 || true
}
trap 'code=$?; if test "$code" -ne 0; then rollback; echo "EDGE_HARDENING_ROLLBACK=PASS" >&2; fi; exit "$code"' EXIT HUP INT TERM

install -m 0644 "$EDGE_SOURCE" "$EDGE_TARGET"
install -m 0644 "$JAIL_SOURCE" "$JAIL_TARGET"
install -m 0644 "$FILTER_SOURCE" "$FILTER_TARGET"

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
legacy_host='157-85-108-142.sslip.io'
compat='location ^~ /api/v1/control/'
if marker not in text:
    if legacy_host in text:
        raise SystemExit('legacy ssl server authority malformed')
elif compat not in text:
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

# Existing DOMAIN sites created before loopback-only backends were introduced
# must converge too. Domain routes are the authority for which backend ports
# are no longer intended to be internet-facing. The rewrite is bounded to
# AWH-managed site configs and is idempotent; rollback restores every captured
# backend config if any later edge verification fails.
python3 - "$NGINX_AVAILABLE" "$NGINX_ENABLED" <<'PY'
from pathlib import Path
import os,re,stat,sys
available=Path(sys.argv[1]).resolve()
enabled=Path(sys.argv[2]).resolve()
if not available.is_dir() or not enabled.is_dir():
    raise SystemExit('managed nginx directories are unavailable')
ports=set()
port_re=re.compile(r'proxy_pass\s+https://127\.0\.0\.1:(8[4-9][0-9]{2})\s*;')
for entry in sorted(enabled.glob('awh-domain-*.conf')):
    if not entry.exists():
        continue
    target=entry.resolve()
    if target.parent != available or not target.is_file() or target.is_symlink():
        raise SystemExit(f'unsafe managed domain route: {entry}')
    raw=target.read_text()
    if len(raw)>1024*1024:
        raise SystemExit(f'managed domain route too large: {entry.name}')
    ports.update(port_re.findall(raw))
rewritten=0
for port in sorted(ports):
    public=f'listen {port} ssl;'
    loopback=f'listen 127.0.0.1:{port} ssl;'
    matches=[]
    for config in sorted(available.glob('awh-site-*.conf')):
        if config.is_symlink() or not config.is_file():
            raise SystemExit(f'unsafe managed backend config: {config}')
        raw=config.read_text()
        if len(raw)>1024*1024:
            raise SystemExit(f'managed backend config too large: {config.name}')
        if public in raw or loopback in raw:
            matches.append((config,raw))
    if len(matches)!=1:
        raise SystemExit(f'domain backend authority is ambiguous for port {port}')
    config,raw=matches[0]
    if loopback in raw:
        if public in raw:
            raise SystemExit(f'mixed backend listener authority for port {port}')
        continue
    if raw.count(public)!=1:
        raise SystemExit(f'backend listener shape changed for port {port}')
    updated=raw.replace(public,loopback,1)
    tmp=config.with_name(config.name+f'.awh-edge-{os.getpid()}.tmp')
    with tmp.open('x') as handle:
        handle.write(updated)
        handle.flush()
        os.fsync(handle.fileno())
    os.chmod(tmp,stat.S_IMODE(config.stat().st_mode))
    os.replace(tmp,config)
    rewritten+=1
print(f'EDGE_DOMAIN_BACKENDS_RECONCILED={rewritten}')
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
