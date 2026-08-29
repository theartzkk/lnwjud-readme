<?php

declare(strict_types=1);

final class HubInfrastructureService
{
    private const MAX_SNAPSHOT_BYTES = 262144;
    private const STALE_SECONDS = 180;
    private const SERVICE_KEYS = ['nginx', 'php-fpm', 'native-executor', 'backup', 'fail2ban', 'updates'];
    private const STATES = ['ACTIVE', 'INACTIVE', 'FAILED', 'ACTIVATING', 'DEACTIVATING', 'RELOADING', 'UNKNOWN'];
    private const STARTUP = ['ENABLED', 'DISABLED', 'STATIC', 'INDIRECT', 'MASKED', 'GENERATED', 'TRANSIENT', 'UNKNOWN'];

    public function __construct(private readonly string $snapshotPath)
    {
        if ($snapshotPath === '' || !str_starts_with($snapshotPath, '/') || str_contains($snapshotPath, "\0")) throw new RuntimeException('Infrastructure telemetry configuration is invalid');
    }

    public static function fromEnvironment(): self
    {
        return new self(getenv('AWH_SYSTEM_TELEMETRY_PATH') ?: '/var/lib/awh-hub/system-telemetry.json');
    }

    public function status(?string $now = null): array
    {
        if (!is_file($this->snapshotPath) || is_link($this->snapshotPath)) return ['state' => 'NOT_CONFIGURED', 'generatedAt' => null, 'server' => null];
        $size = @filesize($this->snapshotPath); if (!is_int($size) || $size < 2 || $size > self::MAX_SNAPSHOT_BYTES) return ['state' => 'INVALID', 'generatedAt' => null, 'server' => null];
        $raw = @file_get_contents($this->snapshotPath); if (!is_string($raw)) return ['state' => 'UNAVAILABLE', 'generatedAt' => null, 'server' => null];
        try { $value = json_decode($raw, true, 32, JSON_THROW_ON_ERROR); }
        catch (Throwable) { return ['state' => 'INVALID', 'generatedAt' => null, 'server' => null]; }
        try { $server = $this->sanitize($value); }
        catch (Throwable) { return ['state' => 'INVALID', 'generatedAt' => null, 'server' => null]; }
        $generated = strtotime((string) $server['generatedAt']); $reference = strtotime($now ?? gmdate('c'));
        $state = $generated !== false && $reference !== false && ($reference - $generated) <= self::STALE_SECONDS && ($reference - $generated) >= -30 ? 'READY' : 'STALE';
        return ['state' => $state, 'generatedAt' => $server['generatedAt'], 'server' => $server];
    }

    public static function currentReleaseId(): ?string
    {
        $env = getenv('AWH_RELEASE_ID');
        if (is_string($env) && preg_match('/^[A-Za-z0-9._-]{1,80}$/', $env)) return $env;
        $target = @readlink('/opt/awh-hub/control-plane-current');
        if (!is_string($target) || $target === '') return null;
        $name = basename($target);
        return preg_match('/^[A-Za-z0-9._-]{1,80}$/', $name) ? $name : null;
    }

    /** Sanitized release inventory over the existing release roots; never exposes paths. */
    public static function releaseState(): array
    {
        $control = self::pointerRelease('/opt/awh-hub/control-plane-current');
        $web = self::pointerRelease('/var/www/awh-web/current');
        $releases = self::releaseNames('/opt/awh-hub/control-releases');
        $staged = array_values(array_filter($releases, static fn (string $id): bool => $id !== $control));
        $rollback = null;
        if ($control !== null && preg_match('/^m(\d+)-/', $control, $match) === 1) {
            $currentMajor = (int) $match[1];
            foreach ($staged as $id) {
                if (preg_match('/^m(\d+)-/', $id, $candidate) === 1 && (int) $candidate[1] <= $currentMajor) { $rollback = $id; break; }
            }
        }
        return ['controlReleaseId' => $control, 'webReleaseId' => $web, 'pointersMatch' => $control !== null && hash_equals($control, (string) $web), 'stagedCandidates' => array_slice($staged, 0, 5), 'rollbackReleaseId' => $rollback];
    }

    private static function pointerRelease(string $pointer): ?string
    {
        $target = @readlink($pointer); if (!is_string($target) || $target === '') return null;
        $name = basename($target); return preg_match('/^m[0-9]+-[A-Za-z0-9._-]{6,72}$/', $name) === 1 ? $name : null;
    }

    /** @return list<string> */
    private static function releaseNames(string $root): array
    {
        $items = @scandir($root); if (!is_array($items)) return [];
        $rows = [];
        foreach ($items as $name) {
            if (preg_match('/^m[0-9]+-[A-Za-z0-9._-]{6,72}$/', $name) !== 1 || !is_dir($root . '/' . $name) || is_link($root . '/' . $name)) continue;
            $time = @filemtime($root . '/' . $name); $rows[] = ['id' => $name, 'time' => is_int($time) ? $time : 0];
        }
        usort($rows, static fn (array $a, array $b): int => $b['time'] <=> $a['time'] ?: strcmp($b['id'], $a['id']));
        return array_map(static fn (array $row): string => $row['id'], $rows);
    }

    private function sanitize(mixed $value): array
    {
        if (!is_array($value) || array_is_list($value) || ($value['schemaVersion'] ?? null) !== 1) throw new RuntimeException('Invalid telemetry schema');
        $generatedAt = $this->text($value['generatedAt'] ?? null, 40); if (strtotime($generatedAt) === false) throw new RuntimeException('Invalid telemetry time');
        $host = is_array($value['host'] ?? null) ? $value['host'] : [];
        $cpu = is_array($value['cpu'] ?? null) ? $value['cpu'] : [];
        $memory = is_array($value['memory'] ?? null) ? $value['memory'] : [];
        $swap = is_array($value['swap'] ?? null) ? $value['swap'] : [];
        $storage = is_array($value['storage'] ?? null) ? $value['storage'] : [];
        $security = is_array($value['security'] ?? null) ? $value['security'] : [];
        $services = [];
        foreach (is_array($value['services'] ?? null) ? $value['services'] : [] as $item) {
            if (!is_array($item) || array_is_list($item)) continue;
            $key = $this->text($item['key'] ?? null, 32); if (!in_array($key, self::SERVICE_KEYS, true)) continue;
            $state = strtoupper($this->text($item['state'] ?? 'UNKNOWN', 24)); if (!in_array($state, self::STATES, true)) $state = 'UNKNOWN';
            $startup = strtoupper($this->text($item['startup'] ?? 'UNKNOWN', 24)); if (!in_array($startup, self::STARTUP, true)) $startup = 'UNKNOWN';
            $services[] = ['key' => $key, 'label' => $this->text($item['label'] ?? $key, 60), 'state' => $state, 'startup' => $startup];
        }
        $domains = [];
        foreach (is_array($value['domains'] ?? null) ? $value['domains'] : [] as $item) {
            if (!is_array($item) || array_is_list($item)) continue;
            $name = strtolower($this->text($item['name'] ?? null, 253)); if (preg_match('/^(?:\*\.)?[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/', $name) !== 1) continue;
            $expires = $item['certificateExpiresAt'] ?? null; $expires = is_string($expires) && strlen($expires) <= 40 && strtotime($expires) !== false ? $expires : null;
            $days = $item['certificateDaysRemaining'] ?? null; $days = is_int($days) && $days >= -3650 && $days <= 3650 ? $days : null;
            $domains[] = ['name' => $name, 'tls' => ($item['tls'] ?? false) === true, 'certificateExpiresAt' => $expires, 'certificateDaysRemaining' => $days];
        }
        return [
            'schemaVersion' => 1,
            'generatedAt' => $generatedAt,
            'host' => ['name' => $this->text($host['name'] ?? 'server', 80), 'os' => $this->text($host['os'] ?? 'Linux', 120), 'uptimeSeconds' => $this->integer($host['uptimeSeconds'] ?? 0, 0, PHP_INT_MAX)],
            'cpu' => ['usedPercent' => $this->percent($cpu['usedPercent'] ?? null), 'load1' => $this->decimal($cpu['load1'] ?? null), 'load5' => $this->decimal($cpu['load5'] ?? null), 'load15' => $this->decimal($cpu['load15'] ?? null)],
            'memory' => $this->capacity($memory),
            'swap' => $this->capacity($swap),
            'storage' => $this->capacity($storage),
            'services' => array_slice($services, 0, 12),
            'domains' => array_slice($domains, 0, 100),
            'security' => ['fail2ban' => $this->state($security['fail2ban'] ?? 'UNKNOWN'), 'automaticUpdates' => $this->state($security['automaticUpdates'] ?? 'UNKNOWN')],
        ];
    }

    private function capacity(array $value): array
    {
        $total = $this->integer($value['totalBytes'] ?? 0, 0, PHP_INT_MAX);
        $used = $this->integer($value['usedBytes'] ?? 0, 0, PHP_INT_MAX);
        $free = array_key_exists('freeBytes', $value) ? $this->integer($value['freeBytes'], 0, PHP_INT_MAX) : max(0, $total - $used);
        $available = array_key_exists('availableBytes', $value) ? $this->integer($value['availableBytes'], 0, PHP_INT_MAX) : $free;
        return ['totalBytes' => $total, 'usedBytes' => min($used, $total > 0 ? $total : $used), 'freeBytes' => min($free, $total > 0 ? $total : $free), 'availableBytes' => min($available, $total > 0 ? $total : $available), 'usedPercent' => $this->percent($value['usedPercent'] ?? null)];
    }

    private function text(mixed $value, int $max): string
    {
        if (!is_string($value)) throw new RuntimeException('Invalid telemetry text'); $value = trim($value);
        if ($value === '' || strlen($value) > $max || preg_match('/[\x00-\x1f\x7f]/', $value) || str_contains($value, '/') || str_contains($value, '\\')) throw new RuntimeException('Invalid telemetry text');
        return $value;
    }
    private function integer(mixed $value, int $min, int $max): int { if (!is_int($value) || $value < $min || $value > $max) throw new RuntimeException('Invalid telemetry integer'); return $value; }
    private function percent(mixed $value): ?float { if ($value === null) return null; if (!is_int($value) && !is_float($value)) throw new RuntimeException('Invalid telemetry percent'); $number = (float) $value; return $number >= 0 && $number <= 100 ? round($number, 1) : throw new RuntimeException('Invalid telemetry percent'); }
    private function decimal(mixed $value): ?float { if ($value === null) return null; if (!is_int($value) && !is_float($value)) throw new RuntimeException('Invalid telemetry decimal'); $number = (float) $value; return is_finite($number) && $number >= 0 && $number <= 100000 ? $number : throw new RuntimeException('Invalid telemetry decimal'); }
    private function state(mixed $value): string { $state = is_string($value) ? strtoupper($value) : 'UNKNOWN'; return in_array($state, self::STATES, true) ? $state : 'UNKNOWN'; }
}
