<?php

declare(strict_types=1);

require_once __DIR__ . '/HubProjectVault.php';
require_once __DIR__ . '/HubCentralProjectAuthorityMigration.php';

/** Database authority around immutable Vault bytes.  Authorization belongs to
 * HubControlPlaneService; this class deliberately has no user/session input. */
final class HubProjectVaultService
{
    public function __construct(private readonly PDO $pdo, private readonly HubProjectVault $vault) {}

    public static function fromEnvironment(PDO $pdo): self { return new self($pdo, HubProjectVault::fromEnvironment()); }

    /** @return array<string,mixed> */
    public function state(string $projectId): array
    {
        $this->assertReady(); $projectId = self::uuid($projectId);
        $q = $this->pdo->prepare('SELECT v.*, r.content_sha256, r.created_at AS revision_created_at, r.origin_kind FROM control_project_vaults v LEFT JOIN control_project_vault_revisions r ON r.revision_id = v.active_revision_id WHERE v.project_id = :project'); $q->execute(['project' => $projectId]); $row = $q->fetch();
        if (!is_array($row)) return ['projectId' => $projectId, 'storageMode' => 'EXTERNAL', 'syncState' => 'EMPTY', 'activeRevisionId' => null, 'contentBytes' => 0, 'fileCount' => 0, 'updatedAt' => null];
        return ['projectId' => $projectId, 'storageMode' => (string) $row['storage_mode'], 'syncState' => (string) $row['sync_state'], 'activeRevisionId' => $row['active_revision_id'] === null ? null : (string) $row['active_revision_id'], 'contentSha256' => $row['content_sha256'] === null ? null : (string) $row['content_sha256'], 'contentBytes' => (int) $row['content_bytes'], 'fileCount' => (int) $row['file_count'], 'updatedAt' => (string) $row['updated_at'], 'originKind' => $row['origin_kind'] === null ? null : (string) $row['origin_kind']];
    }

    /** @return list<array{revisionId:string,state:string,contentSha256:string,contentBytes:int,fileCount:int,createdAt:string,originKind:string}> */
    public function revisions(string $projectId): array
    {
        $this->assertReady(); $q = $this->pdo->prepare('SELECT revision_id, state, content_sha256, content_bytes, file_count, created_at, origin_kind FROM control_project_vault_revisions WHERE project_id = :project ORDER BY created_at DESC, revision_id DESC LIMIT 50'); $q->execute(['project' => self::uuid($projectId)]);
        return array_map(static fn (array $row): array => ['revisionId' => (string) $row['revision_id'], 'state' => (string) $row['state'], 'contentSha256' => (string) $row['content_sha256'], 'contentBytes' => (int) $row['content_bytes'], 'fileCount' => (int) $row['file_count'], 'createdAt' => (string) $row['created_at'], 'originKind' => (string) $row['origin_kind']], $q->fetchAll());
    }

    /** @return array<string,mixed> */
    public function ingestArchive(string $projectId, string $archivePath, string $userId, ?string $deviceId, ?string $expectedActiveRevision, ?string $now = null): array
    {
        $this->assertReady(); $projectId = self::uuid($projectId); $userId = self::uuid($userId); $deviceId = $deviceId === null ? null : self::uuid($deviceId); $expected = $expectedActiveRevision === null ? null : self::uuid($expectedActiveRevision); $at = self::timestamp($now ?? gmdate('c')); $revisionId = self::uuidFromBytes(random_bytes(16));
        $stored = $this->vault->ingestZip($projectId, $archivePath, $revisionId);
        $savepoint = 'awh_vault_ingest';
        try {
            self::savepoint($this->pdo, $savepoint);
            $existing = $this->pdo->prepare('SELECT active_revision_id FROM control_project_vaults WHERE project_id = :project'); $existing->execute(['project' => $projectId]); $vault = $existing->fetch();
            $active = is_array($vault) && $vault['active_revision_id'] !== null ? (string) $vault['active_revision_id'] : null;
            if ($expected !== $active) throw new HubProjectVaultException('Project source changed before this archive was promoted', 'PROJECT_REVISION_CONFLICT');
            $duplicate = $this->pdo->prepare('SELECT revision_id FROM control_project_vault_revisions WHERE project_id = :project AND content_sha256 = :hash'); $duplicate->execute(['project' => $projectId, 'hash' => $stored['contentSha256']]); $duplicateId = $duplicate->fetchColumn();
            if (is_string($duplicateId)) { self::release($this->pdo, $savepoint); $this->vault->removeRevision($projectId, $revisionId); return $this->state($projectId) + ['duplicateRevisionId' => $duplicateId, 'changed' => false]; }
            $initial = $active === null;
            $insert = $this->pdo->prepare('INSERT INTO control_project_vault_revisions(revision_id, project_id, parent_revision_id, content_sha256, manifest_json, content_bytes, file_count, origin_kind, created_by_user_id, created_by_device_id, task_id, state, created_at, promoted_at) VALUES(:id, :project, :parent, :hash, :manifest, :bytes, :files, :origin, :user, :device, NULL, :state, :at, :promoted)');
            $insert->execute(['id' => $revisionId, 'project' => $projectId, 'parent' => $active, 'hash' => $stored['contentSha256'], 'manifest' => $stored['manifestJson'], 'bytes' => $stored['contentBytes'], 'files' => $stored['fileCount'], 'origin' => $deviceId === null ? 'ARCHIVE' : 'DEVICE', 'user' => $userId, 'device' => $deviceId, 'state' => $initial ? 'ACTIVE' : 'CANDIDATE', 'at' => $at, 'promoted' => $initial ? $at : null]);
            if ($initial) $this->pdo->prepare('INSERT INTO control_project_vaults(project_id, storage_mode, active_revision_id, sync_state, content_bytes, file_count, updated_at) VALUES(:project, \'VAULT\', :revision, \'SYNCED\', :bytes, :files, :at)')->execute(['project' => $projectId, 'revision' => $revisionId, 'bytes' => $stored['contentBytes'], 'files' => $stored['fileCount'], 'at' => $at]);
            else $this->pdo->prepare("UPDATE control_project_vaults SET sync_state = 'STALE', updated_at = :at WHERE project_id = :project")->execute(['project' => $projectId, 'at' => $at]);
            self::release($this->pdo, $savepoint);
            return $this->state($projectId) + ['createdRevisionId' => $revisionId, 'changed' => true, 'promotionRequired' => !$initial];
        } catch (Throwable $error) {
            self::rollbackSavepoint($this->pdo, $savepoint); $this->vault->removeRevision($projectId, $revisionId);
            if ($error instanceof HubProjectVaultException) throw $error;
            throw new HubProjectVaultException('Project archive could not be promoted', 'PROJECT_VAULT_FAILED');
        }
    }

    /** @return array<string,mixed> */
    public function promote(string $projectId, string $revisionId, string $expectedActiveRevision, ?string $now = null): array
    {
        $this->assertReady(); $projectId = self::uuid($projectId); $revisionId = self::uuid($revisionId); $expected = self::uuid($expectedActiveRevision); $at = self::timestamp($now ?? gmdate('c'));
        $savepoint = 'awh_vault_promote';
        try {
            self::savepoint($this->pdo, $savepoint);
            $q = $this->pdo->prepare('SELECT active_revision_id FROM control_project_vaults WHERE project_id = :project'); $q->execute(['project' => $projectId]); $active = $q->fetchColumn();
            if (!is_string($active) || $active !== $expected) throw new HubProjectVaultException('Project source changed before this revision was promoted', 'PROJECT_REVISION_CONFLICT');
            $candidate = $this->pdo->prepare("SELECT content_bytes, file_count FROM control_project_vault_revisions WHERE revision_id = :revision AND project_id = :project AND state = 'CANDIDATE'"); $candidate->execute(['revision' => $revisionId, 'project' => $projectId]); $row = $candidate->fetch();
            if (!is_array($row)) throw new HubProjectVaultException('Project revision is not promotable', 'PROJECT_REVISION_NOT_FOUND');
            $this->pdo->prepare("UPDATE control_project_vault_revisions SET state = 'SUPERSEDED' WHERE revision_id = :revision")->execute(['revision' => $active]);
            $this->pdo->prepare("UPDATE control_project_vault_revisions SET state = 'ACTIVE', promoted_at = :at WHERE revision_id = :revision")->execute(['at' => $at, 'revision' => $revisionId]);
            $this->pdo->prepare("UPDATE control_project_vaults SET active_revision_id = :revision, sync_state = 'SYNCED', content_bytes = :bytes, file_count = :files, updated_at = :at WHERE project_id = :project")->execute(['revision' => $revisionId, 'bytes' => (int) $row['content_bytes'], 'files' => (int) $row['file_count'], 'at' => $at, 'project' => $projectId]);
            self::release($this->pdo, $savepoint); return $this->state($projectId);
        } catch (Throwable $error) { self::rollbackSavepoint($this->pdo, $savepoint); if ($error instanceof HubProjectVaultException) throw $error; throw new HubProjectVaultException('Project revision could not be promoted', 'PROJECT_VAULT_FAILED'); }
    }

    /** @return array{revisionId:string,contentSha256:string,contentBytes:int,fileCount:int,parentRevisionId:string,changed:bool} */
    public function captureTaskWorkspace(string $projectId, string $workspace, string $userId, string $taskId, string $expectedActiveRevision, ?string $now = null): array
    {
        $this->assertReady(); $projectId = self::uuid($projectId); $userId = self::uuid($userId); $taskId = self::uuid($taskId); $expected = self::uuid($expectedActiveRevision); $at = self::timestamp($now ?? gmdate('c')); $revisionId = self::uuidFromBytes(random_bytes(16));
        $stored = $this->vault->ingestDirectory($projectId, $workspace, $revisionId);
        $savepoint = 'awh_vault_task_workspace';
        try {
            self::savepoint($this->pdo, $savepoint);
            $q = $this->pdo->prepare('SELECT active_revision_id FROM control_project_vaults WHERE project_id = :project'); $q->execute(['project' => $projectId]); $active = $q->fetchColumn();
            if (!is_string($active) || !hash_equals($expected, $active)) throw new HubProjectVaultException('Project source changed before this task candidate was captured', 'PROJECT_REVISION_CONFLICT');
            $duplicate = $this->pdo->prepare('SELECT revision_id FROM control_project_vault_revisions WHERE project_id = :project AND content_sha256 = :hash'); $duplicate->execute(['project' => $projectId, 'hash' => $stored['contentSha256']]); $duplicateId = $duplicate->fetchColumn();
            if (is_string($duplicateId)) { self::release($this->pdo, $savepoint); $this->vault->removeRevision($projectId, $revisionId); return ['revisionId' => $duplicateId, 'contentSha256' => $stored['contentSha256'], 'contentBytes' => $stored['contentBytes'], 'fileCount' => $stored['fileCount'], 'parentRevisionId' => $expected, 'changed' => false]; }
            $insert = $this->pdo->prepare("INSERT INTO control_project_vault_revisions(revision_id, project_id, parent_revision_id, content_sha256, manifest_json, content_bytes, file_count, origin_kind, created_by_user_id, created_by_device_id, task_id, state, created_at, promoted_at) VALUES(:id, :project, :parent, :hash, :manifest, :bytes, :files, 'TASK', :user, NULL, :task, 'CANDIDATE', :at, NULL)");
            $insert->execute(['id' => $revisionId, 'project' => $projectId, 'parent' => $expected, 'hash' => $stored['contentSha256'], 'manifest' => $stored['manifestJson'], 'bytes' => $stored['contentBytes'], 'files' => $stored['fileCount'], 'user' => $userId, 'task' => $taskId, 'at' => $at]);
            $this->pdo->prepare("UPDATE control_project_vaults SET sync_state = 'STALE', updated_at = :at WHERE project_id = :project")->execute(['at' => $at, 'project' => $projectId]);
            self::release($this->pdo, $savepoint);
            return ['revisionId' => $revisionId, 'contentSha256' => $stored['contentSha256'], 'contentBytes' => $stored['contentBytes'], 'fileCount' => $stored['fileCount'], 'parentRevisionId' => $expected, 'changed' => true];
        } catch (Throwable $error) {
            self::rollbackSavepoint($this->pdo, $savepoint); $this->vault->removeRevision($projectId, $revisionId);
            if ($error instanceof HubProjectVaultException) throw $error;
            throw new HubProjectVaultException('Task candidate could not be captured', 'PROJECT_VAULT_FAILED');
        }
    }

    /** Captures a worker-produced candidate through the same safe ZIP policy
     * used for project ingestion.  The worker never receives a Vault path and
     * cannot promote this candidate itself. */
    public function captureTaskArchive(string $projectId, string $archive, string $userId, string $taskId, string $expectedActiveRevision, ?string $now = null): array
    {
        $this->assertReady(); $projectId = self::uuid($projectId); $userId = self::uuid($userId); $taskId = self::uuid($taskId); $expected = self::uuid($expectedActiveRevision); $at = self::timestamp($now ?? gmdate('c')); $revisionId = self::uuidFromBytes(random_bytes(16));
        $stored = $this->vault->ingestZip($projectId, $archive, $revisionId);
        $savepoint = 'awh_vault_task_archive';
        try {
            self::savepoint($this->pdo, $savepoint);
            $q = $this->pdo->prepare('SELECT active_revision_id FROM control_project_vaults WHERE project_id = :project'); $q->execute(['project' => $projectId]); $active = $q->fetchColumn();
            if (!is_string($active) || !hash_equals($expected, $active)) throw new HubProjectVaultException('Project source changed before this task candidate was captured', 'PROJECT_REVISION_CONFLICT');
            $duplicate = $this->pdo->prepare('SELECT revision_id FROM control_project_vault_revisions WHERE project_id = :project AND content_sha256 = :hash'); $duplicate->execute(['project' => $projectId, 'hash' => $stored['contentSha256']]); $duplicateId = $duplicate->fetchColumn();
            if (is_string($duplicateId)) { self::release($this->pdo, $savepoint); $this->vault->removeRevision($projectId, $revisionId); return ['revisionId' => $duplicateId, 'contentSha256' => $stored['contentSha256'], 'contentBytes' => $stored['contentBytes'], 'fileCount' => $stored['fileCount'], 'parentRevisionId' => $expected, 'changed' => false]; }
            $insert = $this->pdo->prepare("INSERT INTO control_project_vault_revisions(revision_id, project_id, parent_revision_id, content_sha256, manifest_json, content_bytes, file_count, origin_kind, created_by_user_id, created_by_device_id, task_id, state, created_at, promoted_at) VALUES(:id, :project, :parent, :hash, :manifest, :bytes, :files, 'TASK', :user, NULL, :task, 'CANDIDATE', :at, NULL)");
            $insert->execute(['id' => $revisionId, 'project' => $projectId, 'parent' => $expected, 'hash' => $stored['contentSha256'], 'manifest' => $stored['manifestJson'], 'bytes' => $stored['contentBytes'], 'files' => $stored['fileCount'], 'user' => $userId, 'task' => $taskId, 'at' => $at]);
            $this->pdo->prepare("UPDATE control_project_vaults SET sync_state = 'STALE', updated_at = :at WHERE project_id = :project")->execute(['at' => $at, 'project' => $projectId]);
            self::release($this->pdo, $savepoint); return ['revisionId' => $revisionId, 'contentSha256' => $stored['contentSha256'], 'contentBytes' => $stored['contentBytes'], 'fileCount' => $stored['fileCount'], 'parentRevisionId' => $expected, 'changed' => true];
        } catch (Throwable $error) {
            self::rollbackSavepoint($this->pdo, $savepoint); $this->vault->removeRevision($projectId, $revisionId);
            if ($error instanceof HubProjectVaultException) throw $error;
            throw new HubProjectVaultException('Task candidate could not be captured', 'PROJECT_VAULT_FAILED');
        }
    }

    public function rejectCandidate(string $projectId, string $revisionId, ?string $now = null): void
    {
        $this->assertReady(); $projectId = self::uuid($projectId); $revisionId = self::uuid($revisionId); $at = self::timestamp($now ?? gmdate('c')); $savepoint = 'awh_vault_reject';
        try {
            self::savepoint($this->pdo, $savepoint);
            $q = $this->pdo->prepare("UPDATE control_project_vault_revisions SET state = 'REJECTED' WHERE project_id = :project AND revision_id = :revision AND state = 'CANDIDATE'"); $q->execute(['project' => $projectId, 'revision' => $revisionId]);
            if ($q->rowCount() !== 1) throw new HubProjectVaultException('Project revision is not promotable', 'PROJECT_REVISION_NOT_FOUND');
            $this->pdo->prepare("UPDATE control_project_vaults SET sync_state = CASE WHEN EXISTS(SELECT 1 FROM control_project_vault_revisions r WHERE r.project_id = :project AND r.state = 'CANDIDATE') THEN 'STALE' ELSE 'SYNCED' END, updated_at = :at WHERE project_id = :project")->execute(['project' => $projectId, 'at' => $at]);
            self::release($this->pdo, $savepoint);
        } catch (Throwable $error) { self::rollbackSavepoint($this->pdo, $savepoint); if ($error instanceof HubProjectVaultException) throw $error; throw new HubProjectVaultException('Project candidate could not be rejected', 'PROJECT_VAULT_FAILED'); }
    }

    /** @return array{revisionId:string,contentSha256:string,files:list<array{path:string,sizeBytes:int}>} */
    public function context(string $projectId, string $request): array
    {
        $state = $this->state($projectId); $revision = $state['activeRevisionId']; if (!is_string($revision)) throw new HubProjectVaultException('This project is not held in AWH Vault yet', 'PROJECT_VAULT_EMPTY');
        $terms = preg_split('/[^[:alnum:]_.-]+/u', strtolower($request), -1, PREG_SPLIT_NO_EMPTY) ?: []; $files = [];
        foreach (array_slice($terms, 0, 4) as $term) foreach ($this->vault->search($projectId, $revision, $term, 12) as $match) $files[$match['path']] = $match;
        return ['revisionId' => $revision, 'contentSha256' => (string) $state['contentSha256'], 'files' => array_values(array_slice($files, 0, 24))];
    }

    public function vault(): HubProjectVault { return $this->vault; }
    public function activeRevision(string $projectId): ?string { $state = $this->state($projectId); return is_string($state['activeRevisionId']) ? $state['activeRevisionId'] : null; }
    private function assertReady(): void { try { HubCentralProjectAuthorityMigration::assertCapabilityReady($this->pdo, dirname(__DIR__) . '/migrations/011_central_project_authority.sql'); } catch (HubCentralProjectAuthorityMigrationException $error) { throw new HubProjectVaultException('Central Project Authority is not ready', $error->codeName); } }
    private static function savepoint(PDO $pdo, string $name): void { $pdo->exec('SAVEPOINT ' . $name); }
    private static function release(PDO $pdo, string $name): void { $pdo->exec('RELEASE SAVEPOINT ' . $name); }
    private static function rollbackSavepoint(PDO $pdo, string $name): void { try { $pdo->exec('ROLLBACK TO SAVEPOINT ' . $name); $pdo->exec('RELEASE SAVEPOINT ' . $name); } catch (Throwable) {} }
    private static function uuid(string $value): string { if (preg_match('/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i', $value) !== 1) throw new HubProjectVaultException('Project reference is invalid', 'PROJECT_VAULT_INVALID'); return $value; }
    private static function uuidFromBytes(string $bytes): string { $bytes[6] = chr((ord($bytes[6]) & 0x0f) | 0x40); $bytes[8] = chr((ord($bytes[8]) & 0x3f) | 0x80); return vsprintf('%s%s-%s-%s-%s-%s%s%s', str_split(bin2hex($bytes), 4)); }
    private static function timestamp(string $value): string { if (strtotime($value) === false) throw new HubProjectVaultException('Project Vault time is invalid', 'PROJECT_VAULT_FAILED'); return gmdate('c', strtotime($value)); }
}
