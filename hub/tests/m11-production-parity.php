<?php

declare(strict_types=1);

/**
 * Executes the release migration CLI contract against a protected, disposable
 * copy of a verified production M7 database.  The source database is never
 * opened for write and no database contents are emitted.
 *
 * Usage: php hub/tests/m11-production-parity.php /safe/path/to/m7.sqlite
 */

if (!in_array('sqlite', PDO::getAvailableDrivers(), true)) { fwrite(STDOUT, "AWH M11 production parity: SKIP pdo_sqlite extension unavailable\n"); exit(77); }
if ($argc !== 2 || !is_string($argv[1]) || $argv[1] === '' || str_contains($argv[1], "\0") || !is_file($argv[1])) { fwrite(STDERR, "Usage: m11-production-parity.php VERIFIED_M7_DATABASE_PATH\n"); exit(2); }

function m11_parity_assert(bool $condition, string $code): void { if (!$condition) throw new RuntimeException($code); }
function m11_parity_open(string $path): PDO { return new PDO('sqlite:' . $path, null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC]); }
/** @param array<string,string> $overrides @return array<string,string> */
function m11_parity_environment(array $overrides = []): array { $base = getenv(); return array_merge(is_array($base) ? $base : [], $overrides); }
/** @param list<string> $command */
function m11_parity_run(array $command, array $environment, string $code, ?int $expectedExit = 0): void {
    $pipes = []; $process = proc_open($command, [0 => ['pipe', 'r'], 1 => ['pipe', 'w'], 2 => ['pipe', 'w']], $pipes, null, $environment);
    if (!is_resource($process)) throw new RuntimeException($code . '_PROCESS');
    fclose($pipes[0]); stream_get_contents($pipes[1]); fclose($pipes[1]); stream_get_contents($pipes[2]); fclose($pipes[2]);
    $exit = proc_close($process);
    if ($exit !== $expectedExit) throw new RuntimeException($code . '_EXIT_' . $exit);
}
function m11_parity_health(string $database, int $version): void {
    $pdo = m11_parity_open($database);
    m11_parity_assert((int) $pdo->query('PRAGMA user_version')->fetchColumn() === $version, 'USER_VERSION_' . $version);
    m11_parity_assert((string) $pdo->query('PRAGMA integrity_check')->fetchColumn() === 'ok', 'INTEGRITY');
    m11_parity_assert($pdo->query('PRAGMA foreign_key_check')->fetchAll() === [], 'FOREIGN_KEYS');
}
function m11_parity_cleanup(string $root): void {
    if (!is_dir($root)) return;
    foreach (scandir($root) ?: [] as $entry) {
        if ($entry === '.' || $entry === '..') continue;
        $path = $root . '/' . $entry;
        if (is_dir($path)) { foreach (scandir($path) ?: [] as $child) if ($child !== '.' && $child !== '..') @unlink($path . '/' . $child); @rmdir($path); }
        else @unlink($path);
    }
    @rmdir($root);
}

$source = $argv[1];
$root = sys_get_temp_dir() . '/awh-m11-production-parity-' . bin2hex(random_bytes(8));
$base = $root . '/verified-m7.sqlite';
$php = PHP_BINARY;
$sqlite = getenv('AWH_SQLITE3_BIN') ?: 'sqlite3';
$hub = dirname(__DIR__);
$m8 = $hub . '/bin/migrate-unified-workspace.php';
$m9 = $hub . '/bin/migrate-final-product.php';
$m10 = $hub . '/bin/migrate-founding-memory.php';
$m11 = $hub . '/bin/migrate-self-service.php';
$m8Sql = $hub . '/migrations/007_unified_workspace.sql';

try {
    mkdir($root, 0700, true); m11_parity_assert(copy($source, $base), 'BASELINE_COPY'); chmod($base, 0600); m11_parity_health($base, 7);
    $baselineLedger = m11_parity_open($base)->query("SELECT count(*) FROM awh_schema_migrations WHERE migration_id = 'm7-workspace-continuity' AND schema_version = 7")->fetchColumn();
    m11_parity_assert((int) $baselineLedger === 1, 'M7_LEDGER');

    // Reproduce the rejected pre-repair production invocation exactly.  It
    // must fail before any M9 schema or ledger mutation, proving the failure
    // is the release runner's CLI arity rather than production data.
    $arityDb = $root . '/arity.sqlite'; copy($base, $arityDb); chmod($arityDb, 0600);
    $arityAttachmentRoot = $root . '/arity-attachments'; mkdir($arityAttachmentRoot, 0700, true);
    $arityEnv = m11_parity_environment(['AWH_HUB_DB_PATH' => $arityDb, 'AWH_ATTACHMENT_ROOT' => $arityAttachmentRoot]);
    m11_parity_run([$php, $m8, $arityDb, $m8Sql], $arityEnv, 'M8_ARITY_PREPARE');
    m11_parity_run([$php, $m9, $arityDb, $hub . '/migrations/008_final_product.sql'], $arityEnv, 'M9_PRE_REPAIR_ARITY', 2);
    $arityPdo = m11_parity_open($arityDb);
    m11_parity_assert((int) $arityPdo->query('PRAGMA user_version')->fetchColumn() === 8, 'M9_ARITY_VERSION_UNCHANGED');
    m11_parity_assert((int) $arityPdo->query("SELECT count(*) FROM awh_schema_migrations WHERE migration_id = 'm9-final-product'")->fetchColumn() === 0, 'M9_ARITY_LEDGER_UNCHANGED');

    for ($run = 1; $run <= 2; $run++) {
        $database = $root . '/chain-' . $run . '.sqlite'; $attachments = $root . '/chain-' . $run . '-attachments';
        copy($base, $database); chmod($database, 0600); mkdir($attachments, 0700, true);
        $env = m11_parity_environment(['AWH_HUB_DB_PATH' => $database, 'AWH_ATTACHMENT_ROOT' => $attachments]);
        // These are the canonical activation CLI shapes.  M8 owns an explicit
        // staged SQL path; M9--M11 own their reviewed paths internally.
        m11_parity_run([$php, $m8, $database, $m8Sql], $env, 'M8_FIRST_' . $run);
        m11_parity_run([$php, $m9, $database], $env, 'M9_FIRST_' . $run);
        m11_parity_run([$php, $m10, $database], $env, 'M10_FIRST_' . $run);
        m11_parity_run([$php, $m11, $database], $env, 'M11_FIRST_' . $run);
        m11_parity_run([$php, $m8, $database, $m8Sql], $env, 'M8_IDEMPOTENT_' . $run);
        m11_parity_run([$php, $m9, $database], $env, 'M9_IDEMPOTENT_' . $run);
        m11_parity_run([$php, $m10, $database], $env, 'M10_IDEMPOTENT_' . $run);
        m11_parity_run([$php, $m11, $database], $env, 'M11_IDEMPOTENT_' . $run);
        m11_parity_health($database, 11);
        $ledger = m11_parity_open($database)->query("SELECT count(*) FROM awh_schema_migrations WHERE migration_id IN ('m8-unified-workspace', 'm9-final-product', 'm10-founding-memory', 'm11-self-service') AND schema_version IN (8, 9, 10, 11)")->fetchColumn();
        m11_parity_assert((int) $ledger === 4, 'FINAL_LEDGER_' . $run);
        if ($run === 1) {
            $rollbackBackup = $root . '/rollback-v7.sqlite';
            $rollbackTarget = $root . '/rollback-target.sqlite'; copy($database, $rollbackTarget); chmod($rollbackTarget, 0600);
            // Match the production rollback primitive: a verified SQLite
            // backup is restored atomically onto the migrated database copy.
            m11_parity_run([$sqlite, $base, ".backup '$rollbackBackup'"], m11_parity_environment(), 'ROLLBACK_BACKUP');
            m11_parity_run([$sqlite, $rollbackTarget, ".restore '$rollbackBackup'"], m11_parity_environment(), 'ROLLBACK_RESTORE');
            m11_parity_health($rollbackTarget, 7);
            $rollbackM9 = m11_parity_open($rollbackTarget)->query("SELECT count(*) FROM awh_schema_migrations WHERE migration_id = 'm9-final-product'")->fetchColumn();
            m11_parity_assert((int) $rollbackM9 === 0, 'ROLLBACK_LEDGER');
        }
    }
    m11_parity_health($base, 7);
    fwrite(STDOUT, "M11_PRODUCTION_PARITY=PASS\nM11_PRODUCTION_PARITY_ARITY=PASS\nM11_PRODUCTION_PARITY_FRESH_BASELINES=2\nM11_PRODUCTION_PARITY_ROLLBACK=PASS\n");
} catch (Throwable $error) {
    fwrite(STDERR, "M11_PRODUCTION_PARITY_FAILED=" . preg_replace('/[^A-Z0-9_.-]/', '_', $error->getMessage()) . "\n");
    exit(1);
} finally {
    m11_parity_cleanup($root);
}
