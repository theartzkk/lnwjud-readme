<?php

declare(strict_types=1);
require_once dirname(__DIR__) . '/src/HubControlPlaneService.php';
if (!extension_loaded('pdo_sqlite')) { fwrite(STDOUT, "AWH Project List Schema Compatibility: SKIP required PHP extension unavailable\n"); exit(77); }

function compat_assert(bool $ok, string $message): void
{
    if (!$ok) throw new RuntimeException($message);
}

function compat_projects(int $schema): array
{
    $pdo = new PDO('sqlite::memory:', null, null, [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
    ]);
    $pdo->exec("CREATE TABLE projects(project_id TEXT PRIMARY KEY,name TEXT NOT NULL,type TEXT NOT NULL,created_at TEXT NOT NULL,source_revision TEXT,observed_at TEXT NOT NULL,provenance TEXT NOT NULL);");
    $pdo->exec("CREATE TABLE user_project_memberships(user_id TEXT NOT NULL,project_id TEXT NOT NULL,revoked_at TEXT);");
    $pdo->exec("CREATE TABLE project_memory(project_id TEXT NOT NULL,memory_file TEXT NOT NULL,status TEXT NOT NULL);");
    if ($schema >= 12) $pdo->exec("CREATE TABLE control_project_vaults(project_id TEXT PRIMARY KEY,active_revision_id TEXT);");
    if ($schema >= 21) $pdo->exec("ALTER TABLE projects ADD COLUMN canonical_source_authority TEXT;");
    $pdo->exec('PRAGMA user_version = ' . $schema);
    $pdo->exec("INSERT INTO projects VALUES('11111111-1111-4111-8111-111111111111','Compat','general','2026-01-01T00:00:00Z','source','2026-01-01T00:00:00Z','test'" . ($schema >= 21 ? ",'AWH_VAULT'" : '') . ")");
    $pdo->exec("INSERT INTO user_project_memberships VALUES('22222222-2222-4222-8222-222222222222','11111111-1111-4111-8111-111111111111',NULL)");
    if ($schema >= 12) $pdo->exec("INSERT INTO control_project_vaults VALUES('11111111-1111-4111-8111-111111111111','33333333-3333-4333-8333-333333333333')");

    $reflection = new ReflectionClass(HubControlPlaneService::class);
    $service = $reflection->newInstanceWithoutConstructor();
    $property = $reflection->getProperty('pdo');
    $property->setAccessible(true);
    $property->setValue($service, $pdo);
    $method = $reflection->getMethod('projectsForUser');
    $method->setAccessible(true);
    $projects = $method->invoke($service, '22222222-2222-4222-8222-222222222222');
    compat_assert(count($projects) === 1, "schema $schema must list the project");
    return $projects[0];
}

$m4 = compat_projects(4);
compat_assert($m4['vaultReady'] === false && $m4['sourceAuthority'] === null, 'M4 must not require Vault/source-authority columns');
$m12 = compat_projects(12);
compat_assert($m12['vaultReady'] === true && $m12['sourceAuthority'] === null, 'M12 must use Vault without M21 authority columns');
$m20 = compat_projects(20);
compat_assert($m20['vaultReady'] === true && $m20['sourceAuthority'] === null, 'M20 must remain compatible before M21 authority columns');
$m21 = compat_projects(21);
compat_assert($m21['vaultReady'] === true && $m21['sourceAuthority'] === 'AWH_VAULT' && $m21['sourceAuthorityState'] === 'READY', 'M21 must expose bound Vault authority');

fwrite(STDOUT, "AWH Project List Schema Compatibility: PASS\n");
