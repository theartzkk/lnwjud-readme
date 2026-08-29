<?php

declare(strict_types=1);

require_once dirname(__DIR__) . '/src/HubProjectVaultService.php';

if ($argc !== 4) {
    fwrite(STDERR, "Usage: php sync-deployed-source-vault.php <database> <source.zip> <release-sha>\n");
    exit(2);
}
[$script, $databasePath, $archivePath, $releaseSha] = $argv;
if ($databasePath === '' || str_contains($databasePath, "\0") || $archivePath === '' || str_contains($archivePath, "\0") || !is_file($archivePath) || is_link($archivePath) || !is_readable($archivePath) || preg_match('/^[0-9a-f]{40,64}$/i', $releaseSha) !== 1) {
    fwrite(STDERR, "Deployed source Vault input is invalid\n");
    exit(3);
}

$pdo = new PDO('sqlite:' . $databasePath, null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC, PDO::ATTR_EMULATE_PREPARES => false]);
$pdo->exec('PRAGMA foreign_keys = ON');
$pdo->exec('PRAGMA busy_timeout = 5000');
$schemaVersion = (int) $pdo->query('PRAGMA user_version')->fetchColumn();
if (!in_array($schemaVersion, [12, 13, 14, 15, 16], true)) {
    fwrite(STDERR, "Central Project Authority schema is not ready\n");
    exit(4);
}
$owner = $pdo->query('SELECT owner_user_id FROM owner_bootstrap WHERE singleton_id=1 AND bootstrap_closed=1')->fetchColumn();
if (!is_string($owner) || preg_match('/^[0-9a-f-]{36}$/i', $owner) !== 1) {
    fwrite(STDERR, "Owner authority is unavailable\n");
    exit(5);
}
$q = $pdo->prepare("SELECT p.project_id FROM projects p JOIN user_project_memberships m ON m.project_id=p.project_id AND m.user_id=:owner AND m.revoked_at IS NULL WHERE p.name='Art’s Workspace Hub' ORDER BY p.project_id LIMIT 2");
$q->execute(['owner' => $owner]); $projects = $q->fetchAll();
if (count($projects) !== 1 || !is_string($projects[0]['project_id'] ?? null)) {
    fwrite(STDERR, "Canonical AWH Project is ambiguous or unavailable\n");
    exit(6);
}
$projectId = (string) $projects[0]['project_id']; $service = HubProjectVaultService::fromEnvironment($pdo); $createdRevision = null;
try {
    $pdo->exec('BEGIN IMMEDIATE'); $before = $service->activeRevision($projectId); $at = gmdate('c');
    $result = $service->ingestArchive($projectId, $archivePath, $owner, null, $before, $at);
    if (($result['changed'] ?? false) === true) {
        $createdRevision = is_string($result['createdRevisionId'] ?? null) ? (string) $result['createdRevisionId'] : null;
        if (($result['promotionRequired'] ?? false) === true) {
            if (!is_string($before) || !is_string($createdRevision)) throw new RuntimeException('Vault promotion authority is incomplete');
            $service->promote($projectId, $createdRevision, $before, $at);
        }
    } elseif (is_string($result['duplicateRevisionId'] ?? null) && (string) ($result['activeRevisionId'] ?? '') !== (string) $result['duplicateRevisionId']) {
        throw new RuntimeException('Duplicate source is not the active canonical revision');
    }
    $state = $service->state($projectId); if (!is_string($state['activeRevisionId'] ?? null)) throw new RuntimeException('Canonical source revision is unavailable');
    $pdo->prepare('UPDATE projects SET source_revision=:release, observed_at=:at, provenance=:provenance WHERE project_id=:project')->execute(['release' => strtolower($releaseSha), 'at' => $at, 'provenance' => 'release-vault:' . substr(strtolower($releaseSha), 0, 12), 'project' => $projectId]);
    $pdo->exec('COMMIT');
} catch (Throwable $error) {
    try { $pdo->exec('ROLLBACK'); } catch (Throwable) {}
    if (is_string($createdRevision)) $service->vault()->removeRevision($projectId, $createdRevision);
    fwrite(STDERR, "Deployed source Vault sync failed closed\n");
    exit(7);
}
fwrite(STDOUT, "AWH deployed source Vault sync: PASS\n");
