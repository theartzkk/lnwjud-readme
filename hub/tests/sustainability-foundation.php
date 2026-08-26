<?php

declare(strict_types=1);

require_once dirname(__DIR__) . '/src/HubBackupService.php';

function expect(bool $condition, string $message): void { if (!$condition) throw new RuntimeException($message); }
function expectBackupCode(callable $operation, string $code): void
{
    try { $operation(); }
    catch (HubBackupException $error) { expect($error->codeName === $code, "expected {$code}, got {$error->codeName}"); return; }
    throw new RuntimeException("expected {$code}");
}
function removeTree(string $path): void
{
    if (!is_dir($path)) return;
    foreach (scandir($path) ?: [] as $entry) {
        if ($entry === '.' || $entry === '..') continue;
        $item = $path . DIRECTORY_SEPARATOR . $entry;
        if (is_dir($item) && !is_link($item)) removeTree($item); else @unlink($item);
    }
    @rmdir($path);
}

$root = sys_get_temp_dir() . '/awh-sustainability-' . bin2hex(random_bytes(6));
$backupRoot = $root . '/backup';
$scratchRoot = $root . '/scratch';
mkdir($backupRoot, 0700, true);
mkdir($scratchRoot, 0700, true);
$db = $root . '/authority.sqlite';

try {
    $pdo = new PDO('sqlite:' . $db, null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
    $pdo->exec('PRAGMA foreign_keys = ON');
    $pdo->exec('PRAGMA journal_mode = WAL');
    $pdo->exec('PRAGMA user_version = 17');
    $pdo->exec('CREATE TABLE parent (id INTEGER PRIMARY KEY, name TEXT NOT NULL)');
    $pdo->exec('CREATE TABLE child (id INTEGER PRIMARY KEY, parent_id INTEGER NOT NULL REFERENCES parent(id), value TEXT NOT NULL)');
    $pdo->exec("INSERT INTO parent(id,name) VALUES(1,'authority')");
    $pdo->exec("INSERT INTO child(id,parent_id,value) VALUES(1,1,'durable')");
    $sourceHash = hash_file('sha256', $db);
    expect(is_string($sourceHash), 'source hash missing');

    $created = HubBackupService::create($db, $backupRoot, '2026-08-26T12:00:00Z');
    expect(is_file($created['backupPath']), 'backup payload missing');
    expect(is_file($created['manifestPath']), 'backup manifest missing');
    expect(($created['manifest']['databaseUserVersion'] ?? null) === 17, 'schema version not captured');
    expect(hash_file('sha256', $db) === $sourceHash, 'backup mutated source database');

    $verified = HubBackupService::verify($created['backupPath'], $created['manifestPath']);
    expect($verified['databaseUserVersion'] === 17, 'verified schema mismatch');
    expect($verified['sha256'] === $created['manifest']['sha256'], 'verified hash mismatch');
    $latest = HubBackupService::latestMetadata($backupRoot);
    expect(($latest['latest']['status'] ?? null) === 'VERIFIED', 'latest backup not verified');

    $drill = HubBackupService::restoreDrill($created['backupPath'], $created['manifestPath'], $scratchRoot);
    expect($drill['status'] === 'PASS', 'restore drill did not pass');

    $tampered = $backupRoot . '/tampered.json';
    $manifest = $created['manifest'];
    $manifest['sha256'] = str_repeat('0', 64);
    file_put_contents($tampered, json_encode($manifest, JSON_PRETTY_PRINT | JSON_THROW_ON_ERROR));
    expectBackupCode(fn () => HubBackupService::verify($created['backupPath'], $tampered), 'BACKUP_MANIFEST_MISMATCH');
    expectBackupCode(fn () => HubBackupService::create($db, $backupRoot, '2026-08-26T12:00:00Z'), 'BACKUP_EXISTS');

    $bad = $root . '/bad.sqlite';
    $badPdo = new PDO('sqlite:' . $bad, null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
    $badPdo->exec('PRAGMA foreign_keys = OFF');
    $badPdo->exec('CREATE TABLE p (id INTEGER PRIMARY KEY)');
    $badPdo->exec('CREATE TABLE c (id INTEGER PRIMARY KEY, p_id INTEGER REFERENCES p(id))');
    $badPdo->exec('INSERT INTO c(id,p_id) VALUES(1,999)');
    $badPdo = null;
    expectBackupCode(fn () => HubBackupService::verify($bad), 'BACKUP_FOREIGN_KEY_FAILED');

    fwrite(STDOUT, "SUSTAINABILITY_FOUNDATION=PASS\n");
} finally {
    $pdo = null;
    removeTree($root);
}
