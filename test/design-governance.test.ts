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
    'design/qa/experience-policy.md',
    'config/kruart-experience-contract.json',
    'design/overlays/awh.md',
    'design/overlays/bay-excuse-x.md',
    'design/overlays/bay-learnlab.md',
    'design/overlays/bay-assessment.md',
    'design/overlays/bay-computer-lab.md',
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

test('KRUART experience contract prevents navigation and portal drift', async () => {
  const contract = await json('config/kruart-experience-contract.json');
  assert.equal(contract.schemaVersion, 1);
  assert.equal(contract.principles.oneNavigationVocabularyPerProduct, true);
  assert.equal(contract.navigationSemantics.back, 'previous-context');
  assert.equal(contract.navigationSemantics.home, 'current-product-home');
  assert.equal(contract.navigationSemantics.exit, 'parent-product-or-context');

  const products = contract.products as Array<any>;
  const ids = products.map((product) => product.id);
  assert.equal(new Set(ids).size, ids.length);
  const known = new Set(ids);
  const urls = products.map((product) => product.canonicalUrl).filter(Boolean);
  assert.equal(new Set(urls).size, urls.length);
  for (const product of products) {
    assert.ok(product.mobilePrimaryMax <= 5, product.id + ' mobile nav budget');
    if (Array.isArray(product.primaryVocabulary)) {
      assert.ok(product.primaryVocabulary.length <= product.mobilePrimaryMax, product.id + ' primary nav size');
      assert.equal(new Set(product.primaryVocabulary).size, product.primaryVocabulary.length);
    }
    if (product.parentProductId) assert.ok(known.has(product.parentProductId));
  }

  const releaseContract = await json('config/ecosystem-release-contract.json');
  const expectedTracks = Object.keys(releaseContract.releaseTracks);
  const tracks = contract.releaseTracks.map((track: any) => track.id);
  assert.deepEqual([...tracks].sort(), [...expectedTracks].sort());
  assert.equal(new Set(tracks).size, tracks.length);
  for (const track of contract.releaseTracks) {
    assert.equal(track.visibility, releaseContract.releaseTracks[track.id].visibility);
  }
  assert.deepEqual(contract.releaseTracks.filter((track: any) => track.visibility === 'ADVANCED').map((track: any) => track.id), ['bay-hub']);
  assert.deepEqual([...contract.releaseGroups['line-oa'].targets].sort(), ['awh-line-gateway','line-oa']);
  assert.equal(contract.interaction.touchTargetPx, 44);
  assert.equal(contract.interaction.safeAreaRequired, true);
  assert.equal(contract.interaction.mobileInputMinFontPx, 16);
  assert.equal(contract.interaction.visualViewportRequired, true);
  assert.equal(contract.interaction.focusedControlMustRemainVisible, true);
  assert.equal(contract.interaction.keyboardDismissRestoresLayout, true);
  assert.equal(contract.interaction.dynamicViewportUnitRequired, true);
  assert.equal(contract.interaction.minimumViewportPx, 320);
  assert.deepEqual(contract.interaction.keyboardReferenceViewportsPx, [390, 430]);
  assert.equal(contract.experienceGate.rejectHorizontalOverflow, true);
  assert.equal(contract.experienceGate.rejectFocusedControlOcclusion, true);
  assert.equal(contract.experienceGate.rejectSoftwareKeyboardOverlay, true);
  assert.equal(contract.experienceGate.rejectMobileInputZoom, true);
  assert.equal(contract.experienceGate.requireKeyboardDismissRecovery, true);

  const index = await read('web/index.html');
  const ownerNav = index.match(/<nav id="owner-global-nav"[\s\S]*?<\/nav>/)?.[0] ?? '';
  const labels = [...ownerNav.matchAll(/<span>([^<]+)<\/span>/g)].map((match) => match[1]);
  assert.deepEqual(labels, contract.ownerNavigation.primaryVocabulary);
  const publicNav = index.match(/<nav class="global-nav"[\s\S]*?<\/nav>/)?.[0] ?? '';
  const publicLabels = [...publicNav.matchAll(/<span>([^<]+)<\/span>/g)].map((match) => match[1]);
  assert.deepEqual(publicLabels, contract.publicNavigation.primaryVocabulary);
  assert.match(publicNav, /href="https:\/\/learn\.kruart\.online\/"[\s\S]*?<span>เรียนรู้<\/span>/);
  assert.match(publicNav, /href="https:\/\/school\.kruart\.online\/"[\s\S]*?<span>โรงเรียน<\/span>/);
  assert.match(publicNav, /href="\/bay\/apps\.html"[\s\S]*?<span>ระบบ<\/span>/);
  for (const duplicate of ['สำหรับครู','ผู้ปกครอง','ข่าวสาร']) assert.doesNotMatch(publicNav, new RegExp(duplicate));
  assert.doesNotMatch(index, /class="kruart-shortcuts"/);
  assert.doesNotMatch(index, /class="kruart-section kruart-systems"/);
  assert.doesNotMatch(index, /class="kruart-today"/);
  assert.match(index, /เลือกพื้นที่ของคุณ/);

  const feedback = await read('web/interaction-feedback.js');
  assert.match(feedback, /kruart-ui-pressed/);
  assert.match(feedback, /1800/);
});
