import fs from 'node:fs/promises';

const matrix = JSON.parse(await fs.readFile('design/qa/visual-matrix.json','utf8'));
const requiredSurfaces = ['awh','bay-excuse-x','bay-assessment','bay-cooperative','bay-learnlab','bay-line','school-website','bay-hub'];
const requiredAssertions = ['horizontal-overflow-zero','thai-not-clipped','primary-action-visible','touch-target-contract','focus-not-obscured','loading-error-recovery-deliberate','overlay-focus-owner-correct','long-thai-content-safe','role-presentation-correct'];
const requiredWidths = [390,430,820,1366,1440];

function fail(message) { throw new Error('[experience-contract] ' + message); }
if (matrix.schemaVersion < 2) fail('visual matrix schemaVersion must be >= 2');
if (matrix.minimumDocumentWidth !== 320) fail('minimum document width must remain 320px');
if (JSON.stringify(matrix.viewports.map(v=>v.width)) !== JSON.stringify(requiredWidths)) fail('required viewport matrix drifted');
for (const assertion of requiredAssertions) if (!matrix.universalAssertions.includes(assertion)) fail('missing assertion: ' + assertion);
for (const id of requiredSurfaces) {
  const surface = matrix.surfaces[id];
  if (!surface) fail('missing governed surface: ' + id);
  if (!surface.overlay) fail('missing overlay for ' + id);
  await fs.access(surface.overlay);
  if (!Array.isArray(surface.scenarios) || surface.scenarios.length < 2) fail('insufficient scenarios for ' + id);
}
for (const id of ['awh','bay-assessment','bay-cooperative','bay-learnlab','bay-line']) {
  const kv = matrix.surfaces[id].keyboardViewports || [];
  for (const required of ['mobile-390','mobile-430']) if (!kv.includes(required)) fail(id + ' missing keyboard viewport ' + required);
}
console.log('KRUART experience contract PASS:', requiredSurfaces.length, 'surfaces,', requiredAssertions.length, 'universal gates');
