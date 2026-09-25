<?php

declare(strict_types=1);

final class HubDeviceRoleRegistry
{
    private const MAX_BYTES = 131072;
    private const ROLES = [
        'PRIMARY_AUTHORITY',
        'GENERAL_PROJECT_WORKSTATION',
        'UTILITY_QA_RECOVERY',
        'WINDOWS_UTILITY_QA_WORKER',
        'VIDEO_WORKSTATION',
        'CREATIVE_PRIMARY_WORKSTATION',
        'OFFSITE_BACKUP',
    ];
    private const KINDS = ['server', 'worker', 'external'];

    public function __construct(private readonly string $path)
    {
        if ($path === '' || !str_starts_with($path, '/') || str_contains($path, "\0")) {
            throw new RuntimeException('Device role registry path is invalid');
        }
    }

    public static function fromEnvironment(): self
    {
        $path = getenv('AWH_DEVICE_ROLE_REGISTRY_PATH');
        if (!is_string($path) || $path === '') {
            $path = dirname(__DIR__, 2) . '/config/device-role-registry.json';
        }
        return new self($path);
    }
    /** @param list<array<string,mixed>> $workers @return list<array<string,mixed>> */
    public function decorateWorkers(array $workers): array
    {
        $byDevice = $this->indexByDeviceId();
        $out = [];
        foreach ($workers as $worker) {
            if (!is_array($worker)) continue;
            $id = strtolower((string) ($worker['deviceId'] ?? ''));
            $policy = $this->policyFor($id, (string) ($worker['displayName'] ?? ''));
            $worker['role'] = is_array($policy) ? $policy['role'] : 'UNCLASSIFIED';
            $worker['roleKey'] = is_array($policy) ? $policy['key'] : null;
            $worker['routingEnabled'] = is_array($policy) ? (($policy['routingEnabled'] ?? false) === true) : $this->defaultRoutingEnabled();
            $worker['requiresOwnerApproval'] = !is_array($policy) || ($policy['requiresOwnerApproval'] ?? true) === true;
            $worker['workloads'] = is_array($policy) ? $policy['workloads'] : [];
            $worker['purpose'] = is_array($policy) ? $policy['purpose'] : 'ยังไม่ได้จัดบทบาทใน Device Role Registry';
            $out[] = $worker;
        }
        return $out;
    }

    public function claimAllowed(string $deviceId, ?string $displayName = null): bool
    {
        // Device roles are routing context only. Authentication, heartbeat,
        // advertised capability and task/execution authority decide eligibility.
        return trim($deviceId) !== '';
    }
    /** @param list<array<string,mixed>> $workers @return array<string,mixed> */
    public function projection(array $workers): array
    {
        $decorated = $this->decorateWorkers($workers);
        $workerById = [];
        foreach ($decorated as $worker) {
            $id = strtolower((string) ($worker['deviceId'] ?? ''));
            if ($id !== '') $workerById[$id] = $worker;
        }

        $devices = [];
        $routingEnabled = 0;
        $onlineWorkers = 0;
        $offsiteReady = false;
        foreach ($this->entries() as $entry) {
            $id = is_string($entry['deviceId'] ?? null) ? strtolower($entry['deviceId']) : null;
            $worker = $id !== null ? ($workerById[$id] ?? null) : null;
            $state = is_array($worker)
                ? (string) ($worker['state'] ?? 'UNKNOWN')
                : (($entry['kind'] ?? null) === 'server' ? 'AUTHORITY' : 'OUT_OF_BAND');
            if (($entry['routingEnabled'] ?? false) === true) $routingEnabled++;
            if (is_array($worker) && in_array($state, ['READY', 'WORKING'], true)) $onlineWorkers++;
            if (($entry['role'] ?? null) === 'OFFSITE_BACKUP' && ($entry['backupConfigured'] ?? false) === true) $offsiteReady = true;
            $devices[] = [
                'key' => $entry['key'],
                'deviceId' => $id,
                'displayName' => is_array($worker) ? (string) ($worker['displayName'] ?? $entry['displayName']) : $entry['displayName'],
                'role' => $entry['role'],
                'kind' => $entry['kind'],
                'state' => $state,
                'routingEnabled' => ($entry['routingEnabled'] ?? false) === true,
                'requiresOwnerApproval' => ($entry['requiresOwnerApproval'] ?? true) === true,
                'workloads' => $entry['workloads'],
                'purpose' => $entry['purpose'],
                'lastSeenAt' => is_array($worker) ? ($worker['lastSeenAt'] ?? null) : null,
                'platform' => is_array($worker) ? ($worker['platform'] ?? null) : null,
            ];
        }

        return [
            'schemaVersion' => 1,
            'state' => 'READY',
            'devices' => $devices,
            'summary' => [
                'registered' => count($devices),
                'routingEnabled' => $routingEnabled,
                'onlineWorkers' => $onlineWorkers,
            ],
            'backupCoverage' => [
                'state' => $offsiteReady ? 'READY' : 'NOT_CONFIGURED',
                'role' => 'OFFSITE_BACKUP',
                'detail' => $offsiteReady ? 'มี off-site replica ที่เปิดใช้งานแล้ว' : 'Art-PC ถูกสงวนไว้เป็น off-site backup แต่ยังไม่ activate',
            ],
        ];
    }
    /** @return array<string,mixed>|null */
    private function policyFor(string $deviceId, string $displayName): ?array
    {
        $byDevice = $this->indexByDeviceId();
        if (isset($byDevice[$deviceId])) return $byDevice[$deviceId];
        $needle = mb_strtolower(trim($displayName), 'UTF-8');
        if ($needle === '') return null;
        foreach ($this->entries() as $entry) {
            if (($entry['deviceId'] ?? null) !== null) continue;
            if (mb_strtolower((string) $entry['displayName'], 'UTF-8') === $needle) return $entry;
        }
        return null;
    }

    private function defaultRoutingEnabled(): bool
    {
        try {
            $value = json_decode((string) file_get_contents($this->path), true, 8, JSON_THROW_ON_ERROR);
            return is_array($value) && ($value['defaultRoutingEnabled'] ?? true) === true;
        } catch (Throwable) {
            return true;
        }
    }

    /** @return array<string,array<string,mixed>> */
    private function indexByDeviceId(): array
    {
        $out = [];
        foreach ($this->entries() as $entry) {
            $id = $entry['deviceId'] ?? null;
            if (!is_string($id) || $id === '') continue;
            $out[strtolower($id)] = $entry;
        }
        return $out;
    }

    /** @return list<array<string,mixed>> */
    private function entries(): array
    {
        if (!is_file($this->path) || is_link($this->path)) throw new RuntimeException('Device role registry is unavailable');
        $size = @filesize($this->path);
        if (!is_int($size) || $size < 2 || $size > self::MAX_BYTES) throw new RuntimeException('Device role registry size is invalid');
        $value = json_decode((string) file_get_contents($this->path), true, 32, JSON_THROW_ON_ERROR);
        if (!is_array($value) || ($value['schemaVersion'] ?? null) !== 1 || !is_array($value['devices'] ?? null)) {
            throw new RuntimeException('Device role registry schema is invalid');
        }
        $out = [];
        foreach ($value['devices'] as $row) {
            if (!is_array($row)) continue;
            $entry = $this->normalize($row);
            if ($entry !== null) $out[] = $entry;
            if (count($out) >= 32) break;
        }
        return $out;
    }
    /** @param array<string,mixed> $row @return array<string,mixed>|null */
    private function normalize(array $row): ?array
    {
        $key = $this->text($row['key'] ?? null, 64);
        $displayName = $this->text($row['displayName'] ?? null, 96);
        $role = strtoupper($this->text($row['role'] ?? null, 64));
        $kind = strtolower($this->text($row['kind'] ?? null, 24));
        if ($key === '' || $displayName === '' || !in_array($role, self::ROLES, true) || !in_array($kind, self::KINDS, true)) return null;

        $deviceId = null;
        if (is_string($row['deviceId'] ?? null) && preg_match('/^[0-9a-f-]{36}$/i', $row['deviceId']) === 1) {
            $deviceId = strtolower($row['deviceId']);
        }
        $workloads = [];
        foreach (is_array($row['workloads'] ?? null) ? $row['workloads'] : [] as $workload) {
            if (!is_string($workload) || preg_match('/^[A-Z0-9_:-]{1,64}$/', $workload) !== 1) continue;
            $workloads[] = $workload;
            if (count($workloads) >= 16) break;
        }

        return [
            'key' => $key,
            'deviceId' => $deviceId,
            'displayName' => $displayName,
            'role' => $role,
            'kind' => $kind,
            'routingEnabled' => ($row['routingEnabled'] ?? false) === true,
            'requiresOwnerApproval' => ($row['requiresOwnerApproval'] ?? true) === true,
            'backupConfigured' => ($row['backupConfigured'] ?? false) === true,
            'workloads' => array_values(array_unique($workloads)),
            'purpose' => $this->text($row['purpose'] ?? null, 220),
        ];
    }

    private function text(mixed $value, int $max): string
    {
        if (!is_string($value)) return '';
        $value = trim(preg_replace('/[\x00-\x1F\x7F]/u', ' ', $value) ?? '');
        if ($value === '') return '';
        return mb_substr($value, 0, $max);
    }
}
