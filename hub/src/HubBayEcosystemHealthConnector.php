<?php

declare(strict_types=1);

final class HubBayEcosystemHealthConnector
{
    public function __construct(private readonly string $adapterPath)
    {
        if (
            $adapterPath === ''
            || !str_starts_with($adapterPath, '/var/www/bay-staging/')
            || str_contains($adapterPath, "\0")
        ) {
            throw new RuntimeException('BAY LearnLab connector path is invalid');
        }
    }

    public static function fromEnvironment(): self
    {
        return new self(
            getenv('AWH_BAY_LEARNLAB_HOST_ADAPTER')
                ?: '/var/www/bay-staging/current/learnlab/server/host-adapter.php'
        );
    }

    public function collect(?string $now = null): array
    {
        $at = strtotime($now ?? 'now');
        if ($at === false) $at = time();

        $real = realpath($this->adapterPath);
        if (
            !is_string($real)
            || !str_starts_with($real, '/var/www/bay-staging/releases/')
            || !is_file($real)
            || is_link($real)
            || !is_readable($real)
        ) {
            return $this->unavailable('BAY_ADAPTER_UNAVAILABLE');
        }

        try {
            $runtime = require $real;
            if (
                !is_object($runtime)
                || !property_exists($runtime, 'db')
                || !property_exists($runtime, 'host')
                || !$runtime->db instanceof PDO
            ) {
                return $this->unavailable('BAY_RUNTIME_UNAVAILABLE');
            }
            $db = $runtime->db;
            $tables = $this->tables($db, ['ll_devices', 'll_sync_events']);
            if (!$tables['ll_devices'] || !$tables['ll_sync_events']) {
                return $this->unavailable('LEARNLAB_SCHEMA_UNAVAILABLE');
            }

            $offlineWindow = 24;
            try {
                if (is_object($runtime->host) && method_exists($runtime->host, 'setting')) {
                    $offlineWindow = max(1, min(168, (int) $runtime->host->setting('learnlab.offline.window_hours', 24)));
                }
            } catch (Throwable) {
                $offlineWindow = 24;
            }

            $releaseVersion = 'unknown';
            $releaseFile = dirname($real, 2) . '/release-runtime.json';
            if (is_file($releaseFile) && !is_link($releaseFile) && filesize($releaseFile) <= 65536) {
                try {
                    $release = json_decode((string) file_get_contents($releaseFile), true, 16, JSON_THROW_ON_ERROR);
                    if (is_array($release) && is_string($release['product_version'] ?? null)) {
                        $candidate = trim((string) $release['product_version']);
                        if (preg_match('/^[A-Za-z0-9._+-]{1,50}$/', $candidate)) $releaseVersion = $candidate;
                    }
                } catch (Throwable) {
                    $releaseVersion = 'unknown';
                }
            }

            $devices = [];
            $counts = [
                'deviceCount' => 0,
                'onlineDevices' => 0,
                'staleDevices' => 0,
                'offlineDevices' => 0,
                'warningDevices' => 0,
                'errorDevices' => 0,
            ];

            $q = $db->query(
                "SELECT display_name,device_role,core_version,last_seen_at,last_sync_at,health_state
                 FROM ll_devices
                 ORDER BY COALESCE(last_seen_at,created_at) DESC
                 LIMIT 100"
            );
            foreach (($q ? $q->fetchAll(PDO::FETCH_ASSOC) : []) ?: [] as $row) {
                $lastSeen = is_string($row['last_seen_at'] ?? null) ? strtotime((string) $row['last_seen_at']) : false;
                $age = $lastSeen === false ? PHP_INT_MAX : max(0, $at - $lastSeen);
                $status = $age <= 900 ? 'ONLINE' : ($age <= 3600 ? 'STALE' : 'OFFLINE');
                $health = is_string($row['health_state'] ?? null) ? strtolower((string) $row['health_state']) : 'unknown';
                if (!in_array($health, ['unknown', 'healthy', 'warning', 'error', 'offline'], true)) $health = 'unknown';

                $counts['deviceCount']++;
                if ($status === 'ONLINE') $counts['onlineDevices']++;
                elseif ($status === 'STALE') $counts['staleDevices']++;
                else $counts['offlineDevices']++;
                if ($health === 'warning') $counts['warningDevices']++;
                if ($health === 'error') $counts['errorDevices']++;

                $devices[] = [
                    'displayName' => $this->text($row['display_name'] ?? 'LearnLab PC', 80),
                    'role' => $this->text($row['device_role'] ?? 'student', 24),
                    'coreVersion' => $this->version($row['core_version'] ?? null),
                    'lastSeenAt' => $this->isoOrNull($row['last_seen_at'] ?? null),
                    'lastSyncAt' => $this->isoOrNull($row['last_sync_at'] ?? null),
                    'healthState' => $health,
                    'status' => $status,
                ];
            }

            $pending = $this->scalar($db, "SELECT COUNT(*) FROM ll_sync_events WHERE processing_state='received'");
            $rejected24h = $this->scalar(
                $db,
                "SELECT COUNT(*) FROM ll_sync_events WHERE processing_state='rejected' AND created_at >= DATE_SUB(UTC_TIMESTAMP(), INTERVAL 1 DAY)"
            );
            $lastSyncRaw = $db->query('SELECT MAX(last_sync_at) FROM ll_devices')?->fetchColumn();
            $lastSync = $this->isoOrNull($lastSyncRaw);

            return [
                'state' => 'READY',
                'generatedAt' => gmdate('c', $at),
                'releaseVersion' => $releaseVersion,
                'offlineWindowHours' => $offlineWindow,
                'summary' => $counts + [
                    'serverPendingEvents' => max(0, $pending),
                    'rejectedEvents24h' => max(0, $rejected24h),
                    'lastSyncAt' => $lastSync,
                    'clientQueueVisibility' => 'LOCAL_ONLY',
                ],
                'devices' => $devices,
                'dataPolicy' => [
                    'studentPiiExposed' => false,
                    'credentialsExposed' => false,
                    'rawPayloadsExposed' => false,
                    'clientOfflineQueueRead' => false,
                ],
            ];
        } catch (Throwable) {
            return $this->unavailable('LEARNLAB_CONNECTOR_FAILED');
        }
    }

    /** @param list<string> $names @return array<string,bool> */
    private function tables(PDO $db, array $names): array
    {
        $out = array_fill_keys($names, false);
        $q = $db->prepare(
            'SELECT table_name FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name IN ('
            . implode(',', array_fill(0, count($names), '?')) . ')'
        );
        $q->execute($names);
        foreach (($q->fetchAll(PDO::FETCH_COLUMN) ?: []) as $name) {
            if (is_string($name) && array_key_exists($name, $out)) $out[$name] = true;
        }
        return $out;
    }

    private function scalar(PDO $db, string $sql): int
    {
        try {
            $value = $db->query($sql)?->fetchColumn();
            return is_numeric($value) ? max(0, (int) $value) : 0;
        } catch (Throwable) {
            return 0;
        }
    }

    private function unavailable(string $code): array
    {
        return [
            'state' => 'UNAVAILABLE',
            'generatedAt' => gmdate('c'),
            'releaseVersion' => 'unknown',
            'offlineWindowHours' => 24,
            'summary' => [
                'deviceCount' => 0,
                'onlineDevices' => 0,
                'staleDevices' => 0,
                'offlineDevices' => 0,
                'warningDevices' => 0,
                'errorDevices' => 0,
                'serverPendingEvents' => 0,
                'rejectedEvents24h' => 0,
                'lastSyncAt' => null,
                'clientQueueVisibility' => 'LOCAL_ONLY',
            ],
            'devices' => [],
            'code' => $code,
            'dataPolicy' => [
                'studentPiiExposed' => false,
                'credentialsExposed' => false,
                'rawPayloadsExposed' => false,
                'clientOfflineQueueRead' => false,
            ],
        ];
    }

    private function text(mixed $value, int $max): string
    {
        $text = is_string($value) ? trim($value) : '';
        $text = preg_replace('/[\x00-\x1F\x7F]/', '', $text) ?? '';
        if ($text === '') $text = 'unknown';
        return function_exists('mb_substr') ? mb_substr($text, 0, $max, 'UTF-8') : substr($text, 0, $max);
    }

    private function version(mixed $value): string
    {
        $value = is_string($value) ? trim($value) : '';
        return preg_match('/^[A-Za-z0-9._+-]{1,50}$/', $value) ? $value : 'unknown';
    }

    private function isoOrNull(mixed $value): ?string
    {
        if (!is_string($value) || $value === '' || strlen($value) > 40) return null;
        $stamp = strtotime($value);
        return $stamp === false ? null : gmdate('c', $stamp);
    }
}
