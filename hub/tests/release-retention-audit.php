<?php

declare(strict_types=1);

function retention_expect(bool $condition, string $message): void
{
    if (!$condition) {
        fwrite(STDERR, "FAIL: {$message}\n");
        exit(1);
    }
}

$root = dirname(__DIR__, 2);
$auditPath = $root . '/scripts/ops/audit-vps-release-retention.sh';
$audit = @file_get_contents($auditPath);
retention_expect(is_string($audit) && $audit !== '', 'release retention auditor exists');
retention_expect(str_contains($audit, "'mode':'AUDIT_ONLY'"), 'auditor is explicitly read-only');
retention_expect(str_contains($audit, "'purgeEnabled':False"), 'purge stays disabled');
retention_expect(str_contains($audit, 'mode=ro'), 'database is opened read-only');
retention_expect(str_contains($audit, 'UNIQUE_ALLOCATED_INODES_WITH_ALL_LINKS_OBSERVED'), 'reclaim estimate is inode-aware');
retention_expect(str_contains($audit, 'st_nlink'), 'hard-link count participates in safety proof');
retention_expect(str_contains($audit, 'filesystem_release_references'), 'filesystem release pointers are protected');
retention_expect(str_contains($audit, '__PROTECTED_DESKTOP_OBJECT_STORE__'), 'content-addressed Desktop object store is protected');
retention_expect(str_contains($audit, "'boundedScanNeverClaimsReclaimable':True"), 'bounded scan cannot claim reclaimable bytes');
foreach (['rm -rf', 'os.remove(', 'os.unlink(', 'shutil.rmtree(', 'Path.unlink(', 'DELETE FROM', 'UPDATE control_'] as $forbidden) {
    retention_expect(!str_contains($audit, $forbidden), "auditor does not contain destructive primitive {$forbidden}");
}

$dedupPath = $root . '/scripts/ops/deduplicate-vps-release-artifacts.sh';
$dedup = @file_get_contents($dedupPath);
retention_expect(is_string($dedup) && $dedup !== '', 'historical release deduplicator exists');
retention_expect(str_contains($dedup, 'MODE=preview'), 'deduplicator defaults to preview');
retention_expect(str_contains($dedup, '--apply requires --approve'), 'mutation requires explicit approval');
retention_expect(str_contains($dedup, 'mode=ro'), 'deduplicator reads database without write access');
retention_expect(str_contains($dedup, 'sha256(file)!=digest') && str_contains($dedup, 'sha256(obj)!=digest'), 'both release file and object hash are verified');
retention_expect(str_contains($dedup, 'fst.st_dev!=ost.st_dev'), 'cross-filesystem hardlinks fail closed');
retention_expect(str_contains($dedup, 'os.link(obj,temp)') && str_contains($dedup, 'os.replace(temp,file)'), 'replacement is staged as an atomic hardlink');
retention_expect(str_contains($dedup, "'releaseDirectoriesDeleted':False"), 'release directories are never deleted');
retention_expect(str_contains($dedup, "'activeProtected':True") && str_contains($dedup, "'rollbackProtected':True") && str_contains($dedup, "'referenceProtected':True"), 'active rollback and referenced releases remain protected');
foreach (['rm -rf', 'shutil.rmtree(', 'DELETE FROM', 'UPDATE control_', 'DROP TABLE'] as $forbidden) {
    retention_expect(!str_contains($dedup, $forbidden), "deduplicator does not contain destructive primitive {$forbidden}");
}

fwrite(STDOUT, "PASS release retention and dedup safety\n");
