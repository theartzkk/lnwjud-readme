<?php

declare(strict_types=1);

require_once dirname(__DIR__) . '/src/HubBackupService.php';

const AWH_MORNING_BRIEF_KEY = 'system.morningBrief';

function out(array $value): never
{
    fwrite(STDOUT, json_encode($value, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PRETTY_PRINT | JSON_THROW_ON_ERROR) . PHP_EOL);
    exit(($value['state'] ?? '') === 'ERROR' ? 1 : 0);
}

$apply = in_array('--apply', $argv, true);
$vacuum = in_array('--vacuum', $argv, true);
$database = getenv('AWH_HUB_DB_PATH') ?: '/var/lib/awh-hub/awh.sqlite';
$backupRoot = getenv('AWH_HUB_BACKUP_ROOT') ?: '/var/backups/awh-hub';

if (!is_file($database) || is_link($database)) out(['schemaVersion'=>1,'state'=>'ERROR','code'=>'DATABASE_INVALID']);
if ($apply) {
    $metadata = HubBackupService::latestMetadata($backupRoot);
    $latest = is_array($metadata['latest'] ?? null) ? $metadata['latest'] : null;
    $freshness = HubBackupService::freshness($latest);
    if (($latest['status'] ?? null) !== 'VERIFIED' || ($freshness['state'] ?? null) !== 'FRESH') {
        out(['schemaVersion'=>1,'state'=>'ERROR','code'=>'FRESH_VERIFIED_BACKUP_REQUIRED','freshness'=>$freshness]);
    }
}

$pdo = new PDO('sqlite:' . $database, null, null, [
    PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
    PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
]);
$pdo->exec('PRAGMA foreign_keys=ON');
$pdo->exec('PRAGMA busy_timeout=7500');
$pdo->exec('PRAGMA journal_mode=WAL');
$pdo->exec('PRAGMA synchronous=NORMAL');

$query = $pdo->prepare('SELECT revision_id,revision_no,value_json,created_at FROM control_product_setting_revisions WHERE setting_key=:key ORDER BY revision_no DESC');
$query->execute(['key'=>AWH_MORNING_BRIEF_KEY]);
$rows = $query->fetchAll();

$keepDates = [];
$keep = [];
$delete = [];
$invalid = 0;
$deleteBytes = 0;
foreach ($rows as $row) {
    $id = (string)($row['revision_id'] ?? '');
    $raw = (string)($row['value_json'] ?? '');
    try { $value = json_decode($raw, true, 32, JSON_THROW_ON_ERROR); }
    catch (Throwable) { $value = null; }
    $date = is_array($value) && is_string($value['briefDate'] ?? null) && preg_match('/^\d{4}-\d{2}-\d{2}$/D', $value['briefDate']) === 1 ? $value['briefDate'] : null;
    if ($date === null) {
        $invalid++;
        $keep[] = $id;
        continue;
    }
    if (!isset($keepDates[$date])) {
        $keepDates[$date] = true;
        $keep[] = $id;
        continue;
    }
    $delete[] = $id;
    $deleteBytes += strlen($raw);
}

$maxRevision = $rows === [] ? 0 : (int)$rows[0]['revision_no'];
$result = [
    'schemaVersion'=>1,
    'state'=>$apply ? 'READY_TO_APPLY' : 'DRY_RUN',
    'settingKey'=>AWH_MORNING_BRIEF_KEY,
    'rows'=>count($rows),
    'days'=>count($keepDates),
    'kept'=>count($keep),
    'invalidRetained'=>$invalid,
    'deleteCandidates'=>count($delete),
    'candidatePayloadBytes'=>$deleteBytes,
    'vacuumRequested'=>$vacuum,
];

if (!$apply) out($result);

$pdo->exec('BEGIN IMMEDIATE');
try {
    $currentMax = (int)$pdo->query("SELECT COALESCE(MAX(revision_no),0) FROM control_product_setting_revisions WHERE setting_key=" . $pdo->quote(AWH_MORNING_BRIEF_KEY))->fetchColumn();
    if ($currentMax !== $maxRevision) throw new RuntimeException('Morning Brief ledger changed during prune preflight');
    foreach (array_chunk($delete, 400) as $chunk) {
        $placeholders = implode(',', array_fill(0, count($chunk), '?'));
        $stmt = $pdo->prepare("DELETE FROM control_product_setting_revisions WHERE setting_key=? AND revision_id IN ($placeholders)");
        $stmt->execute(array_merge([AWH_MORNING_BRIEF_KEY], $chunk));
    }
    $pdo->exec('COMMIT');
} catch (Throwable $error) {
    if ($pdo->inTransaction()) $pdo->rollBack();
    out(array_merge($result, ['state'=>'ERROR','code'=>'PRUNE_ABORTED','message'=>$error->getMessage()]));
}

if ($vacuum) $pdo->exec('VACUUM');
$integrity = $pdo->query('PRAGMA integrity_check')->fetchColumn();
$foreign = $pdo->query('PRAGMA foreign_key_check')->fetchAll();
$remaining = (int)$pdo->query("SELECT COUNT(*) FROM control_product_setting_revisions WHERE setting_key=" . $pdo->quote(AWH_MORNING_BRIEF_KEY))->fetchColumn();

out(array_merge($result, [
    'state'=>'APPLIED',
    'deleted'=>count($delete),
    'remaining'=>$remaining,
    'integrity'=>$integrity === 'ok' ? 'PASS' : 'FAIL',
    'foreignKeys'=>$foreign === [] ? 'PASS' : 'FAIL',
]));
