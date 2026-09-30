<?php

declare(strict_types=1);

require_once __DIR__ . '/../src/HubDeviceRoleRegistry.php';

function assertTrue(bool $value, string $message): void
{
    if (!$value) throw new RuntimeException($message);
}

$path = sys_get_temp_dir() . '/awh-device-role-registry-' . bin2hex(random_bytes(4)) . '.json';
$workerId = '11111111-1111-4111-8111-111111111111';
file_put_contents($path, json_encode([
    'schemaVersion' => 1,
    'devices' => [
        [
            'key' => 'worker',
            'deviceId' => $workerId,
            'displayName' => 'Worker',
            'role' => 'GENERAL_PROJECT_WORKSTATION',
            'kind' => 'worker',
            'routingEnabled' => true,
            'requiresOwnerApproval' => false,
            'workloads' => ['QA'],
            'purpose' => 'test worker',
        ],
        [
            'key' => 'm5',
            'displayName' => 'M5',
            'role' => 'CREATIVE_PRIMARY_WORKSTATION',
            'kind' => 'external',
            'routingEnabled' => true,
            'requiresOwnerApproval' => false,
            'workloads' => ['VIDEO'],
            'purpose' => 'video only',
        ],
        [
            'key' => 'backup',
            'displayName' => 'Art-PC',
            'role' => 'OFFSITE_BACKUP',
            'kind' => 'external',
            'routingEnabled' => false,
            'backupConfigured' => false,
            'workloads' => ['BACKUP'],
            'purpose' => 'backup',
        ],
    ],
], JSON_THROW_ON_ERROR));

try {
    $registry = new HubDeviceRoleRegistry($path);
    assertTrue($registry->claimAllowed($workerId), 'registered worker must be routable');
    assertTrue($registry->claimAllowed('22222222-2222-4222-8222-222222222222'), 'unclassified legacy worker must remain backward compatible');
    assertTrue($registry->claimAllowed('22222222-2222-4222-8222-222222222222', 'M5'), 'device role must not hard-block an authenticated capable worker');
    assertTrue($registry->claimAllowed('22222222-2222-4222-8222-222222222222', 'VIDEO'), 'creative workstation must remain routable for declared creative work');
    assertTrue(!$registry->capabilityAllowed($workerId, 'Worker', 'local.ai.fallback'), 'general worker must not provision local AI fallback by default');
    assertTrue(!$registry->capabilityAllowed($workerId, 'Worker', 'media.transform'), 'general worker must not provision heavy media transform by default');
    assertTrue($registry->capabilityAllowed('22222222-2222-4222-8222-222222222222', 'M5', 'local.ai.fallback'), 'creative role may use local AI fallback when runtime resource gates also pass');
    assertTrue($registry->capabilityAllowed('22222222-2222-4222-8222-222222222222', 'M5', 'media.transcribe'), 'creative role may use heavy media tooling');
    assertTrue(!$registry->capabilityAllowed('33333333-3333-4333-8333-333333333333', 'Unknown', 'local.ai.fallback'), 'unclassified device must fail closed for heavy local AI');
    assertTrue($registry->capabilityAllowed('33333333-3333-4333-8333-333333333333', 'Unknown', 'code.semantic'), 'unclassified device stays backward compatible for non-heavy capability');
    $workers = $registry->decorateWorkers([[
        'deviceId' => $workerId,
        'displayName' => 'Worker',
        'state' => 'READY',
        'lastSeenAt' => gmdate('c'),
        'platform' => 'darwin',
    ]]);
    assertTrue(($workers[0]['role'] ?? null) === 'GENERAL_PROJECT_WORKSTATION', 'worker role must be projected');
    assertTrue(($workers[0]['routingEnabled'] ?? false) === true, 'worker routing state must be projected');
    $rotated = $registry->decorateWorkers([[
        'deviceId' => '44444444-4444-4444-8444-444444444444',
        'displayName' => 'Worker',
        'state' => 'READY',
        'lastSeenAt' => gmdate('c'),
        'platform' => 'darwin',
    ]]);
    assertTrue(($rotated[0]['role'] ?? null) === 'GENERAL_PROJECT_WORKSTATION', 'unique display-name fallback must preserve role across device-id rotation');
    $projection = $registry->projection($workers);
    assertTrue(($projection['state'] ?? null) === 'READY', 'registry projection must be ready');
    assertTrue(($projection['backupCoverage']['state'] ?? null) === 'NOT_CONFIGURED', 'off-site backup must stay truthful');
    assertTrue(count($projection['devices'] ?? []) === 3, 'all configured roles must be visible');
    echo "device-role-registry: PASS\n";
} finally {
    @unlink($path);
}
