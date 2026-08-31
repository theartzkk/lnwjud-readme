const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const baseUrl = process.argv[2];
const outputDir = path.resolve(process.argv[3] || '.awh-local/review/screens');
const viewport = process.argv[4] || '390x844';
const [width, height] = viewport.split('x').map(Number);
if (!/^http:\/\/127\.0\.0\.1:\d+\/$/.test(baseUrl || '')) throw new Error('review base URL is invalid');
if (!Number.isInteger(width) || !Number.isInteger(height) || width < 320 || height < 600) throw new Error('review viewport is invalid');
fs.mkdirSync(outputDir, { recursive: true, mode: 0o700 });

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function waitFor(win, expression, timeout = 10000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    if (await win.webContents.executeJavaScript(`Boolean(${expression})`, true)) return;
    await sleep(100);
  }
  throw new Error(`timeout waiting for ${expression}`);
}
async function shot(win, id, expected, action) {
  await sleep(250);
  const metrics = await win.webContents.executeJavaScript(`({innerWidth,clientWidth:document.documentElement.clientWidth,scrollWidth:document.documentElement.scrollWidth,bodyText:document.body.innerText.slice(0,4000)})`, true);
  const png = await win.webContents.capturePage();
  fs.writeFileSync(path.join(outputDir, `${id}-${width}x${height}.png`), png.toPNG(), { mode: 0o600 });
  return { id, viewport: { width, height }, expected, action, horizontalOverflow: metrics.scrollWidth > metrics.clientWidth, capturedAt: new Date().toISOString() };
}
async function login(win) {
  await win.loadURL(baseUrl);
  await waitFor(win, `document.querySelector('#login-form')`);
  await win.webContents.executeJavaScript(`(() => { document.querySelector('#login-username').value='reviewer'; document.querySelector('#login-password').value='review-password'; document.querySelector('#login-form').requestSubmit(); })()`, true);
  await waitFor(win, `document.querySelector('#product-dashboard') && !document.querySelector('#product-dashboard').hidden`, 15000);
  await sleep(350);
}
async function submitHome(win, prompt) {
  await waitFor(win, `document.querySelector('#dashboard-command')`);
  await win.webContents.executeJavaScript(`(() => { const el=document.querySelector('#dashboard-command'); el.value=${JSON.stringify(prompt)}; el.dispatchEvent(new Event('input',{bubbles:true})); document.querySelector('#dashboard-command-form').requestSubmit(); })()`, true);
  await waitFor(win, `document.querySelector('#workspace-view') && !document.querySelector('#workspace-view').hidden`, 10000);
  await sleep(500);
}
async function submitWork(win, prompt) {
  await waitFor(win, `document.querySelector('#goal-input')`);
  await win.webContents.executeJavaScript(`(() => { const el=document.querySelector('#goal-input'); el.value=${JSON.stringify(prompt)}; el.dispatchEvent(new Event('input',{bubbles:true})); document.querySelector('#goal-form').requestSubmit(); })()`, true);
  await sleep(700);
}
async function returnHome(win) {
  const exists = await win.webContents.executeJavaScript(`Boolean(document.querySelector('#dashboard-home-button'))`, true);
  if (exists) await win.webContents.executeJavaScript(`document.querySelector('#dashboard-home-button').click()`, true);
  await waitFor(win, `document.querySelector('#product-dashboard') && !document.querySelector('#product-dashboard').hidden`, 10000);
  await sleep(250);
}
app.whenReady().then(async () => {
  const win = new BrowserWindow({ width, height, show: false, webPreferences: { sandbox: true, contextIsolation: true } });
  const evidence = [];
  try {
    await win.loadURL(baseUrl);
    await waitFor(win, `document.querySelector('#registration-open')`);
    await win.webContents.executeJavaScript(`document.querySelector('#registration-open').click()`, true);
    await waitFor(win, `document.querySelector('#registration-sheet') && !document.querySelector('#registration-sheet').hidden`);
    evidence.push(await shot(win, 'registration-request', 'self-service access request is readable and touch-safe; no privilege choice is exposed', 'open public account request form'));
    await login(win);
    evidence.push(await shot(win, 'home-empty', 'real composer immediately usable; no backend language; three mobile destinations maximum', 'authenticated home'));
    await win.webContents.executeJavaScript(`document.querySelector('#account-open').click()`, true);
    await waitFor(win, `document.querySelector('#account-sheet') && !document.querySelector('#account-sheet').hidden`);
    await win.webContents.executeJavaScript(`document.querySelector('[data-settings-tab=\"people\"]').click()`, true);
    await waitFor(win, `document.querySelector('#settings-panel-people') && !document.querySelector('#settings-panel-people').hidden && document.querySelector('#account-request-list')`, 10000);
    evidence.push(await shot(win, 'owner-accounts', 'Owner can create people and review pending requests with role/project assignment in one bounded settings surface', 'open Owner people settings'));
    await win.loadURL(baseUrl);
    await login(win);
    await submitHome(win, 'นายคือใคร');
    evidence.push(await shot(win, 'question-identity', 'direct conversational answer; no task-status substitute', 'ask a normal identity question'));
    await returnHome(win);
    await submitHome(win, 'ตรวจข้อมูลนี้แล้วสรุปประเด็นสำคัญให้หน่อย');
    evidence.push(await shot(win, 'work-progress', 'one human progress surface with expandable steps and Stop while cancellable', 'start bounded read-only work'));
    await submitWork(win, 'ทำบันทึกข้อความขออนุมัติเป็นไฟล์ Word');
    evidence.push(await shot(win, 'document-artifact', 'artifact card appears in conversation with open/download/continue actions', 'request a Word deliverable'));
    await returnHome(win);
    await win.webContents.executeJavaScript(`document.querySelector('#awh-home-tools')?.scrollIntoView({block:'start'})`, true);
    evidence.push(await shot(win, 'tools-shortcuts', 'tools are shortcuts; chat remains the primary path', 'inspect tools shortcuts'));
    await win.loadURL(baseUrl + 'hosting.html');
    await waitFor(win, `document.querySelector('#site-list') && document.querySelector('#hosting-state')?.textContent.includes('เชื่อมต่อแล้ว')`, 10000);
    evidence.push(await shot(win, 'managed-hosting', 'Owner can see managed site state, URL, runtime, database, backup and bounded actions without VPS commands', 'open managed hosting'));
    fs.writeFileSync(path.join(outputDir, `evidence-${width}x${height}.json`), JSON.stringify({ schemaVersion: 1, source: 'local-contract-fixture', baseUrl, viewport: { width, height }, evidence }, null, 2) + '\n', { mode: 0o600 });
    if (evidence.some((item) => item.horizontalOverflow)) process.exitCode = 2;
  } finally {
    win.destroy();
    app.quit();
  }
}).catch((error) => { console.error(error?.stack || error); process.exitCode = 1; app.quit(); });
