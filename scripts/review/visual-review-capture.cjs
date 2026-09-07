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
  await win.webContents.executeJavaScript(`document.documentElement.offsetHeight`, true);
  if (typeof win.webContents.invalidate === 'function') win.webContents.invalidate();
  await sleep(100);
  const metrics = await win.webContents.executeJavaScript(`({innerWidth,clientWidth:document.documentElement.clientWidth,scrollWidth:document.documentElement.scrollWidth,bodyText:document.body.innerText.slice(0,4000),activeSettings:[...document.querySelectorAll('.settings-panel')].find((el)=>!el.hidden)?.id||null,hostingSummary:document.querySelector('#hosting-summary')?.textContent||null,siteCount:document.querySelector('#site-list')?.children.length??null})`, true);
  const png = await win.webContents.capturePage();
  fs.writeFileSync(path.join(outputDir, `${id}-${width}x${height}.png`), png.toPNG(), { mode: 0o600 });
  return { id, viewport: { width, height }, expected, action, horizontalOverflow: metrics.scrollWidth > metrics.clientWidth, activeSettings: metrics.activeSettings, hostingSummary: metrics.hostingSummary, siteCount: metrics.siteCount, capturedAt: new Date().toISOString() };
}
async function login(win) {
  await win.loadURL(baseUrl);
  await waitFor(win, `document.querySelector('#login-form')`);
  await win.webContents.executeJavaScript(`(() => { document.querySelector('#login-username').value='reviewer'; document.querySelector('#login-password').value='review-password'; document.querySelector('#login-form').requestSubmit(); })()`, true);
  await waitFor(win, `document.querySelector('#ecosystem-home-view') && !document.querySelector('#ecosystem-home-view').hidden`, 15000);
  await waitFor(win, `document.querySelectorAll('#ecosystem-project-grid .ecosystem-project-card').length >= 4`, 15000);
  await sleep(350);
}
async function openAwhWorkspace(win) {
  await win.webContents.executeJavaScript(`(() => { const cards=[...document.querySelectorAll('#ecosystem-project-grid .ecosystem-project-card')]; const card=cards.find((item)=>item.textContent.includes('AWH Workspace')); const button=card?.querySelector('.ecosystem-project-action'); if(!button) throw new Error('AWH Workspace action missing'); button.click(); })()`, true);
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
  await waitFor(win, `document.querySelector('#ecosystem-home-view') && !document.querySelector('#ecosystem-home-view').hidden`, 10000);
  await sleep(250);
}
app.whenReady().then(async () => {
  const win = new BrowserWindow({ width, height, show: false, webPreferences: { sandbox: true, contextIsolation: true, backgroundThrottling: false } });
  const evidence = [];
  const runtimeErrors = [];
  win.webContents.on('console-message', (...args) => { const details=args.at(-1); const level=typeof details==='object' && details ? details.level : args[1]; const message=typeof details==='object' && details ? details.message : args[2]; if (level === 'error' || level === 3) runtimeErrors.push(String(message || 'browser console error')); });
  win.webContents.on('did-fail-load', (_event, code, description, validatedURL, isMainFrame) => { if (isMainFrame !== false) runtimeErrors.push(`did-fail-load ${code} ${description} ${validatedURL}`); });
  try {
    await win.loadURL(baseUrl);
    await waitFor(win, `document.querySelector('#registration-open')`);
    await win.webContents.executeJavaScript(`document.querySelector('#registration-open').click()`, true);
    await waitFor(win, `document.querySelector('#registration-sheet') && !document.querySelector('#registration-sheet').hidden`);
    evidence.push(await shot(win, 'registration-request', 'self-service access request is readable and touch-safe; no privilege choice is exposed', 'open public account request form'));
    await login(win);
    evidence.push(await shot(win, 'root-portfolio', 'authenticated root is the project portfolio hub and renders BAY registry cards without runtime errors', 'authenticated portfolio root'));
    await openAwhWorkspace(win);
    evidence.push(await shot(win, 'home-empty', 'AWH Workspace keeps its operational dashboard behind the portfolio root', 'open AWH Workspace'));
    await win.webContents.executeJavaScript(`document.querySelector('#account-open').click()`, true);
    await waitFor(win, `document.querySelector('#account-sheet') && !document.querySelector('#account-sheet').hidden && document.querySelector('[data-settings-tab=\"people\"]') && !document.querySelector('[data-settings-tab=\"people\"]').hidden`, 10000);
    await waitFor(win, `document.querySelector('#account-request-list') && document.querySelector('#account-request-list').children.length > 0`, 10000);
    await win.webContents.executeJavaScript(`document.querySelector('[data-settings-tab=\"people\"]').click()`, true);
    await waitFor(win, `document.querySelector('#settings-panel-people') && !document.querySelector('#settings-panel-people').hidden && document.querySelector('#settings-panel-start').hidden`, 10000);
    await win.webContents.executeJavaScript(`document.querySelector('#settings-panel-people').scrollIntoView({block:'start'})`, true);
    evidence.push(await shot(win, 'owner-accounts', 'Owner can create people and review pending requests with role/project assignment in one bounded settings surface', 'open Owner people settings'));
    await login(win);
    await openAwhWorkspace(win);
    await submitHome(win, 'นายคือใคร');
    evidence.push(await shot(win, 'question-identity', 'direct conversational answer; no task-status substitute', 'ask a normal identity question'));
    await returnHome(win);
    await openAwhWorkspace(win);
    await submitHome(win, 'ตรวจข้อมูลนี้แล้วสรุปประเด็นสำคัญให้หน่อย');
    evidence.push(await shot(win, 'work-progress', 'one human progress surface with expandable steps and Stop while cancellable', 'start bounded read-only work'));
    await submitWork(win, 'ทำบันทึกข้อความขออนุมัติเป็นไฟล์ Word');
    evidence.push(await shot(win, 'document-artifact', 'artifact card appears in conversation with open/download/continue actions', 'request a Word deliverable'));
    await returnHome(win);
    await openAwhWorkspace(win);
    await win.webContents.executeJavaScript(`document.querySelector('#awh-home-tools')?.scrollIntoView({block:'start'})`, true);
    evidence.push(await shot(win, 'tools-shortcuts', 'tools are shortcuts; chat remains the primary path', 'inspect tools shortcuts'));
    await win.loadURL(baseUrl + 'hosting.html');
    await waitFor(win, `document.querySelector('#site-list') && ['พร้อมใช้งาน','เชื่อมต่อแล้ว'].some((label)=>document.querySelector('#hosting-state')?.textContent.includes(label))`, 10000);
    evidence.push(await shot(win, 'managed-hosting', 'Owner can see managed site state, URL, runtime, database, backup and bounded actions without VPS commands', 'open managed hosting'));
    fs.writeFileSync(path.join(outputDir, `evidence-${width}x${height}.json`), JSON.stringify({ schemaVersion: 1, source: 'local-contract-fixture', baseUrl, viewport: { width, height }, evidence, runtimeErrors }, null, 2) + '\n', { mode: 0o600 });
    if (runtimeErrors.length) { console.error(`browser runtime errors: ${runtimeErrors.join(' | ')}`); process.exitCode = 3; }
    else if (evidence.some((item) => item.horizontalOverflow)) process.exitCode = 2;
  } finally {
    win.destroy();
    app.quit();
  }
}).catch((error) => { console.error(error?.stack || error); process.exitCode = 1; app.quit(); });
