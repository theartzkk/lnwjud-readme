<?php

declare(strict_types=1);

const AWH_IDENTITY_RETRY_SECONDS = 600;
const AWH_IDENTITY_MAX_PER_TICK = 4;

function reconcileRun(array $command): array
{
    if ($command === [] || !is_string($command[0]) || !in_array($command[0], ['/bin/systemctl', '/usr/sbin/useradd'], true)) {
        return ['code' => 126, 'out' => ''];
    }
    $pipes = [];
    $process = @proc_open($command, [
        0 => ['file', '/dev/null', 'r'],
        1 => ['pipe', 'w'],
        2 => ['pipe', 'w'],
    ], $pipes, null, ['PATH' => '/usr/sbin:/usr/bin:/sbin:/bin'], ['bypass_shell' => true]);
    if (!is_resource($process)) return ['code' => 127, 'out' => ''];
    $out = '';
    foreach ([1, 2] as $index) if (is_resource($pipes[$index] ?? null)) $out .= (string)stream_get_contents($pipes[$index], 65537);
    foreach ($pipes as $pipe) if (is_resource($pipe)) fclose($pipe);
    return ['code' => proc_close($process), 'out' => substr($out, 0, 131072)];
}

function reconcileState(string $path): array
{
    if (!is_file($path) || is_link($path)) return ['attempts' => []];
    $raw = @file_get_contents($path);
    if (!is_string($raw) || strlen($raw) > 65536) return ['attempts' => []];
    try { $state = json_decode($raw, true, 16, JSON_THROW_ON_ERROR); }
    catch (Throwable) { return ['attempts' => []]; }
    return is_array($state) && !array_is_list($state) && is_array($state['attempts'] ?? null) ? $state : ['attempts' => []];
}

function reconcilePersistState(string $path, array $state): void
{
    $dir = dirname($path);
    if (!is_dir($dir) || is_link($dir)) return;
    $state['schemaVersion'] = 1;
    $state['observedAt'] = gmdate('c');
    $tmp = $path . '.tmp-' . bin2hex(random_bytes(6));
    $json = json_encode($state, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR) . "\n";
    if (@file_put_contents($tmp, $json, LOCK_EX) !== strlen($json)) { @unlink($tmp); return; }
    @chmod($tmp, 0640);
    @rename($tmp, $path);
}

$database = getenv('AWH_HUB_DB_PATH') ?: '/var/lib/awh-hub/awh.sqlite';
$statePath = getenv('AWH_HOSTING_IDENTITY_RECONCILE_STATE') ?: '/var/lib/awh-hub/hosting-identity-reconcile.json';
$proxy = '/opt/awh-hub/control-plane-current/deploy/awh-hosting/awh-useradd-proxy.php';
if (!is_file($database) || is_link($database) || !is_file($proxy) || is_link($proxy)) {
    fwrite(STDOUT, "HOSTING_IDENTITY_RECONCILE=UNAVAILABLE\n");
    exit(0);
}
$proxyHash = hash_file('sha256', $proxy);
$useraddHash = is_file('/usr/sbin/useradd') ? hash_file('sha256', '/usr/sbin/useradd') : false;
if (!is_string($proxyHash) || !is_string($useraddHash) || !hash_equals($proxyHash, $useraddHash)) {
    fwrite(STDOUT, "HOSTING_IDENTITY_RECONCILE=PROXY_NOT_BOUND\n");
    exit(0);
}
try {
    $pdo = new PDO('sqlite:' . $database, null, null, [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
    ]);
    $pdo->exec('PRAGMA busy_timeout=2500');
} catch (Throwable) {
    fwrite(STDOUT, "HOSTING_IDENTITY_RECONCILE=DATABASE_UNAVAILABLE\n");
    exit(0);
}

$list = reconcileRun(['/bin/systemctl', 'list-units', '--failed', '--no-legend', '--plain', 'awh-hosting-identity@*.service']);
if (($list['code'] ?? 1) !== 0) {
    fwrite(STDOUT, "HOSTING_IDENTITY_RECONCILE=SYSTEMD_UNAVAILABLE\n");
    exit(0);
}
$pattern = '/^(awh-hosting-identity@([0-9a-f-]{36})\.service)\s+/mi';
preg_match_all($pattern, (string)$list['out'], $matches, PREG_SET_ORDER);
$state = reconcileState($statePath);
$attempts = is_array($state['attempts'] ?? null) ? $state['attempts'] : [];
$checked = 0;
$repaired = 0;
$cleared = 0;
$deferred = 0;
$failed = 0;
$now = time();

foreach (array_slice($matches, 0, AWH_IDENTITY_MAX_PER_TICK) as $match) {
    $unit = strtolower((string)$match[1]);
    $site = strtolower((string)$match[2]);
    if (preg_match('/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/', $site) !== 1) continue;
    $checked++;
    $q = $pdo->prepare('SELECT state FROM control_managed_sites WHERE site_id=:site LIMIT 1');
    $q->execute(['site' => $site]);
    $siteState = $q->fetchColumn();
    if (!is_string($siteState) || $siteState === 'DISABLED') {
        $reset = reconcileRun(['/bin/systemctl', 'reset-failed', $unit]);
        if (($reset['code'] ?? 1) === 0) { unset($attempts[$site]); $cleared++; }
        else { $failed++; }
        continue;
    }

    $user = 'awhsite-' . substr(str_replace('-', '', $site), 0, 10);
    $home = '/srv/awh-sites/' . $site;
    $existing = function_exists('posix_getpwnam') ? posix_getpwnam($user) : false;
    $validExisting = is_array($existing)
        && (string)($existing['dir'] ?? '') === $home
        && (string)($existing['shell'] ?? '') === '/usr/sbin/nologin';
    if ($validExisting) {
        $reset = reconcileRun(['/bin/systemctl', 'reset-failed', $unit]);
        if (($reset['code'] ?? 1) === 0) { unset($attempts[$site]); $cleared++; }
        else { $failed++; }
        continue;
    }
    $lastAttempt = is_numeric($attempts[$site] ?? null) ? (int)$attempts[$site] : 0;
    if ($lastAttempt > 0 && ($now - $lastAttempt) < AWH_IDENTITY_RETRY_SECONDS) {
        $deferred++;
        continue;
    }
    $attempts[$site] = $now;

    $create = reconcileRun([
        '/usr/sbin/useradd',
        '--system',
        '--no-log-init',
        '--home-dir', $home,
        '--shell', '/usr/sbin/nologin',
        '--user-group', $user,
    ]);
    $created = function_exists('posix_getpwnam') ? posix_getpwnam($user) : false;
    $verified = ($create['code'] ?? 1) === 0
        && is_array($created)
        && (string)($created['dir'] ?? '') === $home
        && (string)($created['shell'] ?? '') === '/usr/sbin/nologin';
    if ($verified) {
        $reset = reconcileRun(['/bin/systemctl', 'reset-failed', $unit]);
        if (($reset['code'] ?? 1) === 0) { unset($attempts[$site]); $repaired++; }
        else { $failed++; }
        continue;
    }
    $failed++;
}

$state['attempts'] = $attempts;
$state['lastResult'] = [
    'checked' => $checked,
    'repaired' => $repaired,
    'cleared' => $cleared,
    'deferred' => $deferred,
    'failed' => $failed,
];
reconcilePersistState($statePath, $state);

$status = $failed > 0 ? 'ATTENTION' : 'READY';
$message = 'HOSTING_IDENTITY_RECONCILE=' . $status
    . ' checked=' . $checked
    . ' repaired=' . $repaired
    . ' cleared=' . $cleared
    . ' deferred=' . $deferred
    . ' failed=' . $failed . "\n";
fwrite(STDOUT, $message);
exit(0);
