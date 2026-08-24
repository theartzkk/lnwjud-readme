<?php

declare(strict_types=1);

final class HubReadModelException extends RuntimeException
{
    public function __construct(string $message, public readonly string $codeName = 'HUB_READ_MODEL_INVALID')
    {
        parent::__construct($message);
    }
}

final class HubReadModel
{
    public const SCHEMA_VERSION = 1;
    public const MEMORY_FILES = ['PROJECT.md', 'HANDOFF.md', 'TASKS.md', 'ARCHITECTURE.md', 'DECISIONS.md'];
    private const PROJECT_ID = '/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i';
    private const SAFE_TYPE = '/^[a-z][a-z0-9-]{0,31}$/';
    private const MAX_MEMORY_BYTES = 32768;
    private const STALE_AFTER_SECONDS = 86400;

    private function __construct(private readonly PDO $pdo)
    {
    }

    public static function open(string $path, bool $readOnly = false): self
    {
        if ($path === '' || str_contains($path, "\0")) {
            throw new HubReadModelException('Hub database configuration is invalid', 'DATABASE_CONFIG_INVALID');
        }
        if ($readOnly && !is_file($path)) {
            throw new HubReadModelException('Hub database is not initialized', 'DATABASE_UNAVAILABLE');
        }
        try {
            $pdo = new PDO('sqlite:' . $path, null, null, [
                PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
                PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
                PDO::ATTR_EMULATE_PREPARES => false,
            ]);
            $pdo->exec('PRAGMA foreign_keys = ON');
            $pdo->exec('PRAGMA busy_timeout = 2500');
            if ($readOnly) {
                $pdo->exec('PRAGMA query_only = ON');
            }
        } catch (Throwable) {
            throw new HubReadModelException('Hub database is unavailable', 'DATABASE_UNAVAILABLE');
        }
        return new self($pdo);
    }

    public static function openFromEnvironment(bool $readOnly = true): self
    {
        $path = getenv('AWH_HUB_DB_PATH');
        if (!is_string($path) || $path === '') {
            $path = '/var/lib/awh-hub/awh.sqlite';
        }
        return self::open($path, $readOnly);
    }

    public function initializeSchema(string $schemaPath): void
    {
        $schema = @file_get_contents($schemaPath);
        if (!is_string($schema) || $schema === '') {
            throw new HubReadModelException('Hub schema is unavailable', 'SCHEMA_UNAVAILABLE');
        }
        try {
            $this->pdo->exec($schema);
        } catch (Throwable) {
            throw new HubReadModelException('Hub schema could not be initialized', 'SCHEMA_INVALID');
        }
    }

    public function health(): array
    {
        try {
            $this->pdo->query('SELECT 1')->fetchColumn();
        } catch (Throwable) {
            throw new HubReadModelException('Hub database is unavailable', 'DATABASE_UNAVAILABLE');
        }
        return ['schemaVersion' => self::SCHEMA_VERSION, 'status' => 'ok', 'service' => 'awh-hub-read-foundation'];
    }

    public function status(): array
    {
        return [
            'schemaVersion' => self::SCHEMA_VERSION,
            'status' => 'ok',
            'mode' => 'read-only',
            'staleAfterSeconds' => self::STALE_AFTER_SECONDS,
            'counts' => [
                'projects' => $this->count('projects'),
                'devices' => $this->count('devices'),
                'builds' => $this->count('builds'),
                'releases' => $this->count('releases'),
            ],
        ];
    }

    public function projects(): array
    {
        $rows = $this->pdo->query('SELECT project_id, name, type, created_at, source_revision, observed_at, provenance FROM projects ORDER BY name, project_id LIMIT 100')->fetchAll();
        return ['schemaVersion' => self::SCHEMA_VERSION, 'projects' => array_map(fn (array $row): array => $this->projectRow($row), $rows), 'nextCursor' => null];
    }

    public function project(string $projectId): array
    {
        self::assertProjectId($projectId);
        $statement = $this->pdo->prepare('SELECT project_id, name, type, created_at, source_revision, observed_at, provenance FROM projects WHERE project_id = :project_id');
        $statement->execute(['project_id' => $projectId]);
        $row = $statement->fetch();
        if (!is_array($row)) {
            throw new HubReadModelException('Project was not found', 'PROJECT_NOT_FOUND');
        }
        return ['schemaVersion' => self::SCHEMA_VERSION, 'project' => $this->projectRow($row), 'membership' => ['status' => 'not-configured']];
    }

    public function memory(string $projectId): array
    {
        self::assertProjectId($projectId);
        $this->assertProjectExists($projectId);
        $statement = $this->pdo->prepare('SELECT memory_file, status, sha256, size_bytes, observed_at, provenance FROM project_memory WHERE project_id = :project_id ORDER BY memory_file');
        $statement->execute(['project_id' => $projectId]);
        $rows = [];
        foreach ($statement->fetchAll() as $row) {
            if (!is_array($row) || !in_array($row['memory_file'] ?? '', self::MEMORY_FILES, true)) {
                continue;
            }
            $rows[(string) $row['memory_file']] = [
                'status' => in_array($row['status'] ?? '', ['present', 'missing'], true) ? $row['status'] : 'missing',
                'sha256' => is_string($row['sha256'] ?? null) ? $row['sha256'] : null,
                'sizeBytes' => is_numeric($row['size_bytes'] ?? null) ? (int) $row['size_bytes'] : null,
                'observedAt' => (string) ($row['observed_at'] ?? ''),
                'provenance' => (string) ($row['provenance'] ?? 'local-index'),
            ];
        }
        $files = [];
        foreach (self::MEMORY_FILES as $file) {
            $files[$file] = $rows[$file] ?? ['status' => 'missing', 'sha256' => null, 'sizeBytes' => null, 'observedAt' => null, 'provenance' => 'not-indexed'];
        }
        $observed = array_values(array_filter(array_map(static fn (array $file): ?string => $file['observedAt'], $files)));
        return [
            'schemaVersion' => self::SCHEMA_VERSION,
            'projectId' => $projectId,
            'canonicalSource' => 'PROJECT.md, HANDOFF.md, TASKS.md, ARCHITECTURE.md, DECISIONS.md',
            'files' => $files,
            'observedAt' => $observed === [] ? null : max($observed),
            'handoffSummary' => null,
        ];
    }

    public function devices(): array
    {
        $rows = $this->pdo->query("SELECT d.device_id, d.display_name, d.platform, d.arch, d.app_version, d.last_seen_at, d.revoked_at, e.revoked_at AS enrollment_revoked, CASE WHEN e.device_id IS NULL THEN 'unmanaged' WHEN d.revoked_at IS NOT NULL OR e.revoked_at IS NOT NULL THEN 'revoked' ELSE 'active' END AS enrollment_status, (SELECT COUNT(*) FROM device_project_memberships m WHERE m.device_id = d.device_id AND m.revoked_at IS NULL) AS project_count FROM devices d LEFT JOIN device_enrollments e ON e.device_id = d.device_id ORDER BY d.display_name, d.device_id LIMIT 100")->fetchAll();
        return ['schemaVersion' => self::SCHEMA_VERSION, 'devices' => array_map(static fn (array $row): array => [
            'schemaVersion' => 1,
            'deviceId' => (string) $row['device_id'],
            'displayName' => (string) $row['display_name'],
            'platform' => (string) $row['platform'],
            'arch' => (string) $row['arch'],
            'appVersion' => (string) $row['app_version'],
            'lastSeenAt' => (string) $row['last_seen_at'],
            'revokedAt' => $row['revoked_at'] === null ? null : (string) $row['revoked_at'],
            'enrollmentStatus' => in_array($row['enrollment_status'] ?? '', ['active', 'revoked', 'unmanaged'], true) ? $row['enrollment_status'] : 'unmanaged',
            'projectCount' => is_numeric($row['project_count'] ?? null) ? (int) $row['project_count'] : 0,
        ], $rows)];
    }

    public function builds(): array
    {
        $rows = $this->pdo->query('SELECT build_id, project_id, revision_id, status, version, created_at, completed_at FROM builds ORDER BY created_at DESC, build_id DESC LIMIT 100')->fetchAll();
        return ['schemaVersion' => self::SCHEMA_VERSION, 'builds' => array_map(static fn (array $row): array => [
            'schemaVersion' => 1,
            'buildId' => (string) $row['build_id'],
            'projectId' => (string) $row['project_id'],
            'revisionId' => (string) $row['revision_id'],
            'status' => (string) $row['status'],
            'version' => (string) $row['version'],
            'createdAt' => (string) $row['created_at'],
            'completedAt' => $row['completed_at'] === null ? null : (string) $row['completed_at'],
        ], $rows)];
    }

    public function releases(): array
    {
        $rows = $this->pdo->query('SELECT release_id, project_id, version, status, created_at, released_at FROM releases ORDER BY created_at DESC, release_id DESC LIMIT 100')->fetchAll();
        return ['schemaVersion' => self::SCHEMA_VERSION, 'releases' => array_map(static fn (array $row): array => [
            'schemaVersion' => 1,
            'releaseId' => (string) $row['release_id'],
            'projectId' => (string) $row['project_id'],
            'version' => (string) $row['version'],
            'status' => (string) $row['status'],
            'createdAt' => (string) $row['created_at'],
            'releasedAt' => $row['released_at'] === null ? null : (string) $row['released_at'],
        ], $rows)];
    }

    /** Index only portable project metadata and memory file metadata; never stores a workspace path or content. */
    public function indexLocalProject(string $workspace): array
    {
        $root = realpath($workspace);
        if ($root === false || !is_dir($root)) {
            throw new HubReadModelException('Project workspace is unavailable', 'PROJECT_WORKSPACE_INVALID');
        }
        $manifestPath = $root . DIRECTORY_SEPARATOR . '.awh' . DIRECTORY_SEPARATOR . 'project.json';
        $manifest = $this->readManifest($manifestPath);
        $observedAt = gmdate('c');
        $memory = [];
        foreach (self::MEMORY_FILES as $file) {
            $path = $root . DIRECTORY_SEPARATOR . $file;
            $info = @lstat($path);
            if ($info === false) {
                $memory[$file] = ['status' => 'missing', 'sha256' => null, 'size' => null];
                continue;
            }
            if (filetype($path) !== 'file' || is_link($path) || (int) ($info['size'] ?? 0) > self::MAX_MEMORY_BYTES) {
                throw new HubReadModelException('Project Memory file is not a bounded regular file', 'MEMORY_FILE_INVALID');
            }
            $hash = hash_file('sha256', $path);
            if (!is_string($hash)) {
                throw new HubReadModelException('Project Memory file could not be hashed', 'MEMORY_FILE_INVALID');
            }
            $memory[$file] = ['status' => 'present', 'sha256' => $hash, 'size' => (int) $info['size']];
        }
        try {
            $this->pdo->beginTransaction();
            $project = $this->pdo->prepare('INSERT INTO projects(project_id, name, type, created_at, source_revision, observed_at, provenance) VALUES(:project_id, :name, :type, :created_at, NULL, :observed_at, :provenance) ON CONFLICT(project_id) DO UPDATE SET name=excluded.name, type=excluded.type, created_at=excluded.created_at, observed_at=excluded.observed_at, provenance=excluded.provenance');
            $project->execute(['project_id' => $manifest['projectId'], 'name' => $manifest['name'], 'type' => $manifest['type'], 'created_at' => $manifest['createdAt'], 'observed_at' => $observedAt, 'provenance' => 'local-index:portable-project-manifest']);
            $delete = $this->pdo->prepare('DELETE FROM project_memory WHERE project_id = :project_id');
            $delete->execute(['project_id' => $manifest['projectId']]);
            $memoryInsert = $this->pdo->prepare('INSERT INTO project_memory(project_id, memory_file, status, sha256, size_bytes, observed_at, provenance) VALUES(:project_id, :memory_file, :status, :sha256, :size_bytes, :observed_at, :provenance)');
            foreach ($memory as $file => $value) {
                $memoryInsert->execute(['project_id' => $manifest['projectId'], 'memory_file' => $file, 'status' => $value['status'], 'sha256' => $value['sha256'], 'size_bytes' => $value['size'], 'observed_at' => $observedAt, 'provenance' => 'local-index:canonical-memory-file']);
            }
            $this->pdo->commit();
        } catch (Throwable) {
            if ($this->pdo->inTransaction()) {
                $this->pdo->rollBack();
            }
            throw new HubReadModelException('Project metadata could not be indexed', 'INDEX_FAILED');
        }
        return $manifest;
    }

    private function count(string $table): int
    {
        if (!in_array($table, ['projects', 'devices', 'builds', 'releases'], true)) {
            throw new HubReadModelException('Hub count is not allowed', 'QUERY_NOT_ALLOWED');
        }
        return (int) $this->pdo->query("SELECT COUNT(*) FROM {$table}")->fetchColumn();
    }

    private function assertProjectExists(string $projectId): void
    {
        $statement = $this->pdo->prepare('SELECT 1 FROM projects WHERE project_id = :project_id');
        $statement->execute(['project_id' => $projectId]);
        if ($statement->fetchColumn() === false) {
            throw new HubReadModelException('Project was not found', 'PROJECT_NOT_FOUND');
        }
    }

    private function projectRow(array $row): array
    {
        return [
            'schemaVersion' => self::SCHEMA_VERSION,
            'projectId' => (string) $row['project_id'],
            'name' => (string) $row['name'],
            'type' => (string) $row['type'],
            'createdAt' => (string) $row['created_at'],
            'sourceRevision' => $row['source_revision'] === null ? null : (string) $row['source_revision'],
            'observedAt' => (string) $row['observed_at'],
            'provenance' => (string) $row['provenance'],
        ];
    }

    private function readManifest(string $path): array
    {
        $info = @lstat($path);
        if ($info === false || filetype($path) !== 'file' || is_link($path) || (int) ($info['size'] ?? 0) > 16384) {
            throw new HubReadModelException('Project manifest is unavailable or unsafe', 'PROJECT_MANIFEST_INVALID');
        }
        $raw = @file_get_contents($path);
        $value = is_string($raw) ? json_decode($raw, true) : null;
        $keys = is_array($value) ? array_keys($value) : [];
        sort($keys);
        $name = is_string($value['name'] ?? null) ? trim($value['name']) : '';
        $type = is_string($value['type'] ?? null) ? trim(strtolower($value['type'])) : '';
        $nameHasPath = strpbrk($name, "/\\") !== false;
        $typeHasPath = strpbrk($type, "/\\") !== false;
        if (!is_array($value) || $keys !== ['createdAt', 'name', 'projectId', 'schemaVersion', 'type'] || $value['schemaVersion'] !== 1 || !is_string($value['projectId']) || !preg_match(self::PROJECT_ID, $value['projectId']) || !is_string($value['createdAt']) || strtotime($value['createdAt']) === false || $name === '' || strlen($name) > 120 || preg_match('/[\x00-\x1F\x7F]/', $name) || $nameHasPath || preg_match('/^(?:[A-Za-z]:|~)/', $name) || preg_match('/^https?:\/\//i', $name) || !preg_match(self::SAFE_TYPE, $type) || $typeHasPath || preg_match('/https?:\/\//i', $type)) {
            throw new HubReadModelException('Project manifest is malformed or non-portable', 'PROJECT_MANIFEST_INVALID');
        }
        $value['name'] = $name;
        $value['type'] = $type;
        return $value;
    }

    public static function assertProjectId(string $projectId): void
    {
        if (!preg_match(self::PROJECT_ID, $projectId)) {
            throw new HubReadModelException('Project identifier is invalid', 'PROJECT_ID_INVALID');
        }
    }
}
