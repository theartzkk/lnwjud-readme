<?php
declare(strict_types=1);
require_once dirname(__DIR__) . '/src/HubSystemOneDecisionService.php';

function expect_true(bool $ok, string $message): void {
    if (!$ok) throw new RuntimeException($message);
}

$root = sys_get_temp_dir() . '/awh-jev-' . bin2hex(random_bytes(4));
putenv('AWH_PROVIDER_CREDENTIAL_ROOT=' . $root);
$store = new HubProviderCredentialStore($root, 'typesafe');
$store->replace('typesafe-fixture-key-1234567890');
$calls = 0;
$adapter = new HubTypeSafeDecisionAdapter(
    static function (array $payload, string $credential) use (&$calls): array {
        $calls++;
        expect_true($credential === 'typesafe-fixture-key-1234567890', 'fixture credential mismatch');
        return [
            'model' => 'jev-fixture',
            'answers' => [
                'intent' => ['type'=>'choice','choice'=>'infrastructure','confidence'=>0.96,'probabilities'=>[]],
                'route' => ['type'=>'choice','choice'=>'vps_direct','confidence'=>0.94,'probabilities'=>[]],
            ],
            'usage' => ['input_tokens'=>12,'output_tokens'=>0],
        ];
    }
);
$service = new HubSystemOneDecisionService($adapter, $store);
$hard = $service->decideGoal('restart service on vps');
expect_true($hard['state'] === 'DETERMINISTIC_ROUTE', 'hard route must remain deterministic');
expect_true($hard['route'] === 'VPS_DIRECT', 'hard route changed');
expect_true($calls === 0, 'Jev must not run when deterministic route is known');
$guard = $service->decideGoal('finish this api_key=supersecretvalue123456');
expect_true($guard['state'] === 'SECRET_GUARD', 'credential-like state must not leave AWH');
expect_true($calls === 0, 'Jev must not receive credential-like state');

$advisory = $service->decideGoal('make this reliable and finish it');
expect_true($advisory['state'] === 'APPLIED', 'ambiguous route did not use Jev');
expect_true($advisory['route'] === 'VPS_DIRECT', 'Jev route mapping failed');
expect_true($calls === 1, 'Jev call count mismatch');

$lowAdapter = new HubTypeSafeDecisionAdapter(static fn(array $payload, string $credential): array => [
    'model'=>'jev-fixture',
    'answers'=>[
        'intent'=>['type'=>'choice','choice'=>'other','confidence'=>0.7,'probabilities'=>[]],
        'route'=>['type'=>'choice','choice'=>'remote_device','confidence'=>0.6,'probabilities'=>[]],
    ],
]);
$low = (new HubSystemOneDecisionService($lowAdapter, $store))->decideGoal('finish this properly');
expect_true($low['state'] === 'LOW_CONFIDENCE' && $low['route'] === 'AUTO_FIT', 'low confidence must fall back');

$downAdapter = new HubTypeSafeDecisionAdapter(static function (): array {
    throw new HubTypeSafeDecisionException('fixture unavailable', 'JEV_UNAVAILABLE');
});
$down = (new HubSystemOneDecisionService($downAdapter, $store))->decideGoal('finish this properly');
expect_true($down['state'] === 'PROVIDER_FALLBACK' && $down['route'] === 'AUTO_FIT', 'provider failure must fall back');

$store->remove();
@rmdir($root);
putenv('AWH_PROVIDER_CREDENTIAL_ROOT');
echo "system-one-decision: PASS\n";
