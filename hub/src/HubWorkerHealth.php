<?php

declare(strict_types=1);

/**
 * Single authority for effective Desktop worker freshness.
 * Raw control_workers.state records the last declared state; online readiness
 * is derived from last_seen_at so stale devices can never remain READY forever.
 */
final class HubWorkerHealth
{
    public const STALE_TTL_SECONDS = 120;
    private const DECLARED_STATES = ['READY', 'WORKING', 'OFFLINE'];

    public static function effectiveState(mixed $declaredState, mixed $lastSeenAt, ?string $now = null): string
    {
        $reference = strtotime($now ?? 'now');
        $lastSeen = is_string($lastSeenAt) ? strtotime($lastSeenAt) : false;
        if ($reference === false) $reference = time();
        if ($lastSeen === false || max(0, $reference - $lastSeen) > self::STALE_TTL_SECONDS) return 'STALE';
        $state = is_string($declaredState) ? strtoupper($declaredState) : 'OFFLINE';
        return in_array($state, self::DECLARED_STATES, true) ? $state : 'OFFLINE';
    }

    /** @return array<string,int> */
    public static function counts(PDO $pdo, ?string $now = null): array
    {
        try {
            $rows = $pdo->query('SELECT state,last_seen_at FROM control_workers')->fetchAll();
        } catch (Throwable) {
            return [];
        }
        $out = [];
        foreach (is_array($rows) ? $rows : [] as $row) {
            if (!is_array($row)) continue;
            $state = self::effectiveState($row['state'] ?? null, $row['last_seen_at'] ?? null, $now);
            $out[$state] = ($out[$state] ?? 0) + 1;
        }
        ksort($out);
        return $out;
    }
}
