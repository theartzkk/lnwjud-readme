import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../../.github/workflows/ci.yml', import.meta.url), 'utf8');

function requirePattern(pattern, message) {
  if (!pattern.test(source)) throw new Error(message);
}

requirePattern(/group:\s*ci-\$\{\{ github\.workflow \}\}-\$\{\{ github\.event\.pull_request\.head\.ref \|\| github\.ref_name \}\}/,
  'CI concurrency must deduplicate push and pull_request runs for the same feature branch');

requirePattern(/changes:\n\s+runs-on: ubuntu-latest\n\s+outputs:\n\s+desktop: \$\{\{ steps\.classify\.outputs\.desktop \}\}/,
  'CI must expose one bounded Desktop-impact classifier');
requirePattern(/fetch-depth: 0/, 'Desktop-impact classifier must compare exact PR base/head history');
requirePattern(/github\.event\.pull_request\.base\.sha/, 'Desktop-impact classifier must use the PR base SHA');
requirePattern(/github\.event\.pull_request\.head\.sha/, 'Desktop-impact classifier must use the PR head SHA');
requirePattern(/ART_AI_WORKING_PROTOCOL\\\.md|ART_AI_WORKING_PROTOCOL/, 'Owner protocol changes must remain Desktop-package affecting');
requirePattern(/scripts\/qa\/verify-packaged-bundle\\\.mjs|scripts\/qa\/verify-packaged-bundle/, 'Packaged-bundle verifier changes must remain Desktop-package affecting');

const gatedJobs = ['desktop-installer-windows', 'desktop-package-macos'];
for (const job of gatedJobs) {
  const block = new RegExp(
    `${job}:\\n\\s+needs: changes\\n\\s+if: \\$\\{\\{[^\\n]*github\\.event_name == 'workflow_dispatch'[^\\n]*github\\.ref == 'refs/heads/main'[^\\n]*needs\\.changes\\.outputs\\.desktop == 'true'[^\\n]*\\}\\}`,
  );
  requirePattern(block, `${job} must package on manual/main gates and only package PRs classified as Desktop-affecting`);
}

requirePattern(/desktop-runtime-linux:\n\s+runs-on: ubuntu-latest/, 'Linux runtime smoke must remain on every CI run');
requirePattern(/matrix:\n\s+os: \[windows-latest, ubuntu-latest\]/, 'Cross-platform test matrix must remain enabled');
requirePattern(/if: runner\.os != 'Windows'\n\s+name: Verify production runtime dependency security\n\s+run: npm audit --omit=dev --audit-level=high/,
  'CI must fail closed on high or critical advisories in production runtime dependencies without conflating dev-only packaging debt');

console.log('CI policy verified: PR packaging is path-aware; canonical/manual release gates stay full; cross-platform/runtime/security tests stay enabled.');
