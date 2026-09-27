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
  const minNav = product.channelOnly === true ? 0 : 1;
  if (!Number.isInteger(product.mobilePrimaryMax) || product.mobilePrimaryMax < minNav || product.mobilePrimaryMax > 5) fail(product.id + ' mobile navigation budget');
  if (Array.isArray(product.primaryVocabulary)) {
    if (product.primaryVocabulary.length > product.mobilePrimaryMax) fail(product.id + ' primary navigation over budget');
    if (new Set(product.primaryVocabulary).size !== product.primaryVocabulary.length) fail(product.id + ' duplicate primary labels');
  }
  if (product.parentProductId && !known.has(product.parentProductId)) fail(product.id + ' unknown parent');
}

const expectedTracks = ['awh','vps','bay-excuse-x','bay-learnlab','bay-assessment','bay-computer-lab','cooperative','awh-line-gateway','line-oa','school-website'].sort();
const tracks = (contract.releaseTracks ?? []).map((track) => track.id);
if (new Set(tracks).size !== tracks.length) fail('duplicate release track');
if (JSON.stringify([...tracks].sort()) !== JSON.stringify(expectedTracks)) fail('release tracks drifted');

if (contract.interaction?.touchTargetPx !== 44) fail('touch target drift');
if (contract.interaction?.safeAreaRequired !== true) fail('safe-area contract disabled');
if (contract.experienceGate?.rejectDuplicatePortalRoots !== true) fail('duplicate-portal gate disabled');
if (contract.experienceGate?.rejectPublicInternalTerminology !== true) fail('public terminology gate disabled');

const index = await read('web/index.html');
const ownerNav = index.match(/<nav id="owner-global-nav"[\s\S]*?<\/nav>/)?.[0] ?? '';
const ownerLabels = [...ownerNav.matchAll(/<span>([^<]+)<\/span>/g)].map((match) => match[1]);
const expectedOwner = ['หน้าแรก','ทำงาน','ระบบ','อัปเดต','ตั้งค่า'];
if (JSON.stringify(ownerLabels) !== JSON.stringify(expectedOwner)) fail('AWH owner navigation vocabulary drift');
if (!/href="https:\/\/excuse\.kruart\.online\/"[^>]*><img[^>]+><span>สำหรับครู<\/span>/.test(index)) fail('teacher entry must go directly to BAY');
if (/href="\/bay\/"[^>]*><img[^>]+><span>สำหรับครู<\/span>/.test(index)) fail('duplicate BAY portal root is exposed as teacher entry');

const feedback = await read('web/interaction-feedback.js');
if (!feedback.includes('kruart-ui-pressed')) fail('shared press feedback missing');
if (!feedback.includes('1800')) fail('long-running feedback contract missing');

console.log('EXPERIENCE_GATE=PASS');
console.log('PRODUCTS=' + products.length);
console.log('RELEASE_TRACKS=' + tracks.length);
