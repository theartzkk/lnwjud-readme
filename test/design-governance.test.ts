import test from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';

const read = (path: string) => readFile(path, 'utf8');
const json = async (path: string) => JSON.parse(await read(path));

function validateTokenNode(node: any, inheritedType?: string, trail = 'root'): void {
  if (!node || typeof node !== 'object' || Array.isArray(node)) return;
  const type = typeof node.$type === 'string' ? node.$type : inheritedType;
  if (Object.prototype.hasOwnProperty.call(node, '$value')) {
    assert.ok(type, trail + ' token has no explicit/inherited $type');
    const value = node.$value;
    if (typeof value === 'string' && /^\{[^}]+\}$/.test(value)) return;
    if (type === 'color') {
      assert.equal(value?.colorSpace, 'srgb', trail + ' colorSpace');
      assert.ok(Array.isArray(value?.components) && value.components.length === 3, trail + ' color components');
      assert.match(value?.hex ?? '', /^#[0-9A-Fa-f]{6}$/, trail + ' color hex');
    } else if (type === 'dimension') {
      assert.equal(typeof value?.value, 'number', trail + ' dimension value');
      assert.ok(['px', 'rem'].includes(value?.unit), trail + ' dimension unit');
    } else if (type === 'duration') {
      assert.equal(typeof value?.value, 'number', trail + ' duration value');
      assert.ok(['ms', 's'].includes(value?.unit), trail + ' duration unit');
    } else if (type === 'cubicBezier') {
      assert.ok(Array.isArray(value) && value.length === 4 && value.every((n: unknown) => typeof n === 'number'), trail + ' cubicBezier');
    }
  }
  for (const [key, value] of Object.entries(node)) {
    if (!key.startsWith('$') && value && typeof value === 'object') validateTokenNode(value, type, trail + '.' + key);
  }
}

test('KRUART design governance files and overlays are complete', async () => {
  const required = [
    'design/DESIGN.md',
    'design/foundations.json',
    'design/assets.manifest.json',
    'design/UX-ACCEPTANCE.md',
    'design/AGENT-DESIGN-RULES.md',
    'design/qa/visual-matrix.json',
    'design/qa/regression-policy.md',
    'design/qa/accessibility-policy.md',
    'design/overlays/awh.md',
    'design/overlays/bay-excuse-x.md',
    'design/overlays/bay-learnlab.md',
    'design/overlays/school-website.md',
    'design/overlays/bay-hub.md',
  ];
  for (const path of required) await access(path);
  const agents = await read('AGENTS.md');
  assert.match(agents, /design\/DESIGN\.md/);
  assert.match(agents, /config\/kruart-visual-assets\.json/);
});

test('DTCG tokens are typed and preserve the Golden KRUART runtime palette', async () => {
  const tokens = await json('design/foundations.json');
  assert.equal(tokens.$schema, 'https://www.designtokens.org/schemas/2025.10/format.json');
  validateTokenNode(tokens);
  const expected = ['#0B3D91','#176DE5','#FF7A00','#F5FAFF','#FFFFFF','#F7FBFF','#EAF5FF','#11325F','#657D99','#DBE8F4','#16855B','#A9690D','#C43D3D'];
  const css = ((await read('web/kruart-system.css')) + '\n' + (await read('web/awh-light-system.css'))).toLowerCase();
  for (const color of expected) assert.ok(css.includes(color.toLowerCase()), color + ' must exist in runtime CSS');
  assert.equal(tokens.size.touchTarget.$value.value, 44);
  assert.equal(tokens.size.minViewport.$value.value, 320);
});
test('asset governance points to the existing registry instead of duplicating semantic slots', async () => {
  const [descriptor, registry] = await Promise.all([
    json('design/assets.manifest.json'),
    json('config/kruart-visual-assets.json'),
  ]);
  assert.equal(descriptor.canonicalRegistry, 'config/kruart-visual-assets.json');
  assert.equal(Object.prototype.hasOwnProperty.call(descriptor, 'slots'), false);
  assert.equal(descriptor.sourceArchive.name, 'KRUART-ECOSYSTEM-SOURCES-READY-FINAL-v2.zip');
  assert.equal(descriptor.sourceArchive.sha256, '2cf381c01c0a29b7e0a8d95b6b97426e82e2288658cce46ad79927d7c1c1e52e');
  assert.equal(descriptor.identity.schoolName, 'โรงเรียนบ้านเอือดใหญ่');
  assert.equal(registry.projectSources.unifiedArchive.schoolName, 'โรงเรียนบ้านเอือดใหญ่');
  assert.ok(Array.isArray(registry.slots) && registry.slots.length >= 30);
  assert.equal(new Set(registry.slots.map((slot: any) => slot.id)).size, registry.slots.length);
});

test('visual acceptance matrix keeps the sealed responsive references', async () => {
  const matrix = await json('design/qa/visual-matrix.json');
  assert.deepEqual(matrix.viewports.map((v: any) => v.width), [390,430,820,1366,1440]);
  assert.deepEqual(matrix.surfaces.awh.keyboardViewports, ['mobile-390','mobile-430']);
  assert.ok(matrix.universalAssertions.includes('horizontal-overflow-zero'));
  assert.ok(matrix.universalAssertions.includes('navigation-owner-correct'));
  assert.equal(matrix.surfaces['bay-learnlab'].overlay, 'design/overlays/bay-learnlab.md');
});

test('canonical school identity and anti-drift language remain exact', async () => {
  const design = await read('design/DESIGN.md');
  const acceptance = await read('design/UX-ACCEPTANCE.md');
  const agentRules = await read('design/AGENT-DESIGN-RULES.md');
  const combined = design + '\n' + acceptance + '\n' + agentRules;
  assert.match(combined, /โรงเรียนบ้านเอือดใหญ่/);
  assert.doesNotMatch(combined, /โรงเรียนบ้านเอื้อดใหญ่/);
  assert.match(agentRules, /must not:[\s\S]*regenerate, redraw or approximate an approved logo/);
  assert.match(agentRules, /claim visual PASS from source inspection alone/);
});
