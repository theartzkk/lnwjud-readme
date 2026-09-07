# AWH Observability (Honeycomb)

## Authority
- AWH canonical source remains `awh/api-independence`; Honeycomb is an observability sink, never a Source of Truth.
- Production data authority remains the AWH SQLite/control-plane and existing BAY authorities.
- Honeycomb receives traces only in Phase 1. Logs, metrics, browser RUM, prompts, files, request bodies and identity data are out of scope.

## Runtime contract
- OpenTelemetry Collector Contrib: **0.160.0** (SHA-256 pinned in installer).
- OpenTelemetry PHP Distro: **0.6.1** (SHA-256 pinned in installer).
- OTLP receiver binds only to `127.0.0.1:4318`; no public listener is allowed.
- Only the `awh-hub` PHP-FPM pool exports traces. Other PHP pools are not configured for OTLP export.
- Phase 1 disables `curl` and `pdo` child-span auto-instrumentation, leaving one bounded server root span per request.
- Span and event names are normalized to `awh.http` / `awh.event`.

## Privacy contract
Collector redaction is fail-closed. Resource attributes are reduced to service identity/version, namespace and deployment environment. The only allowed span attributes are:
- `http.request.method`
- `http.response.status_code`
- `http.response.body.size`
- `network.protocol.version`
- `error.type`

Span-event attributes are cleared. URLs, route parameters, query strings, cookies, headers, request/response bodies, prompt content, attachment metadata, student/personnel identifiers, DB statements and exception messages must not be added without a new privacy review.

## User flow
The Owner uses **Settings → System → Honeycomb Observability** in AWH. The ingest key is write-only:
1. Browser sends it once over the authenticated same-origin HTTPS control route.
2. `HubProviderCredentialStore` stores it in the existing provider-secret authority, outside SQLite and outside the release tree.
3. `awh-observability-sync.path` watches the secret authority and triggers a fixed root-only sync service.
4. The sync service validates the secret file, builds the collector EnvironmentFile, validates the Honeycomb collector config and restarts only the collector.
5. Removing the key through AWH automatically restores local preflight mode.

There is no arbitrary command execution, no second secret store exposed to the browser and no key returned by any status route.

## Verification states
- `LOCAL_PREFLIGHT`: traces stay on the VPS debug exporter.
- `ACTIVATING`: the key exists but the root sync has not completed.
- `VERIFYING`: Honeycomb egress is configured; independent Honeycomb-side evidence is still pending. The root watcher writes only the egress marker.
- `ACTIVE`: Honeycomb-side data was independently observed and the verified marker was written separately after that evidence exists.

The root sync deliberately removes the ACTIVE marker whenever the credential changes so a rotated key must be re-verified.

## Rollback
Every installer run writes a timestamped backup under `/var/backups/awh-observability/`. To disable egress immediately, remove the Honeycomb credential through AWH or restore the preflight collector config and restart `otelcol-contrib`. To disable AWH tracing, restore the backed-up `awh-enrollment.conf` and reload PHP-FPM. Package removal is optional unless the extension itself is implicated.

## Current field state — 2026-09-07
Production preflight was verified on Ubuntu 24.04 / PHP 8.3 with the collector bound to loopback only. Controlled requests produced one root span after disabling curl/PDO instrumentation, and the collector output contained only allowlisted method/status attributes after redaction. Honeycomb external egress remains gated on the Owner ingest key.
