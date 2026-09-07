import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path: string) =>
  readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('AWH observability collector is loopback-only and allowlist based', async () => {
  const files = await Promise.all([
    read('deploy/observability/otelcol-awh-preflight.yaml'),
    read('deploy/observability/otelcol-awh-honeycomb.yaml'),
  ]);
  for (const yaml of files) {
    assert.match(yaml, /endpoint:\s*127\.0\.0\.1:4318/);
    assert.match(yaml, /allow_all_keys:\s*false/);
    assert.match(yaml, /set\(span\.name, "awh\.http"\)/);
    assert.match(yaml, /keep_keys\(spanevent\.attributes, \[\]\)/);
    assert.doesNotMatch(yaml, /url\.full|db\.statement|cookie|request\.body/i);
  }
});

test('AWH installer pins artifacts and disables child instrumentation', async () => {
  const install = await read('deploy/observability/install-awh-observability.sh');
  assert.match(install, /OTELCOL_VERSION=0\.160\.0/);
  assert.match(install, /PHP_OTEL_VERSION=0\.6\.1/);
  assert.match(install, /OTEL_PHP_DISABLED_INSTRUMENTATIONS.*curl,pdo/);
  assert.match(install, /OTEL_EXPORTER_OTLP_ENDPOINT.*127\.0\.0\.1:4318/);
  assert.match(install, /php-fpm8\.3 -t/);
});
test('AWH Honeycomb UI uses write-only owner credential route', async () => {
  const [service, router, adapter, app, html, trust] = await Promise.all([
    read('hub/src/HubControlPlaneService.php'),
    read('hub/src/HubControlPlaneRouter.php'),
    read('web/control-plane-adapter.js'),
    read('web/app.js'),
    read('web/index.html'),
    read('hub/src/HubTrustPolicy.php'),
  ]);
  assert.match(service, /HubProviderCredentialStore::fromEnvironment\('honeycomb'\)/);
  assert.match(service, /observability\.credential/);
  assert.match(router, /\/api\/v1\/control\/observability\/credential/);
  assert.match(adapter, /updateObservabilityCredential/);
  assert.match(app, /observability-credential-form/);
  assert.match(html, /type="password"[^>]+observability-api-key|id="observability-api-key"[^>]+type="password"/);
  assert.match(trust, /observability\.credential/);
  const block = service.slice(service.indexOf('public function observabilityStatus'), service.indexOf('public function providerStatus'));
  assert.doesNotMatch(block, /['"]secret['"]\s*=>/i);
});

test('Honeycomb watcher never stores the ingest key in source-controlled config', async () => {
  const [sync, collector] = await Promise.all([
    read('deploy/observability/sync-honeycomb-credential.sh'),
    read('deploy/observability/otelcol-awh-honeycomb.yaml'),
  ]);
  assert.match(sync, /provider-credentials\/honeycomb\.key/);
  assert.match(sync, /HONEYCOMB_API_KEY/);
  assert.match(sync, /honeycomb-egress/);
  assert.match(sync, /rm -f "\$EGRESS_MARKER" "\$ACTIVE_MARKER"/);
  assert.doesNotMatch(sync, /printf ['"]ACTIVE/);
  assert.match(collector, /\$\{env:HONEYCOMB_API_KEY\}/);
  assert.doesNotMatch(collector, /hcaik_[A-Za-z0-9]/);
});
