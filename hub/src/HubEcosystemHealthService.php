<?php

declare(strict_types=1);

final class HubEcosystemHealthService
{
    private const MAX_CURRENT_BYTES = 524288;
    private const MAX_HISTORY_BYTES = 8388608;
    private const MAX_HISTORY_LINES = 2300;
    private const CURRENT_STALE_SECONDS = 900;
    private const SERVICE_IDS = ['awh', 'bay', 'learnlab', 'website'];
    private const SERVICE_STATES = ['healthy', 'protected', 'degraded', 'down', 'unknown'];
    private const DNS_STATES = ['healthy', 'missing', 'misconfigured', 'unknown'];
    private const DEVICE_STATES = ['healthy', 'warning', 'error', 'offline', 'unknown'];
    private const DEVICE_STATUS = ['ONLINE', 'STALE', 'OFFLINE', 'UNKNOWN'];

    public function __construct(
        private readonly string $currentPath,
        private readonly string $historyPath,
        private readonly string $recoveryProofPath
    ) {
        foreach ([$currentPath, $historyPath, $recoveryProofPath] as $path) {
            if ($path === '' || !str_starts_with($path, '/') || str_contains($path, "\0")) {
                throw new RuntimeException('Ecosystem health configuration is invalid');
            }
        }
    }

    public static function fromEnvironment(): self
    {
        return new self(
            getenv('AWH_ECOSYSTEM_HEALTH_PATH') ?: '/var/lib/awh-hub/ecosystem-health.json',
            getenv('AWH_ECOSYSTEM_HEALTH_HISTORY_PATH') ?: '/var/lib/awh-hub/system-health-history.jsonl',
            getenv('AWH_RECOVERY_DRILL_PROOF_PATH') ?: '/var/lib/awh-hub/recovery-drill.json'
        );
    }

    public function status(?string $currentReleaseId = null, ?string $now = null): array
    {
        $reference = strtotime($now ?? 'now');
        if ($reference === false) $reference = time();
        $current = $this->readCurrent();
        $history = $this->readHistory($reference);
        $summary = $this->summarize($history, $current, $currentReleaseId, $reference);
        $recovery = $this->readRecoveryProof($reference);
        $currentGenerated = is_array($current) ? strtotime((string) ($current['generatedAt'] ?? '')) : false;
        $currentState = !is_array($current) ? 'NOT_CONFIGURED'
            : ($currentGenerated === false || $reference - $currentGenerated > self::CURRENT_STALE_SECONDS || $currentGenerated > $reference + 300 ? 'STALE' : 'READY');

        $alerts = $summary['alerts'];
        if ($currentState !== 'READY') {
            array_unshift($alerts, [
                'key' => 'ecosystem-health-stale',
                'severity' => 'WARNING',
                'title' => 'ข้อมูลสุขภาพระบบยังไม่สด',
                'detail' => 'AWH ยังทำงานได้ แต่รอบตรวจ BAY ecosystem เก่ากว่าเกณฑ์ 15 นาที',
                'action' => 'CHECK_HEALTH_COLLECTOR',
            ]);
        }
        if (($recovery['state'] ?? null) === 'FAILED') {
            $alerts[] = [
                'key' => 'recovery-drill-failed',
                'severity' => 'CRITICAL',
                'title' => 'Recovery drill ต้องตรวจสอบ',
                'detail' => 'Backup มีอยู่ แต่การทดสอบ restore ล่าสุดไม่ผ่าน',
                'action' => 'CHECK_RECOVERY',
            ];
        }

        return [
            'schemaVersion' => 1,
            'state' => $currentState,
            'generatedAt' => is_array($current) ? $current['generatedAt'] : null,
            'current' => $current,
            'history' => [
                'state' => $history === [] ? 'COLLECTING' : 'READY',
                'sampleCount' => count($history),
                'windows' => $summary['windows'],
                'deployCorrelation' => $summary['deployCorrelation'],
            ],
            'alerts' => array_slice($this->dedupeAlerts($alerts), 0, 12),
            'recoveryDrill' => $recovery,
        ];
    }

    private function readCurrent(): ?array
    {
        if (!is_file($this->currentPath) || is_link($this->currentPath)) return null;
        $size = @filesize($this->currentPath);
        if (!is_int($size) || $size < 2 || $size > self::MAX_CURRENT_BYTES) return null;
        try {
            $value = json_decode((string) file_get_contents($this->currentPath), true, 32, JSON_THROW_ON_ERROR);
            return $this->sanitizeCurrent($value);
        } catch (Throwable) {
            return null;
        }
    }

    /** @return list<array<string,mixed>> */
    private function readHistory(int $reference): array
    {
        if (!is_file($this->historyPath) || is_link($this->historyPath)) return [];
        $size = @filesize($this->historyPath);
        if (!is_int($size) || $size < 2 || $size > self::MAX_HISTORY_BYTES) return [];
        $lines = @file($this->historyPath, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES);
        if (!is_array($lines)) return [];
        if (count($lines) > self::MAX_HISTORY_LINES) $lines = array_slice($lines, -self::MAX_HISTORY_LINES);
        $cutoff = $reference - 8 * 86400;
        $out = [];
        foreach ($lines as $line) {
            if (!is_string($line) || strlen($line) > 8192) continue;
            try { $row = json_decode($line, true, 16, JSON_THROW_ON_ERROR); }
            catch (Throwable) { continue; }
            if (!is_array($row) || ($row['schemaVersion'] ?? null) !== 1 || !is_string($row['at'] ?? null)) continue;
            $stamp = strtotime($row['at']); if ($stamp === false || $stamp < $cutoff || $stamp > $reference + 300) continue;
            $services = [];
            foreach (is_array($row['services'] ?? null) ? $row['services'] : [] as $id => $service) {
                if (!in_array($id, self::SERVICE_IDS, true) || !is_array($service)) continue;
                $services[$id] = [
                    'ok' => ($service['ok'] ?? false) === true,
                    'state' => $this->enum($service['state'] ?? 'unknown', self::SERVICE_STATES, 'unknown'),
                    'http' => $this->boundedInt($service['http'] ?? 0, 0, 599),
                    'latencyMs' => $this->boundedInt($service['latencyMs'] ?? 0, 0, 60000),
                ];
            }
            $dns = [];
            foreach (is_array($row['dns'] ?? null) ? $row['dns'] : [] as $host => $state) {
                if (!is_string($host) || !in_array($host, ['learn.kruart.online', 'school.kruart.online'], true)) continue;
                $dns[$host] = $this->enum($state, self::DNS_STATES, 'unknown');
            }
            $learnlab = is_array($row['learnlab'] ?? null) ? $row['learnlab'] : [];
            $releaseId = is_string($row['releaseId'] ?? null) && preg_match('/^m[0-9]+-[A-Za-z0-9._-]{6,72}$/', $row['releaseId']) ? $row['releaseId'] : null;
            $out[] = [
                'at' => gmdate('c', $stamp),
                'stamp' => $stamp,
                'releaseId' => $releaseId,
                'services' => $services,
                'dns' => $dns,
                'learnlab' => [
                    'serverPendingEvents' => $this->boundedInt($learnlab['serverPendingEvents'] ?? 0, 0, 1000000),
                    'errorDevices' => $this->boundedInt($learnlab['errorDevices'] ?? 0, 0, 10000),
                ],
            ];
        }
        usort($out, static fn(array $a, array $b): int => $a['stamp'] <=> $b['stamp']);
        return $out;
    }

    private function sanitizeCurrent(mixed $value): array
    {
        if (!is_array($value) || ($value['schemaVersion'] ?? null) !== 1) throw new RuntimeException('Invalid ecosystem health');
        $generatedAt = $this->iso($value['generatedAt'] ?? null);
        $bay = is_array($value['bay'] ?? null) ? $value['bay'] : [];
        $services = [];
        foreach (is_array($bay['services'] ?? null) ? $bay['services'] : [] as $service) {
            if (!is_array($service)) continue;
            $id = is_string($service['id'] ?? null) ? $service['id'] : '';
            if (!in_array($id, self::SERVICE_IDS, true)) continue;
            $services[] = [
                'id' => $id,
                'name' => $this->safeText($service['name'] ?? $id, 80),
                'ok' => ($service['ok'] ?? false) === true,
                'state' => $this->enum($service['state'] ?? 'unknown', self::SERVICE_STATES, 'unknown'),
                'critical' => ($service['critical'] ?? true) === true,
                'http' => $this->boundedInt($service['http'] ?? 0, 0, 599),
                'latencyMs' => $this->boundedInt($service['latencyMs'] ?? 0, 0, 60000),
                'detail' => $this->safeText($service['detail'] ?? 'ไม่มีรายละเอียด', 180),
            ];
        }
        $dns = [];
        foreach (is_array($bay['dns'] ?? null) ? $bay['dns'] : [] as $item) {
            if (!is_array($item)) continue;
            $host = is_string($item['host'] ?? null) ? strtolower($item['host']) : '';
            if (!in_array($host, ['learn.kruart.online', 'school.kruart.online'], true)) continue;
            $dns[] = ['host' => $host, 'ok' => ($item['ok'] ?? false) === true, 'state' => $this->enum($item['state'] ?? 'unknown', self::DNS_STATES, 'unknown')];
        }
        $learnlab = $this->sanitizeLearnLab(is_array($value['learnlab'] ?? null) ? $value['learnlab'] : []);
        return [
            'schemaVersion' => 1,
            'generatedAt' => $generatedAt,
            'bay' => ['checkedAt' => $this->optionalIso($bay['checkedAt'] ?? null), 'services' => $services, 'dns' => $dns],
            'learnlab' => $learnlab,
        ];
    }

    private function sanitizeLearnLab(array $value): array
    {
        $summary = is_array($value['summary'] ?? null) ? $value['summary'] : [];
        $devices = [];
        foreach (is_array($value['devices'] ?? null) ? $value['devices'] : [] as $device) {
            if (!is_array($device)) continue;
            $devices[] = [
                'displayName' => $this->safeText($device['displayName'] ?? 'LearnLab PC', 80),
                'role' => $this->safeText($device['role'] ?? 'student', 24),
                'coreVersion' => $this->safeText($device['coreVersion'] ?? 'unknown', 50),
                'lastSeenAt' => $this->optionalIso($device['lastSeenAt'] ?? null),
                'lastSyncAt' => $this->optionalIso($device['lastSyncAt'] ?? null),
                'healthState' => $this->enum($device['healthState'] ?? 'unknown', self::DEVICE_STATES, 'unknown'),
                'status' => $this->enum($device['status'] ?? 'UNKNOWN', self::DEVICE_STATUS, 'UNKNOWN'),
            ];
            if (count($devices) >= 100) break;
        }
        return [
            'state' => $this->enum($value['state'] ?? 'UNAVAILABLE', ['READY', 'UNAVAILABLE', 'DEGRADED'], 'UNAVAILABLE'),
            'generatedAt' => $this->optionalIso($value['generatedAt'] ?? null),
            'releaseVersion' => $this->safeText($value['releaseVersion'] ?? 'unknown', 50),
            'offlineWindowHours' => $this->boundedInt($value['offlineWindowHours'] ?? 24, 1, 168),
            'summary' => [
                'deviceCount' => $this->boundedInt($summary['deviceCount'] ?? 0, 0, 10000),
                'onlineDevices' => $this->boundedInt($summary['onlineDevices'] ?? 0, 0, 10000),
                'staleDevices' => $this->boundedInt($summary['staleDevices'] ?? 0, 0, 10000),
                'offlineDevices' => $this->boundedInt($summary['offlineDevices'] ?? 0, 0, 10000),
                'warningDevices' => $this->boundedInt($summary['warningDevices'] ?? 0, 0, 10000),
                'errorDevices' => $this->boundedInt($summary['errorDevices'] ?? 0, 0, 10000),
                'serverPendingEvents' => $this->boundedInt($summary['serverPendingEvents'] ?? 0, 0, 1000000),
                'rejectedEvents24h' => $this->boundedInt($summary['rejectedEvents24h'] ?? 0, 0, 1000000),
                'lastSyncAt' => $this->optionalIso($summary['lastSyncAt'] ?? null),
                'clientQueueVisibility' => 'LOCAL_ONLY',
            ],
            'devices' => $devices,
        ];
    }

    /** @param list<array<string,mixed>> $history @param array<string,mixed>|null $current */
    private function summarize(array $history, ?array $current, ?string $releaseId, int $reference): array
    {
        $windows = [];
        foreach (['24h' => 86400, '7d' => 7 * 86400] as $label => $seconds) {
            $rows = array_values(array_filter($history, static fn(array $row): bool => $row['stamp'] >= $reference - $seconds));
            $services = [];
            foreach (self::SERVICE_IDS as $id) {
                $samples = [];
                foreach ($rows as $row) if (isset($row['services'][$id])) $samples[] = $row['services'][$id];
                $latencies = array_map(static fn(array $sample): int => $sample['latencyMs'], $samples);
                $okCount = count(array_filter($samples, static fn(array $sample): bool => $sample['ok'] === true));
                $services[$id] = [
                    'sampleCount' => count($samples),
                    'availabilityPercent' => $samples === [] ? null : round($okCount * 100 / count($samples), 2),
                    'p50Ms' => $this->percentile($latencies, 0.50),
                    'p95Ms' => $this->percentile($latencies, 0.95),
                ];
            }
            $windows[$label] = ['sampleCount' => count($rows), 'services' => $services];
        }

        $alerts = [];
        foreach (self::SERVICE_IDS as $id) {
            $samples = [];
            foreach (array_reverse($history) as $row) {
                if (isset($row['services'][$id])) $samples[] = $row['services'][$id];
                if (count($samples) >= 3) break;
            }
            if (count($samples) === 3 && count(array_filter($samples, static fn(array $sample): bool => $sample['ok'] === false)) === 3) {
                $alerts[] = ['key' => 'service-down-' . $id, 'severity' => 'CRITICAL', 'title' => $this->serviceLabel($id) . ' มีปัญหาต่อเนื่อง', 'detail' => 'ตรวจพบไม่ผ่าน 3 รอบติดกัน จึงแจ้งเตือนแทนการเตือนจาก blip เดียว', 'action' => 'CHECK_SERVICE'];
                continue;
            }
            $threshold = $id === 'website' ? 2500 : 1500;
            if (count($samples) === 3 && count(array_filter($samples, static fn(array $sample): bool => $sample['ok'] && $sample['latencyMs'] >= $threshold)) === 3) {
                $alerts[] = ['key' => 'service-slow-' . $id, 'severity' => 'WARNING', 'title' => $this->serviceLabel($id) . ' ช้าต่อเนื่อง', 'detail' => 'Latency สูงกว่าเกณฑ์ 3 รอบติดกัน', 'action' => 'CHECK_LATENCY'];
            }
        }
        foreach (['learn.kruart.online', 'school.kruart.online'] as $host) {
            $states = [];
            foreach (array_reverse($history) as $row) {
                if (isset($row['dns'][$host])) $states[] = $row['dns'][$host];
                if (count($states) >= 3) break;
            }
            if (count($states) === 3 && count(array_filter($states, static fn(string $state): bool => $state !== 'healthy')) === 3) {
                $alerts[] = ['key' => 'dns-' . str_replace('.', '-', $host), 'severity' => 'WARNING', 'title' => 'DNS ' . $host . ' ยังไม่พร้อม', 'detail' => 'ตรวจพบ DNS ผิดปกติ 3 รอบติดกัน', 'action' => 'CHECK_DNS'];
            }
        }
        $latest = $history === [] ? null : $history[array_key_last($history)];
        if (is_array($latest) && ($latest['learnlab']['serverPendingEvents'] ?? 0) >= 25) {
            $alerts[] = ['key' => 'learnlab-server-sync-backlog', 'severity' => 'WARNING', 'title' => 'LearnLab มี sync backlog', 'detail' => 'มี event ฝั่ง server รอประมวลผลอย่างน้อย 25 รายการ', 'action' => 'CHECK_LEARNLAB_SYNC'];
        }
        if (is_array($latest) && ($latest['learnlab']['errorDevices'] ?? 0) > 0) {
            $alerts[] = ['key' => 'learnlab-device-error', 'severity' => 'WARNING', 'title' => 'LearnLab มีเครื่องรายงาน error', 'detail' => 'แสดงเฉพาะเครื่องที่ส่ง health_state=error; เครื่องปิดปกติไม่ทำให้เกิด alert', 'action' => 'CHECK_LEARNLAB_DEVICES'];
        }
        $currentLearnLab = is_array($current['learnlab']['summary'] ?? null) ? $current['learnlab']['summary'] : [];
        if (($currentLearnLab['rejectedEvents24h'] ?? 0) >= 10) {
            $alerts[] = ['key' => 'learnlab-sync-rejections', 'severity' => 'WARNING', 'title' => 'LearnLab มี sync rejection สูง', 'detail' => 'มี event ถูกปฏิเสธอย่างน้อย 10 รายการใน 24 ชั่วโมง ควรตรวจ schema/context ก่อนกระจายเครื่องเพิ่ม', 'action' => 'CHECK_LEARNLAB_SYNC'];
        }

        $deploy = ['state' => 'INSUFFICIENT_DATA', 'releaseId' => $releaseId, 'services' => []];
        if (is_string($releaseId) && $releaseId !== '') {
            $transition = null;
            foreach ($history as $index => $row) {
                if (($row['releaseId'] ?? null) === $releaseId && ($index === 0 || ($history[$index - 1]['releaseId'] ?? null) !== $releaseId)) { $transition = $index; break; }
            }
            if (is_int($transition) && $transition > 0) {
                $beforeRows = array_slice($history, max(0, $transition - 12), min(12, $transition));
                $afterRows = array_slice($history, $transition, 12);
                foreach (self::SERVICE_IDS as $id) {
                    $before = []; $after = [];
                    foreach ($beforeRows as $row) if (isset($row['services'][$id]) && $row['services'][$id]['ok']) $before[] = $row['services'][$id]['latencyMs'];
                    foreach ($afterRows as $row) if (isset($row['services'][$id]) && $row['services'][$id]['ok']) $after[] = $row['services'][$id]['latencyMs'];
                    $beforeP95 = $this->percentile($before, 0.95); $afterP95 = $this->percentile($after, 0.95);
                    $deploy['services'][$id] = [
                        'beforeP95Ms' => $beforeP95,
                        'afterP95Ms' => $afterP95,
                        'deltaPercent' => $beforeP95 === null || $afterP95 === null || $beforeP95 <= 0 ? null : round(($afterP95 - $beforeP95) * 100 / $beforeP95, 1),
                    ];
                }
                $deploy['state'] = count($afterRows) >= 3 ? 'READY' : 'COLLECTING_AFTER_DEPLOY';
            }
        }
        return ['windows' => $windows, 'deployCorrelation' => $deploy, 'alerts' => $alerts];
    }

    private function readRecoveryProof(int $reference): array
    {
        if (!is_file($this->recoveryProofPath) || is_link($this->recoveryProofPath)) return ['state' => 'NOT_RUN', 'verifiedAt' => null];
        $size = @filesize($this->recoveryProofPath); if (!is_int($size) || $size < 2 || $size > 32768) return ['state' => 'INVALID', 'verifiedAt' => null];
        try { $value = json_decode((string) file_get_contents($this->recoveryProofPath), true, 16, JSON_THROW_ON_ERROR); }
        catch (Throwable) { return ['state' => 'INVALID', 'verifiedAt' => null]; }
        if (!is_array($value) || ($value['schemaVersion'] ?? null) !== 1) return ['state' => 'INVALID', 'verifiedAt' => null];
        $state = $this->enum($value['state'] ?? 'INVALID', ['PASS', 'FAILED'], 'INVALID');
        $verifiedAt = $this->optionalIso($value['verifiedAt'] ?? null);
        $age = $verifiedAt === null ? null : max(0, $reference - (strtotime($verifiedAt) ?: $reference));
        return [
            'state' => $state,
            'verifiedAt' => $verifiedAt,
            'ageSeconds' => $age,
            'databaseSchemaVersion' => $this->boundedInt($value['databaseSchemaVersion'] ?? 0, 0, 100000),
            'backupName' => $this->safeText($value['backupName'] ?? 'unknown', 120),
        ];
    }

    /** @param list<int> $values */
    private function percentile(array $values, float $p): ?int
    {
        if ($values === []) return null;
        sort($values, SORT_NUMERIC);
        $index = (int) ceil($p * count($values)) - 1;
        return (int) $values[max(0, min(count($values) - 1, $index))];
    }

    /** @param list<array<string,mixed>> $alerts */
    private function dedupeAlerts(array $alerts): array
    {
        $out = []; $seen = [];
        foreach ($alerts as $alert) {
            $key = is_string($alert['key'] ?? null) ? $alert['key'] : '';
            if ($key === '' || isset($seen[$key])) continue;
            $seen[$key] = true; $out[] = $alert;
        }
        return $out;
    }

    private function serviceLabel(string $id): string
    {
        return ['awh' => 'AWH', 'bay' => 'BAY EXCUSE X', 'learnlab' => 'BAY LearnLab', 'website' => 'เว็บไซต์โรงเรียน'][$id] ?? $id;
    }

    private function safeText(mixed $value, int $max): string
    {
        if (!is_string($value)) return 'unknown';
        $value = trim($value); if ($value === '') return 'unknown';
        $value = preg_replace('/[\x00-\x1F\x7F]/u', '', $value) ?? '';
        return function_exists('mb_substr') ? mb_substr($value, 0, $max, 'UTF-8') : substr($value, 0, $max);
    }

    private function iso(mixed $value): string
    {
        if (!is_string($value) || strtotime($value) === false || strlen($value) > 40) throw new RuntimeException('Invalid health timestamp');
        return gmdate('c', (int) strtotime($value));
    }

    private function optionalIso(mixed $value): ?string
    {
        if (!is_string($value) || $value === '' || strlen($value) > 40) return null;
        $stamp = strtotime($value); return $stamp === false ? null : gmdate('c', $stamp);
    }

    /** @param list<string> $allowed */
    private function enum(mixed $value, array $allowed, string $fallback): string
    {
        return is_string($value) && in_array($value, $allowed, true) ? $value : $fallback;
    }

    private function boundedInt(mixed $value, int $min, int $max): int
    {
        $number = is_int($value) ? $value : (is_numeric($value) ? (int) $value : $min);
        return max($min, min($max, $number));
    }
}
