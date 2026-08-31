import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, relative, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { PRODUCT } from '../src/product.js';

const ROOT = resolve(process.cwd());
const requestedOutput = process.env.AWH_WEB_OUTPUT_DIR;
const OUTPUT = requestedOutput === undefined ? join(ROOT, 'dist-web') : resolve(requestedOutput);

function isWithin(root: string, candidate: string): boolean {
  const value = relative(root, candidate);
  return value !== '' && !value.startsWith(`..${sep}`) && value !== '..' && !value.startsWith('../');
}
if (requestedOutput !== undefined && !isWithin(ROOT, OUTPUT) && !isWithin(tmpdir(), OUTPUT)) throw new Error('AWH web output path is outside the allowed build roots');

async function asset(name: string): Promise<string> { return readFile(join(ROOT, 'web', name), 'utf8'); }
function renderReleaseAsset(source: string, releaseId: string): string { const rendered = source.replaceAll('__AWH_WEB_RELEASE_ID__', releaseId); if (rendered.includes('__AWH_WEB_RELEASE_ID__')) throw new Error('AWH web release identity was not rendered'); return rendered; }
function generatedAt(): string { const fixed = process.env.AWH_PREVIEW_GENERATED_AT; if (fixed !== undefined && Number.isFinite(Date.parse(fixed))) return fixed; return new Date().toISOString(); }
function withDashboard(index: string): string {
  if (!index.includes('</head>') || !index.includes('</body>')) throw new Error('AWH web shell cannot mount dashboard assets');
  return index
    .replace('</head>', '  <link rel="stylesheet" href="./dashboard.css?release=__AWH_WEB_RELEASE_ID__" />\n  <link rel="stylesheet" href="./responsive-layout.css?release=__AWH_WEB_RELEASE_ID__" />\n</head>')
    .replace('</body>', '  <script src="./vendor/pdf-lib.min.js?release=__AWH_WEB_RELEASE_ID__"></script>\n  <script src="./vendor/qrcode.js?release=__AWH_WEB_RELEASE_ID__"></script>\n  <script type="module" src="./dashboard.js?release=__AWH_WEB_RELEASE_ID__"></script>\n</body>');
}

async function main(): Promise<void> {
  const webMode = process.env.AWH_WEB_MODE === 'CONTROL' || process.argv.includes('--control') ? 'CONTROL' : 'UNAVAILABLE';
  const releaseId = process.env.AWH_WEB_RELEASE_ID ?? process.env.AWH_RELEASE_ID ?? 'local';
  if (!/^[A-Za-z0-9._-]{1,80}$/.test(releaseId)) throw new Error('AWH web release identity is invalid');
  const data = { schemaVersion: 1, generatedAt: generatedAt(), surface: { mode: webMode, label: 'AWH', status: webMode === 'CONTROL' ? 'Sign in to continue' : 'AWH release is not active' }, product: { name: PRODUCT.productName, shortName: PRODUCT.shortName, tagline: PRODUCT.tagline }, message: webMode === 'CONTROL' ? 'Sign in to access your projects and work.' : 'This AWH release is not configured for Control.' };
  const [index, styles, designSystem, responsiveLayout, app, navigation, dashboardCss, ownerCenterCss, automationCss, dashboardJs, ownerCenterJs, automationJs, dashboardGuardrails, executionUx, toolRegistry, schoolTools, hubAdapter, controlAdapter, manifest, serviceWorker, databaseHtml, databaseCss, databaseJs, infrastructureHtml, infrastructureCss, infrastructureJs, hostingHtml, hostingCss, hostingJs, trustHtml, trustCss, trustJs, pdfLib, qrCode] = await Promise.all([
    asset('index.html'), asset('styles.css'), asset('awh-design-system.css'), asset('responsive-layout.css'), asset('app.js'), asset('navigation.js'), asset('dashboard.css'), asset('owner-center.css'), asset('automation-surface.css'), asset('dashboard.js'), asset('owner-center.js'), asset('automation-surface.js'), asset('dashboard-guardrails.js'), asset('execution-ux.js'), asset('tool-registry.js'), asset('school-tools.js'), asset('hub-read-adapter.js'), asset('control-plane-adapter.js'), asset('manifest.webmanifest'), asset('sw.js'), asset('database.html'), asset('database.css'), asset('database.js'), asset('infrastructure.html'), asset('infrastructure.css'), asset('infrastructure.js'), asset('hosting.html'), asset('hosting.css'), asset('hosting.js'), asset('trust.html'), asset('trust.css'), asset('trust.js'),
    readFile(join(ROOT, 'node_modules', 'pdf-lib', 'dist', 'pdf-lib.min.js'), 'utf8'),
    readFile(join(ROOT, 'node_modules', 'qrcode-generator', 'qrcode.js'), 'utf8'),
  ]);
  await mkdir(OUTPUT, { recursive: true });
  await mkdir(join(OUTPUT, 'vendor'), { recursive: true });
  const bundledDashboardCss = `${dashboardCss}

/* Owner Center */
${ownerCenterCss}

/* Automations */
${automationCss}`;
  const bundledDashboardJs = `${dashboardJs}

/* Owner Center */
${ownerCenterJs}

/* Automations */
${automationJs}

/* Dashboard correctness guardrails */
${dashboardGuardrails}`;
  await Promise.all([
    writeFile(join(OUTPUT, 'index.html'), renderReleaseAsset(withDashboard(index), releaseId), 'utf8'),
    writeFile(join(OUTPUT, 'styles.css'), styles, 'utf8'),
    writeFile(join(OUTPUT, 'awh-design-system.css'), designSystem, 'utf8'),
    writeFile(join(OUTPUT, 'responsive-layout.css'), responsiveLayout, 'utf8'),
    writeFile(join(OUTPUT, 'app.js'), renderReleaseAsset(app, releaseId), 'utf8'),
    writeFile(join(OUTPUT, 'navigation.js'), renderReleaseAsset(navigation, releaseId), 'utf8'),
    writeFile(join(OUTPUT, 'dashboard.css'), bundledDashboardCss, 'utf8'),
    writeFile(join(OUTPUT, 'dashboard.js'), renderReleaseAsset(bundledDashboardJs, releaseId), 'utf8'),
    writeFile(join(OUTPUT, 'execution-ux.js'), renderReleaseAsset(executionUx, releaseId), 'utf8'),
    writeFile(join(OUTPUT, 'tool-registry.js'), renderReleaseAsset(toolRegistry, releaseId), 'utf8'),
    writeFile(join(OUTPUT, 'school-tools.js'), renderReleaseAsset(schoolTools, releaseId), 'utf8'),
    writeFile(join(OUTPUT, 'vendor', 'pdf-lib.min.js'), pdfLib, 'utf8'),
    writeFile(join(OUTPUT, 'vendor', 'qrcode.js'), qrCode, 'utf8'),
    writeFile(join(OUTPUT, 'hub-read-adapter.js'), renderReleaseAsset(hubAdapter, releaseId), 'utf8'),
    writeFile(join(OUTPUT, 'control-plane-adapter.js'), controlAdapter, 'utf8'),
    writeFile(join(OUTPUT, 'database.html'), renderReleaseAsset(databaseHtml, releaseId), 'utf8'),
    writeFile(join(OUTPUT, 'database.css'), databaseCss, 'utf8'),
    writeFile(join(OUTPUT, 'database.js'), renderReleaseAsset(databaseJs, releaseId), 'utf8'),
    writeFile(join(OUTPUT, 'infrastructure.html'), renderReleaseAsset(infrastructureHtml, releaseId), 'utf8'),
    writeFile(join(OUTPUT, 'infrastructure.css'), infrastructureCss, 'utf8'),
    writeFile(join(OUTPUT, 'infrastructure.js'), renderReleaseAsset(infrastructureJs, releaseId), 'utf8'),
    writeFile(join(OUTPUT, 'hosting.html'), renderReleaseAsset(hostingHtml, releaseId), 'utf8'),
    writeFile(join(OUTPUT, 'hosting.css'), hostingCss, 'utf8'),
    writeFile(join(OUTPUT, 'hosting.js'), renderReleaseAsset(hostingJs, releaseId), 'utf8'),
    writeFile(join(OUTPUT, 'trust.html'), renderReleaseAsset(trustHtml, releaseId), 'utf8'),
    writeFile(join(OUTPUT, 'trust.css'), trustCss, 'utf8'),
    writeFile(join(OUTPUT, 'trust.js'), renderReleaseAsset(trustJs, releaseId), 'utf8'),
    writeFile(join(OUTPUT, 'manifest.webmanifest'), manifest, 'utf8'),
    writeFile(join(OUTPUT, 'sw.js'), renderReleaseAsset(serviceWorker, releaseId), 'utf8'),
    copyFile(join(ROOT, 'logo-256x256.png'), join(OUTPUT, 'logo-256x256.png')),
    writeFile(join(OUTPUT, 'web-config.json'), `${JSON.stringify({ schemaVersion: 1, mode: webMode, apiBase: webMode === 'CONTROL' ? '/api/v1' : null }, null, 2)}\n`, 'utf8'),
    writeFile(join(OUTPUT, 'data.json'), `${JSON.stringify(data, null, 2)}\n`, 'utf8'),
  ]);
  console.log(`AWH web preview built at ${OUTPUT}`);
}

await main();
