<?php

declare(strict_types=1);

function retention_expect(bool $condition, string $message): void
{
    if (!$condition) {
        fwrite(STDERR, "FAIL: {$message}\n");
        exit(1);
    }
}

$path = dirname(__DIR__, 2) . '/scripts/ops/audit-vps-release-retention.sh';
$source = @file_get_contents($path);
retention_expect(is_string($source) && $source !== '', 'release retention auditor exists');
retention_expect(str_contains($source, "'mode':'AUDIT_ONLY'"), 'auditor is explicitly read-only');
retention_expect(str_contains($source, "'purgeEnabled':False"), 'purge stays disabled');
retention_expect(str_contains($source, "mode=ro"), 'database is opened read-only');
retention_expect(str_contains($source, 'UNIQUE_ALLOCATED_INODES_WITH_ALL_LINKS_OBSERVED'), 'reclaim estimate is inode-aware');
retention_expect(str_contains($source, "st_nlink"), 'hard-link count participates in safety proof');
retention_expect(str_contains($source, 'filesystem_release_references'), 'filesystem release pointers are protected');
retention_expect(str_contains($source, '__PROTECTED_DESKTOP_OBJECT_STORE__'), 'content-addressed Desktop object store is protected');
retention_expect(str_contains($source, "'boundedScanNeverClaimsReclaimable':True"), 'bounded scan cannot claim reclaimable bytes');
foreach (['rm -rf', 'os.remove(', 'os.unlink(', 'shutil.rmtree(', 'Path.unlink(', 'DELETE FROM', 'UPDATE control_'] as $forbidden) {
    retention_expect(!str_contains($source, $forbidden), "auditor does not contain destructive primitive {$forbidden}");
}

fwrite(STDOUT, "PASS release retention audit safety\n");
