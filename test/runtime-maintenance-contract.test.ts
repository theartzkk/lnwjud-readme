import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';

const root=process.cwd();
const read=(p:string)=>readFile(join(root,p),'utf8');
const executable=(s:string)=>s.split('\n').filter((line)=>!line.trimStart().startsWith('#')).join('\n');

test('runtime and dependency maintenance are declarative and do not require deploy implementation edits',async()=>{
  const [manifestRaw,bootstrap,nodeInstaller,connectorBootstrap,connectorInstall,connectorVerify,browserQa,macInstaller,packagedVerifier,dependabot]=await Promise.all([
    read('config/device-runtime-release.json'),
    read('src/device-bootstrap.ts'),
    read('deploy/remote-worker/linux/install-node-runtime.sh'),
    read('deploy/remote-worker/linux/bootstrap-vps-direct-connector.sh'),
    read('deploy/remote-worker/linux/install-vps-direct-connector.sh'),
    read('deploy/remote-worker/linux/verify-vps-direct-connector.sh'),
    read('deploy/qa/install-browser-qa-runtime.sh'),
    read('deploy/remote-worker/macos/install.sh'),
    read('scripts/qa/verify-packaged-bundle.mjs'),
    read('.github/dependabot.yml'),
  ]);
  const manifest=JSON.parse(manifestRaw);
  assert.equal(manifest.schemaVersion,1);
  assert.match(manifest.version,/^\d+\.\d+\.\d+$/);
  assert.match(manifest.npmIntegrity,/^sha512-/);
  assert.match(manifest.minimumVersion,/^\d+\.\d+\.\d+$/);
  assert.match(manifest.nodeRuntime.version,/^\d+\.\d+\.\d+$/);
  assert.match(manifest.nodeRuntime.minimumVersion,/^\d+\.\d+\.\d+$/);
  assert.match(manifest.nodeRuntime.sourceUrlTemplate,/\{version\}.*\{asset\}/);
  for(const asset of Object.values(manifest.nodeRuntime.assets) as Array<any>) assert.match(asset.sha256,/^[0-9a-f]{64}$/);
  assert.match(manifest.linuxConnector.nodeRuntime.version,/^\d+\.\d+\.\d+$/);
  assert.match(manifest.linuxConnector.nodeRuntime.minimumVersion,/^\d+\.\d+\.\d+$/);
  assert.match(manifest.linuxConnector.nodeRuntime.asset.sha256,/^[0-9a-f]{64}$/);
  assert.match(manifest.browserQa.playwrightVersion,/^\d+\.\d+\.\d+$/);
  assert.match(manifest.browserQa.axeCoreVersion,/^\d+\.\d+\.\d+$/);

  assert.match(bootstrap,/DEVICE_RUNTIME_RELEASE\.nodeRuntime\.version/);
  assert.match(bootstrap,/DEVICE_RUNTIME_RELEASE\.version/);
  assert.match(bootstrap,/DEVICE_RUNTIME_RELEASE\.npmIntegrity/);
  assert.doesNotMatch(bootstrap,/const NODE_VERSION = ['"]\d+\.\d+\.\d+/);
  assert.doesNotMatch(bootstrap,/const SYSTEM_MCP_VERSION = ['"]\d+\.\d+\.\d+/);

  for(const script of [nodeInstaller,connectorBootstrap,connectorInstall,connectorVerify,browserQa]){
    const body=executable(script);
    assert.match(body,/device-runtime-release\.json/);
    assert.doesNotMatch(body,/22\.22\.1|9a6bc82f9b491279147219f6a18add1e18424dce90d41d2a5fcd69d4924ba3aa|1\.63\.0|AWH_VPS_DIRECT_NODE22_REQUIRED|AWH_BROWSER_QA_NODE22_REQUIRED/);
  }
  assert.match(executable(connectorInstall),/manifest_value version/);
  assert.match(executable(connectorVerify),/EXPECTED_AGENT_VERSION=\$\(manifest_value version\)/);
  assert.match(executable(browserQa),/manifest_value browserQa\.playwrightVersion/);
  assert.match(executable(browserQa),/manifest_value browserQa\.axeCoreVersion/);
  assert.match(macInstaller,/device-runtime-release\.json/);
  assert.doesNotMatch(executable(macInstaller),/^EXPECTED=\d+\.\d+\.\d+$/m);
  assert.match(packagedVerifier,/package\.json/);
  assert.doesNotMatch(packagedVerifier,/EXPECTED_VERSION = ['"]1\.0\.0-rc\.1/);

  assert.match(dependabot,/package-ecosystem:\s*npm/);
  assert.match(dependabot,/interval:\s*weekly/);
  assert.doesNotMatch(dependabot,/npm audit fix|--force|workflow_dispatch|deploy/i);
});
