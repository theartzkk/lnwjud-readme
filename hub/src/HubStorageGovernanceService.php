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
    private const MAX_NODES = 4000;
    private const CATEGORIES = ['ACTIVE', 'RETAIN', 'QUARANTINE', 'SAFE_TO_PURGE', 'PROTECTED', 'UNKNOWN'];

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
                $this->addItem($items, $summary, $rootId, 'ROOT_UNAVAILABLE', 'UNKNOWN', 0, false);
                continue;
            }
            $isPointer = in_array($rootId, ['controlPointer', 'webPointer'], true);
            if ($isPointer) {
                $target = is_link($root) ? readlink($root) : false;
                $state = is_string($target) && $target !== '' && is_dir($root) ? 'READY' : 'UNKNOWN';
                $roots[] = ['rootId' => $rootId, 'state' => $state, 'items' => $state === 'READY' ? 1 : 0];
                if ($state === 'READY') $this->addItem($items, $summary, $rootId, basename($target), 'ACTIVE', 0, false);
                else $this->addItem($items, $summary, $rootId, 'POINTER_UNAVAILABLE', 'UNKNOWN', 0, false);
                continue;
            }
            if (!is_dir($root) || is_link($root) || !is_readable($root)) {
                $roots[] = ['rootId' => $rootId, 'state' => 'UNKNOWN', 'items' => 0];
                $this->addItem($items, $summary, $rootId, 'ROOT_UNAVAILABLE', 'UNKNOWN', 0, false);
                continue;
            }
            $children = @scandir($root);
            if (!is_array($children)) {
                $roots[] = ['rootId' => $rootId, 'state' => 'UNKNOWN', 'items' => 0];
                $this->addItem($items, $summary, $rootId, 'ROOT_UNREADABLE', 'UNKNOWN', 0, false);
                continue;
            }
            $rootCount = 0;
            foreach (array_slice($children, 0, self::MAX_CHILDREN) as $name) {
                if ($name === '.' || $name === '..') continue;
                $path = $root . DIRECTORY_SEPARATOR . $name;
                $classification = $this->classify($rootId, $name, $path, $at, $activeReleaseIds);
                $measurement = $this->measure($path);
                $this->addItem($items, $summary, $rootId, $name, $classification, $measurement['bytes'], $measurement['known'], $measurement['nodes']);
                $rootCount++;
            }
            $roots[] = ['rootId' => $rootId, 'state' => 'READY', 'items' => $rootCount, 'bounded' => count($children) > self::MAX_CHILDREN];
        }
        $hasQuarantine = $summary['QUARANTINE']['items'] > 0;
        $hasUnknown = $summary['UNKNOWN']['items'] > 0 || count(array_filter($items, static fn (array $item): bool => ($item['sizeKnown'] ?? false) !== true)) > 0;
        $unknownBytes = $hasUnknown ? null : (int) $summary['UNKNOWN']['bytes'];
        $reclaimable = (int) $summary['SAFE_TO_PURGE']['bytes'];
        $disk = $this->disk();
        $largest = $items;
        usort($largest, static fn (array $a, array $b): int => (int) ($b['sizeBytes'] ?? 0) <=> (int) ($a['sizeBytes'] ?? 0));
        return [
            'schemaVersion' => 2,
            'generatedAt' => gmdate('c', $at),
            'policy' => [
                'classification' => implode('/', self::CATEGORIES),
                'purgeMode' => 'AUDIT_ONLY',
                'unknownItems' => 'UNKNOWN_AND_RETAINED',
                'maxChildrenPerRoot' => self::MAX_CHILDREN,
                'maxMeasuredNodesPerItem' => self::MAX_NODES,
            ],
            'state' => $hasQuarantine ? 'REVIEW' : ($hasUnknown ? 'BOUNDED_REVIEW' : 'GOVERNED'),
            'disk' => $disk,
            'roots' => $roots,
            'summary' => $summary,
            'categoryBreakdown' => $summary,
            'reclaimableBytes' => $reclaimable,
            'protectedBytes' => (int) $summary['PROTECTED']['bytes'],
            'unknownBytes' => $unknownBytes,
            'largestConsumers' => array_slice($largest, 0, 10),
            'growth' => ['state' => 'UNKNOWN', 'reason' => 'INSUFFICIENT_HISTORY'],
            'forecast' => ['state' => 'UNKNOWN', 'reason' => 'INSUFFICIENT_HISTORY', 'warningDays' => null, 'criticalDays' => null],
            'items' => array_slice($items, 0, self::MAX_ITEMS),
            'actions' => [
                'scanned' => true,
                'preview' => $reclaimable > 0 ? 'READY' : 'NO_SAFE_ITEMS',
                'quarantined' => 0,
                'quarantine' => 'NOT_ENABLED',
                'verifyQuarantine' => 'NOT_ENABLED',
                'purged' => 0,
                'purge' => 'AUDIT_ONLY',
                'reclaimableBytes' => $reclaimable,
            ],
        ];
    }

    /** @param list<array<string,mixed>> $items @param array<string,array{items:int,bytes:int}> $summary */
    private function addItem(array &$items, array &$summary, string $rootId, string $name, string $classification, int $bytes, bool $sizeKnown, int $nodes = 1): void
    {
        if (!in_array($classification, self::CATEGORIES, true)) $classification = 'UNKNOWN';
        $summary[$classification]['items']++;
        $summary[$classification]['bytes'] += $bytes;
        if (count($items) < self::MAX_ITEMS) $items[] = ['rootId' => $rootId, 'name' => $this->safeName($name), 'classification' => $classification, 'sizeBytes' => $bytes, 'sizeKnown' => $sizeKnown, 'measuredNodes' => $nodes];
    }

    /** @return array{bytes:int,known:bool,nodes:int} */
    private function measure(string $path): array
    {
        if (is_link($path)) return ['bytes' => 0, 'known' => false, 'nodes' => 0];
        if (is_file($path)) { $size = @filesize($path); return ['bytes' => is_int($size) ? max(0, $size) : 0, 'known' => is_int($size), 'nodes' => 1]; }
        if (!is_dir($path)) return ['bytes' => 0, 'known' => false, 'nodes' => 0];
        $bytes = 0; $nodes = 0; $known = true;
        try {
            $iterator = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($path, FilesystemIterator::SKIP_DOTS | FilesystemIterator::CURRENT_AS_FILEINFO), RecursiveIteratorIterator::LEAVES_ONLY);
            foreach ($iterator as $file) {
                if ($nodes >= self::MAX_NODES) { $known = false; break; }
                if (!$file instanceof SplFileInfo || $file->isLink()) { $known = false; continue; }
                $nodes++;
                if (!$file->isFile()) { $known = false; continue; }
                $size = $file->getSize();
                if (!is_int($size) || $size < 0) { $known = false; continue; }
                $bytes += $size;
            }
        } catch (Throwable) { $known = false; }
        return ['bytes' => $bytes, 'known' => $known, 'nodes' => $nodes];
    }

    /** @return array{state:string,totalBytes:int,usedBytes:int,freeBytes:int,usedPercent:?float} */
    private function disk(): array
    {
        try {
            $total = @disk_total_space('/'); $free = @disk_free_space('/');
            if (!is_float($total) && !is_int($total)) throw new RuntimeException('disk total unavailable');
            if (!is_float($free) && !is_int($free)) throw new RuntimeException('disk free unavailable');
            $total = max(0, (int) $total); $free = max(0, min($total, (int) $free)); $used = max(0, $total - $free);
            return ['state' => $total > 0 ? 'READY' : 'UNKNOWN', 'totalBytes' => $total, 'usedBytes' => $used, 'freeBytes' => $free, 'usedPercent' => $total > 0 ? round($used / $total * 100, 1) : null];
        } catch (Throwable) { return ['state' => 'UNKNOWN', 'totalBytes' => 0, 'usedBytes' => 0, 'freeBytes' => 0, 'usedPercent' => null]; }
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
