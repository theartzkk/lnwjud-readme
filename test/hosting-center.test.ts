import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import test from 'node:test';

const execFileAsync=promisify(execFile);
const root=process.cwd();

test('Hosting Center exposes reconciled read-only server inventory without a second deployment authority',async()=>{
  const [html,js,css,service,adapter,router,telemetry,infrastructure]=await Promise.all([
    readFile(new URL('../web/hosting.html',import.meta.url),'utf8'),
    readFile(new URL('../web/hosting.js',import.meta.url),'utf8'),
    readFile(new URL('../web/hosting.css',import.meta.url),'utf8'),
    readFile(new URL('../hub/src/HubManagedHostingService.php',import.meta.url),'utf8'),
    readFile(new URL('../web/control-plane-adapter.js',import.meta.url),'utf8'),
    readFile(new URL('../hub/src/HubControlPlaneRouter.php',import.meta.url),'utf8'),
    readFile(new URL('../hub/bin/system-telemetry.php',import.meta.url),'utf8'),
    readFile(new URL('../hub/src/HubInfrastructureService.php',import.meta.url),'utf8'),
  ]);
  assert.match(html,/AWH Hosting Center/);
  assert.match(html,/เว็บไซต์และ Subdomain ทั้งหมด/);
  assert.match(html,/id="hosting-kpis"/);
  assert.match(html,/id="domain-list"/);
  assert.match(html,/id="hosting-recovery"/);
  assert.match(html,/id="hosting-alert-panel"/);
  assert.match(html,/HTTP สะดุดครั้งเดียวไม่สร้าง incident/);
  assert.match(html,/id="hosting-topology"/);
  assert.match(html,/id="site-environment"/);
  assert.match(html,/rel="icon"/);
  assert.match(html,/id="hosting-state" role="status" aria-live="polite"/);
  assert.match(html,/id="hosting-summary" class="hosting-summary" role="status" aria-live="polite" aria-atomic="true"/);
  assert.match(html,/id="inventory-search"/);
  assert.match(js,/ownershipLabel/);
  assert.match(js,/ตรวจพบจาก Nginx/);
  assert.match(js,/readOnly|อ่านอย่างเดียว/);
  assert.match(css,/ownership-discovered/);
  assert.match(css,/ownership-adopted/);
  assert.match(js,/observeHostingSite/);
  assert.match(js,/Observe-only/);
  assert.match(js,/เส้นทาง Production ยังพร้อม/);
  assert.equal((js.match(/function renderRecovery\(/g)||[]).length,1);
  assert.equal((js.match(/function renderTopology\(/g)||[]).length,1);
  assert.match(js,/renderOnboarding\(\)/);
  assert.match(html,/id="unhosted-panel"/);
  assert.match(js,/renderRecovery\(\)/);
  assert.match(js,/renderReliabilityAlerts\(\)/);
  assert.match(js,/renderTopology\(\)/);
  assert.match(js,/HTTP probe/);
  assert.match(js,/DNS reconcile/);
  assert.match(js,/Restore drill/);
  assert.match(js,/เก็บเข้าคลัง/);
  assert.match(js,/เปิดเผยแพร่อีกครั้ง/);
  assert.match(js,/ลบถาวรปิดอยู่/);
  assert.match(js,/loadOwnerSelfServiceStatus/);
  assert.doesNotMatch(js,/เว็บจริงยังออนไลน์|เว็บออนไลน์/);
  assert.match(js,/site-environment/);
  assert.match(css,/recovery-grid/);
  assert.match(css,/topology-list/);
  assert.match(adapter,/environment = 'PRODUCTION'/);
  assert.match(adapter,/\['PRODUCTION','STAGING','PREVIEW'\]/);
  assert.match(service,/'secretsConfigured'/);
  assert.doesNotMatch(service,/'secretCount'/);
  assert.match(service,/'managedPortRemaining'/);
  assert.match(service,/'tlsAttentionCount'/);
  assert.match(service,/hostingReliability/);
  assert.match(service,/hostingHttpProbes/);
  assert.match(service,/hostingDnsReconciliation/);
  assert.match(service,/HubEcosystemHealthService/);
  assert.match(service,/'singleHttpFailureCreatesAlert'=>false/);
  assert.match(service,/'permanentDeleteEnabled'=>false/);
  assert.match(service,/PERSISTED_OR_STRUCTURAL/);
  assert.doesNotMatch(js,/managedSiteAction\([^\n]*['"]delete['"]/);
  assert.match(css,/reliability-alert-list/);
  assert.match(css,/domain-chips/);
  assert.match(service,/'inventory'=>\$inventory\['sites'\]/);
  assert.match(service,/'readOnlyDiscovery'=>true/);
  assert.match(service,/HOSTING_OBSERVE_ADOPTION/);
  assert.match(service,/'observationOnly'=>true/);
  assert.match(service,/recentSiteEvents/);
  assert.match(adapter,/hosting\/adoptions/);
  assert.match(router,/hosting\/adoptions/);
  assert.match(service,/ownerMutation\(\$token,\$csrf,'hosting\.site\.create',\$now\)/);
  assert.doesNotMatch(service,/ownerMutation\(\$token,\$csrf,'hosting\.site\.observe_adopt'/);
  assert.match(telemetry,/function telemetryNginxSites/);
  assert.match(telemetry,/'sites' => telemetryNginxSites\(\)/);
  assert.match(infrastructure,/'sites' => array_slice\(\$sites, 0, 200\)/);
  assert.doesNotMatch(js,/fetch\([^)]*nginx|\/etc\/nginx|\/var\/www/);
});

test('Hosting Center inventory reconciliation stays bounded and safe',async()=>{
  const result=await execFileAsync('php',['hub/tests/m17-hosting-center.php'],{cwd:root});
  assert.match(result.stdout,/AWH Hosting Center Inventory: PASS/);
});
