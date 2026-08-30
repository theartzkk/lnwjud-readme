<?php

declare(strict_types=1);

/**
 * Bounded storage governance over the known AWH roots. Normal audit calls are
 * read-only. The explicit housekeep() path may move and purge only old regular
 * temp files that are still classified SAFE_TO_PURGE after a second reference
 * check. UNKNOWN, rollback, backup, Vault, artifact and active release material
 * is retained; quarantine is verified by hash+size before any purge.
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
                'purgeMode' => 'EXPLICIT_VERIFIED_QUARANTINE_ONLY',
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
                'quarantine' => 'SAFE_TO_PURGE_ONLY',
                'verifyQuarantine' => 'HASH_AND_SIZE_REQUIRED',
                'purged' => 0,
                'purge' => 'EXPLICIT_VERIFIED_QUARANTINE_ONLY',
                'reclaimableBytes' => $reclaimable,
            ],
        ];
    }

    /**
     * Explicit bounded housekeeping. Only direct-child regular temp files that
     * remain SAFE_TO_PURGE on a second classification pass are eligible. Each
     * item is moved into an owned quarantine batch, verified there by size and
     * SHA-256, then unlinked from quarantine. No recursive purge is used.
     *
     * @param array<string,string> $activeReleaseIds
     * @return array<string,mixed>
     */
    public function housekeep(?string $now = null, array $activeReleaseIds = []): array
    {
        $at = strtotime($now ?? gmdate('c')) ?: time();
        $audit = $this->audit(gmdate('c', $at), $activeReleaseIds);
        $candidates = array_values(array_filter($audit['items'] ?? [], static fn (array $item): bool =>
            ($item['classification'] ?? null) === 'SAFE_TO_PURGE'
            && ($item['sizeKnown'] ?? false) === true
            && in_array((string) ($item['rootId'] ?? ''), ['hubData', 'backups'], true)
        ));
        $identity = array_map(static fn (array $item): string => (string) ($item['rootId'] ?? '') . '/' . (string) ($item['name'] ?? ''), $candidates);
        sort($identity);
        $batchId = gmdate('Ymd\\THis\\Z', $at) . '-' . substr(hash('sha256', implode("\n", $identity)), 0, 12);
        $result = ['schemaVersion' => 1, 'generatedAt' => gmdate('c', $at), 'batchId' => $batchId, 'discovered' => count($candidates), 'referenceChecked' => 0, 'quarantined' => 0, 'verified' => 0, 'purged' => 0, 'reclaimedBytes' => 0, 'blocked' => 0, 'unknownRetained' => true, 'state' => count($candidates) === 0 ? 'NO_SAFE_ITEMS' : 'RUNNING'];
        if ($candidates === []) return $result;

        $moved = [];
        foreach ($candidates as $item) {
            $rootId = (string) $item['rootId']; $name = (string) $item['name'];
            $root = $this->roots[$rootId] ?? null;
            if (!is_string($root) || !$this->referenceSafeCandidate($rootId, $root, $name, $at, $activeReleaseIds)) { $result['blocked']++; continue; }
            $result['referenceChecked']++;
            $source = $root . DIRECTORY_SEPARATOR . $name;
            $size = @filesize($source); $sha = @hash_file('sha256', $source);
            if (!is_int($size) || $size < 0 || !is_string($sha) || preg_match('/^[0-9a-f]{64}$/', $sha) !== 1) { $result['blocked']++; continue; }
            $parent = $root . DIRECTORY_SEPARATOR . '.awh-quarantine';
            $batch = $parent . DIRECTORY_SEPARATOR . $batchId;
            if (!$this->ensureOwnedDirectory($parent) || !$this->ensureOwnedDirectory($batch)) { $result['blocked']++; continue; }
            $target = $batch . DIRECTORY_SEPARATOR . $name;
            if (file_exists($target) || is_link($target) || !@rename($source, $target)) { $result['blocked']++; continue; }
            $moved[] = ['rootId' => $rootId, 'name' => $name, 'source' => $source, 'target' => $target, 'batch' => $batch, 'parent' => $parent, 'sizeBytes' => $size, 'sha256' => $sha];
            $result['quarantined']++;
        }
        if ($moved === []) { $result['state'] = 'NO_VERIFIED_CANDIDATES'; return $result; }

        $allVerified = true;
        foreach ($moved as $entry) {
            $sourceGone = !file_exists($entry['source']) && !is_link($entry['source']);
            $targetInfo = @lstat($entry['target']);
            $size = @filesize($entry['target']); $sha = @hash_file('sha256', $entry['target']);
            $ok = $sourceGone && is_array($targetInfo) && (($targetInfo['mode'] ?? 0) & 0170000) === 0100000 && !is_link($entry['target']) && is_int($size) && $size === $entry['sizeBytes'] && is_string($sha) && hash_equals($entry['sha256'], $sha);
            if ($ok) $result['verified']++; else { $allVerified = false; $result['blocked']++; }
        }
        if (!$allVerified || $result['verified'] !== count($moved)) { $result['state'] = 'QUARANTINED_REVIEW'; return $result; }

        foreach ($moved as $entry) {
            if (!@unlink($entry['target'])) { $result['state'] = 'QUARANTINED_REVIEW'; $result['blocked']++; return $result; }
            $result['purged']++; $result['reclaimedBytes'] += $entry['sizeBytes'];
        }
        foreach (array_unique(array_column($moved, 'batch')) as $batch) @rmdir((string) $batch);
        foreach (array_unique(array_column($moved, 'parent')) as $parent) @rmdir((string) $parent);
        $result['state'] = 'CLEANED';
        return $result;
    }

    /** @param array<string,string> $activeReleaseIds */
    private function referenceSafeCandidate(string $rootId, string $root, string $name, int $at, array $activeReleaseIds): bool
    {
        if (!in_array($rootId, ['hubData', 'backups'], true) || $this->safeName($name) !== $name || str_starts_with($name, '.awh-quarantine')) return false;
        if (!is_dir($root) || is_link($root)) return false;
        $path = $root . DIRECTORY_SEPARATOR . $name;
        $parent = @realpath(dirname($path)); $canonicalRoot = @realpath($root);
        if (!is_string($parent) || !is_string($canonicalRoot) || !hash_equals($canonicalRoot, $parent) || is_link($path) || !is_file($path)) return false;
        if ($this->classify($rootId, $name, $path, $at, $activeReleaseIds) !== 'SAFE_TO_PURGE') return false;
        if (in_array($name, array_values($activeReleaseIds), true)) return false;
        if ($rootId === 'backups' && preg_match('/^awh-[0-9]{8}T[0-9]{6}Z\\.sqlite(?:\\.json)?$/', $name) === 1) return false;
        return true;
    }

    private function ensureOwnedDirectory(string $path): bool
    {
        if (is_link($path)) return false;
        if (is_dir($path)) return is_writable($path);
        if (file_exists($path)) return false;
        return @mkdir($path, 0700, true) && !is_link($path) && is_dir($path);
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
