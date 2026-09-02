import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../../.github/workflows/ci.yml', import.meta.url), 'utf8');

function requirePattern(pattern, message) {
  if (!pattern.test(source)) throw new Error(message);
}

requirePattern(/group:\s*ci-\$\{\{ github\.workflow \}\}-\$\{\{ github\.event\.pull_request\.head\.ref \|\| github\.ref_name \}\}/,
  'CI concurrency must deduplicate push and pull_request runs for the same feature branch');

const releaseGate = /if:\s*\$\{\{ github\.event_name == 'pull_request' \|\| github\.event_name == 'workflow_dispatch' \|\| github\.ref == 'refs\/heads\/awh\/api-independence' \|\| github\.ref == 'refs\/heads\/main' \}\}/g;
const gates = source.match(releaseGate) ?? [];
if (gates.length !== 2) throw new Error(`Expected exactly two desktop release gates, found ${gates.length}`);

requirePattern(/desktop-installer-windows:\n\s+if:/, 'Windows installer must remain behind the release gate');
requirePattern(/desktop-package-macos:\n\s+if:/, 'macOS packaging must remain behind the release gate');
requirePattern(/desktop-runtime-linux:\n\s+runs-on: ubuntu-latest/, 'Linux runtime smoke must remain on every CI run');
requirePattern(/matrix:\n\s+os: \[windows-latest, ubuntu-latest\]/, 'Cross-platform test matrix must remain enabled');
requirePattern(/if: runner\.os != 'Windows'\n\s+name: Verify production runtime dependency security\n\s+run: npm audit --omit=dev --audit-level=high/,
  'CI must fail closed on high or critical advisories in production runtime dependencies without conflating dev-only packaging debt');

console.log('CI policy verified: feature pushes stay lightweight; PR/canonical release gates stay full; runtime dependencies stay audit-gated.');
