<?php
declare(strict_types=1);

require_once dirname(__DIR__) . '/src/HubLocalDecisionRouter.php';
require_once dirname(__DIR__) . '/src/HubDecisionFabricService.php';

function local_expect(bool $ok, string $message): void {
    if (!$ok) throw new RuntimeException($message);
}

$pdo = new PDO('sqlite::memory:');
$pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
$pdo->exec("CREATE TABLE control_tasks(
    goal TEXT,
    state TEXT,
    updated_at TEXT
)");
$pdo->prepare("INSERT INTO control_tasks(goal,state,updated_at) VALUES(?,?,?)")
    ->execute(['custom tool xyz failed on server','COMPLETED','2026-09-27T00:00:00Z']);

$router = new HubLocalDecisionRouter($pdo);

$web = $router->decideGoal('หน้าเว็บจริงยังไม่เปลี่ยนหลังอัปเดต');
local_expect($web['state'] === 'APPLIED' && $web['route'] === 'VPS_DIRECT', 'local web route failed');

$screen = $router->decideGoal('เช็คหน้าจอแล้วบอกเราที');
local_expect($screen['state'] === 'APPLIED' && $screen['route'] === 'REMOTE_DEVICE', 'local screen route failed');
$generic = $router->decideGoal('ทำต่อให้เสร็จ');
local_expect($generic['state'] === 'AUTO_FIT' && $generic['route'] === 'AUTO_FIT', 'generic request must stay AUTO_FIT');

$m5 = $router->decideGoal('deploy แล้วเปิด Safari บน M5 ตรวจ');
local_expect($m5['state'] === 'DETERMINISTIC_ROUTE' && $m5['route'] === 'DIRECT_PLUS_REMOTE', 'M5 alias hard route failed');

$learned = $router->decideGoal('custom tool xyz ช่วยแก้ที');
local_expect($learned['state'] === 'APPLIED' && $learned['route'] === 'VPS_DIRECT', 'completed-task route memory was not learned');

$status = $router->status();
local_expect(($status['active'] ?? false) === true, 'local router must be active');
local_expect(($status['costClass'] ?? null) === 'LOCAL_INCLUDED', 'local router must not require paid API');
local_expect(($status['networkRequired'] ?? true) === false, 'local router must not require network');
local_expect((int)($status['exampleCount'] ?? 0) > 40, 'route memory example count is unexpectedly small');

$root = sys_get_temp_dir() . '/awh-local-decision-' . bin2hex(random_bytes(4));
putenv('AWH_PROVIDER_CREDENTIAL_ROOT=' . $root);
$store = new HubProviderCredentialStore($root, 'typesafe');
$externalCalls = 0;
$externalAdapter = new HubTypeSafeDecisionAdapter(
    static function (array $payload, string $credential) use (&$externalCalls): array {
        $externalCalls++;
        return [
            'model'=>'jev-fixture',
            'answers'=>[
                'intent'=>['type'=>'choice','choice'=>'infrastructure','confidence'=>0.96],
                'route'=>['type'=>'choice','choice'=>'vps_direct','confidence'=>0.94],
            ],
        ];
    }
);
$external = new HubSystemOneDecisionService($externalAdapter, $store);
$fabric = new HubDecisionFabricService($router, $external);

$localDecision = $fabric->decideGoal('หน้าเว็บจริงยังไม่เปลี่ยนหลังอัปเดต');
local_expect(($localDecision['provider'] ?? null) === 'awh-local', 'decision fabric did not prefer local router');
local_expect($externalCalls === 0, 'external fallback must not run when local route is accepted');

$ambiguous = $fabric->decideGoal('ทำต่อให้เสร็จ');
local_expect(($ambiguous['route'] ?? null) === 'AUTO_FIT', 'unconfigured external fallback must preserve AUTO_FIT');
local_expect($externalCalls === 0, 'unconfigured external fallback was called');

$store->replace('typesafe-fixture-key-1234567890');
$fallback = $fabric->decideGoal('ทำต่อให้เสร็จ');
local_expect(($fallback['provider'] ?? null) === 'typesafe' && ($fallback['route'] ?? null) === 'VPS_DIRECT', 'optional Jev fallback failed');
local_expect($externalCalls === 1, 'optional Jev fallback call count mismatch');

$store->remove();
@rmdir($root);
putenv('AWH_PROVIDER_CREDENTIAL_ROOT');

echo "local-decision-router: PASS\n";
