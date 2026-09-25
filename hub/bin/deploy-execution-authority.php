<?php

declare(strict_types=1);

require_once dirname(__DIR__) . '/src/HubDeployExecutionAuthorityService.php';

$action = strtolower($argv[1] ?? '');
$db = $argv[2] ?? '';
if ($db === '' || str_contains($db, "\0")) { fwrite(STDERR, "DEPLOY_AUTHORITY_INVALID\n"); exit(2); }

try {
    $pdo = new PDO('sqlite:' . $db, null, null, [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
    ]);
    $service = new HubDeployExecutionAuthorityService($pdo);
    if ($action === 'acquire') {
        $release = $argv[3] ?? '';
        $seconds = isset($argv[4]) ? (int)$argv[4] : 1800;
        $result = $service->acquire($release, $seconds);
        fwrite(STDOUT, "DEPLOY_AUTHORITY=ACQUIRED\n");
        fwrite(STDOUT, "DEPLOY_AUTHORITY_EXECUTION_ID=" . $result['executionId'] . "\n");
        fwrite(STDOUT, "DEPLOY_AUTHORITY_LEASE_EXPIRES=" . $result['leaseExpiresAt'] . "\n");
        fwrite(STDOUT, "DEPLOY_AUTHORITY_BORROWED=" . (($result['borrowed'] ?? false) ? '1' : '0') . "\n");
        exit(0);
    }
    if ($action === 'verify') {
        $execution = $argv[3] ?? '';
        $seconds = isset($argv[4]) ? (int)$argv[4] : 1800;
        $result = $service->verify($execution, $seconds);
        fwrite(STDOUT, "DEPLOY_AUTHORITY=VERIFIED\n");
        fwrite(STDOUT, "DEPLOY_AUTHORITY_EXECUTION_ID=" . $result['executionId'] . "\n");
        fwrite(STDOUT, "DEPLOY_AUTHORITY_LEASE_EXPIRES=" . $result['leaseExpiresAt'] . "\n");
        exit(0);
    }
    if ($action === 'release') {
        $execution = $argv[3] ?? '';
        $outcome = strtolower($argv[4] ?? '');
        if (!in_array($outcome, ['success','failure'], true)) { fwrite(STDERR, "DEPLOY_AUTHORITY_INVALID\n"); exit(2); }
        $service->release($execution, $outcome === 'success');
        fwrite(STDOUT, "DEPLOY_AUTHORITY=RELEASED\n");
        exit(0);
    }
    if ($action === 'reconcile') {
        $result = $service->reconcile();
        fwrite(STDOUT, "DEPLOY_AUTHORITY=RECONCILED\n");
        fwrite(STDOUT, "DEPLOY_AUTHORITY_TERMINAL_RELEASED=" . $result['releasedTerminal'] . "\n");
        fwrite(STDOUT, "DEPLOY_AUTHORITY_EXPIRED_RELEASED=" . $result['releasedExpired'] . "\n");
        exit(0);
    }
    fwrite(STDERR, "usage: deploy-execution-authority.php acquire <db> <release-id> [lease-seconds] | verify <db> <execution-id> [lease-seconds] | release <db> <execution-id> <success|failure> | reconcile <db>\n");
    exit(2);
} catch (HubDeployExecutionAuthorityException $error) {
    fwrite(STDERR, "DEPLOY_AUTHORITY_FAILED=" . $error->codeName . "\n");
    exit($error->codeName === 'DEPLOY_AUTHORITY_CONFLICT' ? 3 : 1);
} catch (Throwable) {
    fwrite(STDERR, "DEPLOY_AUTHORITY_FAILED=DEPLOY_AUTHORITY_FAILED\n");
    exit(1);
}
