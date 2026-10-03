import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import test from 'node:test';

const execFileAsync=promisify(execFile);
const root=process.cwd();

test('Hosting Center exposes reconciled read-only server inventory without a second deployment authority',async()=>{
  const [html,js,css,service,telemetry,infrastructure]=await Promise.all([
    readFile(new URL('../web/hosting.html',import.meta.url),'utf8'),
    readFile(new URL('../web/hosting.js',import.meta.url),'utf8'),
    readFile(new URL('../web/hosting.css',import.meta.url),'utf8'),
    readFile(new URL('../hub/src/HubManagedHostingService.php',import.meta.url),'utf8'),
    readFile(new URL('../hub/bin/system-telemetry.php',import.meta.url),'utf8'),
    readFile(new URL('../hub/src/HubInfrastructureService.php',import.meta.url),'utf8'),
  ]);
  assert.match(html,/AWH Hosting Center/);
  assert.match(html,/เว็บไซต์และ Subdomain ทั้งหมด/);
  assert.match(html,/id="hosting-kpis"/);
  assert.match(html,/id="domain-list"/);
  assert.match(html,/id="inventory-search"/);
  assert.match(js,/ownershipLabel/);
  assert.match(js,/ตรวจพบจาก Nginx/);
  assert.match(js,/readOnly|อ่านอย่างเดียว/);
  assert.match(css,/ownership-discovered/);
  assert.match(service,/'inventory'=>\$inventory\['sites'\]/);
  assert.match(service,/'readOnlyDiscovery'=>true/);
  assert.match(telemetry,/function telemetryNginxSites/);
  assert.match(telemetry,/'sites' => telemetryNginxSites\(\)/);
  assert.match(infrastructure,/'sites' => array_slice\(\$sites, 0, 200\)/);
  assert.doesNotMatch(js,/fetch\([^)]*nginx|\/etc\/nginx|\/var\/www/);
});

test('Hosting Center inventory reconciliation stays bounded and safe',async()=>{
  const result=await execFileAsync('php',['hub/tests/m17-hosting-center.php'],{cwd:root});
  assert.match(result.stdout,/AWH Hosting Center Inventory: PASS/);
});
