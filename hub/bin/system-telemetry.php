<?php

declare(strict_types=1);

const AWH_TELEMETRY_SCHEMA = 1;
const AWH_TELEMETRY_DEFAULT = '/var/lib/awh-hub/system-telemetry.json';

function telemetryRun(array $argv): array
{
    if ($argv === [] || !is_string($argv[0]) || !str_starts_with($argv[0], '/')) return ['ok' => false, 'out' => ''];
    $pipes = [];
    $process = @proc_open($argv, [['pipe', 'r'], ['pipe', 'w'], ['pipe', 'w']], $pipes, null, ['LANG' => 'C', 'LC_ALL' => 'C', 'PATH' => '/usr/sbin:/usr/bin:/sbin:/bin']);
    if (!is_resource($process)) return ['ok' => false, 'out' => ''];
    fclose($pipes[0]);
    $stdout = stream_get_contents($pipes[1]); fclose($pipes[1]);
    stream_get_contents($pipes[2]); fclose($pipes[2]);
    $status = proc_close($process);
    return ['ok' => $status === 0, 'out' => is_string($stdout) ? $stdout : ''];
}

function telemetryMemInfo(): array
{
    $raw = @file_get_contents('/proc/meminfo');
    $values = [];
    if (is_string($raw)) foreach (preg_split('/\R/', $raw) ?: [] as $line) if (preg_match('/^([A-Za-z_()]+):\s+(\d+)\s+kB$/', $line, $m)) $values[$m[1]] = (int) $m[2] * 1024;
    return $values;
}

function telemetryCpuSample(): ?array
{
    $read = static function (): ?array {
        $raw = @file('/proc/stat', FILE_IGNORE_NEW_LINES);
        if (!is_array($raw) || !isset($raw[0]) || preg_match('/^cpu\s+(.+)$/', $raw[0], $m) !== 1) return null;
        $parts = preg_split('/\s+/', trim($m[1])) ?: [];
        $numbers = array_map('intval', $parts);
        if (count($numbers) < 4) return null;
        $idle = ($numbers[3] ?? 0) + ($numbers[4] ?? 0);
        return ['idle' => $idle, 'total' => array_sum($numbers)];
    };
    $first = $read(); if ($first === null) return null; usleep(150000); $second = $read(); if ($second === null) return null;
    $total = $second['total'] - $first['total']; $idle = $second['idle'] - $first['idle'];
    if ($total <= 0) return null;
    return ['usedPercent' => round(max(0, min(100, (1 - ($idle / $total)) * 100)), 1)];
}

function telemetrySystemd(string $unit): array
{
    if (preg_match('/^[a-zA-Z0-9@_.:-]{1,80}$/', $unit) !== 1) return ['active' => 'UNKNOWN', 'enabled' => 'UNKNOWN'];
    $result = telemetryRun(['/usr/bin/systemctl', 'show', $unit, '--property=ActiveState', '--property=UnitFileState', '--no-pager']);
    if (!$result['ok']) return ['active' => 'UNKNOWN', 'enabled' => 'UNKNOWN'];
    $active = 'UNKNOWN'; $enabled = 'UNKNOWN';
    foreach (preg_split('/\R/', trim($result['out'])) ?: [] as $line) {
        if (str_starts_with($line, 'ActiveState=')) $active = strtoupper(substr($line, 12));
        if (str_starts_with($line, 'UnitFileState=')) $enabled = strtoupper(substr($line, 14));
    }
    return ['active' => $active, 'enabled' => $enabled];
}

function telemetryOs(): string
{
    $raw = @file_get_contents('/etc/os-release');
    if (is_string($raw) && preg_match('/^PRETTY_NAME=(?:"([^"]+)"|([^\r\n]+))$/m', $raw, $m)) return trim($m[1] !== '' ? $m[1] : $m[2]);
    return PHP_OS_FAMILY;
}

function telemetryCertificateExpiry(string $domain): array
{
    if (preg_match('/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/', $domain) !== 1 || strlen($domain) > 253) return ['expiresAt' => null, 'daysRemaining' => null];
    $context = stream_context_create(['ssl' => ['peer_name' => $domain, 'SNI_enabled' => true, 'verify_peer' => false, 'verify_peer_name' => false, 'capture_peer_cert' => true]]);
    $socket = @stream_socket_client('ssl://127.0.0.1:443', $errno, $error, 1.0, STREAM_CLIENT_CONNECT, $context);
    if (!is_resource($socket)) return ['expiresAt' => null, 'daysRemaining' => null];
    $params = stream_context_get_params($socket); fclose($socket);
    $certificate = $params['options']['ssl']['peer_certificate'] ?? null;
    if ($certificate === null || !function_exists('openssl_x509_parse')) return ['expiresAt' => null, 'daysRemaining' => null];
    $parsed = @openssl_x509_parse($certificate, false); $stamp = is_array($parsed) && is_int($parsed['validTo_time_t'] ?? null) ? $parsed['validTo_time_t'] : null;
    return $stamp === null ? ['expiresAt' => null, 'daysRemaining' => null] : ['expiresAt' => gmdate('c', $stamp), 'daysRemaining' => (int) floor(($stamp - time()) / 86400)];
}

function telemetryNginxDomains(): array
{
    $files = ['/etc/nginx/nginx.conf'];
    foreach (['/etc/nginx/sites-enabled/*', '/etc/nginx/conf.d/*.conf'] as $pattern) foreach (glob($pattern) ?: [] as $file) if (is_file($file) && is_readable($file)) $files[] = $file;
    $domains = [];
    foreach (array_unique($files) as $file) {
        $raw = @file_get_contents($file); if (!is_string($raw) || $raw === '') continue;
        $lines = preg_split('/\R/', $raw) ?: []; $inside = false; $depth = 0; $block = [];
        foreach ($lines as $line) {
            $trim = trim(preg_replace('/#.*$/', '', $line) ?? '');
            if (!$inside && preg_match('/^server\s*\{$/', $trim)) { $inside = true; $depth = 1; $block = []; continue; }
            if (!$inside) continue;
            $depth += substr_count($trim, '{') - substr_count($trim, '}');
            if ($depth <= 0) {
                $text = implode("\n", $block); $tls = preg_match('/\blisten\s+[^;]*443[^;]*;/', $text) === 1; $names = [];
                if (preg_match_all('/\bserver_name\s+([^;]+);/', $text, $matches)) foreach ($matches[1] as $chunk) foreach (preg_split('/\s+/', trim($chunk)) ?: [] as $name) if ($name !== '' && $name !== '_' && $name !== 'localhost' && !str_contains($name, '$') && preg_match('/^[A-Za-z0-9*.-]{1,253}$/', $name)) $names[] = strtolower($name);
                foreach (array_unique($names) as $name) {
                    $current = $domains[$name] ?? null; if (is_array($current) && ($current['tls'] ?? false) && !$tls) continue;
                    $expiry = $tls && !str_starts_with($name, '*.') ? telemetryCertificateExpiry($name) : ['expiresAt' => null, 'daysRemaining' => null];
                    $domains[$name] = ['name' => $name, 'tls' => $tls, 'certificateExpiresAt' => $expiry['expiresAt'], 'certificateDaysRemaining' => $expiry['daysRemaining']];
                }
                $inside = false; $depth = 0; $block = []; continue;
            }
            $block[] = $trim;
        }
    }
    ksort($domains); return array_values($domains);
}

function telemetrySnapshot(): array
{
    $mem = telemetryMemInfo(); $cpu = telemetryCpuSample();
    $uptimeRaw = @file_get_contents('/proc/uptime'); $uptime = is_string($uptimeRaw) ? (int) floor((float) explode(' ', trim($uptimeRaw))[0]) : 0;
    $loadRaw = @file_get_contents('/proc/loadavg'); $load = is_string($loadRaw) ? array_slice(preg_split('/\s+/', trim($loadRaw)) ?: [], 0, 3) : [];
    $memoryTotal = (int) ($mem['MemTotal'] ?? 0); $memoryAvailable = (int) ($mem['MemAvailable'] ?? 0); $memoryUsed = max(0, $memoryTotal - $memoryAvailable);
    $swapTotal = (int) ($mem['SwapTotal'] ?? 0); $swapFree = (int) ($mem['SwapFree'] ?? 0);
    $diskTotalRaw = @disk_total_space('/'); $diskFreeRaw = @disk_free_space('/'); $diskTotal = is_float($diskTotalRaw) || is_int($diskTotalRaw) ? (int) $diskTotalRaw : 0; $diskFree = is_float($diskFreeRaw) || is_int($diskFreeRaw) ? (int) $diskFreeRaw : 0;
    $serviceDefs = [
        ['key' => 'nginx', 'label' => 'Web Server', 'unit' => 'nginx.service'],
        ['key' => 'php-fpm', 'label' => 'PHP Runtime', 'unit' => 'php8.3-fpm.service'],
        ['key' => 'native-executor', 'label' => 'AWH Agent Runtime', 'unit' => 'awh-native-executor.timer'],
        ['key' => 'backup', 'label' => 'Automatic Backup', 'unit' => 'awh-backup.timer'],
        ['key' => 'fail2ban', 'label' => 'Login Protection', 'unit' => 'fail2ban.service'],
        ['key' => 'updates', 'label' => 'Automatic Updates', 'unit' => 'unattended-upgrades.service'],
    ];
    $services = [];
    foreach ($serviceDefs as $def) { $state = telemetrySystemd($def['unit']); $services[] = ['key' => $def['key'], 'label' => $def['label'], 'state' => $state['active'], 'startup' => $state['enabled']]; }
    $host = preg_replace('/[^A-Za-z0-9._-]/', '', (string) gethostname()) ?: 'server';
    return [
        'schemaVersion' => AWH_TELEMETRY_SCHEMA,
        'generatedAt' => gmdate('c'),
        'host' => ['name' => substr($host, 0, 80), 'os' => substr(telemetryOs(), 0, 120), 'uptimeSeconds' => $uptime],
        'cpu' => ['usedPercent' => $cpu['usedPercent'] ?? null, 'load1' => isset($load[0]) ? (float) $load[0] : null, 'load5' => isset($load[1]) ? (float) $load[1] : null, 'load15' => isset($load[2]) ? (float) $load[2] : null],
        'memory' => ['totalBytes' => $memoryTotal, 'availableBytes' => $memoryAvailable, 'usedBytes' => $memoryUsed, 'usedPercent' => $memoryTotal > 0 ? round(($memoryUsed / $memoryTotal) * 100, 1) : null],
        'swap' => ['totalBytes' => $swapTotal, 'usedBytes' => max(0, $swapTotal - $swapFree), 'usedPercent' => $swapTotal > 0 ? round(((max(0, $swapTotal - $swapFree)) / $swapTotal) * 100, 1) : 0],
        'storage' => ['totalBytes' => $diskTotal, 'freeBytes' => $diskFree, 'usedBytes' => max(0, $diskTotal - $diskFree), 'usedPercent' => $diskTotal > 0 ? round(((max(0, $diskTotal - $diskFree)) / $diskTotal) * 100, 1) : null],
        'services' => $services,
        'domains' => telemetryNginxDomains(),
        'security' => ['fail2ban' => telemetrySystemd('fail2ban.service')['active'], 'automaticUpdates' => telemetrySystemd('unattended-upgrades.service')['active']],
    ];
}

function telemetryRefreshIfStale(?string $output = null, int $maxAgeSeconds = 60): array
{
    $path = $output ?: (getenv('AWH_SYSTEM_TELEMETRY_OUTPUT') ?: AWH_TELEMETRY_DEFAULT);
    if ($maxAgeSeconds < 0 || $maxAgeSeconds > 3600) throw new RuntimeException('Telemetry refresh interval is invalid');
    if (is_link($path)) throw new RuntimeException('Telemetry snapshot target is unsafe');
    $mtime = is_file($path) ? @filemtime($path) : false;
    if ($maxAgeSeconds > 0 && is_int($mtime) && (time() - $mtime) >= 0 && (time() - $mtime) < $maxAgeSeconds) {
        return ['status' => 'FRESH', 'path' => $path];
    }
    telemetryWrite(telemetrySnapshot(), $path);
    return ['status' => 'REFRESHED', 'path' => $path];
}

function telemetryWrite(array $snapshot, string $output): void
{
    if ($output === '' || !str_starts_with($output, '/') || str_contains($output, "\0")) throw new RuntimeException('Telemetry output path is invalid');
    $directory = dirname($output); if (!is_dir($directory) && !@mkdir($directory, 0750, true) && !is_dir($directory)) throw new RuntimeException('Telemetry directory is unavailable');
    $temp = $output . '.tmp-' . bin2hex(random_bytes(6));
    $json = json_encode($snapshot, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PRETTY_PRINT | JSON_THROW_ON_ERROR) . "\n";
    if (@file_put_contents($temp, $json, LOCK_EX) !== strlen($json)) { @unlink($temp); throw new RuntimeException('Telemetry snapshot could not be written'); }
    @chmod($temp, 0640); @chgrp($temp, 'awh-hub');
    if (!@rename($temp, $output)) { @unlink($temp); throw new RuntimeException('Telemetry snapshot could not be committed'); }
    @chmod($output, 0640); @chgrp($output, 'awh-hub');
}

if (PHP_SAPI === 'cli' && realpath((string) ($_SERVER['SCRIPT_FILENAME'] ?? '')) === __FILE__) {
    try { telemetryRefreshIfStale(null, 0); fwrite(STDOUT, "AWH_SYSTEM_TELEMETRY=PASS\n"); }
    catch (Throwable $error) { fwrite(STDERR, "AWH_SYSTEM_TELEMETRY=FAIL\n"); exit(1); }
}
