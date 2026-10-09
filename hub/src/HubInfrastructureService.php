<?php

declare(strict_types=1);

final class HubInfrastructureService
{
    private const MAX_SNAPSHOT_BYTES = 262144;
    private const STALE_SECONDS = 180;
    private const CANONICAL_GIT_REPO = '/srv/awh-git/awh.git';
    private const SERVICE_KEYS = ['nginx', 'php-fpm', 'native-executor', 'backup', 'source-drift', 'gatus', 'beszel', 'fail2ban', 'updates'];
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
        $enrollment = self::pointerRelease('/opt/awh-hub/enrollment-current');
        $releases = self::releaseNames('/opt/awh-hub/control-releases');
        $staged = array_values(array_filter($releases, static fn (string $id): bool => $id !== $control));
        $rollback = null;
        if ($control !== null && preg_match('/^m(\d+)-/', $control, $match) === 1) {
            $currentMajor = (int) $match[1];
            foreach ($staged as $id) {
                if (preg_match('/^m(\d+)-/', $id, $candidate) === 1 && (int) $candidate[1] <= $currentMajor) { $rollback = $id; break; }
            }
        }
        $controlSha = self::manifestSource('/opt/awh-hub/control-plane-current/dist-web/release.json', $control);
        $webSha = self::manifestSource('/var/www/awh-web/current/release.json', $web);
        $enrollmentSha = self::manifestSource('/opt/awh-hub/enrollment-current/release-source.json', $enrollment);
        $enrollmentRef = $enrollmentSha ?? self::releaseSourceRef($enrollment);
        $trackSplit = self::trackSplitCoherent($controlSha, $webSha);
        $sourceState = $controlSha === null || $webSha === null ? 'UNKNOWN' : (hash_equals($controlSha, $webSha) ? 'MATCHED' : ($trackSplit ? 'TRACK_COHERENT' : 'MISMATCH'));
        $runtimeSha = $sourceState === 'TRACK_COHERENT' ? $webSha : $controlSha;
        $enrollmentMatches = $runtimeSha !== null && $enrollmentRef !== null ? ($enrollmentSha !== null ? hash_equals($runtimeSha, $enrollmentSha) : str_starts_with($runtimeSha, $enrollmentRef)) : null;
        $componentState = $sourceState === 'UNKNOWN' || $enrollmentMatches === null ? 'UNKNOWN' : (in_array($sourceState, ['MATCHED','TRACK_COHERENT'], true) && $enrollmentMatches ? 'COHERENT' : 'SPLIT');
        $sourceTopology = $sourceState === 'MATCHED' ? 'UNIFIED' : ($sourceState === 'TRACK_COHERENT' ? 'TRACK_SPLIT' : ($sourceState === 'UNKNOWN' ? 'UNKNOWN' : 'UNVERIFIED_SPLIT'));
        return [
            'controlSourceSha' => $controlSha, 'webSourceSha' => $webSha, 'runtimeSourceSha' => $runtimeSha, 'enrollmentSourceSha' => $enrollmentSha, 'enrollmentSourceRef' => $enrollmentRef,
            'sourceState' => $sourceState, 'sourceTopology' => $sourceTopology, 'componentState' => $componentState,
            'controlReleaseId' => $control, 'webReleaseId' => $web, 'enrollmentReleaseId' => $enrollment,
            'pointersMatch' => $control !== null && hash_equals($control, (string) $web),
            'components' => ['control'=>$control,'web'=>$web,'enrollment'=>$enrollment],
            'stagedCandidates' => array_slice($staged, 0, 5), 'rollbackReleaseId' => $rollback,
        ];
    }

    /** Read only exact committed provenance; never expand a milestone/short SHA. */
    public static function manifestSource(string $path, ?string $releaseId): ?string
    {
        if ($releaseId === null || !is_file($path) || is_link($path)) return null;
        $size = @filesize($path);
        if (!is_int($size) || $size < 2 || $size > 262144) return null;
        $value = json_decode((string) @file_get_contents($path), true);
        if (!is_array($value) || ($value['schemaVersion'] ?? null) !== 1 || ($value['releaseId'] ?? null) !== $releaseId || ($value['sourceState'] ?? null) !== 'COMMITTED') return null;
        $sha = $value['sourceSha'] ?? null;
        return is_string($sha) && preg_match('/^[0-9a-f]{40}$/D', $sha) === 1 ? $sha : null;
    }

    private static function trackSplitCoherent(?string $controlSha, ?string $webSha): bool
    {
        if ($controlSha === null || $webSha === null || hash_equals($controlSha, $webSha)) return false;
        $platform = self::canonicalRefSha('platform/production');
        $runtime = self::canonicalRefSha('runtime/production');
        $production = self::canonicalRefSha('production');
        return $platform !== null && $runtime !== null && $production !== null
            && hash_equals($platform, $controlSha)
            && hash_equals($runtime, $webSha)
            && hash_equals($production, $webSha);
    }

    private static function canonicalRefSha(string $branch): ?string
    {
        if (!in_array($branch, ['production','runtime/production','platform/production'], true)) return null;
        $configured = getenv('AWH_CORE_CANONICAL_GIT');
        $path = is_string($configured) && $configured !== '' ? $configured : self::CANONICAL_GIT_REPO;
        if (!str_starts_with($path, '/') || is_link($path)) return null;
        $repo = realpath($path); if (!is_string($repo) || !is_dir($repo)) return null;
        $ref = $repo . '/refs/heads/' . $branch;
        if (is_file($ref) && !is_link($ref) && is_readable($ref)) {
            $sha = strtolower(trim((string) file_get_contents($ref)));
            if (preg_match('/^[0-9a-f]{40}$/D', $sha) === 1) return $sha;
        }
        $packed = $repo . '/packed-refs';
        if (!is_file($packed) || is_link($packed) || !is_readable($packed) || filesize($packed) > 8 * 1024 * 1024) return null;
        $needle = 'refs/heads/' . $branch;
        foreach (preg_split('/\\r?\\n/', (string) file_get_contents($packed)) ?: [] as $line) {
            if ($line === '' || $line[0] === '#' || $line[0] === '^') continue;
            $parts = preg_split('/\\s+/', trim($line));
            if (!is_array($parts) || count($parts) !== 2 || $parts[1] !== $needle) continue;
            $sha = strtolower((string) $parts[0]);
            if (preg_match('/^[0-9a-f]{40}$/D', $sha) === 1) return $sha;
        }
        return null;
    }

    private static function pointerRelease(string $pointer): ?string
    {
        $target = @readlink($pointer); if (!is_string($target) || $target === '') return null;
        $name = basename($target); return self::validReleaseId($name) ? $name : null;
    }

    private static function validReleaseId(string $name): bool
    {
        return preg_match('/^(?:m[0-9a-z]+-[A-Za-z0-9._-]{6,72}|platform-[0-9a-f]{7,40})$/i', $name) === 1;
    }

    private static function releaseSourceRef(?string $releaseId): ?string
    {
        if ($releaseId === null || preg_match('/^m[0-9a-z]+-([0-9a-f]{7,40})(?:-|$)/i', $releaseId, $match) !== 1) return null;
        return strtolower((string) $match[1]);
    }

    /** @return list<string> */
    private static function releaseNames(string $root): array
    {
        $items = @scandir($root); if (!is_array($items)) return [];
        $rows = [];
        foreach ($items as $name) {
            if (!self::validReleaseId($name) || !is_dir($root . '/' . $name) || is_link($root . '/' . $name)) continue;
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
            $state = is_string($item['state'] ?? null) ? strtoupper(trim((string) $item['state'])) : 'UNKNOWN'; if (!in_array($state, self::STATES, true)) $state = 'UNKNOWN';
            $startup = is_string($item['startup'] ?? null) ? strtoupper(trim((string) $item['startup'])) : 'UNKNOWN'; if (!in_array($startup, self::STARTUP, true)) $startup = 'UNKNOWN';
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
        $sites = [];
        foreach (is_array($value['sites'] ?? null) ? $value['sites'] : [] as $item) {
            if (!is_array($item) || array_is_list($item)) continue;
            $host = strtolower(trim((string)($item['primaryHost'] ?? '')));
            if (preg_match('/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/', $host) !== 1 || strlen($host) > 253) continue;
            $hosts = [];
            foreach (is_array($item['hosts'] ?? null) ? $item['hosts'] : [] as $candidate) {
                if (!is_string($candidate)) continue; $candidate = strtolower(trim($candidate));
                if (preg_match('/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/', $candidate) === 1 && strlen($candidate) <= 253) $hosts[$candidate] = true;
            }
            $route = strtoupper((string)($item['routeType'] ?? 'UNKNOWN'));
            if (!in_array($route, ['STATIC','PHP','PROXY','REDIRECT','UNKNOWN'], true)) $route = 'UNKNOWN';
            $port = $item['upstreamPort'] ?? null; $port = is_int($port) && $port >= 1 && $port <= 65535 ? $port : null;
            $redirect = $item['redirectHost'] ?? null;
            $redirect = is_string($redirect) && preg_match('/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/', $redirect) === 1 && strlen($redirect) <= 253 ? strtolower($redirect) : null;
            $rootClass = strtoupper((string)($item['rootClass'] ?? ''));
            $rootClass = in_array($rootClass, ['AWH_SITE_ROOT','WEB_ROOT','SYSTEM_ROOT'], true) ? $rootClass : null;
            $config = $item['configName'] ?? null;
            $config = is_string($config) && preg_match('/^[A-Za-z0-9._-]{1,120}$/', $config) === 1 ? $config : null;
            $id = $item['inventoryId'] ?? null;
            $id = is_string($id) && preg_match('/^nginx-[a-f0-9]{20}$/', $id) === 1 ? $id : 'nginx-'.substr(hash('sha256',$host),0,20);
            $sites[] = ['inventoryId'=>$id,'primaryHost'=>$host,'hosts'=>array_slice(array_keys($hosts),0,20),'tls'=>($item['tls']??false)===true,'routeType'=>$route,'upstreamPort'=>$port,'redirectHost'=>$redirect,'rootClass'=>$rootClass,'configName'=>$config];
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
            'sites' => array_slice($sites, 0, 200),
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
