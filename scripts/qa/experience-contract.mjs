#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = process.cwd();
const read = (path) => readFile(resolve(root, path), 'utf8');
const fail = (message) => { throw new Error('EXPERIENCE_GATE: ' + message); };

const contract = JSON.parse(await read('config/kruart-experience-contract.json'));
if (contract.schemaVersion !== 1) fail('unsupported schema');
if (contract.principles?.oneNavigationVocabularyPerProduct !== true) fail('navigation vocabulary must be singular per product');
if (contract.navigationSemantics?.back !== 'previous-context') fail('back semantic drift');
if (contract.navigationSemantics?.home !== 'current-product-home') fail('home semantic drift');
if (contract.navigationSemantics?.exit !== 'parent-product-or-context') fail('exit semantic drift');

const products = Array.isArray(contract.products) ? contract.products : [];
const ids = products.map((product) => product.id);
if (new Set(ids).size !== ids.length) fail('duplicate product id');
const known = new Set(ids);
const urls = products.map((product) => product.canonicalUrl).filter(Boolean);
if (new Set(urls).size !== urls.length) fail('duplicate canonical URL');

for (const product of products) {
  const minNav = product.channelOnly === true || product.navigationless === true ? 0 : 1;
  if (!Number.isInteger(product.mobilePrimaryMax) || product.mobilePrimaryMax < minNav || product.mobilePrimaryMax > 5) fail(product.id + ' mobile navigation budget');
  if (Array.isArray(product.primaryVocabulary)) {
    if (product.primaryVocabulary.length > product.mobilePrimaryMax) fail(product.id + ' primary navigation over budget');
    if (new Set(product.primaryVocabulary).size !== product.primaryVocabulary.length) fail(product.id + ' duplicate primary labels');
  }
  if (product.parentProductId && !known.has(product.parentProductId)) fail(product.id + ' unknown parent');
}

const releaseContract = JSON.parse(await read('config/ecosystem-release-contract.json'));
const expectedTracks = Object.keys(releaseContract.releaseTracks ?? {}).sort();
const tracks = (contract.releaseTracks ?? []).map((track) => track.id);
if (new Set(tracks).size !== tracks.length) fail('duplicate release track');
if (JSON.stringify([...tracks].sort()) !== JSON.stringify(expectedTracks)) fail('experience/release track ids drifted');
for (const track of contract.releaseTracks ?? []) {
  const release = releaseContract.releaseTracks?.[track.id];
  if (!release) fail(track.id + ' missing from ecosystem release contract');
  if (!['PRIMARY','ADVANCED'].includes(track.visibility)) fail(track.id + ' invalid visibility');
  if (track.visibility !== release.visibility) fail(track.id + ' visibility drifted');
}
const advancedTracks = (contract.releaseTracks ?? []).filter((track) => track.visibility === 'ADVANCED').map((track) => track.id).sort();
if (JSON.stringify(advancedTracks) !== JSON.stringify(['bay-hub'])) fail('advanced release tracks drifted');
const experienceLineTargets = contract.releaseGroups?.['line-oa']?.targets ?? [];
const releaseLineTargets = (releaseContract.releaseGroups?.['line-oa']?.targets ?? []).map((target) => target.releaseTrack);
if (JSON.stringify([...experienceLineTargets].sort()) !== JSON.stringify([...releaseLineTargets].sort())) fail('LINE OA group target drift');

if (contract.interaction?.touchTargetPx !== 44) fail('touch target drift');
if (contract.interaction?.safeAreaRequired !== true) fail('safe-area contract disabled');
if (contract.interaction?.mobileInputMinFontPx !== 16) fail('mobile input font-size contract drift');
if (contract.interaction?.visualViewportRequired !== true) fail('visual viewport contract disabled');
if (contract.interaction?.focusedControlMustRemainVisible !== true) fail('focused-control visibility contract disabled');
if (contract.interaction?.keyboardDismissRestoresLayout !== true) fail('keyboard dismissal recovery contract disabled');
if (contract.interaction?.dynamicViewportUnitRequired !== true) fail('dynamic viewport contract disabled');
if (contract.interaction?.minimumViewportPx !== 320) fail('minimum viewport contract drift');
if (JSON.stringify(contract.interaction?.keyboardReferenceViewportsPx) !== JSON.stringify([390,430])) fail('keyboard reference viewport drift');
if (contract.experienceGate?.rejectDuplicatePortalRoots !== true) fail('duplicate-portal gate disabled');
if (contract.experienceGate?.rejectPublicInternalTerminology !== true) fail('public terminology gate disabled');
if (contract.experienceGate?.requireVisualVerificationForVisualChanges !== true) fail('mandatory visual verification disabled');
const visual = contract.visualAcceptance ?? {};
const expectedViewports = [390, 430, 820, 1366, 1440];
if (visual.minimumSupportedWidthPx !== 320) fail('minimum supported width must remain 320px');
if (JSON.stringify(visual.requiredViewportsPx) !== JSON.stringify(expectedViewports)) fail('mobile/tablet/desktop viewport evidence must include 390/430/820/1366/1440');
for (const key of ['requireExactRevisionEvidence','requireRenderedScreenshots','rejectHorizontalOverflow','requireKeyboardAndTouchEvidence','requireAccessibilityEvidence','blockMissingEvidence','blockOnP0','ownerReviewForMaterialRedesign']) {
  if (visual[key] !== true) fail('visual acceptance rule missing or disabled: ' + key);
}
if (contract.experienceGate?.rejectHorizontalOverflow !== true) fail('horizontal-overflow gate disabled');
if (contract.experienceGate?.rejectFocusedControlOcclusion !== true) fail('focused-control occlusion gate disabled');
if (contract.experienceGate?.rejectSoftwareKeyboardOverlay !== true) fail('software-keyboard overlay gate disabled');
if (contract.experienceGate?.rejectMobileInputZoom !== true) fail('mobile input zoom gate disabled');
if (contract.experienceGate?.requireKeyboardDismissRecovery !== true) fail('keyboard dismissal gate disabled');

const [dashboard, navigation, dashboardCss, chatCss] = await Promise.all([
  read('web/dashboard.js'),
  read('web/navigation.js'),
  read('web/dashboard.css'),
  read('web/chat-island/chat.css'),
]);
if (!dashboard.includes('window.visualViewport') || !dashboard.includes('keyboardViewportBaseline') || !dashboard.includes('awh-keyboard-open')) fail('dashboard keyboard viewport runtime missing');
if (!dashboard.includes("document.addEventListener('focusin', stabilizeKeyboardFocus") || !dashboard.includes("document.addEventListener('focusout'")) fail('keyboard focus recovery runtime missing');
if (!navigation.includes('window.visualViewport') || !navigation.includes('getBoundingClientRect()') || !navigation.includes('safeBottom')) fail('focused dialog control visibility runtime missing');
if (!dashboardCss.includes('100dvh') || !dashboardCss.includes('safe-area-inset-bottom')) fail('dynamic viewport/safe-area CSS missing');
if (!/awh-command-form textarea\{[^}]*font-size:16px/.test(dashboardCss)) fail('mobile command input must remain at least 16px');
if (!/awh-composer-input\{font-size:16px/.test(chatCss)) fail('mobile chat composer must remain at least 16px');

const index = await read('web/index.html');
const ownerNav = index.match(/<nav id="owner-global-nav"[\s\S]*?<\/nav>/)?.[0] ?? '';
const ownerLabels = [...ownerNav.matchAll(/<span>([^<]+)<\/span>/g)].map((match) => match[1]);
const expectedOwner = contract.ownerNavigation?.primaryVocabulary ?? ['หน้าแรก','ทำงาน','ระบบ','ดูแลระบบ'];
if (JSON.stringify(ownerLabels) !== JSON.stringify(expectedOwner)) fail('AWH owner navigation vocabulary drift');
const publicNav = index.match(/<nav class="global-nav"[\s\S]*?<\/nav>/)?.[0] ?? '';
const publicLabels = [...publicNav.matchAll(/<span>([^<]+)<\/span>/g)].map((match) => match[1]);
const expectedPublic = contract.publicNavigation?.primaryVocabulary ?? ['หน้าแรก','เรียนรู้','โรงเรียน','ระบบ'];
if (JSON.stringify(publicLabels) !== JSON.stringify(expectedPublic)) fail('public navigation vocabulary drift');
if (!/href="\/bay\/apps\.html"[^>]*><img[^>]+><span>ระบบ<\/span>/.test(publicNav)) fail('public system directory entry drift');
if (/สำหรับครู|ผู้ปกครอง|ข่าวสาร/.test(publicNav)) fail('duplicate role/news shortcuts leaked into public primary navigation');
if (/class="kruart-shortcuts"|class="kruart-section kruart-systems"|class="kruart-today"/.test(index)) fail('duplicate public home shortcut sections returned');

const feedback = await read('web/interaction-feedback.js');
if (!feedback.includes('kruart-ui-pressed')) fail('shared press feedback missing');
if (!feedback.includes('1800')) fail('long-running feedback contract missing');

console.log('EXPERIENCE_GATE=PASS');
console.log('PRODUCTS=' + products.length);
console.log('RELEASE_TRACKS=' + tracks.length);
