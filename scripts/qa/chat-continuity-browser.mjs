// Real browser regression over the existing local-only control-web-fixture.
// Supply an installed Playwright module and browser; no dependency is downloaded.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
const base = process.env.AWH_CLOSURE_FIXTURE_URL || 'http://127.0.0.1:4174/';
assert.match(base, /^http:\/\/127\.0\.0\.1:\d+\/$/);
const playwrightModule = process.env.AWH_PLAYWRIGHT_MODULE;
const chromePath = process.env.AWH_CHROME_PATH;
assert.ok(playwrightModule, 'AWH_PLAYWRIGHT_MODULE is required; run the VPS browser QA runtime installer');
assert.ok(chromePath, 'AWH_CHROME_PATH is required; run the VPS browser QA runtime installer');
const { chromium } = await import(pathToFileURL(resolve(playwrightModule)).href);
const output = resolve('.awh-local/review/product-closure');
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, executablePath: chromePath });
const evidence = { commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), dirty: !!execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim(), environment: 'local-contract-fixture', scenarios: [], errors: [] };
let page;
try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
  page = await context.newPage();
  console.log("browser ready");
  page.setDefaultTimeout(30000);
  page.on('console', (entry) => { if (entry.type() === 'error') (evidence.consoleErrors ||= []).push(entry.text()); });
  page.on('pageerror', (error) => evidence.errors.push(error.message));
  await page.goto(base);
  await page.locator('#public-login-open').click();
  await page.locator('#login-username').fill('reviewer');
  await page.locator('#login-password').fill('review-password');
  await page.locator('#login-form').evaluate((form) => form.requestSubmit());
  await page.locator('#ecosystem-home-view').waitFor({ state: 'visible' });
  await page.locator('#ecosystem-open-awh').click();
  await page.locator('#dashboard-command').waitFor({ state: 'visible' });
  await page.locator('#dashboard-command').fill('นายคือใคร');
  await page.locator('#dashboard-command-form').evaluate((form) => form.requestSubmit());
  await page.waitForFunction(() => document.querySelectorAll('#work-thread .user-turn').length > 0 && document.querySelector('#goal-submit')?.disabled === false);
  await page.locator('#goal-input').fill('ร่างที่ต้องอยู่ครบ');
  await page.evaluate(() => { window.closureRow = document.querySelector('#work-thread .user-turn'); window.closureCopy = window.closureRow.querySelector('button'); window.closureCopy.focus(); });
  await page.waitForTimeout(4500);
  assert.equal(await page.evaluate(() => window.closureRow === document.querySelector('#work-thread .user-turn') && document.activeElement === window.closureCopy), true, 'poll preserves message node and focus after fresh login');
  evidence.scenarios.push('fresh-login polling preserves message DOM and focus');
  // Navigating to tasks and back must preserve draft and history.
  await page.evaluate(() => document.querySelector('[data-mobile-destination="tasks"], [data-product-destination="tasks"]')?.click());
  await page.goBack();
  await page.locator('#goal-input').waitFor({ state: 'visible' });
  assert.equal(await page.locator('#goal-input').inputValue(), 'ร่างที่ต้องอยู่ครบ');
  evidence.scenarios.push('back navigation preserves composer draft');
  await page.locator('#conversation-open').click();
  await page.locator('#conversation-title-input').fill('ชื่อห้องที่กำลังแก้');
  await page.waitForTimeout(4500);
  assert.equal(await page.locator('#conversation-title-input').inputValue(), 'ชื่อห้องที่กำลังแก้');
  await page.keyboard.press('Escape');
  await page.locator('#conversation-sheet').waitFor({ state: 'hidden' });
  assert.equal(await page.evaluate(() => document.body.classList.contains('awh-overlay-open')), false);
  evidence.scenarios.push('room title editing and Escape preserve focus/overlay ownership');
  // A read failure must leave the last confirmed conversation visible.
  const text = await page.locator('#work-thread').innerText();
  await page.route('**/api/v1/control/conversations/thread/**', (route) => route.request().method() === 'GET' ? route.abort() : route.continue());
  await page.waitForTimeout(4500);
  assert.equal(await page.locator('#work-thread').innerText(), text);
  await page.unroute('**/api/v1/control/conversations/thread/**');
  evidence.scenarios.push('failed read preserves confirmed history');
  for (const width of [320, 390, 430, 820, 1366, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    for (const surface of ['home', 'work', 'tasks', 'files']) {
      console.log(`checking ${surface} ${width}`);
      await page.goto(`${base}?awh-surface=${surface}`);
      await page.waitForFunction((surface) => surface === 'work' ? !document.querySelector('#goal-input')?.disabled && !document.body.classList.contains('product-dashboard-active') : document.querySelector('#product-dashboard')?.dataset.view === surface && document.body.classList.contains('product-dashboard-active'), surface);
      await page.waitForTimeout(250);
      const metrics = await page.evaluate(() => ({ width: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth, visibleNavs: [...document.querySelectorAll('.awh-mobile-nav')].filter((el) => el.getBoundingClientRect().height > 0).length }));
      assert.ok(metrics.scroll <= metrics.width, `${surface} ${width}: horizontal overflow ${metrics.scroll}`);
      await page.screenshot({ path: `${output}/${surface}-${width}.png`, fullPage: true });
      evidence.scenarios.push({ surface, width, ...metrics });
      console.log(`${surface} ${width}: no overflow`);
    }
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${base}?awh-surface=work`);
  await page.waitForFunction(() => !document.querySelector('#goal-input').disabled);
  await page.locator('#attachment-input').setInputFiles([
    { name: 'original.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aP1cAAAAASUVORK5CYII=', 'base64') },
    { name: 'original.heic', mimeType: 'image/heic', buffer: Buffer.from('unchanged-heic-fixture') },
  ]);
  assert.equal(await page.locator('#pending-attachments li').count(), 2);
  assert.equal(await page.locator('#pending-attachments img').count(), 1);
  await page.waitForFunction(() => document.querySelector('#pending-attachments img')?.naturalWidth > 0);
  await page.locator('#goal-input').fill('ข้อความก่อนเปิดแป้นพิมพ์');
  await page.setViewportSize({ width: 390, height: 500 });
  await page.waitForFunction(() => document.body.classList.contains('awh-keyboard-open'));
  const keyboard = await page.locator('#goal-form').boundingBox();
  assert.ok(keyboard.y >= 0 && keyboard.y + keyboard.height <= 501, 'composer inside visual viewport');
  await page.screenshot({ path: `${output}/keyboard-390.png` });
  evidence.scenarios.push('390px keyboard resize keeps composer and original attachment previews reachable');
  await page.setViewportSize({ width: 430, height: 844 });
  await page.locator('#goal-input').blur();
  await page.locator('#goal-input').focus();
  await page.setViewportSize({ width: 430, height: 500 });
  await page.waitForFunction(() => document.body.classList.contains('awh-keyboard-open'));
  const keyboard430 = await page.locator('#goal-form').boundingBox();
  assert.ok(keyboard430.y >= 0 && keyboard430.y + keyboard430.height <= 501);
  await page.screenshot({ path: `${output}/keyboard-430.png` });
  evidence.scenarios.push('430px keyboard resize keeps composer reachable');
  await page.setViewportSize({ width: 390, height: 844 });
  while (await page.locator('#pending-attachments button').count()) await page.locator('#pending-attachments button').first().click();
  await page.locator('#goal-input').fill('ช่วยตรวจโครงการนี้');
  await page.locator('#goal-form').evaluate((form) => form.requestSubmit());
  await page.locator('#goal-stop').waitFor({ state: 'visible' });
  await page.reload();
  await page.locator('#goal-stop').waitFor({ state: 'visible' });
  await page.locator('#goal-stop').click();
  await page.locator('#goal-stop').waitFor({ state: 'hidden' });
  evidence.scenarios.push('canonical queued task survives reload and can be stopped');
  assert.deepEqual(evidence.errors, []);
  const unexpectedConsole = (evidence.consoleErrors || []).filter((message) => !/401|net::ERR_FAILED/.test(message));
  assert.deepEqual(unexpectedConsole, [], 'no unexpected console errors outside auth and injected failed reads');
  evidence.result = 'PASS';
} catch (error) { if (page) { await page.screenshot({ path: `${output}/failure.png`, fullPage: true }).catch(() => {}); evidence.visibleText = await page.locator('body').innerText().catch(() => ''); evidence.uiState = await page.evaluate(() => ({ url: location.href, bodyClass: document.body.className, view: document.querySelector('#product-dashboard')?.dataset.view })).catch(() => null); } evidence.result = 'FAIL'; evidence.failure = error.stack; process.exitCode = 1; }
finally { await writeFile(`${output}/manifest.json`, JSON.stringify(evidence, null, 2)); await browser.close(); console.log(JSON.stringify(evidence, null, 2)); }
