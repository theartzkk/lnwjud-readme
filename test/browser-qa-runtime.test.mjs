import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';

const root = process.cwd();

test('VPS browser QA runtime is pinned, browser-reuse-only and Thai-ready', async () => {
  const [install, verify, runner, browser] = await Promise.all([
    readFile(join(root, 'deploy/qa/install-browser-qa-runtime.sh'), 'utf8'),
    readFile(join(root, 'deploy/qa/verify-browser-qa-runtime.sh'), 'utf8'),
    readFile(join(root, 'scripts/qa/run-vps-chat-continuity.sh'), 'utf8'),
    readFile(join(root, 'scripts/qa/chat-continuity-browser.mjs'), 'utf8'),
  ]);
  const accessibility = await readFile(join(root, 'scripts/qa/accessibility-browser.mjs'), 'utf8');
  assert.match(install, /PLAYWRIGHT_VERSION=\$\{AWH_PLAYWRIGHT_VERSION:-\$\(manifest_value browserQa\.playwrightVersion\)\}/);
  assert.match(install, /AXE_CORE_VERSION=\$\{AWH_AXE_CORE_VERSION:-\$\(manifest_value browserQa\.axeCoreVersion\)\}/);
  assert.match(install, /NODE_VERSION=\$\(manifest_value linuxConnector\.nodeRuntime\.version\)/);
  assert.match(install, /AWH_BROWSER_QA_NODE_RUNTIME_REQUIRED/);
  assert.match(install, /install-node-runtime\.sh/);
  assert.match(install, /install-node-runtime\.sh/);
  assert.match(install, /PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1/);
  assert.match(install, /"axe-core@\$AXE_CORE_VERSION"/);
  assert.match(install, /AWH_BROWSER_QA_AXE_MISSING/);
  assert.match(install, /AWH_AXE_CORE_PATH/);
  assert.match(install, /--no-install-recommends/);
  assert.match(install, /fonts-noto-core/);
  assert.match(install, /fonts-noto-color-emoji/);
  assert.match(install, /cp -al "\$CHROME_DIR\/." "\$ROOT\/chrome-staged\/"/);
  assert.match(install, /ln -sfn "\$CHROME" "\$ROOT\/chrome-current"/);
  assert.doesNotMatch(install, /playwright\s+install|apt-get[^\n]*(chromium|google-chrome)/);
  assert.match(verify, /AWH_BROWSER_QA_NODE_BIN/);
  assert.match(verify, /AWH_BROWSER_QA_AXE_MISSING/);
  assert.match(verify, /AWH_BROWSER_QA_AXE_INVALID/);
  assert.match(verify, /AWH_AXE_CORE_PATH/);
  assert.match(verify, /ldd "\$AWH_CHROME_PATH"/);
  assert.match(runner, /control-web-fixture\.mjs/);
  assert.match(runner, /accessibility-browser\.mjs/);
  assert.match(runner, /AWH_AXE_CORE_PATH/);
  assert.match(runner, /trap cleanup EXIT HUP INT TERM/);
  assert.match(browser, /AWH_PLAYWRIGHT_MODULE is required/);
  assert.match(browser, /AWH_CHROME_PATH is required/);
  assert.match(accessibility, /AWH_AXE_CORE_PATH is required/);
  assert.match(accessibility, /globalThis\.axe\.run/);
  assert.match(accessibility, /wcag22aa/);
  assert.match(accessibility, /AWH_ACCESSIBILITY_GATE_FAILED/);
});
