<?php

declare(strict_types=1);

require_once __DIR__ . '/HubInfrastructureService.php';
require_once __DIR__ . '/HubBayEcosystemHealthConnector.php';

final class HubEcosystemHealthCollector
{
    private const MAX_HISTORY_LINES = 2300;
    private const MAX_CURRENT_BYTES = 524288;

    public function __construct(
        private readonly string $currentPath,
        private readonly string $historyPath,
        private readonly string $bayStatusUrl,
        private readonly HubBayEcosystemHealthConnector $learnLab
    ) {
        foreach ([$currentPath, $historyPath] as $path) {
            if ($path === '' || !str_starts_with($path, '/var/lib/awh-hub/') || str_contains($path, "\0")) {
                throw new RuntimeException('Ecosystem health output path is invalid');
            }
        }
        if (
            !preg_match('#^https://[a-z0-9.-]+/bay/api/status\.php$#i', $bayStatusUrl)
            || strlen($bayStatusUrl) > 255
        ) {
            throw new RuntimeException('BAY health URL is invalid');
        }
    }

    public static function fromEnvironment(): self
    {
        return new self(
            getenv('AWH_ECOSYSTEM_HEALTH_PATH') ?: '/var/lib/awh-hub/ecosystem-health.json',
            getenv('AWH_ECOSYSTEM_HEALTH_HISTORY_PATH') ?: '/var/lib/awh-hub/system-health-history.jsonl',
            getenv('AWH_BAY_STATUS_URL') ?: 'https://kruart.online/bay/api/status.php',
            HubBayEcosystemHealthConnector::fromEnvironment()
        );
    }

    public function refreshIfStale(int $maxAgeSeconds = 300, ?string $now = null): array
    {
        if ($maxAgeSeconds < 60 || $maxAgeSeconds > 3600) throw new RuntimeException('Ecosystem health refresh interval is invalid');
        $reference = strtotime($now ?? 'now'); if ($reference === false) $reference = time();
        if (is_file($this->currentPath) && !is_link($this->currentPath)) {
            $mtime = @filemtime($this->currentPath);
            if (is_int($mtime) && $reference >= $mtime && $reference - $mtime < $maxAgeSeconds) {
                return ['status' => 'FRESH'];
            }
        }
        $snapshot = $this->collect(gmdate('c', $reference));
        $this->writeCurrent($snapshot);
        $this->appendHistory($snapshot, $reference);
        return ['status' => 'REFRESHED'];
    }

    public function collect(?string $now = null): array
    {
        $at = strtotime($now ?? 'now'); if ($at === false) $at = time();
        $bay = $this->collectBayStatus();
        $learnLab = $this->learnLab->collect(gmdate('c', $at));
        return [
            'schemaVersion' => 1,
            'generatedAt' => gmdate('c', $at),
            'bay' => $bay,
            'learnlab' => $learnLab,
        ];
    }

    private function collectBayStatus(): array
    {
        $status = $this->fetchJson($this->bayStatusUrl);
        $services = [];
        $checkedAt = null;
        if (is_array($status)) {
            $checkedAt = $this->isoOrNull($status['checked_at'] ?? null);
            foreach (is_array($status['services'] ?? null) ? $status['services'] : [] as $service) {
                if (!is_array($service)) continue;
                $id = is_string($service['id'] ?? null) ? strtolower((string) $service['id']) : '';
                if (!in_array($id, ['awh', 'bay', 'learnlab', 'website'], true)) continue;
                $services[$id] = [
                    'id' => $id,
                    'name' => $this->text($service['name'] ?? $id, 80),
                    'ok' => ($service['ok'] ?? false) === true,
                    'state' => $this->serviceState($service['state'] ?? null),
                    'critical' => ($service['critical'] ?? true) === true,
                    'http' => $this->int($service['http'] ?? 0, 0, 599),
                    'latencyMs' => $this->int($service['latency_ms'] ?? 0, 0, 60000),
                    'detail' => $this->text($service['detail'] ?? 'ไม่มีรายละเอียด', 180),
                ];
            }
        }

        // BAY Health v1 referenced the legacy school website. Replace only that
        // one probe with the current front-site authority until v2 is deployed.
        if (!isset($services['website']) || ($status['schema'] ?? null) === 'bay.hub.status.v1') {
            $services['website'] = $this->probeCurrentWebsite();
        }

        foreach (['awh' => 'AWH', 'bay' => 'BAY EXCUSE X Staging', 'learnlab' => 'BAY LearnLab'] as $id => $name) {
            if (!isset($services[$id])) {
                $services[$id] = [
                    'id' => $id,
                    'name' => $name,
                    'ok' => false,
                    'state' => 'unknown',
                    'critical' => true,
                    'http' => 0,
                    'latencyMs' => 0,
                    'detail' => 'ยังอ่านสถานะไม่ได้',
                ];
            }
        }

        $ordered = [];
        foreach (['awh', 'bay', 'learnlab', 'website'] as $id) $ordered[] = $services[$id];
        return [
            'checkedAt' => $checkedAt ?? gmdate('c'),
            'services' => $ordered,
            'dns' => $this->dnsHealth(),
        ];
    }

    private function probeCurrentWebsite(): array
    {
        $url = 'https://kruart.great-site.net/';
        $started = microtime(true);
        $body = '';
        $code = 0;
        $error = '';
        if (function_exists('curl_init')) {
            $ch = curl_init($url);
            curl_setopt_array($ch, [
                CURLOPT_RETURNTRANSFER => true,
                CURLOPT_FOLLOWLOCATION => true,
                CURLOPT_MAXREDIRS => 4,
                CURLOPT_TIMEOUT => 6,
                CURLOPT_CONNECTTIMEOUT => 3,
                CURLOPT_SSL_VERIFYPEER => true,
                CURLOPT_USERAGENT => 'AWH-Ecosystem-Health/1.0',
                CURLOPT_RANGE => '0-4095',
            ]);
            $raw = curl_exec($ch);
            $code = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
            $error = (string) curl_error($ch);
            curl_close($ch);
            if (is_string($raw)) $body = substr($raw, 0, 4096);
        } else {
            $context = stream_context_create([
                'http' => ['method' => 'GET', 'timeout' => 6, 'ignore_errors' => true, 'follow_location' => 1, 'max_redirects' => 4, 'header' => "User-Agent: AWH-Ecosystem-Health/1.0\r\nRange: bytes=0-4095\r\n"],
                'ssl' => ['verify_peer' => true, 'verify_peer_name' => true],
            ]);
            $raw = @file_get_contents($url, false, $context);
            if (is_string($raw)) $body = substr($raw, 0, 4096);
            foreach (($http_response_header ?? []) as $line) if (preg_match('/^HTTP\/\S+\s+(\d{3})/', $line, $m)) $code = (int) $m[1];
            if ($raw === false) $error = 'ไม่สามารถเชื่อมต่อได้';
        }
        $latency = (int) round((microtime(true) - $started) * 1000);
        $ok = $code >= 200 && $code < 400;
        $protected = $ok && str_contains($body, '__test') && (stripos($body, 'slowAES') !== false || stripos($body, 'requires Javascript') !== false);
        return [
            'id' => 'website',
            'name' => 'เว็บไซต์โรงเรียน',
            'ok' => $ok,
            'state' => $protected ? 'protected' : ($ok ? 'healthy' : ($code === 0 || $code >= 500 ? 'down' : 'degraded')),
            'critical' => true,
            'http' => $code,
            'latencyMs' => max(0, min(60000, $latency)),
            'detail' => $protected ? 'โฮสต์ตอบสนอง · มี JavaScript anti-bot challenge' : ($ok ? 'ตอบสนองปกติ' : ($error !== '' ? $error : 'ไม่ตอบสนอง')),
        ];
    }

    /** @return list<array{host:string,ok:bool,state:string}> */
    private function dnsHealth(): array
    {
        $expected = getenv('AWH_PUBLIC_IPV4');
        if (!is_string($expected) || filter_var($expected, FILTER_VALIDATE_IP, FILTER_FLAG_IPV4) === false) {
            $root = getenv('AWH_ROOT_DOMAIN') ?: 'kruart.online';
            $answers = gethostbynamel((string) $root) ?: [];
            $expected = null;
            foreach ($answers as $candidate) {
                if (filter_var($candidate, FILTER_VALIDATE_IP, FILTER_FLAG_IPV4) !== false) { $expected = $candidate; break; }
            }
        }
        $out = [];
        foreach (['learn.kruart.online', 'school.kruart.online'] as $host) {
            $answers = gethostbynamel($host) ?: [];
            $answers = array_values(array_unique(array_filter($answers, static fn(string $ip): bool => filter_var($ip, FILTER_VALIDATE_IP, FILTER_FLAG_IPV4) !== false)));
            $ok = is_string($expected) && $expected !== '' && in_array($expected, $answers, true);
            $out[] = [
                'host' => $host,
                'ok' => $ok,
                'state' => $ok ? 'healthy' : ($answers === [] ? 'missing' : 'misconfigured'),
            ];
        }
        return $out;
    }

    private function fetchJson(string $url): ?array
    {
        $context = stream_context_create([
            'http' => [
                'method' => 'GET',
                'timeout' => 8,
                'ignore_errors' => true,
                'follow_location' => 1,
                'max_redirects' => 3,
                'header' => "Accept: application/json\r\nUser-Agent: AWH-Ecosystem-Health/1.0\r\n",
            ],
            'ssl' => ['verify_peer' => true, 'verify_peer_name' => true],
        ]);
        $raw = @file_get_contents($url, false, $context);
        if (!is_string($raw) || strlen($raw) < 2 || strlen($raw) > self::MAX_CURRENT_BYTES) return null;
        try {
            $decoded = json_decode($raw, true, 32, JSON_THROW_ON_ERROR);
            return is_array($decoded) ? $decoded : null;
        } catch (Throwable) {
            return null;
        }
    }

    private function writeCurrent(array $snapshot): void
    {
        $this->atomicWrite($this->currentPath, json_encode($snapshot, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PRETTY_PRINT | JSON_THROW_ON_ERROR) . "\n");
    }

    private function appendHistory(array $snapshot, int $reference): void
    {
        $services = [];
        foreach (($snapshot['bay']['services'] ?? []) as $service) {
            if (!is_array($service) || !is_string($service['id'] ?? null)) continue;
            $services[$service['id']] = [
                'ok' => ($service['ok'] ?? false) === true,
                'state' => (string) ($service['state'] ?? 'unknown'),
                'http' => (int) ($service['http'] ?? 0),
                'latencyMs' => (int) ($service['latencyMs'] ?? 0),
            ];
        }
        $dns = [];
        foreach (($snapshot['bay']['dns'] ?? []) as $item) if (is_array($item) && is_string($item['host'] ?? null)) $dns[$item['host']] = (string) ($item['state'] ?? 'unknown');
        $learnlab = is_array($snapshot['learnlab']['summary'] ?? null) ? $snapshot['learnlab']['summary'] : [];
        $row = [
            'schemaVersion' => 1,
            'at' => gmdate('c', $reference),
            'releaseId' => HubInfrastructureService::currentReleaseId(),
            'services' => $services,
            'dns' => $dns,
            'learnlab' => [
                'serverPendingEvents' => (int) ($learnlab['serverPendingEvents'] ?? 0),
                'errorDevices' => (int) ($learnlab['errorDevices'] ?? 0),
            ],
        ];
        $line = json_encode($row, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);
        $keep = [];
        if (is_file($this->historyPath) && !is_link($this->historyPath) && filesize($this->historyPath) <= 8388608) {
            foreach ((file($this->historyPath, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) ?: []) as $existing) {
                if (!is_string($existing) || strlen($existing) > 8192) continue;
                try {
                    $decoded = json_decode($existing, true, 8, JSON_THROW_ON_ERROR);
                    $stamp = is_array($decoded) && is_string($decoded['at'] ?? null) ? strtotime($decoded['at']) : false;
                    if ($stamp !== false && $stamp >= $reference - 8 * 86400 && $stamp <= $reference + 300) $keep[] = $existing;
                } catch (Throwable) {
                    continue;
                }
            }
        }
        $keep[] = $line;
        if (count($keep) > self::MAX_HISTORY_LINES) $keep = array_slice($keep, -self::MAX_HISTORY_LINES);
        $this->atomicWrite($this->historyPath, implode("\n", $keep) . "\n");
    }

    private function atomicWrite(string $path, string $content): void
    {
        $dir = dirname($path);
        if (!is_dir($dir) || is_link($dir) || !is_writable($dir)) throw new RuntimeException('Ecosystem health storage is unavailable');
        if (is_link($path)) throw new RuntimeException('Ecosystem health target is unsafe');
        $tmp = $path . '.tmp-' . bin2hex(random_bytes(6));
        try {
            if (file_put_contents($tmp, $content, LOCK_EX) !== strlen($content)) throw new RuntimeException('Ecosystem health write failed');
            @chmod($tmp, 0640);
            @chgrp($tmp, 'awh-hub');
            if (!rename($tmp, $path)) throw new RuntimeException('Ecosystem health activation failed');
            @chmod($path, 0640);
            @chgrp($path, 'awh-hub');
        } finally {
            if (is_file($tmp) && !is_link($tmp)) @unlink($tmp);
        }
    }

    private function serviceState(mixed $value): string
    {
        $value = is_string($value) ? strtolower($value) : 'unknown';
        return in_array($value, ['healthy', 'protected', 'degraded', 'down', 'unknown'], true) ? $value : 'unknown';
    }

    private function text(mixed $value, int $max): string
    {
        $text = is_string($value) ? trim($value) : '';
        $text = preg_replace('/[\x00-\x1F\x7F]/', '', $text) ?? '';
        if ($text === '') $text = 'unknown';
        return substr($text, 0, $max);
    }

    private function isoOrNull(mixed $value): ?string
    {
        if (!is_string($value) || $value === '' || strlen($value) > 40) return null;
        $stamp = strtotime($value); return $stamp === false ? null : gmdate('c', $stamp);
    }

    private function int(mixed $value, int $min, int $max): int
    {
        $number = is_int($value) ? $value : (is_numeric($value) ? (int) $value : $min);
        return max($min, min($max, $number));
    }
}
