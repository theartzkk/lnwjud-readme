const $ = (id) => document.getElementById(id);
const state = { csrf: null, overview: null, tables: [], selectedTable: null, browse: null, schema: null, page: 1, search: '', sort: null, direction: 'ASC' };

function el(tag, className = '', text = '') { const node = document.createElement(tag); if (className) node.className = className; if (text !== '') node.textContent = text; return node; }
function number(value) { return Number.isFinite(Number(value)) ? Number(value).toLocaleString('th-TH') : '—'; }
function bytes(value) { const n = Number(value); if (!Number.isFinite(n) || n < 0) return '—'; if (n < 1024) return `${n} B`; if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`; if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`; return `${(n / 1024 ** 3).toFixed(2)} GB`; }
function setStatus(text, className = '') { $('connection-state').textContent = text; $('connection-state').className = `pill ${className}`.trim(); }
function qs(params) { const query = new URLSearchParams(); for (const [key, value] of Object.entries(params)) if (value !== null && value !== undefined && value !== '') query.set(key, String(value)); return query.toString(); }

async function studioApi(action, params = {}, options = {}) {
  const url = `/database-studio.php?${qs({ action, ...params })}`;
  const headers = new Headers(options.headers || {}); headers.set('Accept', 'application/json');
  if (options.body !== undefined) headers.set('Content-Type', 'application/json');
  if (options.method === 'POST' && state.csrf) headers.set('X-AWH-CSRF', state.csrf);
  const response = await fetch(url, { method: options.method || 'GET', body: options.body, headers, credentials: 'include', cache: 'no-store' });
  const text = await response.text(); let value;
  try { value = JSON.parse(text); } catch { throw new Error('Database Studio ตอบกลับไม่ถูกต้อง'); }
  if (!response.ok) { const error = new Error(value?.message || 'Database Studio ไม่สามารถดำเนินการได้'); error.code = value?.code; throw error; }
  return value;
}

async function authenticate() {
  const response = await fetch('/api/v1/auth/session', { credentials: 'include', cache: 'no-store', headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error('กรุณาเข้าสู่ AWH ด้วยบัญชี Owner ก่อน');
  const value = await response.json();
  if (value?.role !== 'OWNER') throw new Error('Database Studio ใช้ได้เฉพาะ Owner');
  if (typeof value?.csrfToken === 'string') state.csrf = value.csrfToken;
}

function renderOverview() {
  const data = state.overview; const host = $('overview-cards'); host.replaceChildren();
  const cards = [
    ['ขนาดฐานข้อมูล', bytes(data.database?.sizeBytes)],
    ['ตาราง', number(data.summary?.tables)],
    ['รายการที่เปิดดูได้', number(data.summary?.visibleRows)],
    ['Schema version', `v${number(data.database?.schemaVersion)}`],
    ['Journal', String(data.database?.journalMode || '—').toUpperCase()],
  ];
  for (const [label, value] of cards) { const card = el('div', 'metric-card'); card.append(el('span', '', label), el('strong', '', value)); host.append(card); }
  const healthy = data.health?.quickCheck === 'ok' && data.database?.foreignKeysEnabled === true;
  const banner = $('health-banner'); banner.className = `health-banner ${healthy ? 'good' : ''}`; banner.textContent = healthy ? `✓ ฐานข้อมูลตอบสนองปกติ · WAL ${bytes(data.database?.walBytes)} · Foreign Key เปิดอยู่` : 'ควรตรวจสุขภาพฐานข้อมูลเพิ่มเติม';
}

function renderTableList() {
  const filter = $('table-filter').value.trim().toLowerCase(); const host = $('table-list'); host.replaceChildren();
  for (const table of state.tables.filter((row) => row.name.toLowerCase().includes(filter))) {
    const button = el('button', `table-item ${table.locked ? 'locked' : ''} ${state.selectedTable === table.name ? 'active' : ''}`.trim()); button.type = 'button';
    const name = el('span', '', table.locked ? `🔒 ${table.name}` : table.name); const count = el('small', '', table.locked ? 'ล็อก' : number(table.rowCount)); button.append(name, count);
    button.addEventListener('click', () => selectTable(table)); host.append(button);
  }
}

async function selectTable(table) {
  state.selectedTable = table.name; state.page = 1; state.search = ''; state.sort = null; state.direction = 'ASC'; renderTableList();
  $('table-title').textContent = table.name; $('table-meta').textContent = table.locked ? 'ตารางป้องกันข้อมูลอ่อนไหว' : `${number(table.rowCount)} รายการ`;
  $('table-empty').hidden = true; $('locked-table').hidden = !table.locked; $('table-browser').hidden = table.locked; $('export-actions').hidden = table.locked;
  if (table.locked) return;
  $('browse-search').value = ''; await loadTable();
}

async function loadTable() {
  if (!state.selectedTable) return;
  const data = await studioApi('browse', { table: state.selectedTable, q: state.search, page: state.page, limit: 50, sort: state.sort, dir: state.direction });
  state.browse = data; state.sort = data.sort; state.direction = data.direction;
  const schema = await studioApi('schema', { table: state.selectedTable }); state.schema = schema;
  renderBrowse(); renderSchema();
}

function renderBrowse() {
  const data = state.browse; const sort = $('browse-sort'); sort.replaceChildren();
  for (const column of data.columns || []) { const option = el('option', '', `${column.primaryKey ? '◆ ' : ''}${column.name}${column.redacted ? ' · ซ่อน' : ''}`); option.value = column.name; option.selected = column.name === data.sort; sort.append(option); }
  $('browse-direction').value = data.direction || 'ASC'; $('table-meta').textContent = `${number(data.totalRows)} รายการ · หน้า ${number(data.page)} / ${number(data.totalPages)}`;
  renderGrid($('browse-grid'), data.columns?.map((column) => column.name) || [], data.rows || [], new Set((data.columns || []).filter((column) => column.redacted).map((column) => column.name)));
  $('page-label').textContent = `หน้า ${data.page} จาก ${data.totalPages}`; $('page-prev').disabled = data.page <= 1; $('page-next').disabled = data.page >= data.totalPages;
}

function renderGrid(host, columns, rows, redacted = new Set()) {
  host.replaceChildren(); if (!rows.length) { const empty = el('div', 'empty-state', 'ไม่พบข้อมูล'); host.append(empty); return; }
  const table = el('table', 'data-grid'); const head = document.createElement('thead'); const hr = document.createElement('tr');
  for (const name of columns) hr.append(el('th', '', name)); head.append(hr); table.append(head); const body = document.createElement('tbody');
  for (const row of rows) { const tr = document.createElement('tr'); for (const name of columns) { const value = row?.[name]; const td = el('td', redacted.has(name) ? 'redacted' : '', value === null ? 'NULL' : typeof value === 'object' ? JSON.stringify(value) : String(value)); tr.append(td); } body.append(tr); }
  table.append(body); host.append(table);
}

function renderSchema() {
  const schema = state.schema; const host = $('schema-view'); host.replaceChildren(); if (!schema || schema.locked) return;
  const grid = el('div', 'schema-grid');
  const columns = el('div', 'schema-box'); columns.append(el('h3', '', 'Columns')); const columnList = document.createElement('ul');
  for (const c of schema.columns || []) columnList.append(el('li', c.redacted ? 'redacted' : '', `${c.primaryKey ? 'PK · ' : ''}${c.name} · ${c.type || 'ANY'}${c.notNull ? ' · NOT NULL' : ''}${c.redacted ? ' · ซ่อนข้อมูล' : ''}`)); columns.append(columnList);
  const indexes = el('div', 'schema-box'); indexes.append(el('h3', '', 'Indexes')); const indexList = document.createElement('ul');
  for (const i of schema.indexes || []) indexList.append(el('li', '', `${i.unique ? 'UNIQUE · ' : ''}${i.name} (${(i.columns || []).join(', ')})`)); if (!(schema.indexes || []).length) indexList.append(el('li', '', 'ไม่มี index เพิ่มเติม')); indexes.append(indexList);
  const foreign = el('div', 'schema-box'); foreign.append(el('h3', '', 'Foreign Keys')); const foreignList = document.createElement('ul');
  for (const f of schema.foreignKeys || []) foreignList.append(el('li', '', `${f.from} → ${f.table}.${f.to} · DELETE ${f.onDelete}`)); if (!(schema.foreignKeys || []).length) foreignList.append(el('li', '', 'ไม่มี foreign key')); foreign.append(foreignList);
  grid.append(columns, indexes, foreign); host.append(grid);
}

async function downloadExport(format) {
  if (!state.selectedTable) return;
  const data = await studioApi('export', { table: state.selectedTable, format, q: state.search, sort: state.sort, dir: state.direction });
  const blob = new Blob([data.content], { type: data.mimeType || 'application/octet-stream' }); const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = data.filename || `${state.selectedTable}.${format}`; document.body.append(link); link.click(); link.remove(); URL.revokeObjectURL(url);
}

async function runSql(explain) {
  const sql = $('sql-input').value.trim(); if (!sql) return;
  $('sql-status').className = 'form-status'; $('sql-status').textContent = explain ? 'กำลังสร้าง Query Plan…' : 'กำลังอ่านข้อมูล…'; $('sql-run').disabled = true; $('sql-explain').disabled = true;
  try {
    const data = await studioApi('query', {}, { method: 'POST', body: JSON.stringify({ schemaVersion: 1, sql, explain }) });
    $('sql-status').className = 'form-status good'; $('sql-status').textContent = `${data.mode} · ${number(data.rowCount)} แถว · ${number(data.durationMs)} ms${data.truncated ? ' · แสดงสูงสุด 200 แถว' : ''}`;
    renderGrid($('sql-result'), data.columns || [], data.rows || []);
  } catch (error) {
    $('sql-status').className = 'form-status error'; $('sql-status').textContent = error?.code === 'STEP_UP_REQUIRED' ? 'ต้องยืนยันรหัสผ่าน Owner อีกครั้งใน AWH ก่อนใช้ SQL Console' : (error?.message || 'SQL ทำงานไม่สำเร็จ'); $('sql-result').replaceChildren();
  } finally { $('sql-run').disabled = false; $('sql-explain').disabled = false; }
}

async function loadHealth() {
  const data = await studioApi('health'); const host = $('health-view'); host.replaceChildren(); const grid = el('div', 'status-grid');
  const integrity = el('div', 'status-card'); integrity.append(el('strong', data.integrity?.status === 'PASS' ? '✓ Integrity PASS' : '⚠ Integrity REVIEW', data.integrity?.status === 'PASS' ? 'good-text' : 'warn-text'), el('div', 'subtle', (data.integrity?.messages || []).join(' · ')));
  const fk = el('div', 'status-card'); fk.append(el('strong', data.foreignKeys?.status === 'PASS' ? '✓ Foreign Key PASS' : '⚠ Foreign Key REVIEW', data.foreignKeys?.status === 'PASS' ? 'good-text' : 'warn-text'), el('div', 'subtle', data.foreignKeys?.status === 'PASS' ? 'ไม่พบ foreign-key violation' : `${number(data.foreignKeys?.violations?.length)} รายการที่ต้องตรวจ`));
  const journal = el('div', 'status-card'); journal.append(el('strong', '', `Journal · ${String(data.journalMode || '').toUpperCase()}`), el('div', 'subtle', data.foreignKeysEnabled ? 'Foreign keys เปิดใช้งาน' : 'Foreign keys ไม่ได้เปิด'));
  grid.append(integrity, fk, journal); host.append(grid);
  if ((data.foreignKeys?.violations || []).length) renderGrid(host, Object.keys(data.foreignKeys.violations[0]), data.foreignKeys.violations);
}

async function loadMigrations() {
  const data = await studioApi('migrations'); const host = $('migration-view'); host.replaceChildren();
  host.append(el('p', 'subtle', `SQLite user_version ${data.databaseUserVersion} · ledger ${number(data.ledger?.length)} รายการ · source SQL ${number(data.files?.length)} ไฟล์`));
  const list = el('div', 'migration-list');
  for (const row of data.ledger || []) { const item = el('div', 'migration-item'); item.append(el('strong', '', `${row.migrationId} · schema ${row.schemaVersion}`), el('div', 'subtle', row.appliedAt || ''), el('code', '', row.checksum || '')); list.append(item); }
  host.append(list);
  if ((data.files || []).length) { host.append(el('h3', '', 'Migration files ใน release')); const files = el('div', 'migration-list'); for (const file of data.files) { const item = el('div', 'migration-item'); item.append(el('strong', '', file.file), el('div', 'subtle', bytes(file.sizeBytes)), el('code', '', file.sha256 || '')); files.append(item); } host.append(files); }
}

async function loadAudit() {
  const data = await studioApi('audit', { limit: 50 }); const host = $('audit-view'); host.replaceChildren();
  if (!(data.streams || []).length) { host.append(el('div', 'empty-state', 'ยังไม่มี audit table ที่เปิดดูได้')); return; }
  const streams = el('div', 'audit-streams');
  for (const stream of data.streams) { const card = el('section', 'audit-stream'); card.append(el('h3', '', stream.table)); const grid = el('div', 'data-grid-wrap'); renderGrid(grid, (stream.columns || []).map((c) => c.name), stream.rows || [], new Set((stream.columns || []).filter((c) => c.redacted).map((c) => c.name))); card.append(grid); streams.append(card); }
  host.append(streams);
}

function showTab(name) {
  for (const button of document.querySelectorAll('.tab')) button.classList.toggle('active', button.dataset.tab === name);
  for (const panel of document.querySelectorAll('.tab-panel')) panel.hidden = panel.id !== `tab-${name}`;
  if (name === 'health') loadHealth().catch(showError); if (name === 'migrations') loadMigrations().catch(showError); if (name === 'audit') loadAudit().catch(showError);
}

function showError(error) { setStatus('ต้องตรวจสอบ'); const banner = $('health-banner'); banner.className = 'health-banner'; banner.textContent = error?.message || 'Database Studio ไม่สามารถโหลดข้อมูลได้'; }

async function refreshAll() {
  state.overview = await studioApi('overview'); const tables = await studioApi('tables'); state.tables = tables.tables || []; renderOverview(); renderTableList();
  if (state.selectedTable) { const current = state.tables.find((row) => row.name === state.selectedTable); if (current && !current.locked) await loadTable(); }
}

async function init() {
  try {
    await authenticate(); await refreshAll(); $('access-gate').hidden = true; $('studio').hidden = false; setStatus('Owner · พร้อม', 'ready');
  } catch (error) { $('gate-message').textContent = error?.message || 'Database Studio ยังไม่พร้อม'; setStatus('ยังไม่พร้อม'); return; }
  $('table-filter').addEventListener('input', renderTableList);
  $('browse-form').addEventListener('submit', async (event) => { event.preventDefault(); state.search = $('browse-search').value.trim(); state.sort = $('browse-sort').value || null; state.direction = $('browse-direction').value; state.page = 1; try { await loadTable(); } catch (error) { showError(error); } });
  $('page-prev').addEventListener('click', async () => { if (state.page > 1) { state.page--; await loadTable(); } }); $('page-next').addEventListener('click', async () => { if (state.browse && state.page < state.browse.totalPages) { state.page++; await loadTable(); } });
  $('export-csv').addEventListener('click', () => downloadExport('csv').catch(showError)); $('export-json').addEventListener('click', () => downloadExport('json').catch(showError));
  $('sql-run').addEventListener('click', () => runSql(false)); $('sql-explain').addEventListener('click', () => runSql(true));
  $('refresh-all').addEventListener('click', () => refreshAll().catch(showError)); $('health-refresh').addEventListener('click', () => loadHealth().catch(showError)); $('migration-refresh').addEventListener('click', () => loadMigrations().catch(showError)); $('audit-refresh').addEventListener('click', () => loadAudit().catch(showError));
  for (const button of document.querySelectorAll('.tab')) button.addEventListener('click', () => showTab(button.dataset.tab));
}

if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('./sw.js', { scope: './' }).catch(() => undefined);
init();
