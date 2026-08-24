<?php

declare(strict_types=1);

/**
 * Applies M12 only to a deliberately supplied COPY of an M11 database.  This
 * is the production-parity release gate; it never discovers or opens the live
 * ReadyIDC database on its own.
 */
require_once dirname(__DIR__) . '/src/HubCentralProjectAuthorityMigration.php';

$copy = getenv('AWH_M12_PRODUCTION_PARITY_DB');
$confirmed = getenv('AWH_M12_PRODUCTION_PARITY_CONFIRMED');
if (!is_string($copy) || $copy === '' || $confirmed !== '1') {
    fwrite(STDOUT, "AWH M12 production parity: SKIP safe M11 database copy was not supplied\n");
    exit(77);
}
$resolved = realpath($copy);
if ($resolved === false || !is_file($resolved) || is_link($resolved) || !is_readable($resolved) || str_starts_with($resolved, '/var/lib/awh-hub/')) {
    fwrite(STDERR, "AWH M12 production parity: refused unsafe database path\n");
    exit(2);
}
if (!in_array('sqlite', PDO::getAvailableDrivers(), true)) {
    fwrite(STDOUT, "AWH M12 production parity: SKIP pdo_sqlite unavailable\n");
    exit(77);
}

try {
    $pdo = new PDO('sqlite:' . $resolved, null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC]);
    $pdo->exec('PRAGMA foreign_keys = ON');
    if ((int) $pdo->query('PRAGMA user_version')->fetchColumn() !== 11) throw new RuntimeException('copy is not an M11 database');
    $m11 = $pdo->query("SELECT count(*) FROM awh_schema_migrations WHERE migration_id = 'm11-self-service' AND schema_version = 11")->fetchColumn();
    if ((int) $m11 !== 1) throw new RuntimeException('M11 migration ledger is not authoritative');
    $sql = dirname(__DIR__) . '/migrations/011_central_project_authority.sql';
    if (HubCentralProjectAuthorityMigration::apply($resolved, $sql) !== 'applied') throw new RuntimeException('M12 first application did not apply');
    if (HubCentralProjectAuthorityMigration::apply($resolved, $sql) !== 'already-applied') throw new RuntimeException('M12 second application was not idempotent');
    $check = new PDO('sqlite:' . $resolved, null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC]);
    $check->exec('PRAGMA foreign_keys = ON');
    if ((int) $check->query('PRAGMA user_version')->fetchColumn() !== 12) throw new RuntimeException('M12 version is not final');
    if ($check->query('PRAGMA integrity_check')->fetchColumn() !== 'ok' || $check->query('PRAGMA foreign_key_check')->fetchAll() !== []) throw new RuntimeException('M12 integrity failed');
    $ledger = $check->query("SELECT count(*) FROM awh_schema_migrations WHERE migration_id = 'm12-central-project-authority' AND schema_version = 12")->fetchColumn();
    if ((int) $ledger !== 1) throw new RuntimeException('M12 ledger is not exact');
    fwrite(STDOUT, "AWH M12 production parity: PASS v11-to-v12 idempotent integrity/FK/ledger\n");
} catch (Throwable $error) {
    fwrite(STDERR, "AWH M12 production parity: FAIL " . ($error instanceof RuntimeException ? $error->getMessage() : 'migration error') . "\n");
    exit(1);
}
