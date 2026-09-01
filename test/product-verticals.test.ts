import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('school document and project factory surfaces use the existing canonical authorities', async () => {
  const [service, documentEngine, router, adapter, tools, registry] = await Promise.all([
    readFile(new URL('../hub/src/HubControlPlaneService.php', import.meta.url), 'utf8'),
    readFile(new URL('../hub/src/HubThaiGovernmentDocumentService.php', import.meta.url), 'utf8'),
    readFile(new URL('../hub/src/HubControlPlaneRouter.php', import.meta.url), 'utf8'),
    readFile(new URL('../web/control-plane-adapter.js', import.meta.url), 'utf8'),
    readFile(new URL('../web/school-tools.js', import.meta.url), 'utf8'),
    readFile(new URL('../web/tool-registry.js', import.meta.url), 'utf8'),
  ]);
  assert.match(router, /\/api\/v1\/control\/school\/documents/);
  assert.match(router, /\/api\/v1\/control\/project-factory/);
  assert.match(service, /HubThaiGovernmentDocumentService/);
  assert.match(documentEngine, /THAI_GOVERNMENT_DOCUMENT/);
  assert.match(documentEngine, /INTERNAL_MEMORANDUM/);
  assert.match(documentEngine, /thai-official-internal-memorandum-v2/);
  assert.match(documentEngine, /TH Sarabun New/);
  assert.match(documentEngine, /w:w=\"11906\"/);
  assert.match(documentEngine, /w:left=\"1701\"/);
  assert.match(documentEngine, /rIdGaruda/);
  assert.match(documentEngine, /48d043c64487328e3a4aa6738eaf908cc6ac47416d15706c43030ff379904fc0/);
  assert.match(service, /PROJECT_FACTORY_SCHOOL_WEBSITE/);
  assert.match(service, /control_task_executions/);
  assert.match(service, /control_artifact_objects/);
  assert.match(service, /school-knowledge-pack-th-v1/);
  assert.match(service, /documentArtifactFollowUpFormat/);
  assert.match(service, /submitSchoolDocumentDocxFollowUp/);
  assert.match(service, /submitOfficeArtifactPdfFollowUp/);
  assert.match(service, /'artifactId'/);
  assert.match(service, /input_store/);
  assert.match(service, /โดยไม่สร้างสำเนาซ้ำ/);
  assert.match(adapter, /createSchoolDocument/);
  assert.match(adapter, /createProjectFactory/);
  assert.match(tools, /openSchoolDocumentTool/);
  assert.match(tools, /openProjectFactoryTool/);
  assert.match(tools, /safeGeneratedArtifactUrl/);
  assert.match(tools, /\/api\\\/v1\\\/control\\\/artifacts\\\//);
  assert.doesNotMatch(tools, /link\.href = artifact\.downloadUrl/);
  assert.match(registry, /project-factory/);
  const dashboard = await readFile(new URL('../web/dashboard.js', import.meta.url), 'utf8');
  const app = await readFile(new URL('../web/app.js', import.meta.url), 'utf8');
  const html = await readFile(new URL('../web/index.html', import.meta.url), 'utf8');
  const css = await readFile(new URL('../web/styles.css', import.meta.url), 'utf8');
  assert.match(dashboard, /classifyUniversalIntent/);
  assert.match(dashboard, /kind: 'DOCUMENT'/);
  assert.match(dashboard, /kind: 'PDF'/);
  assert.match(dashboard, /kind: 'QR'/);
  assert.match(dashboard, /kind: 'IMAGE'/);
  assert.doesNotMatch(dashboard, /fileList\.length === 1[^\n]+startsWith\('image\/'\)/);
  assert.doesNotMatch(dashboard, /fileList\.length > 1[^\n]+endsWith\('\.pdf'\)/);
  assert.match(dashboard, /ลดขนาด\|ปรับขนาด/);
  assert.match(dashboard, /globalThis\.AWH_ROUTE_COMMAND/);
  assert.match(app, /AWH_ROUTE_COMMAND/);
  assert.match(app, /renderArtifactCard/);
  assert.match(app, /textContent = 'เปิด'/);
  assert.match(app, /ดาวน์โหลด/);
  assert.match(app, /ทำ PDF/);
  assert.match(html, /id="artifact-sheet"/);
  assert.match(css, /artifact-sheet-card/);
  assert.match(app, /openArtifactWorkspace/);
  assert.equal(app.includes('URL.revokeObjectURL'), true);
  assert.equal(app.includes('png|jpeg|webp|gif'), true);
  assert.match(app, /AWH ไม่ฝัง HTML, SVG หรือไฟล์ active content/);
  const artifactStart = app.indexOf('function renderArtifactCard');
  const artifactEnd = app.indexOf('function localProgressLabel');
  const artifactWorkspace = artifactStart >= 0 && artifactEnd > artifactStart ? app.slice(artifactStart, artifactEnd) : '';
  assert.notEqual(artifactWorkspace, '');
  assert.equal(artifactWorkspace.includes("target = '_blank'"), false);
  assert.equal(artifactWorkspace.includes('innerHTML ='), false);
  assert.match(app, /localProgressLabel/);
  assert.doesNotMatch(app, /textContent = 'AWH · กำลังตอบ'/);
  assert.match(app, /files: \[\.\.\.state\.pendingAttachments\]/);
  const generatedService = service.match(/public function createSchoolDocument[\s\S]*?private static function documentText/)?.[0] ?? '';
  const generatedUi = tools.match(/export async function openSchoolDocumentTool[\s\S]*?export function mountSchoolTools/)?.[0] ?? '';
  assert.notEqual(generatedService, '');
  assert.notEqual(generatedUi, '');
  assert.doesNotMatch(`${generatedService}\n${generatedUi}`, /(?:password|secret|api[_-]?key)\s*[=:]/i);
});
