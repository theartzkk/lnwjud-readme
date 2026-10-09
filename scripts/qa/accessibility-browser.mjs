import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const base = process.env.AWH_ACCESSIBILITY_FIXTURE_URL || process.env.AWH_CLOSURE_FIXTURE_URL || 'http://127.0.0.1:4174/';
const chrome = process.env.AWH_CHROME_PATH;
const playwrightModule = process.env.AWH_PLAYWRIGHT_MODULE;
const axeCorePath = process.env.AWH_AXE_CORE_PATH;
assert.ok(chrome, 'AWH_CHROME_PATH is required');
assert.ok(playwrightModule, 'AWH_PLAYWRIGHT_MODULE is required');
assert.ok(axeCorePath, 'AWH_AXE_CORE_PATH is required');

const { chromium } = await import(pathToFileURL(resolve(playwrightModule)).href);
const output = '.awh-local/review/accessibility';
const tags = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
const viewports = [
  { id: 'mobile-390', width: 390, height: 844 },
  { id: 'mobile-430', width: 430, height: 932 },
  { id: 'desktop-1366', width: 1366, height: 768 },
];
await mkdir(output, { recursive: true });

function compactViolation(violation) {
  return {
    id: violation.id,
    impact: violation.impact || 'unknown',
    help: violation.help,
    tags: Array.isArray(violation.tags) ? violation.tags.filter((tag) => /^wcag/i.test(tag)) : [],
    targets: (violation.nodes || []).slice(0, 5).map((node) => node.target),
  };
}

async function axeScan(page, surface, viewport) {
  await page.addScriptTag({ path: axeCorePath });
  const result = await page.evaluate(async (runTags) => {
    const report = await globalThis.axe.run(document, {
      runOnly: { type: 'tag', values: runTags },
      resultTypes: ['violations'],
    });
    return {
      testEngine: report.testEngine,
      testEnvironment: report.testEnvironment,
      violations: report.violations,
    };
  }, tags);
  return {
    surface,
    viewport: viewport.id,
    engine: result.testEngine?.version || null,
    violations: result.violations.map(compactViolation),
  };
}

const browser = await chromium.launch({ headless: true, executablePath: chrome });
const evidence = {
  schemaVersion: 1,
  standard: 'WCAG_AA',
  tags,
  surfaces: [],
  result: 'FAIL',
};

try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
  const page = await context.newPage();

  for (const viewport of viewports) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.goto(base, { waitUntil: 'networkidle' });
    evidence.surfaces.push(await axeScan(page, 'public-root', viewport));
  }

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(base, { waitUntil: 'networkidle' });
  await page.locator('#public-login-open').click();
  await page.locator('#login-username').fill('reviewer');
  await page.locator('#login-password').fill('review-password');
  await page.locator('#login-form').evaluate((form) => form.requestSubmit());
  await page.locator('#ecosystem-home-view').waitFor({ state: 'visible' });
  await page.locator('#ecosystem-open-awh').click();
  await page.locator('#dashboard-command').waitFor({ state: 'visible' });
  await page.locator('#dashboard-command').fill('เปิดพื้นที่ตรวจ accessibility');
  await page.locator('#dashboard-command-form').evaluate((form) => form.requestSubmit());
  await page.locator('.awh-chat-shell').waitFor({ state: 'visible' });

  for (const viewport of viewports) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    evidence.surfaces.push(await axeScan(page, 'workspace-chat', viewport));
  }

  const violations = evidence.surfaces.flatMap((entry) =>
    entry.violations.map((violation) => ({ surface: entry.surface, viewport: entry.viewport, ...violation })),
  );
  evidence.violationCount = violations.length;
  evidence.violations = violations;
  if (violations.length > 0) {
    const summary = violations.slice(0, 12).map((item) =>
      `${item.surface}/${item.viewport}: ${item.id} [${item.impact}] ${JSON.stringify(item.targets)}`,
    ).join('\n');
    throw new Error(`AWH_ACCESSIBILITY_GATE_FAILED violations=${violations.length}\n${summary}`);
  }
  evidence.result = 'PASS';
} catch (error) {
  evidence.failure = error instanceof Error ? error.stack || error.message : String(error);
  process.exitCode = 1;
} finally {
  await writeFile(output + '/manifest.json', JSON.stringify(evidence, null, 2) + '\n', 'utf8');
  await browser.close();
  console.log(JSON.stringify({
    result: evidence.result,
    standard: evidence.standard,
    scans: evidence.surfaces.length,
    violations: evidence.violationCount ?? evidence.violations?.length ?? null,
    output: output + '/manifest.json',
  }));
}
