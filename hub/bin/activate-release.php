<?php

declare(strict_types=1);

const AWH_DB = '/var/lib/awh-hub/awh.sqlite';
const AWH_CONTROL_ROOT = '/opt/awh-hub/control-releases';
const AWH_CONTROL_POINTER = '/opt/awh-hub/control-plane-current';
const AWH_WEB_ROOT = '/var/www/awh-web/releases';
const AWH_WEB_POINTER = '/var/www/awh-web/current';

function activateFail(string $code, int $status = 2): never
{
    fwrite(STDERR, "AWH_RELEASE_ACTIVATE_FAILED={$code}\n");
    exit($status);
}

function boundedReleaseId(string $value): string
{
    if (!preg_match('/^m16-([0-9a-f]{12})(?:-r[1-9][0-9]*)?$/', $value)) activateFail('RELEASE_ID_INVALID');
    return $value;
}

function boundedCommit(string $value, string $releaseId): string
{
    if (!preg_match('/^[0-9a-f]{40}$/', $value)) activateFail('RELEASE_COMMIT_INVALID');
    if (!str_starts_with($releaseId, 'm16-' . substr($value, 0, 12))) activateFail('RELEASE_COMMIT_MISMATCH');
    return $value;
}
function requireFile(string $path, string $code): string
{
    if (!is_file($path) || !is_readable($path)) activateFail($code);
    return $path;
}

function readJson(string $path, string $code): array
{
    try {
        $value = json_decode((string) file_get_contents(requireFile($path, $code)), true, 32, JSON_THROW_ON_ERROR);
    } catch (Throwable) {
        activateFail($code);
    }
    if (!is_array($value)) activateFail($code);
    return $value;
}

function verifyWebManifest(string $root, string $releaseId): void
{
    $manifest = readJson($root . '/release.json', 'WEB_MANIFEST_INVALID');
    if (($manifest['releaseId'] ?? null) !== $releaseId || !is_array($manifest['files'] ?? null)) activateFail('WEB_RELEASE_ID_MISMATCH');
    foreach ($manifest['files'] as $entry) {
        if (!is_array($entry) || !is_string($entry['path'] ?? null) || !preg_match('#^[A-Za-z0-9._/-]+$#', $entry['path'])) activateFail('WEB_MANIFEST_INVALID');
        $path = $root . '/' . $entry['path'];
        if (!is_file($path) || is_link($path)) activateFail('WEB_FILE_INVALID');
        if (!hash_equals((string) ($entry['sha256'] ?? ''), hash_file('sha256', $path))) activateFail('WEB_HASH_MISMATCH');
    }
}
function verifyDatabase(): void
{
    try {
        $pdo = new PDO('sqlite:' . AWH_DB, null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC]);
        $pdo->exec('PRAGMA foreign_keys = ON');
        $pdo->exec('PRAGMA busy_timeout = 2500');
        if ((int) $pdo->query('PRAGMA user_version')->fetchColumn() !== 16) activateFail('DATABASE_SCHEMA_INVALID');
        if ((string) $pdo->query('PRAGMA integrity_check')->fetchColumn() !== 'ok') activateFail('DATABASE_INTEGRITY_FAILED');
        if ($pdo->query('PRAGMA foreign_key_check')->fetchAll() !== []) activateFail('DATABASE_FOREIGN_KEY_FAILED');
        $active = (int) $pdo->query("SELECT COUNT(*) FROM control_task_executions WHERE state IN ('LEASED','RUNNING')")->fetchColumn();
        if ($active !== 0) activateFail('EXECUTIONS_ACTIVE');
    } catch (PDOException) {
        activateFail('DATABASE_UNAVAILABLE');
    }
}

function copyWebTree(string $source, string $destination): void
{
    if (file_exists($destination) || is_link($destination)) activateFail('WEB_RELEASE_ALREADY_EXISTS');
    if (!mkdir($destination, 0750, true)) activateFail('WEB_RELEASE_CREATE_FAILED');
    $iterator = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($source, FilesystemIterator::SKIP_DOTS), RecursiveIteratorIterator::SELF_FIRST);
    foreach ($iterator as $item) {
        $relative = substr($item->getPathname(), strlen($source) + 1);
        $target = $destination . '/' . $relative;
        if ($item->isLink()) activateFail('WEB_SYMLINK_REJECTED');
        if ($item->isDir()) { if (!is_dir($target) && !mkdir($target, 0750, true)) activateFail('WEB_COPY_FAILED'); chmod($target, 0750); }
        else { if (!copy($item->getPathname(), $target)) activateFail('WEB_COPY_FAILED'); chmod($target, 0640); }
        @chgrp($target, 'www-data');
    }
    @chgrp($destination, 'www-data'); chmod($destination, 0750);
}
function currentTarget(string $pointer, string $root): string
{
    if (!is_link($pointer)) activateFail('CURRENT_POINTER_INVALID');
    $target = readlink($pointer);
    if (!is_string($target) || !str_starts_with($target, $root . '/') || !is_dir($target)) activateFail('CURRENT_POINTER_INVALID');
    return $target;
}

function swapPointer(string $pointer, string $target, string $suffix): void
{
    $temporary = dirname($pointer) . '/.' . basename($pointer) . '-' . $suffix;
    if (file_exists($temporary) || is_link($temporary)) @unlink($temporary);
    if (!symlink($target, $temporary)) activateFail('POINTER_STAGE_FAILED');
    if (!rename($temporary, $pointer)) { @unlink($temporary); activateFail('POINTER_SWITCH_FAILED'); }
    if (readlink($pointer) !== $target) activateFail('POINTER_VERIFY_FAILED');
}

function restorePointer(string $pointer, string $target, string $suffix): void
{
    $temporary = dirname($pointer) . '/.' . basename($pointer) . '-rollback-' . $suffix;
    @unlink($temporary);
    if (!symlink($target, $temporary) || !rename($temporary, $pointer) || readlink($pointer) !== $target) activateFail('ROLLBACK_FAILED', 3);
}

if (PHP_SAPI !== 'cli') activateFail('CLI_REQUIRED');
$mode = $argv[1] ?? '';
if (!in_array($mode, ['--dry-run', '--activate'], true) || $argc !== 4) activateFail('USAGE_INVALID');
$releaseId = boundedReleaseId(strtolower((string) $argv[2]));
$commit = boundedCommit(strtolower((string) $argv[3]), $releaseId);
if ($mode === '--activate' && function_exists('posix_geteuid') && posix_geteuid() !== 0) activateFail('ROOT_REQUIRED');
$release = AWH_CONTROL_ROOT . '/' . $releaseId;
$webSource = $release . '/dist-web';
$marker = trim((string) file_get_contents(requireFile($release . '/.awh-build/release-commit.txt', 'RELEASE_COMMIT_MARKER_MISSING')));
if (!hash_equals($commit, strtolower($marker))) activateFail('RELEASE_COMMIT_MARKER_MISMATCH');
requireFile($release . '/hub/src/HubControlPlaneService.php', 'CONTROL_RELEASE_INVALID');
requireFile($release . '/.awh-build/awh-source.zip', 'SOURCE_SNAPSHOT_MISSING');
$webConfig = readJson($webSource . '/web-config.json', 'WEB_CONFIG_INVALID');
$data = readJson($webSource . '/data.json', 'WEB_DATA_INVALID');
if (($webConfig['mode'] ?? null) !== 'CONTROL' || (($data['surface'] ?? null)['mode'] ?? null) !== 'CONTROL') activateFail('WEB_MODE_INVALID');
if (str_contains((string) file_get_contents(requireFile($webSource . '/sw.js', 'WEB_SW_INVALID')), 'awh-shell-' . $releaseId) === false) activateFail('WEB_SW_RELEASE_MISMATCH');
verifyWebManifest($webSource, $releaseId);
verifyDatabase();

if ($mode === '--dry-run') {
    fwrite(STDOUT, "AWH_RELEASE_ACTIVATE_DRY_RUN=PASS\nAWH_RELEASE_ID={$releaseId}\nAWH_RELEASE_COMMIT={$commit}\n");
    exit(0);
}

$previousControl = currentTarget(AWH_CONTROL_POINTER, AWH_CONTROL_ROOT);
$previousWeb = currentTarget(AWH_WEB_POINTER, AWH_WEB_ROOT);
$webRelease = AWH_WEB_ROOT . '/' . $releaseId;
copyWebTree($webSource, $webRelease);

try {
    swapPointer(AWH_CONTROL_POINTER, $release, $releaseId);
    try { swapPointer(AWH_WEB_POINTER, $webRelease, $releaseId); }
    catch (Throwable $error) { restorePointer(AWH_CONTROL_POINTER, $previousControl, $releaseId); throw $error; }
} catch (Throwable $error) {
    activateFail('CUTOVER_FAILED', 3);
}

fwrite(STDOUT, "AWH_RELEASE_ACTIVATE=PASS\nAWH_RELEASE_ID={$releaseId}\nAWH_RELEASE_COMMIT={$commit}\n");
