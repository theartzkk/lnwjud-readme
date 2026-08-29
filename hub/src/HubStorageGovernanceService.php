<?php

declare(strict_types=1);

/**
 * Read-only storage governance over the bounded AWH roots.  This is a
 * projection, not a garbage collector: it never moves or deletes anything.
 * Unknown items are retained so a housekeeping pass cannot remove user work,
 * rollback material, audit evidence or credentials by inference.
 */
final class HubStorageGovernanceService
{
    private const MAX_CHILDREN = 500;
    private const MAX_ITEMS = 120;
    private const CATEGORIES = ['ACTIVE', 'RETAIN', 'QUARANTINE', 'SAFE_TO_PURGE', 'PROTECTED'];

    /** @var array<string,string> */
    private readonly array $roots;

    /** @param array<string,string>|null $roots */
    public function __construct(?array $roots = null)
    {
        $this->roots = $roots ?? [
            'hubData' => getenv('AWH_HUB_DATA_ROOT') ?: '/var/lib/awh-hub',
            'backups' => getenv('AWH_HUB_BACKUP_ROOT') ?: '/var/backups/awh-hub',
            'controlReleases' => '/opt/awh-hub/control-releases',
            'webReleases' => '/var/www/awh-web/releases',
            'controlPointer' => '/opt/awh-hub/control-plane-current',
            'webPointer' => '/var/www/awh-web/current',
        ];
    }

    /** @param array<string,string> $activeReleaseIds */
    public function audit(?string $now = null, array $activeReleaseIds = []): array
    {
        $at = strtotime($now ?? gmdate('c')) ?: time();
        $summary = array_fill_keys(self::CATEGORIES, ['items' => 0, 'bytes' => 0]);
        $roots = [];
        $items = [];
        foreach ($this->roots as $rootId => $root) {
            if (!is_string($root) || $root === '' || str_contains($root, "\0") || !str_starts_with($root, '/')) {
                $roots[] = ['rootId' => $rootId, 'state' => 'UNKNOWN', 'items' => 0];
                continue;
            }
            $isPointer = in_array($rootId, ['controlPointer', 'webPointer'], true);
            if ($isPointer) {
                $target = is_link($root) ? readlink($root) : false;
                $state = is_string($target) && $target !== '' && is_dir($root) ? 'READY' : 'UNKNOWN';
                $roots[] = ['rootId' => $rootId, 'state' => $state, 'items' => $state === 'READY' ? 1 : 0];
                if ($state === 'READY') $this->addItem($items, $summary, $rootId, basename($target), 'ACTIVE', 0, false);
                continue;
            }
            if (!is_dir($root) || is_link($root) || !is_readable($root)) {
                $roots[] = ['rootId' => $rootId, 'state' => 'UNKNOWN', 'items' => 0];
                continue;
            }
            $children = @scandir($root);
            if (!is_array($children)) {
                $roots[] = ['rootId' => $rootId, 'state' => 'UNKNOWN', 'items' => 0];
                continue;
            }
            $rootCount = 0;
            foreach (array_slice($children, 0, self::MAX_CHILDREN) as $name) {
                if ($name === '.' || $name === '..') continue;
                $path = $root . DIRECTORY_SEPARATOR . $name;
                $classification = $this->classify($rootId, $name, $path, $at, $activeReleaseIds);
                $size = is_file($path) && !is_link($path) ? @filesize($path) : 0;
                $known = is_file($path) && !is_link($path) && is_int($size);
                $this->addItem($items, $summary, $rootId, $name, $classification, $known ? max(0, $size) : 0, $known);
                $rootCount++;
            }
            $roots[] = ['rootId' => $rootId, 'state' => 'READY', 'items' => $rootCount, 'bounded' => count($children) > self::MAX_CHILDREN];
        }
        $hasQuarantine = $summary['QUARANTINE']['items'] > 0;
        $hasUnknownSize = count(array_filter($items, static fn (array $item): bool => ($item['sizeKnown'] ?? false) !== true)) > 0;
        return [
            'schemaVersion' => 1,
            'generatedAt' => gmdate('c', $at),
            'policy' => [
                'classification' => 'ACTIVE/RETAIN/QUARANTINE/SAFE_TO_PURGE/PROTECTED',
                'purgeMode' => 'AUDIT_ONLY',
                'unknownItems' => 'RETAIN',
                'maxChildrenPerRoot' => self::MAX_CHILDREN,
            ],
            'state' => $hasQuarantine ? 'REVIEW' : ($hasUnknownSize ? 'BOUNDED_REVIEW' : 'GOVERNED'),
            'roots' => $roots,
            'summary' => $summary,
            'items' => array_slice($items, 0, self::MAX_ITEMS),
            'actions' => ['purged' => 0, 'quarantined' => 0, 'reclaimableBytes' => (int) $summary['SAFE_TO_PURGE']['bytes']],
        ];
    }

    /** @param list<array<string,mixed>> $items @param array<string,array{items:int,bytes:int}> $summary */
    private function addItem(array &$items, array &$summary, string $rootId, string $name, string $classification, int $bytes, bool $sizeKnown): void
    {
        if (!in_array($classification, self::CATEGORIES, true)) $classification = 'RETAIN';
        $summary[$classification]['items']++;
        $summary[$classification]['bytes'] += $bytes;
        if (count($items) < self::MAX_ITEMS) $items[] = ['rootId' => $rootId, 'name' => $this->safeName($name), 'classification' => $classification, 'sizeBytes' => $bytes, 'sizeKnown' => $sizeKnown];
    }

    /** @param array<string,string> $activeReleaseIds */
    private function classify(string $rootId, string $name, string $path, int $at, array $activeReleaseIds): string
    {
        if (is_link($path)) return 'PROTECTED';
        if ($rootId === 'controlReleases' || $rootId === 'webReleases') {
            if (in_array($name, array_values($activeReleaseIds), true)) return 'ACTIVE';
            if (preg_match('/^m[0-9]+-[A-Za-z0-9._-]{6,72}$/', $name) === 1) return 'RETAIN';
            return $this->isStaleCandidate($name) ? 'QUARANTINE' : 'RETAIN';
        }
        if ($rootId === 'backups' && preg_match('/^awh-[0-9]{8}T[0-9]{6}Z\.sqlite(?:\.json)?$/', $name) === 1) return 'PROTECTED';
        if ($rootId === 'hubData' && in_array($name, ['awh.sqlite', 'project-vault', 'attachments', 'artifacts', 'task-workspaces', 'task-transfers', 'provider-credentials'], true)) return 'PROTECTED';
        if ($this->isStaleCandidate($name)) return 'QUARANTINE';
        if (preg_match('/^(?:\.tmp-|tmp-|.*\.(?:tmp|part))$/i', $name) === 1 && !is_dir($path) && is_file($path)) {
            $mtime = @filemtime($path);
            if (is_int($mtime) && $mtime < ($at - 86400)) return 'SAFE_TO_PURGE';
        }
        return 'RETAIN';
    }

    private function isStaleCandidate(string $name): bool { return preg_match('/(?:^|[-_.])(failed|candidate|orphan|stale|quarantine)(?:[-_.]|$)/i', $name) === 1; }
    private function safeName(string $name): string { return preg_match('/^[A-Za-z0-9._-]{1,160}$/', $name) === 1 ? $name : 'UNSAFE_NAME'; }
}
