# M3C0 AWH Web Surface / Remote Read-Only Preview

M3C0 is a browser-specific presentation adapter for the same AWH product. It
does not create a second application, Hub server, sync engine, or browser
version of Electron IPC.

## Build

From the AWH repository root:

```sh
npm run web:build
```

The generated static output is:

```text
dist-web/
  index.html
  styles.css
  app.js
  hub-read-adapter.js
  data.json
```

`dist-web/` is generated and gitignored. The build reads the existing portable
manifest and Project Memory through the existing Project Context engine, then
serializes only a sanitized snapshot:

- projectId, portable name, and type
- current M3C0 milestone
- bounded HANDOFF summary (480 characters maximum)
- memory file presence only
- safe Hub/devices/builds/audit status placeholders

It does not serialize workspace paths, Git remotes, source contents, tokens,
environment, SSH details, or credential-store data.

## Browser boundary

The default static surface uses same-origin `GET ./data.json`. The browser
adapter also has a separate future `HUB_READ` mode that accepts only a
same-origin relative API base from an external `web-config.json`; it issues
GET requests only, never creates or forwards bearer credentials, and sanitizes
project/memory metadata before rendering. No Hub mode is enabled by the
generated static build.

The browser surface has no Electron preload, IPC, Node, shell, filesystem,
environment, write, source-editing, MCP-proxy, or remote-execution capability.
DOM values use `textContent`; raw Markdown is never assigned as HTML. The page
has a restrictive CSP and is responsive for desktop browsers and iPhone/iPad
widths.

The visible status is intentionally:

`Remote Preview — Read Only`

M3C0 is a static preview snapshot. “Hub status”, Devices, Builds/Releases, and
Audit are honest placeholders until a future authenticated Hub API exists.
M3C1 supplies a separate local PHP/SQLite read foundation; it is not deployed
or enabled by this static build.

## Safe deployment shape for Ubuntu/Nginx

The following commands are instructions only; they were not executed by M3C0.
Replace `DEPLOY_USER`, `PREVIEW_HOSTNAME`, and `ADMIN_PUBLIC_IP` with reviewed
values. Build locally first, upload a unique release directory, validate Nginx,
then switch one symlink atomically:

```sh
npm run web:build
RELEASE="m3c0-$(date -u +%Y%m%dT%H%M%SZ)"
scp -r dist-web "DEPLOY_USER@awh-hub-01:/tmp/awh-web-$RELEASE"
ssh -o BatchMode=yes "DEPLOY_USER@awh-hub-01" "sudo install -d -m 0755 /var/www/awh-web/releases/$RELEASE && sudo cp -a /tmp/awh-web-$RELEASE/. /var/www/awh-web/releases/$RELEASE/ && sudo ln -sfnT /var/www/awh-web/releases/$RELEASE /var/www/awh-web/current && sudo nginx -t && sudo systemctl reload nginx"
```

Suggested Nginx server block:

```nginx
server {
    listen 80;
    server_name PREVIEW_HOSTNAME;
    root /var/www/awh-web/current;
    index index.html;

    add_header X-Content-Type-Options "nosniff" always;
    add_header Referrer-Policy "no-referrer" always;
    add_header Cache-Control "no-store" always;

    location / {
        try_files $uri $uri/ =404;
    }
}
```

Use HTTPS before exposing the preview publicly. There is no backend port to
expose in M3C0. Allow TCP 80/443 as required by the chosen TLS setup; restrict
SSH TCP 22 to the administrator's `/32` address. Apply this at both the Google
Cloud firewall and Ubuntu UFW layers. Do not expose database, PHP-FPM, Docker,
or development-server ports.

Example reviewed firewall commands (not executed):

```sh
gcloud compute firewall-rules create awh-hub-web-https \
  --target-tags=awh-hub-01 \
  --allow=tcp:80,tcp:443 \
  --source-ranges=0.0.0.0/0

gcloud compute firewall-rules create awh-hub-admin-ssh \
  --target-tags=awh-hub-01 \
  --allow=tcp:22 \
  --source-ranges=ADMIN_PUBLIC_IP/32
```

TLS certificate provisioning and the actual VPS hostname/IP are deployment
steps outside M3C0 and remain unverified.
