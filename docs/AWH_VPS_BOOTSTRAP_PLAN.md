# AWH VPS Bootstrap Plan — Unexecuted

This is the review checklist for tomorrow. No command in this document has
been executed by M3C1. Replace placeholders only after human review.

## Required now: controlled AWH preview

1. Decide whether a static/reserved IP is needed for the chosen DNS plan.
2. Point a reviewed preview hostname to the VM only when HTTPS is ready.
3. Install and validate Caddy on Ubuntu 24.04; use the reviewed template in
   `deploy/caddy/awh-preview.Caddyfile`.
4. Create `/var/www/awh-web/releases/` and `current` with a dedicated service
   owner and no broad write permissions.
5. Build locally, create `release.json`, validate it with
   `deploy/awh-web/validate-release.sh`, upload to a unique release directory,
   run `nginx -t` or `deploy/caddy/validate.sh`, then switch `current` with an
   atomic symlink.
6. Put the preview behind HTTPS and temporary server-layer Basic Auth. Generate
   the hash on the operator machine; do not put credentials in AWH source.
7. Allow public TCP 80/443 only as required for the chosen TLS setup. Restrict
   SSH TCP 22 to the administrator IP. Do not expose 3306, PHP-FPM, Docker, or
   development ports.
8. Use `deploy/awh-web/health-check.sh --check` only after HTTPS is configured;
   its default mode is dry-run and it never sends credentials.

## Required before production

1. Complete M3B device enrollment, credential storage, rotation, revocation,
   project membership, and audit verification.
2. Separate staging and production hostnames, data directories, secrets,
   release paths, and rollback procedures.
3. Configure PHP-FPM privately and keep MariaDB/MySQL private behind its socket
   or local network boundary.
4. Create least-privilege database users; never reuse a root credential.
5. Choose a safer private administration route instead of public phpMyAdmin.
6. Implement encrypted off-host backups, retention, restore drills, and a
   tested rollback path.
7. Add monitoring for disk, memory, swap, CPU, PHP-FPM, database, TLS, and
   application errors.
8. Complete school website/BAY EXCUSE X inventory and a separate migration plan;
   do not combine it with AWH preview deployment.

## Optional later

Reserved IP, larger VM, Cloud SQL, managed object storage, asset layer,
automated staging promotion, and a read-only AWH Hosting Control Center remain
future decisions. No cPanel dependency is required.
