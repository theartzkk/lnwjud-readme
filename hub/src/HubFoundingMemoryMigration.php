<?php

declare(strict_types=1);

require_once __DIR__ . '/HubFinalProductMigration.php';
require_once __DIR__ . '/HubFoundingMemorySeed.php';

final class HubFoundingMemoryMigrationException extends RuntimeException
{
    public function __construct(string $message, public readonly string $codeName = 'MIGRATION_FAILED') { parent::__construct($message); }
}

/**
 * M10 creates the single structured durable-memory authority.  The seed is a
 * versioned import batch; it never creates a Project, replaces live Source of
 * Truth, or writes secrets into the Hub database.
 */
final class HubFoundingMemoryMigration
{
    public const TARGET_USER_VERSION = 10;
    public const MIGRATION_ID = 'm10-founding-memory';
    private const TABLES = ['control_memory_import_batches', 'control_memory_records', 'control_memory_revisions', 'control_memory_import_items'];
    private const INDEXES = ['idx_control_memory_import_batch_active', 'idx_control_memory_records_owner', 'idx_control_memory_records_project', 'idx_control_memory_records_search', 'idx_control_memory_revisions_recent', 'idx_control_memory_import_items_memory'];

    public static function apply(string $databasePath, string $sqlPath, ?string $now = null): string
    {
        $pdo = self::open($databasePath);
        $sql = @file_get_contents($sqlPath);
        if (!is_string($sql) || $sql === '') throw new HubFoundingMemoryMigrationException('Founding Memory migration is unavailable', 'MIGRATION_FILE_INVALID');
        $checksum = hash('sha256', $sql); $version = (int) $pdo->query('PRAGMA user_version')->fetchColumn();
        if ($version < 9) throw new HubFoundingMemoryMigrationException('Final product authority is unavailable', 'BASE_SCHEMA_INVALID');
        try { HubFinalProductMigration::assertCapabilityReady($pdo, dirname(__DIR__) . '/migrations/008_final_product.sql'); }
        catch (Throwable) { throw new HubFoundingMemoryMigrationException('Final product authority is unavailable', 'BASE_SCHEMA_INVALID'); }
        $ledger = self::ledger($pdo);
        if (is_array($ledger)) {
            if ((int) $ledger['schema_version'] !== self::TARGET_USER_VERSION || !hash_equals((string) $ledger['checksum'], $checksum) || $version < self::TARGET_USER_VERSION || !self::ready($pdo)) throw new HubFoundingMemoryMigrationException('Founding Memory migration record is invalid', 'MIGRATION_RECORD_INVALID');
            return 'already-applied';
        }
        if ($version > 9 || self::presentTables($pdo) !== []) throw new HubFoundingMemoryMigrationException('Founding Memory migration order is not provable', 'MIGRATION_ORDER_UNCERTAIN');
        $at = self::timestamp($now ?? gmdate('c'));
        try {
            $pdo->beginTransaction(); $pdo->exec($sql);
            $pdo->prepare('INSERT INTO awh_schema_migrations(migration_id, schema_version, checksum, applied_at) VALUES(:id, :version, :checksum, :at)')->execute(['id' => self::MIGRATION_ID, 'version' => self::TARGET_USER_VERSION, 'checksum' => $checksum, 'at' => $at]);
            $pdo->exec('PRAGMA user_version = 10'); self::assertReady($pdo, $checksum); $pdo->commit();
        } catch (Throwable $error) {
            if ($pdo->inTransaction()) $pdo->rollBack();
            if ($error instanceof HubFoundingMemoryMigrationException) throw $error;
            throw new HubFoundingMemoryMigrationException('Founding Memory migration rolled back', 'MIGRATION_ROLLED_BACK');
        }
        return 'applied';
    }

    /** @return array{status:string,batchId:string,seedVersion:string,inserted:int,updated:int,unchanged:int,skippedNewer:int,excludedSensitive:int,boundProjects:int} */
    public static function importDefaultSeed(string $databasePath, ?string $now = null): array
    {
        $pdo = self::open($databasePath); self::assertCapabilityReady($pdo, dirname(__DIR__) . '/migrations/009_founding_memory.sql');
        $owner = $pdo->query('SELECT owner_user_id FROM owner_bootstrap WHERE singleton_id = 1 AND bootstrap_closed = 1')->fetchColumn();
        if (!is_string($owner) || !self::isUuid($owner)) throw new HubFoundingMemoryMigrationException('Owner authority is unavailable', 'OWNER_AUTHORITY_UNAVAILABLE');
        return self::importRecords($pdo, strtolower($owner), HubFoundingMemorySeed::records(), HubFoundingMemorySeed::VERSION, HubFoundingMemorySeed::checksum(), $now);
    }

    /**
     * Public for deterministic acceptance fixtures.  Production calls the
     * curated default only; arbitrary browser input is never an import source.
     * @param list<array<string,mixed>> $records
     * @return array{status:string,batchId:string,seedVersion:string,inserted:int,updated:int,unchanged:int,skippedNewer:int,excludedSensitive:int,boundProjects:int}
     */
    public static function importRecords(PDO $pdo, string $ownerUserId, array $records, string $seedVersion, string $seedChecksum, ?string $now = null): array
    {
        self::assertCapabilityReadyForPdo($pdo); $ownerUserId = self::uuid($ownerUserId); $at = self::timestamp($now ?? gmdate('c'));
        if (!preg_match('/^[0-9]+(?:\.[0-9]+){0,3}$/', $seedVersion) || !preg_match('/^[a-f0-9]{64}$/', $seedChecksum)) throw new HubFoundingMemoryMigrationException('Founding Memory seed is invalid', 'SEED_INVALID');
        $transactionOpen = false;
        try {
            $pdo->exec('BEGIN IMMEDIATE');
            $transactionOpen = true;
            $batchQuery = $pdo->prepare('SELECT * FROM control_memory_import_batches WHERE imported_by_user_id = :owner AND seed_version = :version AND seed_checksum = :checksum AND rolled_back_at IS NULL LIMIT 1');
            $batchQuery->execute(['owner' => $ownerUserId, 'version' => $seedVersion, 'checksum' => $seedChecksum]); $batch = $batchQuery->fetch();
            if (is_array($batch)) {
                $bound = self::bindSeedProjects($pdo, $at);
                $report = self::batchReport($pdo, (string) $batch['batch_id'], 'already-imported', $seedVersion, $bound);
                $pdo->exec('COMMIT'); $transactionOpen = false; return $report;
            }
            $batchId = self::uuidFromBytes(random_bytes(16));
            $pdo->prepare("INSERT INTO control_memory_import_batches(batch_id, imported_by_user_id, seed_version, seed_checksum, provenance, status, created_at, completed_at, rolled_back_at) VALUES(:id, :owner, :version, :checksum, 'Founding Memory Migration', 'COMMITTED', :at, :at, NULL)")->execute(['id' => $batchId, 'owner' => $ownerUserId, 'version' => $seedVersion, 'checksum' => $seedChecksum, 'at' => $at]);
            foreach ($records as $record) self::importOne($pdo, $batchId, $ownerUserId, self::seedRecord($record), $at);
            $bound = self::bindSeedProjects($pdo, $at);
            $report = self::batchReport($pdo, $batchId, 'imported', $seedVersion, $bound);
            $pdo->exec('COMMIT'); $transactionOpen = false; return $report;
        } catch (Throwable $error) {
            if ($transactionOpen) { try { $pdo->exec('ROLLBACK'); } catch (Throwable) {} }
            if ($error instanceof HubFoundingMemoryMigrationException) throw $error;
            throw new HubFoundingMemoryMigrationException('Founding Memory import failed closed', 'IMPORT_FAILED');
        }
    }

    /** @return array{status:string,removed:int,restored:int,preserved:int} */
    public static function rollbackImport(string $databasePath, string $ownerUserId, string $batchId, ?string $now = null): array
    {
        $pdo = self::open($databasePath); self::assertCapabilityReady($pdo, dirname(__DIR__) . '/migrations/009_founding_memory.sql');
        $ownerUserId = self::uuid($ownerUserId); $batchId = self::uuid($batchId); $at = self::timestamp($now ?? gmdate('c'));
        $transactionOpen = false;
        try {
            $pdo->exec('BEGIN IMMEDIATE');
            $transactionOpen = true;
            $batchQuery = $pdo->prepare('SELECT * FROM control_memory_import_batches WHERE batch_id = :batch AND imported_by_user_id = :owner AND rolled_back_at IS NULL'); $batchQuery->execute(['batch' => $batchId, 'owner' => $ownerUserId]); $batch = $batchQuery->fetch();
            if (!is_array($batch)) throw new HubFoundingMemoryMigrationException('Founding Memory import batch is unavailable', 'IMPORT_BATCH_NOT_FOUND');
            $items = $pdo->prepare('SELECT * FROM control_memory_import_items WHERE batch_id = :batch ORDER BY stable_key'); $items->execute(['batch' => $batchId]);
            $removed = 0; $restored = 0; $preserved = 0;
            foreach ($items->fetchAll() as $item) {
                if (!is_string($item['memory_id'] ?? null) || $item['memory_id'] === '') continue;
                if ((string) $item['action'] === 'INSERTED') {
                    $delete = $pdo->prepare("DELETE FROM control_memory_records WHERE memory_id = :id AND import_batch_id = :batch AND revision_no = 1 AND authority_level = 'FOUNDING'"); $delete->execute(['id' => $item['memory_id'], 'batch' => $batchId]);
                    if ($delete->rowCount() === 1) $removed++; else $preserved++;
                } elseif ((string) $item['action'] === 'UPDATED') {
                    $previous = json_decode((string) ($item['previous_json'] ?? ''), true, 32, JSON_THROW_ON_ERROR);
                    if (!is_array($previous)) { $preserved++; continue; }
                    $restore = $pdo->prepare('UPDATE control_memory_records SET content = :content, content_sha256 = :hash, authority_level = :authority, provenance = :provenance, updated_at = :at, last_verified_at = :verified, freshness = :freshness, superseded_by_memory_id = :supersededMemory, superseded_by_source_revision = :supersededRevision, sharing_policy = :sharing, tags_json = :tags, source_revision = :source, pinned_at = :pinned, deleted_at = :deleted, import_batch_id = :importBatch, revision_no = :revision WHERE memory_id = :id AND import_batch_id = :batch AND revision_no = :currentRevision');
                    $restore->execute(['content' => $previous['content'], 'hash' => $previous['contentHash'], 'authority' => $previous['authorityLevel'], 'provenance' => $previous['provenance'], 'at' => $at, 'verified' => $previous['lastVerifiedAt'], 'freshness' => $previous['freshness'], 'supersededMemory' => $previous['supersededByMemoryId'], 'supersededRevision' => $previous['supersededBySourceRevision'], 'sharing' => $previous['sharingPolicy'], 'tags' => $previous['tagsJson'], 'source' => $previous['sourceRevision'], 'pinned' => $previous['pinnedAt'], 'deleted' => $previous['deletedAt'], 'importBatch' => $previous['importBatchId'], 'revision' => $previous['revisionNo'], 'id' => $item['memory_id'], 'batch' => $batchId, 'currentRevision' => (int) $previous['revisionNo'] + 1]);
                    if ($restore->rowCount() === 1) $restored++; else $preserved++;
                }
            }
            $status = $preserved === 0 ? 'ROLLED_BACK' : 'PARTIAL_ROLLBACK';
            $pdo->prepare('UPDATE control_memory_import_batches SET status = :status, rolled_back_at = :at WHERE batch_id = :batch')->execute(['status' => $status, 'at' => $at, 'batch' => $batchId]);
            $pdo->exec('COMMIT'); $transactionOpen = false; return ['status' => strtolower(str_replace('_', '-', $status)), 'removed' => $removed, 'restored' => $restored, 'preserved' => $preserved];
        } catch (Throwable $error) {
            if ($transactionOpen) { try { $pdo->exec('ROLLBACK'); } catch (Throwable) {} }
            if ($error instanceof HubFoundingMemoryMigrationException) throw $error;
            throw new HubFoundingMemoryMigrationException('Founding Memory rollback failed closed', 'IMPORT_ROLLBACK_FAILED');
        }
    }

    public static function assertCapabilityReady(PDO $pdo, string $sqlPath): void
    {
        if (!is_file($sqlPath)) throw new HubFoundingMemoryMigrationException('Founding Memory migration authority is unavailable', 'MIGRATION_FILE_INVALID');
        self::assertReady($pdo, hash_file('sha256', $sqlPath));
    }

    public static function reconcileProjectSourceTruth(PDO $pdo, string $projectId, ?string $now = null): int
    {
        self::assertCapabilityReadyForPdo($pdo); $projectId = self::uuid($projectId);
        $project = $pdo->prepare('SELECT source_revision, observed_at FROM projects WHERE project_id = :project'); $project->execute(['project' => $projectId]); $source = $project->fetch();
        if (!is_array($source) || !is_string($source['source_revision'] ?? null) || $source['source_revision'] === '') return 0;
        $revision = strtolower((string) $source['source_revision']); $at = self::timestamp($now ?? gmdate('c'));
        $update = $pdo->prepare("UPDATE control_memory_records SET freshness = 'SUPERSEDED', superseded_by_source_revision = :revision, last_verified_at = :verified, updated_at = :at WHERE project_id = :project AND source_revision IS NOT NULL AND lower(source_revision) != :revision AND freshness NOT IN ('SUPERSEDED', 'FORGOTTEN') AND deleted_at IS NULL");
        $update->execute(['revision' => $revision, 'verified' => (string) $source['observed_at'], 'at' => $at, 'project' => $projectId]);
        return $update->rowCount();
    }

    /**
     * A project can be registered after the founding batch was imported. This
     * bounded reconciliation attaches only matching seed records; it never
     * creates a Project or changes a Project identity.
     */
    public static function bindSeedProjectsForCurrentSchema(PDO $pdo, ?string $now = null): int
    {
        self::assertCapabilityReadyForPdo($pdo);
        return self::bindSeedProjects($pdo, self::timestamp($now ?? gmdate('c')));
    }

    public static function isSensitiveContent(string $content): bool
    {
        if (preg_match('/(?:\b(?:medical|health)\s+(?:record|history)\b|\b(?:diagnosis|patient|treatment)\s*[:=]|(?:เลขบัตรประชาชน|ประวัติการรักษา|ผลตรวจสุขภาพ|โรคประจำตัว|ข้อมูลสุขภาพ)\s*[:=?]|(?:recovery[_ -]?code)\s*[:=])/iu', $content) === 1) return true;
        return preg_match('/(?:-----BEGIN [A-Z ]*PRIVATE KEY-----|\b(?:password|api[_ -]?key|access[_ -]?token|refresh[_ -]?token|session[_ -]?cookie|database[_ -]?(?:password|credential))\s*[:=]|\b(?:sk|rk|pk)_[A-Za-z0-9_-]{20,}|\bAKIA[0-9A-Z]{16}\b|\bBearer\s+[A-Za-z0-9._~-]{20,})/iu', $content) === 1;
    }

    private static function importOne(PDO $pdo, string $batchId, string $ownerUserId, array $record, string $at): void
    {
        if (self::isSensitiveContent((string) $record['content'])) { self::importItem($pdo, $batchId, (string) $record['stableKey'], null, 'EXCLUDED_SENSITIVE'); return; }
        $existing = $pdo->prepare('SELECT * FROM control_memory_records WHERE scope = :scope AND scope_subject = :subject AND stable_key = :key'); $existing->execute(['scope' => $record['scope'], 'subject' => $record['scopeSubject'], 'key' => $record['stableKey']]); $row = $existing->fetch();
        $projectId = $record['projectKey'] === null ? null : self::findProjectId($pdo, (string) $record['projectKey']); $hash = hash('sha256', (string) $record['content']);
        if (!is_array($row)) {
            $id = self::uuidFromBytes(random_bytes(16));
            $insert = $pdo->prepare("INSERT INTO control_memory_records(memory_id, scope, scope_subject, stable_key, owner_user_id, project_id, project_key, conversation_id, category, content, content_sha256, authority_level, provenance, created_at, updated_at, last_verified_at, freshness, superseded_by_memory_id, superseded_by_source_revision, sensitivity, sharing_policy, tags_json, source_revision, pinned_at, deleted_at, import_batch_id, revision_no) VALUES(:id, :scope, :subject, :key, :owner, :project, :projectKey, NULL, :category, :content, :hash, 'FOUNDING', 'Founding Memory Migration', :at, :at, NULL, 'FOUNDING', NULL, NULL, 'NORMAL', :sharing, :tags, :source, NULL, NULL, :batch, 1)");
            $insert->execute(['id' => $id, 'scope' => $record['scope'], 'subject' => $record['scopeSubject'], 'key' => $record['stableKey'], 'owner' => $ownerUserId, 'project' => $projectId, 'projectKey' => $record['projectKey'], 'category' => $record['category'], 'content' => $record['content'], 'hash' => $hash, 'at' => $at, 'sharing' => $record['sharingPolicy'], 'tags' => $record['tagsJson'], 'source' => $record['sourceRevision'], 'batch' => $batchId]);
            self::revision($pdo, $id, 1, $record, $hash, 'FOUNDING', 'Founding Memory Migration', 'FOUNDING', 'FOUNDING_IMPORT', null, $at); self::importItem($pdo, $batchId, (string) $record['stableKey'], $id, 'INSERTED'); return;
        }
        if (hash_equals((string) $row['content_sha256'], $hash)) { self::importItem($pdo, $batchId, (string) $record['stableKey'], (string) $row['memory_id'], 'UNCHANGED'); return; }
        $canRefresh = (string) $row['provenance'] === 'Founding Memory Migration' && (string) $row['authority_level'] === 'FOUNDING' && $row['last_verified_at'] === null && $row['deleted_at'] === null && (string) $row['freshness'] === 'FOUNDING';
        if (!$canRefresh) { self::importItem($pdo, $batchId, (string) $record['stableKey'], (string) $row['memory_id'], 'SKIPPED_NEWER'); return; }
        $previous = self::snapshot($row);
        $revisionNo = (int) $row['revision_no'] + 1;
        $update = $pdo->prepare("UPDATE control_memory_records SET project_id = :project, project_key = :projectKey, category = :category, content = :content, content_sha256 = :hash, updated_at = :at, sharing_policy = :sharing, tags_json = :tags, source_revision = :source, import_batch_id = :batch, revision_no = :revision WHERE memory_id = :id");
        $update->execute(['project' => $projectId, 'projectKey' => $record['projectKey'], 'category' => $record['category'], 'content' => $record['content'], 'hash' => $hash, 'at' => $at, 'sharing' => $record['sharingPolicy'], 'tags' => $record['tagsJson'], 'source' => $record['sourceRevision'], 'batch' => $batchId, 'revision' => $revisionNo, 'id' => $row['memory_id']]);
        self::revision($pdo, (string) $row['memory_id'], $revisionNo, $record, $hash, 'FOUNDING', 'Founding Memory Migration', 'FOUNDING', 'FOUNDING_REFRESH', null, $at); self::importItem($pdo, $batchId, (string) $record['stableKey'], (string) $row['memory_id'], 'UPDATED', $previous);
    }

    private static function bindSeedProjects(PDO $pdo, string $at): int
    {
        $records = $pdo->query("SELECT memory_id, project_key FROM control_memory_records WHERE scope = 'PROJECT' AND project_id IS NULL AND project_key IS NOT NULL AND deleted_at IS NULL AND provenance = 'Founding Memory Migration'")->fetchAll(); $bound = 0;
        foreach ($records as $record) {
            $projectId = self::findProjectId($pdo, (string) $record['project_key']);
            if ($projectId === null) continue;
            $update = $pdo->prepare('UPDATE control_memory_records SET project_id = :project, updated_at = :at WHERE memory_id = :id AND project_id IS NULL'); $update->execute(['project' => $projectId, 'at' => $at, 'id' => $record['memory_id']]); $bound += $update->rowCount();
        }
        return $bound;
    }

    private static function findProjectId(PDO $pdo, string $projectKey): ?string
    {
        $aliases = HubFoundingMemorySeed::projectAliases($projectKey); if ($aliases === []) return null;
        $projects = $pdo->query('SELECT project_id, name FROM projects')->fetchAll();
        foreach ($projects as $project) if (in_array(self::projectName((string) $project['name']), $aliases, true) && self::isUuid((string) $project['project_id'])) return strtolower((string) $project['project_id']);
        return null;
    }

    private static function revision(PDO $pdo, string $memoryId, int $revision, array $record, string $hash, string $authority, string $provenance, string $freshness, string $kind, ?string $userId, string $at): void
    {
        $pdo->prepare('INSERT INTO control_memory_revisions(revision_id, memory_id, revision_no, content, content_sha256, authority_level, provenance, freshness, sharing_policy, tags_json, source_revision, change_kind, changed_by_user_id, created_at) VALUES(:id, :memory, :revision, :content, :hash, :authority, :provenance, :freshness, :sharing, :tags, :source, :kind, :user, :at)')->execute(['id' => self::uuidFromBytes(random_bytes(16)), 'memory' => $memoryId, 'revision' => $revision, 'content' => $record['content'], 'hash' => $hash, 'authority' => $authority, 'provenance' => $provenance, 'freshness' => $freshness, 'sharing' => $record['sharingPolicy'], 'tags' => $record['tagsJson'], 'source' => $record['sourceRevision'], 'kind' => $kind, 'user' => $userId, 'at' => $at]);
    }

    private static function importItem(PDO $pdo, string $batchId, string $stableKey, ?string $memoryId, string $action, ?array $previous = null): void
    {
        $pdo->prepare('INSERT INTO control_memory_import_items(batch_id, stable_key, memory_id, action, previous_json) VALUES(:batch, :key, :memory, :action, :previous)')->execute(['batch' => $batchId, 'key' => $stableKey, 'memory' => $memoryId, 'action' => $action, 'previous' => $previous === null ? null : json_encode($previous, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR)]);
    }

    /** @return array{status:string,batchId:string,seedVersion:string,inserted:int,updated:int,unchanged:int,skippedNewer:int,excludedSensitive:int,boundProjects:int} */
    private static function batchReport(PDO $pdo, string $batchId, string $status, string $seedVersion, int $bound): array
    {
        $q = $pdo->prepare('SELECT action, COUNT(*) AS count FROM control_memory_import_items WHERE batch_id = :batch GROUP BY action'); $q->execute(['batch' => $batchId]); $counts = array_fill_keys(['INSERTED', 'UPDATED', 'UNCHANGED', 'SKIPPED_NEWER', 'EXCLUDED_SENSITIVE'], 0); foreach ($q->fetchAll() as $row) $counts[(string) $row['action']] = (int) $row['count'];
        return ['status' => $status, 'batchId' => $batchId, 'seedVersion' => $seedVersion, 'inserted' => $counts['INSERTED'], 'updated' => $counts['UPDATED'], 'unchanged' => $counts['UNCHANGED'], 'skippedNewer' => $counts['SKIPPED_NEWER'], 'excludedSensitive' => $counts['EXCLUDED_SENSITIVE'], 'boundProjects' => $bound];
    }

    /** @return array<string,mixed> */
    private static function seedRecord(array $value): array
    {
        $key = $value['stableKey'] ?? null; $scope = $value['scope'] ?? null; $category = $value['category'] ?? null; $content = $value['content'] ?? null; $tags = $value['tags'] ?? null; $sharing = $value['sharingPolicy'] ?? null;
        if (!is_string($key) || preg_match('/^[a-z][a-z0-9._-]{2,120}$/', $key) !== 1 || !is_string($scope) || !in_array($scope, ['OWNER', 'CONSTITUTION', 'PROJECT', 'ARCHIVE'], true) || !is_string($category) || preg_match('/^[A-Z_]{3,64}$/', $category) !== 1 || !is_string($content) || trim($content) === '' || strlen($content) > 2000 || preg_match('/[\x00-\x1f\x7f]/', $content) || !is_array($tags) || array_is_list($tags) === false || !is_string($sharing) || !in_array($sharing, ['OWNER_PRIVATE', 'PROJECT_SHARED'], true)) throw new HubFoundingMemoryMigrationException('Founding Memory seed is invalid', 'SEED_INVALID');
        $normalizedTags = []; foreach ($tags as $tag) { if (!is_string($tag) || preg_match('/^[a-z0-9-]{2,48}$/', $tag) !== 1) throw new HubFoundingMemoryMigrationException('Founding Memory seed is invalid', 'SEED_INVALID'); $normalizedTags[] = $tag; }
        if (count($normalizedTags) > 12 || count(array_unique($normalizedTags)) !== count($normalizedTags)) throw new HubFoundingMemoryMigrationException('Founding Memory seed is invalid', 'SEED_INVALID');
        $projectKey = $value['projectKey'] ?? null; if ($scope === 'PROJECT') { if (!is_string($projectKey) || preg_match('/^[a-z][a-z0-9-]{2,80}$/', $projectKey) !== 1 || HubFoundingMemorySeed::projectAliases($projectKey) === []) throw new HubFoundingMemoryMigrationException('Founding Memory project seed is invalid', 'SEED_INVALID'); } elseif ($projectKey !== null) throw new HubFoundingMemoryMigrationException('Founding Memory seed is invalid', 'SEED_INVALID');
        $revision = $value['sourceRevision'] ?? null; if ($revision !== null && (!is_string($revision) || preg_match('/^[a-f0-9]{40,64}$/i', $revision) !== 1)) throw new HubFoundingMemoryMigrationException('Founding Memory seed is invalid', 'SEED_INVALID');
        $subject = $scope === 'PROJECT' ? 'project-key:' . $projectKey : 'owner';
        return ['stableKey' => $key, 'scope' => $scope, 'scopeSubject' => $subject, 'projectKey' => $projectKey, 'category' => $category, 'content' => trim($content), 'tagsJson' => json_encode($normalizedTags, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR), 'sharingPolicy' => $sharing, 'sourceRevision' => $revision === null ? null : strtolower($revision)];
    }

    /** @return array<string,mixed> */
    private static function snapshot(array $row): array
    {
        return ['content' => (string) $row['content'], 'contentHash' => (string) $row['content_sha256'], 'authorityLevel' => (string) $row['authority_level'], 'provenance' => (string) $row['provenance'], 'lastVerifiedAt' => $row['last_verified_at'] === null ? null : (string) $row['last_verified_at'], 'freshness' => (string) $row['freshness'], 'supersededByMemoryId' => $row['superseded_by_memory_id'] === null ? null : (string) $row['superseded_by_memory_id'], 'supersededBySourceRevision' => $row['superseded_by_source_revision'] === null ? null : (string) $row['superseded_by_source_revision'], 'sharingPolicy' => (string) $row['sharing_policy'], 'tagsJson' => (string) $row['tags_json'], 'sourceRevision' => $row['source_revision'] === null ? null : (string) $row['source_revision'], 'pinnedAt' => $row['pinned_at'] === null ? null : (string) $row['pinned_at'], 'deletedAt' => $row['deleted_at'] === null ? null : (string) $row['deleted_at'], 'importBatchId' => $row['import_batch_id'] === null ? null : (string) $row['import_batch_id'], 'revisionNo' => (int) $row['revision_no']];
    }

    private static function assertCapabilityReadyForPdo(PDO $pdo): void
    {
        self::assertReady($pdo, hash_file('sha256', dirname(__DIR__) . '/migrations/009_founding_memory.sql'));
    }

    private static function assertReady(PDO $pdo, string $checksum): void
    {
        $ledger = self::ledger($pdo);
        if ((int) $pdo->query('PRAGMA user_version')->fetchColumn() < self::TARGET_USER_VERSION || !is_array($ledger) || (int) $ledger['schema_version'] !== self::TARGET_USER_VERSION || !hash_equals(strtolower($checksum), strtolower((string) ($ledger['checksum'] ?? ''))) || !self::ready($pdo) || $pdo->query('PRAGMA foreign_key_check')->fetchAll() !== []) throw new HubFoundingMemoryMigrationException('Founding Memory capability is not ready', 'FOUNDING_MEMORY_SCHEMA_NOT_READY');
    }

    private static function ledger(PDO $pdo): array|false { $q = $pdo->prepare('SELECT schema_version, checksum FROM awh_schema_migrations WHERE migration_id = :id'); $q->execute(['id' => self::MIGRATION_ID]); return $q->fetch(); }
    private static function open(string $path): PDO { if ($path === '' || str_contains($path, "\0")) throw new HubFoundingMemoryMigrationException('Database path is invalid', 'DATABASE_CONFIG_INVALID'); try { $pdo = new PDO('sqlite:' . $path, null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC]); $pdo->exec('PRAGMA foreign_keys = ON'); $pdo->exec('PRAGMA busy_timeout = 2500'); return $pdo; } catch (Throwable) { throw new HubFoundingMemoryMigrationException('Database is unavailable', 'DATABASE_UNAVAILABLE'); } }
    private static function presentTables(PDO $pdo): array { $out = []; foreach (self::TABLES as $table) if ($pdo->query("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = '" . $table . "'")->fetchColumn() !== false) $out[] = $table; return $out; }
    private static function ready(PDO $pdo): bool { foreach (self::INDEXES as $index) if ($pdo->query("SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = '" . $index . "'")->fetchColumn() === false) return false; return self::presentTables($pdo) === self::TABLES; }
    private static function timestamp(string $value): string { if (strtotime($value) === false) throw new HubFoundingMemoryMigrationException('Founding Memory time is invalid', 'SEED_INVALID'); return gmdate('c', strtotime($value)); }
    private static function uuid(string $value): string { if (!self::isUuid($value)) throw new HubFoundingMemoryMigrationException('Founding Memory identity is invalid', 'OWNER_AUTHORITY_UNAVAILABLE'); return strtolower($value); }
    private static function isUuid(string $value): bool { return preg_match('/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i', $value) === 1; }
    private static function uuidFromBytes(string $bytes): string { $bytes[6] = chr((ord($bytes[6]) & 15) | 64); $bytes[8] = chr((ord($bytes[8]) & 63) | 128); return vsprintf('%s%s-%s-%s-%s-%s%s%s', str_split(bin2hex($bytes), 4)); }
    private static function projectName(string $value): string { return strtolower(trim(preg_replace('/\s+/', ' ', $value) ?? '')); }
}
