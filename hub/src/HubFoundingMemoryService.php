<?php

declare(strict_types=1);

require_once __DIR__ . '/HubFoundingMemoryMigration.php';

final class HubFoundingMemoryException extends RuntimeException
{
    public function __construct(string $message, public readonly string $codeName = 'MEMORY_FAILED') { parent::__construct($message); }
}

/**
 * The only structured durable-memory authority.  It deliberately projects
 * concise, authorized facts into AWH context instead of replaying historical
 * transcripts or treating memory as live source evidence.
 */
final class HubFoundingMemoryService
{
    private const SCOPES = ['all', 'owner', 'constitution', 'project', 'archive'];
    private const ACTIONS = ['EDIT', 'PIN', 'FORGET', 'SHARE', 'UNSHARE', 'MARK_OUTDATED'];

    public function __construct(private readonly PDO $pdo) {}

    /** @return array{schemaVersion:int,scope:string,sourceTruth:?array,memories:list<array>} */
    public function retrieve(string $userId, bool $isOwner, ?string $projectId, string $scope = 'all', ?string $query = null): array
    {
        $this->assertReady(); $scope = self::scope($scope); $query = self::query($query); $userId = self::uuid($userId);
        if ($scope === 'project' && $projectId === null) throw new HubFoundingMemoryException('Project memory needs a project', 'MEMORY_INVALID');
        if ($projectId === null && !$isOwner) throw new HubFoundingMemoryException('Private memory is not available', 'MEMORY_FORBIDDEN');
        $sourceTruth = $projectId === null ? null : $this->sourceTruth(self::uuid($projectId));
        $records = $projectId === null
            ? $this->ownerRecords($userId, $scope, $query, 100)
            : $this->projectRecords($userId, self::uuid($projectId), $scope, $query, 100);
        return ['schemaVersion' => 1, 'scope' => $scope, 'sourceTruth' => $sourceTruth, 'memories' => array_map([self::class, 'record'], $records)];
    }

    /** Bounded provider context. Source Truth is deliberately a separate field. */
    public function promptContext(string $userId, bool $isOwner, string $projectId, string $request): array
    {
        $this->assertReady(); $userId = self::uuid($userId); $projectId = self::uuid($projectId); $needle = self::query($request) ?? '';
        $project = $this->projectRecords($userId, $projectId, 'all', $needle, 24);
        $owner = $isOwner ? $this->ownerRecords($userId, 'all', $needle, 24) : [];
        // Intentional owner configuration (profile, working preferences,
        // personality and constitution) is durable context, not a keyword
        // accident. Include only these small pinned-by-purpose records when a
        // particular user request does not happen to repeat their wording.
        if ($isOwner) {
            $ownerById = [];
            foreach ($owner as $record) $ownerById[(string) $record['memory_id']] = $record;
            foreach ($this->ownerRecords($userId, 'all', null, 24) as $record) {
                if (in_array((string) $record['category'], ['OWNER_PROFILE', 'WORKING_PREFERENCE', 'AI_PERSONALITY', 'OWNER_CONSTITUTION'], true)) $ownerById[(string) $record['memory_id']] = $record;
            }
            $owner = array_values($ownerById);
        }
        $all = array_merge($project, $owner);
        usort($all, static function (array $a, array $b) use ($needle): int {
            $score = static function (array $row) use ($needle): int {
                $value = strtolower((string) $row['stable_key'] . ' ' . (string) $row['category'] . ' ' . (string) $row['tags_json'] . ' ' . (string) $row['content']);
                $needleValue = strtolower($needle); $relevant = $needleValue !== '' && str_contains($value, $needleValue) ? 100 : 0;
                return $relevant + ($row['pinned_at'] === null ? 0 : 30) + ((string) $row['authority_level'] === 'VERIFIED' ? 20 : 0) + ((string) $row['freshness'] === 'CURRENT' ? 10 : 0);
            };
            return $score($b) <=> $score($a) ?: strcmp((string) $b['updated_at'], (string) $a['updated_at']);
        });
        $records = [];
        foreach (array_slice($all, 0, 6) as $row) $records[] = ['stableKey' => (string) $row['stable_key'], 'scope' => strtolower((string) $row['scope']), 'category' => (string) $row['category'], 'content' => self::bounded((string) $row['content'], 700), 'freshness' => strtolower((string) $row['freshness']), 'tags' => self::tags((string) $row['tags_json'])];
        return ['sourceTruth' => $this->sourceTruth($projectId), 'records' => $records, 'limit' => 6, 'authorityOrder' => ['live-source', 'active-task-context', 'project-memory', 'owner-constitution', 'recent-conversation', 'archive']];
    }

    /**
     * Owner-created records extend the same M10 authority; they are never a
     * browser-only profile cache or a second memory database.
     * @return array{schemaVersion:int,memory:array}
     */
    public function create(string $ownerUserId, string $scope, ?string $projectId, string $category, ?string $content, ?array $tags, ?string $now = null): array
    {
        $this->assertReady(); $ownerUserId = self::uuid($ownerUserId); $scope = strtolower(trim($scope));
        if (!in_array($scope, ['owner', 'constitution', 'project'], true)) throw new HubFoundingMemoryException('Memory scope is invalid', 'MEMORY_INVALID');
        $project = $projectId === null ? null : self::uuid($projectId);
        if (($scope === 'project') !== ($project !== null)) throw new HubFoundingMemoryException('Project memory association is invalid', 'MEMORY_INVALID');
        $category = self::category($category); $content = self::content($content); if (HubFoundingMemoryMigration::isSensitiveContent($content)) throw new HubFoundingMemoryException('Sensitive material cannot be stored as ordinary memory', 'MEMORY_SENSITIVE_EXCLUDED');
        $tagsJson = self::tagsJson($tags); $at = self::timestamp($now ?? gmdate('c')); $id = self::uuidFromBytes(random_bytes(16));
        $scopeDb = strtoupper($scope); $subject = $project ?? $ownerUserId; $stable = strtolower($scope) . '.owner.' . $id; $pinned = in_array($category, ['OWNER_PROFILE', 'WORKING_PREFERENCE', 'AI_PERSONALITY', 'OWNER_CONSTITUTION'], true) ? $at : null;
        $transactionOpen = false;
        try {
            $this->pdo->exec('BEGIN IMMEDIATE'); $transactionOpen = true;
            $insert = $this->pdo->prepare("INSERT INTO control_memory_records(memory_id, scope, scope_subject, stable_key, owner_user_id, project_id, project_key, conversation_id, category, content, content_sha256, authority_level, provenance, created_at, updated_at, last_verified_at, freshness, superseded_by_memory_id, superseded_by_source_revision, sensitivity, sharing_policy, tags_json, source_revision, pinned_at, deleted_at, import_batch_id, revision_no) VALUES(:id, :scope, :subject, :stable, :owner, :project, NULL, NULL, :category, :content, :hash, 'OWNER_EDITED', 'Owner Memory Entry', :at, :at, :at, 'CURRENT', NULL, NULL, 'NORMAL', 'OWNER_PRIVATE', :tags, NULL, :pinned, NULL, NULL, 1)");
            $insert->execute(['id' => $id, 'scope' => $scopeDb, 'subject' => $subject, 'stable' => $stable, 'owner' => $ownerUserId, 'project' => $project, 'category' => $category, 'content' => $content, 'hash' => hash('sha256', $content), 'at' => $at, 'tags' => $tagsJson, 'pinned' => $pinned]);
            // OWNER_EDIT is already the durable audited user-authored change
            // kind in M10; no migration is needed merely to rename it CREATE.
            self::revision($this->pdo, $id, 1, $content, 'OWNER_EDITED', 'Owner Memory Entry', 'CURRENT', 'OWNER_PRIVATE', $tagsJson, null, 'OWNER_EDIT', $ownerUserId, $at);
            $this->pdo->exec('COMMIT'); $transactionOpen = false;
        } catch (Throwable $error) {
            if ($transactionOpen) { try { $this->pdo->exec('ROLLBACK'); } catch (Throwable) {} }
            if ($error instanceof HubFoundingMemoryException) throw $error;
            throw new HubFoundingMemoryException('Memory could not be created', 'MEMORY_CREATE_FAILED');
        }
        $q = $this->pdo->prepare('SELECT * FROM control_memory_records WHERE memory_id = :id AND owner_user_id = :owner'); $q->execute(['id' => $id, 'owner' => $ownerUserId]); $record = $q->fetch();
        if (!is_array($record)) throw new HubFoundingMemoryException('Memory could not be read', 'MEMORY_CREATE_FAILED');
        return ['schemaVersion' => 1, 'memory' => self::record($record)];
    }

    /** @return array{schemaVersion:int,batches:list<array>} */
    public function importReport(string $ownerUserId): array
    {
        $this->assertReady(); $ownerUserId = self::uuid($ownerUserId);
        $q = $this->pdo->prepare("SELECT batch_id, seed_version, provenance, status, created_at, completed_at, rolled_back_at FROM control_memory_import_batches WHERE imported_by_user_id = :owner ORDER BY created_at DESC LIMIT 20"); $q->execute(['owner' => $ownerUserId]);
        $batches = [];
        foreach ($q->fetchAll() as $batch) {
            $counts = $this->pdo->prepare('SELECT action, COUNT(*) AS count FROM control_memory_import_items WHERE batch_id = :batch GROUP BY action'); $counts->execute(['batch' => $batch['batch_id']]); $summary = [];
            foreach ($counts->fetchAll() as $row) $summary[strtolower((string) $row['action'])] = (int) $row['count'];
            $batches[] = ['seedVersion' => (string) $batch['seed_version'], 'provenance' => (string) $batch['provenance'], 'status' => strtolower(str_replace('_', '-', (string) $batch['status'])), 'createdAt' => (string) $batch['created_at'], 'completedAt' => (string) $batch['completed_at'], 'rolledBackAt' => $batch['rolled_back_at'] === null ? null : (string) $batch['rolled_back_at'], 'summary' => $summary];
        }
        return ['schemaVersion' => 1, 'batches' => $batches];
    }

    /** @return array{schemaVersion:int,memory:array} */
    public function mutate(string $ownerUserId, string $memoryId, string $action, ?string $content, ?array $tags, ?string $sharingPolicy, ?bool $pinned, ?string $now = null): array
    {
        $this->assertReady(); $ownerUserId = self::uuid($ownerUserId); $memoryId = self::uuid($memoryId); $action = strtoupper(trim($action));
        if (!in_array($action, self::ACTIONS, true)) throw new HubFoundingMemoryException('Memory action is invalid', 'MEMORY_INVALID');
        $at = self::timestamp($now ?? gmdate('c'));
        $transactionOpen = false;
        try {
            $this->pdo->exec('BEGIN IMMEDIATE');
            $transactionOpen = true;
            $q = $this->pdo->prepare('SELECT * FROM control_memory_records WHERE memory_id = :id AND owner_user_id = :owner'); $q->execute(['id' => $memoryId, 'owner' => $ownerUserId]); $row = $q->fetch();
            if (!is_array($row)) throw new HubFoundingMemoryException('Memory is not available', 'MEMORY_NOT_FOUND');
            if ($row['deleted_at'] !== null && $action !== 'FORGET') throw new HubFoundingMemoryException('Memory was removed', 'MEMORY_NOT_FOUND');
            $newContent = (string) $row['content']; $newTags = (string) $row['tags_json']; $newSharing = (string) $row['sharing_policy']; $newPinned = $row['pinned_at']; $freshness = (string) $row['freshness']; $authority = (string) $row['authority_level']; $provenance = (string) $row['provenance']; $deletedAt = $row['deleted_at'];
            if ($action === 'EDIT') { $newContent = self::content($content); if (HubFoundingMemoryMigration::isSensitiveContent($newContent)) throw new HubFoundingMemoryException('Sensitive material cannot be stored as ordinary memory', 'MEMORY_SENSITIVE_EXCLUDED'); $newTags = self::tagsJson($tags); $authority = 'OWNER_EDITED'; $provenance = 'Owner Memory Edit'; $freshness = 'CURRENT'; }
            if ($action === 'PIN') $newPinned = $pinned === false ? null : $at;
            if ($action === 'SHARE' || $action === 'UNSHARE') { if ((string) $row['scope'] !== 'PROJECT' || $row['project_id'] === null) throw new HubFoundingMemoryException('Only bound Project memory can be shared', 'MEMORY_INVALID'); $newSharing = $action === 'SHARE' ? 'PROJECT_SHARED' : 'OWNER_PRIVATE'; }
            if ($action === 'MARK_OUTDATED') $freshness = 'STALE';
            if ($action === 'FORGET') { $newContent = ''; $newTags = '[]'; $newPinned = null; $freshness = 'FORGOTTEN'; $deletedAt = $at; $this->pdo->prepare('DELETE FROM control_memory_revisions WHERE memory_id = :id')->execute(['id' => $memoryId]); }
            $revision = (int) $row['revision_no'] + 1;
            $this->pdo->prepare('UPDATE control_memory_records SET content = :content, content_sha256 = :hash, authority_level = :authority, provenance = :provenance, updated_at = :at, last_verified_at = CASE WHEN :action = \'EDIT\' THEN :at ELSE last_verified_at END, freshness = :freshness, sharing_policy = :sharing, tags_json = :tags, pinned_at = :pinned, deleted_at = :deleted, revision_no = :revision WHERE memory_id = :id')->execute(['content' => $newContent, 'hash' => hash('sha256', $newContent), 'authority' => $authority, 'provenance' => $provenance, 'at' => $at, 'action' => $action, 'freshness' => $freshness, 'sharing' => $newSharing, 'tags' => $newTags, 'pinned' => $newPinned, 'deleted' => $deletedAt, 'revision' => $revision, 'id' => $memoryId]);
            self::revision($this->pdo, $memoryId, $revision, $newContent, $authority, $provenance, $freshness, $newSharing, $newTags, $row['source_revision'] === null ? null : (string) $row['source_revision'], $action === 'EDIT' ? 'OWNER_EDIT' : ($action === 'PIN' ? 'PIN' : ($action === 'FORGET' ? 'FORGET' : ($action === 'MARK_OUTDATED' ? 'STALE_MARK' : 'SHARING'))), $ownerUserId, $at);
            $this->pdo->exec('COMMIT');
            $transactionOpen = false;
        } catch (Throwable $error) {
            if ($transactionOpen) { try { $this->pdo->exec('ROLLBACK'); } catch (Throwable) {} }
            if ($error instanceof HubFoundingMemoryException) throw $error;
            throw new HubFoundingMemoryException('Memory could not be updated', 'MEMORY_UPDATE_FAILED');
        }
        $q = $this->pdo->prepare('SELECT * FROM control_memory_records WHERE memory_id = :id'); $q->execute(['id' => $memoryId]); $updated = $q->fetch();
        if (!is_array($updated)) throw new HubFoundingMemoryException('Memory could not be read', 'MEMORY_UPDATE_FAILED');
        return ['schemaVersion' => 1, 'memory' => self::record($updated)];
    }

    /** @return array{schemaVersion:int,records:list<array>} */
    public function exportForOwner(string $ownerUserId): array
    {
        $this->assertReady(); $ownerUserId = self::uuid($ownerUserId); $q = $this->pdo->prepare('SELECT * FROM control_memory_records WHERE owner_user_id = :owner AND deleted_at IS NULL ORDER BY scope, stable_key LIMIT 300'); $q->execute(['owner' => $ownerUserId]);
        return ['schemaVersion' => 1, 'records' => array_map([self::class, 'record'], $q->fetchAll())];
    }

    public function reconcileProjectSourceTruth(string $projectId, ?string $now = null): int { return HubFoundingMemoryMigration::reconcileProjectSourceTruth($this->pdo, $projectId, $now); }

    /** @return list<array> */
    private function ownerRecords(string $userId, string $scope, ?string $query, int $limit): array
    {
        $scopes = match ($scope) { 'owner' => ['OWNER'], 'constitution' => ['CONSTITUTION'], 'archive' => ['ARCHIVE'], 'all' => ['OWNER', 'CONSTITUTION', 'ARCHIVE'], default => throw new HubFoundingMemoryException('Memory scope is invalid', 'MEMORY_INVALID') };
        $marks = implode(',', array_fill(0, count($scopes), '?')); $sql = "SELECT * FROM control_memory_records WHERE owner_user_id = ? AND scope IN ($marks) AND deleted_at IS NULL AND freshness NOT IN ('FORGOTTEN', 'SUPERSEDED')"; $params = array_merge([$userId], $scopes);
        if ($query !== null) { $sql .= " AND (stable_key LIKE ? ESCAPE '\\' OR category LIKE ? ESCAPE '\\' OR content LIKE ? ESCAPE '\\' OR tags_json LIKE ? ESCAPE '\\')"; $needle = '%' . self::escapeLike($query) . '%'; array_push($params, $needle, $needle, $needle, $needle); }
        $sql .= ' ORDER BY pinned_at IS NULL, freshness = \'CURRENT\' DESC, updated_at DESC, stable_key LIMIT ' . $limit; $q = $this->pdo->prepare($sql); $q->execute($params); return $q->fetchAll();
    }

    /** @return list<array> */
    private function projectRecords(string $userId, string $projectId, string $scope, ?string $query, int $limit): array
    {
        if (!in_array($scope, ['all', 'project'], true)) throw new HubFoundingMemoryException('Project memory scope is invalid', 'MEMORY_INVALID');
        $sql = "SELECT * FROM control_memory_records WHERE project_id = ? AND scope = 'PROJECT' AND deleted_at IS NULL AND freshness NOT IN ('FORGOTTEN', 'SUPERSEDED') AND (owner_user_id = ? OR sharing_policy = 'PROJECT_SHARED')"; $params = [$projectId, $userId];
        if ($query !== null) { $sql .= " AND (stable_key LIKE ? ESCAPE '\\' OR category LIKE ? ESCAPE '\\' OR content LIKE ? ESCAPE '\\' OR tags_json LIKE ? ESCAPE '\\')"; $needle = '%' . self::escapeLike($query) . '%'; array_push($params, $needle, $needle, $needle, $needle); }
        $sql .= ' ORDER BY pinned_at IS NULL, freshness = \'CURRENT\' DESC, updated_at DESC, stable_key LIMIT ' . $limit; $q = $this->pdo->prepare($sql); $q->execute($params); return $q->fetchAll();
    }

    private function sourceTruth(string $projectId): ?array
    {
        $q = $this->pdo->prepare('SELECT project_id, name, source_revision, observed_at FROM projects WHERE project_id = :project'); $q->execute(['project' => $projectId]); $row = $q->fetch();
        return !is_array($row) ? null : ['projectId' => (string) $row['project_id'], 'name' => (string) $row['name'], 'sourceRevision' => $row['source_revision'] === null ? null : (string) $row['source_revision'], 'observedAt' => (string) $row['observed_at'], 'authority' => 'LIVE_SOURCE'];
    }

    /** @return array<string,mixed> */
    private static function record(array $row): array
    {
        return ['memoryId' => (string) $row['memory_id'], 'stableKey' => (string) $row['stable_key'], 'scope' => strtolower((string) $row['scope']), 'projectId' => $row['project_id'] === null ? null : (string) $row['project_id'], 'category' => (string) $row['category'], 'content' => (string) $row['content'], 'authorityLevel' => strtolower((string) $row['authority_level']), 'provenance' => (string) $row['provenance'], 'createdAt' => (string) $row['created_at'], 'updatedAt' => (string) $row['updated_at'], 'lastVerifiedAt' => $row['last_verified_at'] === null ? null : (string) $row['last_verified_at'], 'freshness' => strtolower((string) $row['freshness']), 'supersededBySourceRevision' => $row['superseded_by_source_revision'] === null ? null : (string) $row['superseded_by_source_revision'], 'sharingPolicy' => strtolower((string) $row['sharing_policy']), 'tags' => self::tags((string) $row['tags_json']), 'sourceRevision' => $row['source_revision'] === null ? null : (string) $row['source_revision'], 'pinned' => $row['pinned_at'] !== null];
    }

    private static function revision(PDO $pdo, string $memoryId, int $revision, string $content, string $authority, string $provenance, string $freshness, string $sharing, string $tags, ?string $sourceRevision, string $kind, string $userId, string $at): void
    {
        $pdo->prepare('INSERT INTO control_memory_revisions(revision_id, memory_id, revision_no, content, content_sha256, authority_level, provenance, freshness, sharing_policy, tags_json, source_revision, change_kind, changed_by_user_id, created_at) VALUES(:id, :memory, :revision, :content, :hash, :authority, :provenance, :freshness, :sharing, :tags, :source, :kind, :user, :at)')->execute(['id' => self::uuidFromBytes(random_bytes(16)), 'memory' => $memoryId, 'revision' => $revision, 'content' => $content, 'hash' => hash('sha256', $content), 'authority' => $authority, 'provenance' => $provenance, 'freshness' => $freshness, 'sharing' => $sharing, 'tags' => $tags, 'source' => $sourceRevision, 'kind' => $kind, 'user' => $userId, 'at' => $at]);
    }

    private function assertReady(): void { try { HubFoundingMemoryMigration::assertCapabilityReady($this->pdo, dirname(__DIR__) . '/migrations/009_founding_memory.sql'); } catch (HubFoundingMemoryMigrationException $error) { throw new HubFoundingMemoryException('Founding Memory is not ready', $error->codeName); } }
    private static function scope(string $value): string { $value = strtolower(trim($value)); if (!in_array($value, self::SCOPES, true)) throw new HubFoundingMemoryException('Memory scope is invalid', 'MEMORY_INVALID'); return $value; }
    private static function category(string $value): string { $value = strtoupper(trim($value)); if (preg_match('/^[A-Z][A-Z0-9_]{2,47}$/', $value) !== 1) throw new HubFoundingMemoryException('Memory category is invalid', 'MEMORY_INVALID'); return $value; }
    private static function query(?string $value): ?string { if ($value === null || trim($value) === '') return null; $value = trim($value); if (strlen($value) > 120 || preg_match('/[\x00-\x1f\x7f]/', $value)) throw new HubFoundingMemoryException('Memory search is invalid', 'MEMORY_INVALID'); return $value; }
    private static function content(?string $value): string { if (!is_string($value) || trim($value) === '' || strlen($value) > 2000 || preg_match('/[\x00-\x1f\x7f]/', $value)) throw new HubFoundingMemoryException('Memory content is invalid', 'MEMORY_INVALID'); return trim($value); }
    private static function tagsJson(?array $tags): string { if (!is_array($tags) || array_is_list($tags) === false || count($tags) > 12) throw new HubFoundingMemoryException('Memory tags are invalid', 'MEMORY_INVALID'); $out = []; foreach ($tags as $tag) { if (!is_string($tag) || preg_match('/^[a-z0-9-]{2,48}$/', $tag) !== 1) throw new HubFoundingMemoryException('Memory tags are invalid', 'MEMORY_INVALID'); $out[] = $tag; } if (count(array_unique($out)) !== count($out)) throw new HubFoundingMemoryException('Memory tags are invalid', 'MEMORY_INVALID'); return json_encode($out, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR); }
    /** @return list<string> */
    private static function tags(string $json): array { try { $value = json_decode($json, true, 16, JSON_THROW_ON_ERROR); return is_array($value) && array_is_list($value) ? array_values(array_filter($value, 'is_string')) : []; } catch (Throwable) { return []; } }
    private static function escapeLike(string $value): string { return strtr($value, ['\\' => '\\\\', '%' => '\\%', '_' => '\\_']); }
    private static function uuid(string $value): string { if (preg_match('/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i', $value) !== 1) throw new HubFoundingMemoryException('Memory identity is invalid', 'MEMORY_INVALID'); return strtolower($value); }
    private static function uuidFromBytes(string $bytes): string { $bytes[6] = chr((ord($bytes[6]) & 15) | 64); $bytes[8] = chr((ord($bytes[8]) & 63) | 128); return vsprintf('%s%s-%s-%s-%s-%s%s%s', str_split(bin2hex($bytes), 4)); }
    private static function timestamp(string $value): string { if (strtotime($value) === false) throw new HubFoundingMemoryException('Memory time is invalid', 'MEMORY_INVALID'); return gmdate('c', strtotime($value)); }
    private static function bounded(string $value, int $max): string { return strlen($value) <= $max ? $value : substr($value, 0, $max - 1) . '…'; }
}
