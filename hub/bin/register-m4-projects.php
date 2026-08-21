<?php

declare(strict_types=1);

require_once dirname(__DIR__) . '/src/HubControlPlaneProjectRegistration.php';

$database = getenv('AWH_HUB_DB_PATH') ?: '/var/lib/awh-hub/awh.sqlite';
if ($database === '' || str_contains($database, "\0")) { fwrite(STDERR, "M4 project registration configuration is invalid\n"); exit(2); }
try {
    $pdo = new PDO('sqlite:' . $database, null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC]);
    $pdo->exec('PRAGMA foreign_keys = ON');
    $count = HubControlPlaneProjectRegistration::register($pdo);
    fwrite(STDOUT, "M4_PROJECT_REGISTRATION=PASS\nM4_PROJECTS_REGISTERED=" . $count . "\n");
} catch (Throwable $error) {
    fwrite(STDERR, "M4_PROJECT_REGISTRATION=FAIL\n");
    exit(1);
}
