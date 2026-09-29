import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const base = process.env.AWH_CHAT_FIXTURE_URL || 'http://127.0.0.1:4175/';
const chrome = process.env.AWH_CHROME_PATH;
const playwrightModule = process.env.AWH_PLAYWRIGHT_MODULE;
assert.ok(chrome, 'AWH_CHROME_PATH is required');
assert.ok(playwrightModule, 'AWH_PLAYWRIGHT_MODULE is required');
const { chromium } = await import(pathToFileURL(resolve(playwrightModule)).href);
const output = '.awh-local/review/chat-modern';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, executablePath: chrome });
const evidence = { scenarios: [], errors: [] };
let page;
try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
  page = await context.newPage();
  page.on('pageerror', (error) => evidence.errors.push(error.message));
  await page.goto(base);
  await page.locator('#public-login-open').click();
  await page.locator('#login-username').fill('reviewer');
  await page.locator('#login-password').fill('review-password');
  await page.locator('#login-form').evaluate((form) => form.requestSubmit());
  await page.locator('#ecosystem-home-view').waitFor({ state: 'visible' });
  await page.locator('#ecosystem-open-awh').click();
  await page.locator('#dashboard-command').waitFor({ state: 'visible' });
  await page.locator('#dashboard-command').fill('เริ่มแชททดสอบ');
  await page.locator('#dashboard-command-form').evaluate((form) => form.requestSubmit());
  await page.locator('.awh-chat-shell').waitFor({ state: 'visible' });
  assert.equal(await page.evaluate(() => document.body.classList.contains('awh-modern-chat-ready')), true);
  assert.equal(await page.locator('#goal-form').isVisible(), false);
  const initialStop = page.locator('.awh-stop-button');
  if (await initialStop.isVisible().catch(() => false)) {
    await initialStop.click();
    await initialStop.waitFor({ state: 'hidden' });
  }
  evidence.scenarios.push('modern assistant-ui island owns the visible Chat surface');
  const composer = page.locator('.awh-composer-input');
  await composer.fill('ช่วยตรวจโครงการนี้');
  await page.locator('.awh-send-button').click();
  await page.locator('.awh-user-message').last().waitFor({ state: 'visible' });
  await page.locator('.awh-task-card').waitFor({ state: 'visible' });
  await page.locator('.awh-stop-button').waitFor({ state: 'visible' });
  assert.doesNotMatch(await page.locator('.awh-chat-main').innerText(), /desktop_commander|github\.get_commit|playwright\.browser_navigate/i);
  await page.locator('.awh-stop-button').click();
  await page.locator('.awh-stop-button').waitFor({ state: 'hidden' });
  evidence.scenarios.push('task activity is grouped and stoppable without raw tool logs');

  await page.locator('#attachment-input').setInputFiles({
    name: 'evidence.png', mimeType: 'image/png',
    buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aP1cAAAAASUVORK5CYII=', 'base64'),
  });
  await page.locator('.awh-pending-files').waitFor({ state: 'visible' });
  assert.match(await page.locator('.awh-pending-files').innerText(), /evidence\.png/);
  evidence.scenarios.push('file/image attachment projects through the existing AWH authority');

  await composer.fill('ร่างที่ต้องอยู่หลังรีโหลด');
  await page.waitForTimeout(250);
  evidence.draftBeforeReload = await page.evaluate(() => ({
    conversationId: globalThis.AWH_CHAT_BRIDGE?.getSnapshot()?.conversation?.conversationId || null,
    composer: document.querySelector('.awh-composer-input')?.value || '',
    storage: Object.fromEntries(Object.entries(localStorage).filter(([key]) => key.startsWith('awh.chat.draft.v1:'))),
  }));
  await page.reload();
  await page.locator('.awh-chat-shell').waitFor({ state: 'visible' });
  await page.waitForFunction(() => Boolean(globalThis.AWH_CHAT_BRIDGE?.getSnapshot()?.conversation?.conversationId));
  await page.waitForFunction(() => document.querySelector('.awh-composer-input')?.value === 'ร่างที่ต้องอยู่หลังรีโหลด');
  evidence.draftAfterReload = await page.evaluate(() => ({
    conversationId: globalThis.AWH_CHAT_BRIDGE?.getSnapshot()?.conversation?.conversationId || null,
    composer: document.querySelector('.awh-composer-input')?.value || '',
    storage: Object.fromEntries(Object.entries(localStorage).filter(([key]) => key.startsWith('awh.chat.draft.v1:'))),
  }));
  assert.equal(await page.locator('.awh-composer-input').inputValue(), 'ร่างที่ต้องอยู่หลังรีโหลด');
  evidence.scenarios.push('draft persists across reload');
  await page.setViewportSize({ width: 1366, height: 900 });
  await page.locator('.awh-chat-search input').fill('ช่วยตรวจ');
  await page.waitForTimeout(350);
  assert.ok(await page.locator('.awh-thread-item').count() >= 1);
  await page.locator('.awh-thread-pin').first().click();
  assert.ok((await page.evaluate(() => JSON.parse(localStorage.getItem('awh.chat.pinned.v1') || '[]').length)) >= 1);
  evidence.scenarios.push('search and pin work without a parallel chat database');

  await page.locator('.awh-temp-chat').click();
  await page.locator('.awh-temporary-chip').waitFor({ state: 'visible' });
  const temporaryId = await page.evaluate(() => globalThis.AWH_CHAT_BRIDGE?.getSnapshot()?.conversation?.conversationId || null);
  assert.ok(temporaryId);
  assert.equal(await page.evaluate(() => globalThis.AWH_CHAT_BRIDGE?.getSnapshot()?.temporary), true);
  await page.locator('.awh-composer-input').fill('ร่างชั่วคราวที่ห้ามจำ');
  await page.waitForTimeout(250);
  const temporaryState = await page.evaluate((id) => ({
    draft: localStorage.getItem('awh.chat.draft.v1:' + id),
    listed: globalThis.AWH_CHAT_BRIDGE?.getSnapshot()?.conversations?.some((item) => item.conversationId === id) || false,
  }), temporaryId);
  assert.equal(temporaryState.draft, null);
  assert.equal(temporaryState.listed, false);
  await page.reload();
  await page.locator('.awh-chat-shell').waitFor({ state: 'visible' });
  await page.waitForFunction(() => Boolean(globalThis.AWH_CHAT_BRIDGE?.getSnapshot()?.conversation?.conversationId));
  assert.equal(await page.evaluate(() => globalThis.AWH_CHAT_BRIDGE?.getSnapshot()?.temporary), false);
  assert.notEqual(await page.evaluate(() => globalThis.AWH_CHAT_BRIDGE?.getSnapshot()?.conversation?.conversationId || null), temporaryId);
  evidence.scenarios.push('temporary chat stays out of history, draft storage and reload continuity');

  await page.locator('.awh-composer-input').fill('สร้างไฟล์ Word บันทึกข้อความ');
  await page.locator('.awh-send-button').click();
  await page.locator('.awh-artifact-card').waitFor({ state: 'visible' });
  assert.match(await page.locator('.awh-artifact-card').innerText(), /บันทึกข้อความ/);
  evidence.scenarios.push('artifact is rendered as a dedicated card');

  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('.awh-composer-input').focus();
  await page.setViewportSize({ width: 390, height: 500 });
  await page.waitForFunction(() => document.body.classList.contains('awh-keyboard-open'));
  const box = await page.locator('.awh-composer').boundingBox();
  assert.ok(box && box.y >= 0 && box.y + box.height <= 501);
  await page.screenshot({ path: output + '/mobile-keyboard.png' });
  evidence.scenarios.push('mobile keyboard keeps composer inside the visual viewport');

  assert.deepEqual(evidence.errors, []);
  evidence.result = 'PASS';
} catch (error) {
  evidence.result = 'FAIL'; evidence.failure = error.stack || String(error);
  if (page) await page.screenshot({ path: output + '/failure.png', fullPage: true }).catch(() => {});
  process.exitCode = 1;
} finally {
  await writeFile(output + '/manifest.json', JSON.stringify(evidence, null, 2));
  await browser.close();
  console.log(JSON.stringify(evidence, null, 2));
}
