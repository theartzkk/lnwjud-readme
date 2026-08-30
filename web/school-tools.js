import { controlRequest, createProjectFactory, createSchoolDocument } from './control-plane-adapter.js?release=__AWH_WEB_RELEASE_ID__';

const PDF_FILE_LIMIT = 40 * 1024 * 1024;
const PDF_TOTAL_LIMIT = 100 * 1024 * 1024;
const IMAGE_PDF_MAX_FILES = 30;
const IMAGE_PDF_MARGIN = 28.35;
const A4_PORTRAIT = Object.freeze([595.28, 841.89]);
const QR_TEXT_LIMIT = 1600;
const $ = (id) => document.getElementById(id);

function safeName(value, fallback) {
  const text = String(value || '').replace(/\.[^.]+$/, '').replace(/[^\p{L}\p{N}._ -]+/gu, '_').trim();
  return text.slice(0, 80) || fallback;
}

function downloadBytes(bytes, mime, filename) {
  const blob = bytes instanceof Blob ? bytes : new Blob([bytes], { type: mime });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function pdfLib() {
  const value = globalThis.PDFLib;
  if (!value?.PDFDocument || !value?.degrees) throw new Error('เครื่องมือ PDF ยังโหลดไม่สมบูรณ์ กรุณารีเฟรชหน้า');
  return value;
}
function qrcodeLib() {
  const value = globalThis.qrcode;
  if (typeof value !== 'function') throw new Error('เครื่องมือ QR ยังโหลดไม่สมบูรณ์ กรุณารีเฟรชหน้า');
  return value;
}

function selectedFiles(inputId) {
  const input = $(inputId);
  return input instanceof HTMLInputElement ? Array.from(input.files || []) : [];
}

function assertPdfFiles(files, minimum = 1, maximum = 20) {
  if (files.length < minimum || files.length > maximum) throw new Error(`เลือกไฟล์ PDF ${minimum}-${maximum} ไฟล์`);
  let total = 0;
  for (const file of files) {
    if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) throw new Error('เลือกเฉพาะไฟล์ PDF');
    if (file.size > PDF_FILE_LIMIT) throw new Error(`ไฟล์ ${file.name} ใหญ่เกิน 40 MB`);
    total += file.size;
  }
  if (total > PDF_TOTAL_LIMIT) throw new Error('ไฟล์รวมกันใหญ่เกิน 100 MB');
}

function imagePdfKind(file) {
  const name = String(file?.name || '').toLowerCase();
  const type = String(file?.type || '').toLowerCase();
  if (type === 'image/png' || name.endsWith('.png')) return 'png';
  if (type === 'image/jpeg' || type === 'image/jpg' || name.endsWith('.jpg') || name.endsWith('.jpeg')) return 'jpg';
  return null;
}

function assertImagePdfFiles(files) {
  if (files.length < 1 || files.length > IMAGE_PDF_MAX_FILES) throw new Error(`เลือกรูป 1-${IMAGE_PDF_MAX_FILES} ไฟล์`);
  let total = 0;
  for (const file of files) {
    if (!imagePdfKind(file)) throw new Error('รวมเป็น PDF รองรับรูป JPG และ PNG ก่อน หากเป็นไฟล์ชนิดอื่นให้แปลงรูปก่อน');
    if (file.size > PDF_FILE_LIMIT) throw new Error(`ไฟล์ ${file.name} ใหญ่เกิน 40 MB`);
    total += file.size;
  }
  if (total > PDF_TOTAL_LIMIT) throw new Error('รูปรวมกันใหญ่เกิน 100 MB');
}

function parsePageSpec(spec, pageCount) {
  const raw = String(spec || '').trim();
  if (!raw) return Array.from({ length: pageCount }, (_, index) => index);
  const pages = new Set();
  for (const part of raw.split(',')) {
    const token = part.trim();
    if (!token) continue;
    const match = token.match(/^(\d+)(?:-(\d+))?$/);
    if (!match) throw new Error('ระบุหน้าเป็น 1,3,5-8');
    const start = Number.parseInt(match[1], 10);
    const end = match[2] ? Number.parseInt(match[2], 10) : start;
    if (start < 1 || end < start || end > pageCount) throw new Error(`เลขหน้าต้องอยู่ระหว่าง 1-${pageCount}`);
    for (let page = start; page <= end; page += 1) pages.add(page - 1);
  }
  if (!pages.size) throw new Error('ยังไม่ได้เลือกหน้า PDF');
  return [...pages];
}

function closeDialog(id) {
  const dialog = $(id);
  if (dialog) dialog.hidden = true;
}

function requestKey(prefix) {
  const suffix = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}-${suffix}`.slice(0, 120);
}

function generatedResult(dialog, result, label) {
  const message = dialog.querySelector('[data-generated-message]');
  const output = dialog.querySelector('[data-generated-output]');
  if (output) output.replaceChildren();
  const task = result?.task || result?.factory?.task;
  const artifact = result?.artifact || result?.factory?.artifact;
  if (message) message.textContent = result?.idempotent ? 'งานเดิมถูกนำกลับมาแสดงโดยไม่สร้างซ้ำ' : `${label}เสร็จแล้ว · งานและผลลัพธ์ถูกบันทึกใน AWH`;
  if (!output) return;
  if (task?.taskId) {
    const taskLine = document.createElement('p');
    taskLine.textContent = `Task: ${task.taskId} · สถานะ ${task.state || 'UNKNOWN'}`;
    output.append(taskLine);
  }
  if (artifact?.downloadUrl) {
    const link = document.createElement('a');
    link.href = artifact.downloadUrl;
    link.download = artifact.name || 'awh-artifact.html';
    link.textContent = `ดาวน์โหลด ${artifact.name || 'ผลลัพธ์'}`;
    link.className = 'awh-command-send';
    output.append(link);
  }
  const pipeline = result?.pipeline || result?.factory?.pipeline;
  const phases = Array.isArray(pipeline?.phases) ? pipeline.phases : [];
  if (phases.length) {
    const phaseLine = document.createElement('p');
    phaseLine.textContent = `Pipeline: ${phases.map((phase) => typeof phase === 'string' ? phase : `${phase.key}=${phase.state}`).join(' · ')}`;
    output.append(phaseLine);
  }
}

async function populateDocumentProjects(select) {
  select.replaceChildren();
  const pending = document.createElement('option');
  pending.value = '';
  pending.textContent = 'กำลังอ่านโปรเจกต์…';
  select.append(pending);
  const value = await controlRequest('/api/v1/control/projects');
  const projects = Array.isArray(value?.projects) ? value.projects : [];
  select.replaceChildren();
  if (!projects.length) {
    const empty = document.createElement('option');
    empty.value = '';
    empty.textContent = 'ยังไม่มีโปรเจกต์ที่ใช้ได้';
    select.append(empty);
    return;
  }
  for (const project of projects) {
    if (typeof project?.projectId !== 'string') continue;
    const option = document.createElement('option');
    option.value = project.projectId;
    option.textContent = `${project.name || 'โปรเจกต์'} · ${project.type || 'ทั่วไป'}`;
    select.append(option);
  }
}

export async function openSchoolDocumentTool() {
  const dialog = $('dashboard-school-document-tool');
  if (!(dialog instanceof HTMLElement)) return;
  dialog.hidden = false;
  const select = dialog.querySelector('#dashboard-document-project');
  const message = dialog.querySelector('[data-generated-message]');
  if (message) message.textContent = 'เลือกโปรเจกต์และกรอกข้อมูลที่ทราบจริง ระบบจะทำเครื่องหมายข้อมูลที่ยังขาดให้';
  if (select instanceof HTMLSelectElement) {
    try { await populateDocumentProjects(select); } catch (error) { if (message) message.textContent = error instanceof Error ? error.message : 'อ่านโปรเจกต์ไม่ได้'; }
  }
}

export function openProjectFactoryTool() {
  const dialog = $('dashboard-project-factory-tool');
  if (dialog) dialog.hidden = false;
}

function createSchoolDocumentDialog() {
  const dialog = document.createElement('section');
  dialog.id = 'dashboard-school-document-tool';
  dialog.className = 'awh-tool-dialog';
  dialog.hidden = true;
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');
  dialog.innerHTML = '<div class="awh-tool-dialog-backdrop" data-school-document-close></div><div class="awh-tool-dialog-card"><div class="awh-tool-dialog-head"><div><span>DOCUMENT AI</span><h2>ทำบันทึกข้อความขออนุมัติ</h2><p>ใช้ template และ School Knowledge Pack ของ AWH · ไม่เดาข้อมูลราชการที่ยังไม่ทราบ</p></div><button type="button" data-school-document-close>ปิด</button></div><label>โปรเจกต์<select id="dashboard-document-project"></select></label><label>เรื่อง<input id="dashboard-document-subject" maxlength="180" placeholder="เช่น ขออนุมัติจัดกิจกรรมวันวิทยาศาสตร์" /></label><label>รายละเอียดที่ทราบ<textarea id="dashboard-document-details" rows="7" maxlength="4000" placeholder="อธิบายวัตถุประสงค์ เหตุผล กิจกรรม หรือรายละเอียดงบประมาณที่ทราบจริง"></textarea></label><button id="dashboard-document-create" class="awh-command-send" type="button">สร้างร่างที่พิมพ์ได้</button><p class="awh-local-note" data-generated-message>ข้อมูลที่ไม่ทราบจะถูกแสดงเป็นช่องให้เติม ไม่ถูกแต่งขึ้นเอง</p><div data-generated-output></div></div>';
  dialog.querySelectorAll('[data-school-document-close]').forEach((node) => node.addEventListener('click', () => closeDialog('dashboard-school-document-tool')));
  dialog.querySelector('#dashboard-document-create')?.addEventListener('click', async () => {
    const button = dialog.querySelector('#dashboard-document-create');
    const projectId = dialog.querySelector('#dashboard-document-project')?.value || '';
    const subject = dialog.querySelector('#dashboard-document-subject')?.value || '';
    const details = dialog.querySelector('#dashboard-document-details')?.value || '';
    if (!(button instanceof HTMLButtonElement)) return;
    button.disabled = true;
    try { generatedResult(dialog, await createSchoolDocument({ projectId, subject, details, idempotencyKey: requestKey('school-document') }), 'บันทึกข้อความ'); }
    catch (error) { const message = dialog.querySelector('[data-generated-message]'); if (message) message.textContent = error instanceof Error ? error.message : 'สร้างบันทึกข้อความไม่ได้'; }
    finally { button.disabled = false; }
  });
  return dialog;
}

function createProjectFactoryDialog() {
  const dialog = document.createElement('section');
  dialog.id = 'dashboard-project-factory-tool';
  dialog.className = 'awh-tool-dialog';
  dialog.hidden = true;
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');
  dialog.innerHTML = '<div class="awh-tool-dialog-backdrop" data-project-factory-close></div><div class="awh-tool-dialog-card"><div class="awh-tool-dialog-head"><div><span>PROJECT FACTORY</span><h2>เริ่มเว็บโรงเรียน</h2><p>สร้าง Project, Task, Execution และแผน Build Studio ผ่าน AWH authority เดียว</p></div><button type="button" data-project-factory-close>ปิด</button></div><label>ชื่อโปรเจกต์<input id="dashboard-factory-name" maxlength="120" placeholder="เช่น เว็บไซต์สหกรณ์โรงเรียน" /></label><label>วัตถุประสงค์<textarea id="dashboard-factory-objective" rows="6" maxlength="2000" placeholder="บอกว่าเว็บนี้มีไว้ทำอะไรและใครจะใช้งาน"></textarea></label><button id="dashboard-factory-create" class="awh-command-send" type="button">สร้าง Project Factory plan</button><p class="awh-local-note" data-generated-message>ระบบจะไม่อ้างว่าเว็บ deploy แล้วจนกว่าจะผ่าน implementation, tests, preview และ approval</p><div data-generated-output></div></div>';
  dialog.querySelectorAll('[data-project-factory-close]').forEach((node) => node.addEventListener('click', () => closeDialog('dashboard-project-factory-tool')));
  dialog.querySelector('#dashboard-factory-create')?.addEventListener('click', async () => {
    const button = dialog.querySelector('#dashboard-factory-create');
    const name = dialog.querySelector('#dashboard-factory-name')?.value || '';
    const objective = dialog.querySelector('#dashboard-factory-objective')?.value || '';
    if (!(button instanceof HTMLButtonElement)) return;
    button.disabled = true;
    try { generatedResult(dialog, await createProjectFactory({ name, objective, type: 'school-website', idempotencyKey: requestKey('project-factory') }), 'Project Factory'); }
    catch (error) { const message = dialog.querySelector('[data-generated-message]'); if (message) message.textContent = error instanceof Error ? error.message : 'สร้าง Project Factory ไม่ได้'; }
    finally { button.disabled = false; }
  });
  return dialog;
}

export function openPdfTool() {
  const dialog = $('dashboard-pdf-tool');
  if (dialog) dialog.hidden = false;
}

export function openQrTool() {
  const dialog = $('dashboard-qr-tool');
  if (dialog) dialog.hidden = false;
}

function createPdfDialog() {
  const dialog = document.createElement('section');
  dialog.id = 'dashboard-pdf-tool';
  dialog.className = 'awh-tool-dialog';
  dialog.hidden = true;
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');
  dialog.innerHTML = '<div class="awh-tool-dialog-backdrop" data-pdf-close></div><div class="awh-tool-dialog-card"><div class="awh-tool-dialog-head"><div><span>PDF</span><h2>จัดการ PDF</h2><p>ทำบนอุปกรณ์นี้ ไฟล์ไม่ถูกส่งขึ้นเซิร์ฟเวอร์</p></div><button type="button" data-pdf-close>ปิด</button></div><label>ต้องการทำอะไร<select id="dashboard-pdf-operation"><option value="merge">รวม PDF หลายไฟล์</option><option value="images">รวมรูปเป็น PDF</option><option value="extract">แยก/เลือกหน้า PDF</option><option value="rotate">หมุนหน้า PDF</option></select></label><label class="awh-image-drop"><input id="dashboard-pdf-input" type="file" accept="application/pdf,.pdf" multiple /><strong id="dashboard-pdf-input-title">เลือกไฟล์ PDF</strong><span id="dashboard-pdf-file">สูงสุด 20 ไฟล์ · รวมไม่เกิน 100 MB</span></label><label id="dashboard-pdf-pages-wrap" hidden>หน้าที่ต้องการ<input id="dashboard-pdf-pages" type="text" maxlength="120" placeholder="เช่น 1,3,5-8 · เว้นว่าง = ทุกหน้า" /></label><label id="dashboard-pdf-rotation-wrap" hidden>องศาที่หมุน<select id="dashboard-pdf-rotation"><option value="90">90°</option><option value="180">180°</option><option value="270">270°</option></select></label><button id="dashboard-pdf-process" class="awh-command-send" type="button">สร้างไฟล์ PDF</button><p id="dashboard-pdf-message" class="awh-local-note">✓ ทำบนอุปกรณ์นี้ · ไม่ใช้ AI token</p></div>';
  dialog.querySelectorAll('[data-pdf-close]').forEach((node) => node.addEventListener('click', () => closeDialog('dashboard-pdf-tool')));
  dialog.querySelector('#dashboard-pdf-operation')?.addEventListener('change', syncPdfOptions);
  dialog.querySelector('#dashboard-pdf-input')?.addEventListener('change', syncPdfFileLabel);
  dialog.querySelector('#dashboard-pdf-process')?.addEventListener('click', processPdf);
  return dialog;
}

function pdfSelectionHint(operation) {
  return operation === 'images' ? `JPG/PNG สูงสุด ${IMAGE_PDF_MAX_FILES} รูป · รวมไม่เกิน 100 MB` : 'สูงสุด 20 ไฟล์ · รวมไม่เกิน 100 MB';
}

function syncPdfOptions() {
  const operation = $('dashboard-pdf-operation')?.value || 'merge';
  const pages = $('dashboard-pdf-pages-wrap');
  const rotation = $('dashboard-pdf-rotation-wrap');
  const input = $('dashboard-pdf-input');
  const title = $('dashboard-pdf-input-title');
  if (pages) pages.hidden = operation === 'merge' || operation === 'images';
  if (rotation) rotation.hidden = operation !== 'rotate';
  if (input instanceof HTMLInputElement) {
    input.accept = operation === 'images' ? 'image/jpeg,image/png,.jpg,.jpeg,.png' : 'application/pdf,.pdf';
    input.multiple = operation === 'merge' || operation === 'images';
    input.value = '';
  }
  if (title) title.textContent = operation === 'images' ? 'เลือกรูป JPG/PNG ตามลำดับหน้า' : 'เลือกไฟล์ PDF';
  syncPdfFileLabel();
}
function syncPdfFileLabel() {
  const files = selectedFiles('dashboard-pdf-input');
  const operation = $('dashboard-pdf-operation')?.value || 'merge';
  const label = $('dashboard-pdf-file');
  if (label) label.textContent = files.length ? `${files.length} ไฟล์ · ${files.map((file) => file.name).join(', ')}` : pdfSelectionHint(operation);
}

async function mergePdf(files) {
  const { PDFDocument } = pdfLib();
  assertPdfFiles(files, 2, 20);
  const target = await PDFDocument.create();
  for (const file of files) {
    const source = await PDFDocument.load(await file.arrayBuffer(), { ignoreEncryption: false });
    const pages = await target.copyPages(source, source.getPageIndices());
    pages.forEach((page) => target.addPage(page));
  }
  return { bytes: await target.save(), filename: 'AWH-merged.pdf' };
}
async function extractPdf(file, pageSpec) {
  const { PDFDocument } = pdfLib();
  assertPdfFiles([file], 1, 1);
  const source = await PDFDocument.load(await file.arrayBuffer(), { ignoreEncryption: false });
  const indices = parsePageSpec(pageSpec, source.getPageCount());
  const target = await PDFDocument.create();
  const pages = await target.copyPages(source, indices);
  pages.forEach((page) => target.addPage(page));
  return { bytes: await target.save(), filename: `${safeName(file.name, 'document')}-pages.pdf` };
}

async function rotatePdf(file, pageSpec, amount) {
  const { PDFDocument, degrees } = pdfLib();
  assertPdfFiles([file], 1, 1);
  const source = await PDFDocument.load(await file.arrayBuffer(), { ignoreEncryption: false });
  const indices = parsePageSpec(pageSpec, source.getPageCount());
  for (const index of indices) {
    const page = source.getPage(index);
    page.setRotation(degrees((page.getRotation().angle + amount) % 360));
  }
  return { bytes: await source.save(), filename: `${safeName(file.name, 'document')}-rotated.pdf` };
}

export async function imagesToPdf(files) {
  const { PDFDocument } = pdfLib();
  assertImagePdfFiles(files);
  const target = await PDFDocument.create();
  for (const file of files) {
    const bytes = await file.arrayBuffer();
    const image = imagePdfKind(file) === 'png' ? await target.embedPng(bytes) : await target.embedJpg(bytes);
    const landscape = image.width > image.height;
    const pageWidth = landscape ? A4_PORTRAIT[1] : A4_PORTRAIT[0];
    const pageHeight = landscape ? A4_PORTRAIT[0] : A4_PORTRAIT[1];
    const maxWidth = pageWidth - IMAGE_PDF_MARGIN * 2;
    const maxHeight = pageHeight - IMAGE_PDF_MARGIN * 2;
    const scale = Math.min(maxWidth / image.width, maxHeight / image.height);
    const width = image.width * scale;
    const height = image.height * scale;
    const page = target.addPage([pageWidth, pageHeight]);
    page.drawImage(image, {
      x: (pageWidth - width) / 2,
      y: (pageHeight - height) / 2,
      width,
      height,
    });
  }
  return { bytes: await target.save(), filename: 'AWH-images.pdf' };
}

async function processPdf() {
  const button = $('dashboard-pdf-process');
  if (!(button instanceof HTMLButtonElement)) return;
  button.disabled = true;
  const message = $('dashboard-pdf-message');
  if (message) message.textContent = 'กำลังประมวลผล PDF…';
  try {
    const files = selectedFiles('dashboard-pdf-input');
    const operation = $('dashboard-pdf-operation')?.value || 'merge';
    const pages = $('dashboard-pdf-pages')?.value || '';
    let result;
    if (operation === 'merge') result = await mergePdf(files);
    else if (operation === 'images') result = await imagesToPdf(files);
    else if (operation === 'extract') { assertPdfFiles(files, 1, 1); result = await extractPdf(files[0], pages); }
    else if (operation === 'rotate') { assertPdfFiles(files, 1, 1); result = await rotatePdf(files[0], pages, Number.parseInt($('dashboard-pdf-rotation')?.value || '90', 10)); }
    else throw new Error('ไม่รู้จักคำสั่ง PDF นี้');
    downloadBytes(result.bytes, 'application/pdf', result.filename);
    if (message) message.textContent = `เสร็จแล้ว · ${result.filename}`;
  } catch (error) {
    if (message) message.textContent = error instanceof Error ? error.message : 'ไม่สามารถจัดการ PDF ได้';
  } finally {
    button.disabled = false;
  }
}
function createQrDialog() {
  const dialog = document.createElement('section');
  dialog.id = 'dashboard-qr-tool';
  dialog.className = 'awh-tool-dialog';
  dialog.hidden = true;
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');
  dialog.innerHTML = '<div class="awh-tool-dialog-backdrop" data-qr-close></div><div class="awh-tool-dialog-card"><div class="awh-tool-dialog-head"><div><span>QR</span><h2>สร้าง QR Code</h2><p>ใส่ลิงก์หรือข้อความ แล้วดาวน์โหลด PNG ได้ทันที</p></div><button type="button" data-qr-close>ปิด</button></div><label>ลิงก์หรือข้อความ<textarea id="dashboard-qr-text" rows="4" maxlength="1600" placeholder="https://... หรือข้อความที่ต้องการ"></textarea></label><label>ขนาด<select id="dashboard-qr-size"><option value="512">512 px</option><option value="768" selected>768 px</option><option value="1024">1024 px</option></select></label><div id="dashboard-qr-preview" class="awh-qr-preview" hidden><canvas aria-label="ตัวอย่าง QR Code"></canvas></div><button id="dashboard-qr-create" class="awh-command-send" type="button">สร้าง QR</button><button id="dashboard-qr-download" class="secondary-button" type="button" disabled>ดาวน์โหลด PNG</button><p id="dashboard-qr-message" class="awh-local-note">✓ ทำบนอุปกรณ์นี้ · ไม่ใช้ AI token</p></div>';
  dialog.querySelectorAll('[data-qr-close]').forEach((node) => node.addEventListener('click', () => closeDialog('dashboard-qr-tool')));
  dialog.querySelector('#dashboard-qr-create')?.addEventListener('click', renderQr);
  dialog.querySelector('#dashboard-qr-download')?.addEventListener('click', downloadQr);
  return dialog;
}

function drawQr(canvas, qr, size) {
  const count = qr.getModuleCount();
  const quiet = 4;
  const cell = Math.max(1, Math.floor(size / (count + quiet * 2)));
  const actual = cell * (count + quiet * 2);
  canvas.width = actual;
  canvas.height = actual;
  const context = canvas.getContext('2d', { alpha: false });
  if (!context) throw new Error('ไม่สามารถวาด QR ได้');
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, actual, actual);
  context.fillStyle = '#000000';
  for (let row = 0; row < count; row += 1) {
    for (let column = 0; column < count; column += 1) {
      if (qr.isDark(row, column)) context.fillRect((column + quiet) * cell, (row + quiet) * cell, cell, cell);
    }
  }
  return actual;
}

function renderQr() {
  const text = String($('dashboard-qr-text')?.value || '').trim();
  const message = $('dashboard-qr-message');
  const preview = $('dashboard-qr-preview');
  const canvas = preview?.querySelector('canvas');
  const download = $('dashboard-qr-download');
  if (!(canvas instanceof HTMLCanvasElement) || !(download instanceof HTMLButtonElement)) return;
  download.disabled = true;
  if (!text || text.length > QR_TEXT_LIMIT) {
    if (message) message.textContent = text ? `ข้อความต้องไม่เกิน ${QR_TEXT_LIMIT} ตัวอักษร` : 'กรอกลิงก์หรือข้อความก่อน';
    if (preview) preview.hidden = true;
    return;
  }
  try {
    const qr = qrcodeLib()(0, 'M');
    qr.addData(text, 'Byte');
    qr.make();
    const actual = drawQr(canvas, qr, Number.parseInt($('dashboard-qr-size')?.value || '768', 10));
    if (preview) preview.hidden = false;
    download.disabled = false;
    if (message) message.textContent = `พร้อมดาวน์โหลด · ${actual} × ${actual} px`;
  } catch (error) {
    if (message) message.textContent = error instanceof Error ? error.message : 'ไม่สามารถสร้าง QR ได้';
  }
}
function downloadQr() {
  const canvas = $('dashboard-qr-preview')?.querySelector('canvas');
  if (!(canvas instanceof HTMLCanvasElement)) return;
  canvas.toBlob((blob) => {
    if (!blob) {
      const message = $('dashboard-qr-message');
      if (message) message.textContent = 'ไม่สามารถสร้างไฟล์ PNG ได้';
      return;
    }
    downloadBytes(blob, 'image/png', 'AWH-QR.png');
  }, 'image/png');
}

export function mountSchoolTools(host) {
  if (!(host instanceof HTMLElement)) return;
  if (!$('dashboard-pdf-tool')) host.append(createPdfDialog());
  if (!$('dashboard-qr-tool')) host.append(createQrDialog());
  if (!$('dashboard-school-document-tool')) host.append(createSchoolDocumentDialog());
  if (!$('dashboard-project-factory-tool')) host.append(createProjectFactoryDialog());
}

export const LOCAL_TOOL_ACTIONS = Object.freeze({
  pdf: openPdfTool,
  qr: openQrTool,
});
