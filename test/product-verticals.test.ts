import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('school document and project factory surfaces use the existing canonical authorities', async () => {
  const [service, router, adapter, tools, registry] = await Promise.all([
    readFile(new URL('../hub/src/HubControlPlaneService.php', import.meta.url), 'utf8'),
    readFile(new URL('../hub/src/HubControlPlaneRouter.php', import.meta.url), 'utf8'),
    readFile(new URL('../web/control-plane-adapter.js', import.meta.url), 'utf8'),
    readFile(new URL('../web/school-tools.js', import.meta.url), 'utf8'),
    readFile(new URL('../web/tool-registry.js', import.meta.url), 'utf8'),
  ]);
  assert.match(router, /\/api\/v1\/control\/school\/documents/);
  assert.match(router, /\/api\/v1\/control\/project-factory/);
  assert.match(service, /SCHOOL_DOCUMENT_MEMORANDUM/);
  assert.match(service, /PROJECT_FACTORY_SCHOOL_WEBSITE/);
  assert.match(service, /control_task_executions/);
  assert.match(service, /control_artifact_objects/);
  assert.match(service, /school-knowledge-pack-th-v1/);
  assert.match(service, /ยังไม่ได้ระบุ/);
  assert.match(adapter, /createSchoolDocument/);
  assert.match(adapter, /createProjectFactory/);
  assert.match(tools, /openSchoolDocumentTool/);
  assert.match(tools, /openProjectFactoryTool/);
  assert.match(registry, /project-factory/);
  const dashboard = await readFile(new URL('../web/dashboard.js', import.meta.url), 'utf8');
  const app = await readFile(new URL('../web/app.js', import.meta.url), 'utf8');
  assert.match(dashboard, /classifyUniversalIntent/);
  assert.match(dashboard, /kind: 'DOCUMENT'/);
  assert.match(dashboard, /kind: 'PDF'/);
  assert.match(dashboard, /kind: 'QR'/);
  assert.match(dashboard, /kind: 'IMAGE'/);
  assert.match(dashboard, /globalThis\.AWH_ROUTE_COMMAND/);
  assert.match(app, /AWH_ROUTE_COMMAND/);
  assert.match(app, /files: \[\.\.\.state\.pendingAttachments\]/);
  const generatedService = service.match(/public function createSchoolDocument[\s\S]*?private static function documentText/)?.[0] ?? '';
  const generatedUi = tools.match(/export async function openSchoolDocumentTool[\s\S]*?export function mountSchoolTools/)?.[0] ?? '';
  assert.notEqual(generatedService, '');
  assert.notEqual(generatedUi, '');
  assert.doesNotMatch(`${generatedService}\n${generatedUi}`, /(?:password|secret|api[_-]?key)\s*[=:]/i);
});
