import { spawn } from 'node:child_process';
import { resolveExecutable } from '../../src/process.js';

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
];

const php = await resolveExecutable('php');
for (const fixture of tests) {
  await new Promise((resolve, reject) => {
    const child = spawn(php, [fixture], { cwd: process.cwd(), shell: false, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let stderr = '';
    child.stdout.pipe(process.stdout);
    child.stderr.on('data', (chunk) => { stderr += String(chunk).slice(0, 4096); });
    child.once('error', reject);
    child.once('close', (code) => code === 0 || code === 77 ? resolve() : reject(new Error(`${fixture} failed: ${stderr.trim() || `exit ${code ?? -1}`}`)));
  });
}
