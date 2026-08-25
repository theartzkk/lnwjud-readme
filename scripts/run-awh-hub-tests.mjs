#!/usr/bin/env node

import { spawn } from 'node:child_process';

const tests = [
  'hub/tests/read-foundation.php',
  'hub/tests/m3e-migration.php',
  'hub/tests/m3e2-migration.php',
  'hub/tests/enrollment-api.php',
  'hub/tests/m3e-m4-compatibility.php',
  'hub/tests/m4-control-plane.php',
  'hub/tests/m4-zero-project-control.php',
  'hub/tests/m4-project-registration.php',
  'hub/tests/owner-auth.php',
  'hub/tests/owner-auth-rollback.php',
  'hub/tests/m6-assistant-workstream.php',
  'hub/tests/m7-workspace-continuity.php',
  'hub/tests/m8-unified-workspace.php',
  'hub/tests/m9-final-product.php',
  'hub/tests/m10-founding-memory.php',
  'hub/tests/m11-self-service.php',
  'hub/tests/m12-central-project-authority.php',
  'hub/tests/m13-workspace-product.php',
];

let passed = 0; let skipped = 0;
for (const test of tests) {
  process.stdout.write(`\n== ${test} ==\n`);
  const code = await new Promise((resolve) => {
    const child = spawn('php', [test], { stdio: 'inherit', cwd: process.cwd() });
    child.on('error', (error) => { console.error(error); resolve(127); });
    child.on('exit', (value) => resolve(value ?? 1));
  });
  if (code === 77) { skipped++; continue; }
  if (code !== 0) { process.stderr.write(`AWH Hub regression failed: ${test} (exit ${code})\n`); process.exit(code); }
  passed++;
}
process.stdout.write(`\nAWH Hub regression: PASS ${passed}, SKIP ${skipped}\n`);
