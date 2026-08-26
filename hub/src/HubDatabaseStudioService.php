<?php

declare(strict_types=1);

final class HubDatabaseStudioException extends RuntimeException
{
    public function __construct(string $message, public readonly string $codeName = 'DATABASE_STUDIO_FAILED') { parent::__construct($message); }
}

/** Owner-only, read-only inspection surface over the canonical AWH SQLite authority. */
final class HubDatabaseStudioService
{
    private const MAX_PAGE_SIZE = 100;
    private const MAX_EXPORT_ROWS = 5000;
    private const MAX_SQL_ROWS = 200;
    private const MAX_SQL_BYTES = 4000;
    private const MAX_EXPORT_BYTES = 5_242_880;
    private const SESSION_INACTIVITY_TTL = 43200;
    private const STEP_UP_TTL = 900;

    private function __construct(private readonly PDO $pdo, private readonly string $databasePath, private readonly string $migrationDir) {}

    public static function openExisting(string $databasePath, ?string $migrationDir = null): self
    {
        if ($databasePath === '' || str_contains($databasePath, "\0") || !is_file($databasePath) || is_link($databasePath)) throw new HubDatabaseStudioException('Database configuration is invalid', 'DATABASE_CONFIG_INVALID');
        try {
            $pdo = new PDO('sqlite:' . $databasePath, null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC, PDO::ATTR_EMULATE_PREPARES => false]);
            $pdo->exec('PRAGMA foreign_keys = ON'); $pdo->exec('PRAGMA busy_timeout = 2500');
            foreach (['control_sessions', 'hub_users', 'owner_bootstrap'] as $table) if (!self::tableExists($pdo, $table)) throw new RuntimeException('owner session schema missing');
            $sessionColumns = array_column($pdo->query('PRAGMA table_info(control_sessions)')->fetchAll(), 'name');
            if (array_diff(['session_hash', 'user_id', 'csrf_hash', 'expires_at', 'last_seen_at', 'revoked_at', 'session_kind', 'step_up_at'], $sessionColumns) !== []) throw new RuntimeException('owner password session schema missing');
            return new self($pdo, $databasePath, $migrationDir ?? dirname(__DIR__) . '/migrations');
        } catch (HubDatabaseStudioException $error) { throw $error; }
        catch (Throwable) { throw new HubDatabaseStudioException('Database Studio is unavailable', 'DATABASE_UNAVAILABLE'); }
    }

    public function overview(string $sessionToken, ?string $now = null): array
    {
        $this->ownerSession($sessionToken, null, false, $now); $tables = $this->tableCatalog(); $visibleRows = 0;
        foreach ($tables as $table) if (!$table['locked'] && is_int($table['rowCount'])) $visibleRows += $table['rowCount'];
        $pageSize = (int) $this->pdo->query('PRAGMA page_size')->fetchColumn(); $pageCount = (int) $this->pdo->query('PRAGMA page_count')->fetchColumn(); $freePages = (int) $this->pdo->query('PRAGMA freelist_count')->fetchColumn();
        $quick = $this->boundedPragma('PRAGMA quick_check', 20); $databaseBytes = @filesize($this->databasePath); $walBytes = @filesize($this->databasePath . '-wal');
        return ['schemaVersion' => 1, 'database' => ['engine' => 'SQLite', 'schemaVersion' => (int) $this->pdo->query('PRAGMA user_version')->fetchColumn(), 'sizeBytes' => is_int($databaseBytes) ? $databaseBytes : $pageCount * $pageSize, 'walBytes' => is_int($walBytes) ? $walBytes : 0, 'pageSize' => $pageSize, 'pageCount' => $pageCount, 'freePages' => $freePages, 'journalMode' => strtolower((string) $this->pdo->query('PRAGMA journal_mode')->fetchColumn()), 'foreignKeysEnabled' => (int) $this->pdo->query('PRAGMA foreign_keys')->fetchColumn() === 1], 'summary' => ['tables' => count($tables), 'browseableTables' => count(array_filter($tables, static fn (array $row): bool => !$row['locked'])), 'lockedTables' => count(array_filter($tables, static fn (array $row): bool => $row['locked'])), 'visibleRows' => $visibleRows], 'health' => ['quickCheck' => $quick === ['ok'] ? 'ok' : 'review', 'quickCheckMessages' => $quick], 'backup' => $this->backupMetadata()];
    }

    public function tables(string $sessionToken, ?string $now = null): array { $this->ownerSession($sessionToken, null, false, $now); return ['schemaVersion' => 1, 'tables' => $this->tableCatalog()]; }

    public function browse(string $sessionToken, string $table, ?string $search = null, int $page = 1, int $limit = 50, ?string $sort = null, string $direction = 'ASC', ?string $now = null): array
    {
        $this->ownerSession($sessionToken, null, false, $now); $table = $this->assertBrowseableTable($table);
        if ($page < 1 || $page > 10000 || $limit < 1 || $limit > self::MAX_PAGE_SIZE) throw new HubDatabaseStudioException('Pagination is invalid', 'DATABASE_REQUEST_INVALID');
        $search = self::searchText($search); $columns = $this->columns($table); [$sort, $direction] = $this->sortContract($columns, $sort, $direction); $offset = ($page - 1) * $limit;
        $total = $this->countRows($table, $columns, $search); $rows = $this->readRows($table, $columns, $search, $sort, $direction, $limit, $offset);
        return ['schemaVersion' => 1, 'table' => $table, 'columns' => $this->publicColumns($columns), 'rows' => $rows, 'page' => $page, 'pageSize' => $limit, 'totalRows' => $total, 'totalPages' => max(1, (int) ceil($total / $limit)), 'search' => $search, 'sort' => $sort, 'direction' => $direction];
    }

    public function schema(string $sessionToken, string $table, ?string $now = null): array
    {
        $this->ownerSession($sessionToken, null, false, $now); $table = $this->assertKnownTable($table);
        if ($this->isSensitiveTable($table)) return ['schemaVersion' => 1, 'table' => $table, 'locked' => true, 'columns' => [], 'indexes' => [], 'foreignKeys' => []];
        $columns = $this->columns($table); $indexes = [];
        foreach ($this->pdo->query('PRAGMA index_list(' . self::quoteIdentifier($table) . ')')->fetchAll() as $row) { $name = (string) ($row['name'] ?? ''); if ($name === '') continue; $parts = []; foreach ($this->pdo->query('PRAGMA index_info(' . self::quoteIdentifier($name) . ')')->fetchAll() as $part) if (is_string($part['name'] ?? null)) $parts[] = (string) $part['name']; $indexes[] = ['name' => $name, 'unique' => (int) ($row['unique'] ?? 0) === 1, 'origin' => (string) ($row['origin'] ?? ''), 'columns' => $parts]; }
        $foreign = []; foreach ($this->pdo->query('PRAGMA foreign_key_list(' . self::quoteIdentifier($table) . ')')->fetchAll() as $row) $foreign[] = ['from' => (string) ($row['from'] ?? ''), 'table' => (string) ($row['table'] ?? ''), 'to' => (string) ($row['to'] ?? ''), 'onUpdate' => (string) ($row['on_update'] ?? ''), 'onDelete' => (string) ($row['on_delete'] ?? '')];
        return ['schemaVersion' => 1, 'table' => $table, 'locked' => false, 'columns' => $this->publicColumns($columns), 'indexes' => $indexes, 'foreignKeys' => $foreign];
    }

    public function runReadOnlySql(string $sessionToken, string $csrfToken, string $sql, bool $explain = false, ?string $now = null): array
    {
        $this->ownerSession($sessionToken, $csrfToken, true, $now); $sql = $this->validatedSelect($sql); $statementSql = $explain ? 'EXPLAIN QUERY PLAN ' . $sql : 'SELECT * FROM (' . $sql . ') LIMIT ' . (self::MAX_SQL_ROWS + 1); $started = microtime(true); $rows = []; $columns = [];
        try {
            $this->pdo->exec('PRAGMA query_only = ON'); $statement = $this->pdo->query($statementSql); if (!$statement instanceof PDOStatement) throw new RuntimeException('query unavailable');
            for ($index = 0; $index < $statement->columnCount(); $index++) { $meta = $statement->getColumnMeta($index); $columns[] = is_array($meta) && is_string($meta['name'] ?? null) ? (string) $meta['name'] : 'column_' . ($index + 1); }
            while (($row = $statement->fetch()) !== false && count($rows) <= self::MAX_SQL_ROWS) $rows[] = $this->normalizeRow($row);
        } catch (HubDatabaseStudioException $error) { throw $error; }
        catch (Throwable) { throw new HubDatabaseStudioException('Read-only SQL could not be executed', 'DATABASE_QUERY_FAILED'); }
        finally { try { $this->pdo->exec('PRAGMA query_only = OFF'); } catch (Throwable) {} }
        $truncated = count($rows) > self::MAX_SQL_ROWS; if ($truncated) array_pop($rows);
        return ['schemaVersion' => 1, 'mode' => $explain ? 'EXPLAIN' : 'SELECT', 'queryOnly' => true, 'columns' => $columns, 'rows' => $rows, 'rowCount' => count($rows), 'truncated' => $truncated, 'durationMs' => (int) round((microtime(true) - $started) * 1000)];
    }

    public function export(string $sessionToken, string $table, string $format, ?string $search = null, ?string $sort = null, string $direction = 'ASC', ?string $now = null): array
    {
        $this->ownerSession($sessionToken, null, false, $now); $table = $this->assertBrowseableTable($table); $format = strtolower(trim($format));
        if (!in_array($format, ['csv', 'json'], true)) throw new HubDatabaseStudioException('Export format is invalid', 'DATABASE_REQUEST_INVALID');
        $search = self::searchText($search); $columns = $this->columns($table); [$sort, $direction] = $this->sortContract($columns, $sort, $direction); $rows = $this->readRows($table, $columns, $search, $sort, $direction, self::MAX_EXPORT_ROWS + 1, 0); $truncated = count($rows) > self::MAX_EXPORT_ROWS; if ($truncated) array_pop($rows);
        $safeColumns = array_values(array_filter($columns, static fn (array $column): bool => !$column['redacted'])); $names = array_column($safeColumns, 'name'); if ($names === []) throw new HubDatabaseStudioException('No exportable columns are available', 'DATABASE_TABLE_RESTRICTED');
        if ($format === 'json') { $exportRows = array_map(static function (array $row) use ($names): array { $out = []; foreach ($names as $name) $out[$name] = $row[$name] ?? null; return $out; }, $rows); $content = json_encode($exportRows, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR); $mime = 'application/json'; }
        else { $stream = fopen('php://temp', 'w+'); if (!is_resource($stream)) throw new HubDatabaseStudioException('Export could not be created', 'DATABASE_EXPORT_FAILED'); fputcsv($stream, $names); foreach ($rows as $row) { $values = []; foreach ($names as $name) $values[] = self::exportScalar($row[$name] ?? null); fputcsv($stream, $values); } rewind($stream); $content = stream_get_contents($stream); fclose($stream); $mime = 'text/csv'; if (!is_string($content)) throw new HubDatabaseStudioException('Export could not be created', 'DATABASE_EXPORT_FAILED'); }
        if (strlen($content) > self::MAX_EXPORT_BYTES) throw new HubDatabaseStudioException('Export exceeds the safe size limit', 'DATABASE_EXPORT_TOO_LARGE');
        return ['schemaVersion' => 1, 'table' => $table, 'format' => $format, 'filename' => $table . '.' . $format, 'mimeType' => $mime, 'content' => $content, 'sizeBytes' => strlen($content), 'rows' => count($rows), 'truncated' => $truncated];
    }

    public function health(string $sessionToken, ?string $now = null): array
    {
        $this->ownerSession($sessionToken, null, false, $now); $integrity = $this->boundedPragma('PRAGMA integrity_check', 100); $foreignRows = []; $statement = $this->pdo->query('PRAGMA foreign_key_check');
        if ($statement instanceof PDOStatement) while (($row = $statement->fetch()) !== false && count($foreignRows) < 101) $foreignRows[] = $this->normalizeRow($row); $foreignTruncated = count($foreignRows) > 100; if ($foreignTruncated) array_pop($foreignRows);
        return ['schemaVersion' => 1, 'integrity' => ['status' => $integrity === ['ok'] ? 'PASS' : 'REVIEW', 'messages' => $integrity], 'foreignKeys' => ['status' => $foreignRows === [] ? 'PASS' : 'REVIEW', 'violations' => $foreignRows, 'truncated' => $foreignTruncated], 'journalMode' => strtolower((string) $this->pdo->query('PRAGMA journal_mode')->fetchColumn()), 'foreignKeysEnabled' => (int) $this->pdo->query('PRAGMA foreign_keys')->fetchColumn() === 1];
    }

    public function migrations(string $sessionToken, ?string $now = null): array
    {
        $this->ownerSession($sessionToken, null, false, $now); $ledger = [];
        if (self::tableExists($this->pdo, 'awh_schema_migrations')) { $q = $this->pdo->query('SELECT migration_id, schema_version, checksum, applied_at FROM awh_schema_migrations ORDER BY schema_version, migration_id'); foreach ($q->fetchAll() as $row) $ledger[] = ['migrationId' => (string) $row['migration_id'], 'schemaVersion' => (int) $row['schema_version'], 'checksum' => (string) $row['checksum'], 'appliedAt' => (string) $row['applied_at']]; }
        $files = []; $paths = is_dir($this->migrationDir) ? glob(rtrim($this->migrationDir, DIRECTORY_SEPARATOR) . DIRECTORY_SEPARATOR . '*.sql') : false;
        if (is_array($paths)) { sort($paths, SORT_STRING); foreach ($paths as $path) { if (!is_file($path) || is_link($path)) continue; $checksum = hash_file('sha256', $path); $files[] = ['file' => basename($path), 'sha256' => is_string($checksum) ? $checksum : null, 'sizeBytes' => (int) (@filesize($path) ?: 0)]; } }
        return ['schemaVersion' => 1, 'databaseUserVersion' => (int) $this->pdo->query('PRAGMA user_version')->fetchColumn(), 'ledger' => $ledger, 'files' => $files];
    }

    public function audit(string $sessionToken, int $limit = 50, ?string $now = null): array
    {
        $this->ownerSession($sessionToken, null, false, $now); if ($limit < 1 || $limit > 100) throw new HubDatabaseStudioException('Audit limit is invalid', 'DATABASE_REQUEST_INVALID'); $tables = [];
        foreach ($this->tableCatalog() as $table) if (!$table['locked'] && str_contains(strtolower($table['name']), 'audit')) $tables[] = $table['name'];
        $streams = []; foreach ($tables as $table) { $columns = $this->columns($table); $sort = $this->preferredTimeColumn($columns); $rows = $this->readRows($table, $columns, null, $sort, 'DESC', $limit, 0); $streams[] = ['table' => $table, 'columns' => $this->publicColumns($columns), 'rows' => $rows]; }
        return ['schemaVersion' => 1, 'streams' => $streams];
    }

    private function ownerSession(string $token, ?string $csrf, bool $requireStepUp, ?string $now): array
    {
        if ($token === '' || strlen($token) > 512 || preg_match('/[\x00-\x1f\x7f]/', $token)) throw new HubDatabaseStudioException('Owner session is invalid', 'SESSION_INVALID'); $at = strtotime($now ?? gmdate('c')); if ($at === false) throw new HubDatabaseStudioException('Time is invalid', 'DATABASE_REQUEST_INVALID');
        $q = $this->pdo->prepare("SELECT s.session_id, s.user_id, s.csrf_hash, s.expires_at, s.last_seen_at, s.revoked_at, s.session_kind, s.step_up_at FROM control_sessions s JOIN hub_users u ON u.user_id = s.user_id AND u.revoked_at IS NULL JOIN owner_bootstrap o ON o.owner_user_id = s.user_id AND o.singleton_id = 1 AND o.bootstrap_closed = 1 WHERE s.session_hash = :hash"); $q->execute(['hash' => hash('sha256', $token)]); $row = $q->fetch();
        if (!is_array($row) || $row['revoked_at'] !== null || (string) $row['session_kind'] !== 'password' || strtotime((string) $row['expires_at']) <= $at || strtotime((string) $row['last_seen_at']) < $at - self::SESSION_INACTIVITY_TTL) throw new HubDatabaseStudioException('Owner session has expired', 'SESSION_EXPIRED');
        if ($csrf !== null && ($csrf === '' || strlen($csrf) > 256 || !hash_equals((string) $row['csrf_hash'], hash('sha256', $csrf)))) throw new HubDatabaseStudioException('Request verification failed', 'CSRF_REJECTED');
        if ($requireStepUp) { $step = is_string($row['step_up_at']) ? strtotime((string) $row['step_up_at']) : false; if ($step === false || $step < $at - self::STEP_UP_TTL) throw new HubDatabaseStudioException('Fresh password confirmation is required', 'STEP_UP_REQUIRED'); }
        return $row;
    }

    private function tableCatalog(): array
    {
        $rows = $this->pdo->query("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")->fetchAll(); $out = [];
        foreach ($rows as $row) { $name = (string) $row['name']; $locked = $this->isSensitiveTable($name); $count = null; if (!$locked) { try { $count = (int) $this->pdo->query('SELECT COUNT(*) FROM ' . self::quoteIdentifier($name))->fetchColumn(); } catch (Throwable) { $count = null; } } $out[] = ['name' => $name, 'type' => 'table', 'locked' => $locked, 'rowCount' => $count]; }
        return $out;
    }

    private function assertKnownTable(string $table): string
    {
        if (!preg_match('/^[A-Za-z_][A-Za-z0-9_]{0,127}$/', $table)) throw new HubDatabaseStudioException('Table name is invalid', 'DATABASE_REQUEST_INVALID'); $q = $this->pdo->prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = :name AND name NOT LIKE 'sqlite_%'"); $q->execute(['name' => $table]); $name = $q->fetchColumn(); if (!is_string($name)) throw new HubDatabaseStudioException('Table was not found', 'DATABASE_TABLE_NOT_FOUND'); return $name;
    }
    private function assertBrowseableTable(string $table): string { $table = $this->assertKnownTable($table); if ($this->isSensitiveTable($table)) throw new HubDatabaseStudioException('This table contains protected authentication or credential material', 'DATABASE_TABLE_RESTRICTED'); return $table; }

    private function columns(string $table): array
    {
        $rows = $this->pdo->query('PRAGMA table_info(' . self::quoteIdentifier($table) . ')')->fetchAll(); $out = [];
        foreach ($rows as $row) { $name = (string) ($row['name'] ?? ''); if ($name === '') continue; $redacted = self::isSensitiveColumn($name); $out[] = ['name' => $name, 'type' => (string) ($row['type'] ?? ''), 'notNull' => (int) ($row['notnull'] ?? 0) === 1, 'primaryKey' => (int) ($row['pk'] ?? 0), 'default' => $redacted ? null : ($row['dflt_value'] ?? null), 'redacted' => $redacted]; }
        if ($out === []) throw new HubDatabaseStudioException('Table schema is unavailable', 'DATABASE_SCHEMA_FAILED'); return $out;
    }
    private function publicColumns(array $columns): array { return array_map(static fn (array $column): array => ['name' => $column['name'], 'type' => $column['type'], 'notNull' => $column['notNull'], 'primaryKey' => $column['primaryKey'], 'default' => $column['default'], 'redacted' => $column['redacted']], $columns); }

    private function sortContract(array $columns, ?string $sort, string $direction): array
    {
        $safe = array_values(array_filter($columns, static fn (array $column): bool => !$column['redacted'])); if ($safe === []) throw new HubDatabaseStudioException('Table has no browseable columns', 'DATABASE_TABLE_RESTRICTED'); $names = array_column($safe, 'name');
        if ($sort === null || $sort === '') { $pk = array_values(array_filter($safe, static fn (array $column): bool => $column['primaryKey'] > 0)); usort($pk, static fn (array $a, array $b): int => $a['primaryKey'] <=> $b['primaryKey']); $sort = $pk[0]['name'] ?? $names[0]; }
        if (!in_array($sort, $names, true)) throw new HubDatabaseStudioException('Sort column is invalid', 'DATABASE_REQUEST_INVALID'); $direction = strtoupper($direction); if (!in_array($direction, ['ASC', 'DESC'], true)) throw new HubDatabaseStudioException('Sort direction is invalid', 'DATABASE_REQUEST_INVALID'); return [$sort, $direction];
    }

    private function countRows(string $table, array $columns, ?string $search): int { [$where, $params] = $this->searchClause($columns, $search); $q = $this->pdo->prepare('SELECT COUNT(*) FROM ' . self::quoteIdentifier($table) . $where); $q->execute($params); return (int) $q->fetchColumn(); }
    private function readRows(string $table, array $columns, ?string $search, string $sort, string $direction, int $limit, int $offset): array
    {
        $select = []; foreach ($columns as $column) $select[] = $column['redacted'] ? 'NULL AS ' . self::quoteIdentifier($column['name']) : self::quoteIdentifier($column['name']); [$where, $params] = $this->searchClause($columns, $search);
        $sql = 'SELECT ' . implode(', ', $select) . ' FROM ' . self::quoteIdentifier($table) . $where . ' ORDER BY ' . self::quoteIdentifier($sort) . ' ' . $direction . ' LIMIT :limit OFFSET :offset'; $q = $this->pdo->prepare($sql); foreach ($params as $key => $value) $q->bindValue($key, $value, PDO::PARAM_STR); $q->bindValue(':limit', $limit, PDO::PARAM_INT); $q->bindValue(':offset', $offset, PDO::PARAM_INT); $q->execute();
        $redacted = array_column(array_filter($columns, static fn (array $column): bool => $column['redacted']), 'name'); $rows = []; foreach ($q->fetchAll() as $row) { foreach ($redacted as $name) $row[$name] = '[ซ่อนข้อมูลอ่อนไหว]'; $rows[] = $this->normalizeRow($row); } return $rows;
    }
    private function searchClause(array $columns, ?string $search): array
    {
        if ($search === null || $search === '') return ['', []]; $parts = []; foreach ($columns as $column) if (!$column['redacted'] && stripos($column['type'], 'BLOB') === false) $parts[] = 'instr(lower(CAST(' . self::quoteIdentifier($column['name']) . ' AS TEXT)), lower(:needle)) > 0'; return $parts === [] ? ['', []] : [' WHERE (' . implode(' OR ', $parts) . ')', [':needle' => $search]];
    }

    private function validatedSelect(string $sql): string
    {
        $sql = trim($sql); if ($sql === '' || strlen($sql) > self::MAX_SQL_BYTES || preg_match('/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/', $sql)) throw new HubDatabaseStudioException('SQL is invalid', 'DATABASE_QUERY_REJECTED'); if (str_ends_with($sql, ';')) $sql = rtrim(substr($sql, 0, -1));
        if ($sql === '' || str_contains($sql, ';') || str_contains($sql, '--') || str_contains($sql, '/*') || str_contains($sql, '*/') || preg_match('/^SELECT\b/is', $sql) !== 1) throw new HubDatabaseStudioException('Only one SELECT statement is allowed', 'DATABASE_QUERY_REJECTED');
        if (preg_match('/\b(?:INSERT|UPDATE|DELETE|REPLACE|CREATE|DROP|ALTER|ATTACH|DETACH|VACUUM|REINDEX|ANALYZE|BEGIN|COMMIT|ROLLBACK|SAVEPOINT|RELEASE|END|PRAGMA|WITH|RECURSIVE|LOAD_EXTENSION|READFILE|WRITEFILE|RANDOMBLOB|ZEROBLOB)\b/i', $sql) || preg_match('/\bCROSS\s+JOIN\b/i', $sql) || substr_count(strtoupper($sql), ' JOIN ') > 4 || preg_match('/\b(?:pragma_|sqlite_dbpage|sqlite_dbdata|sqlite_dbptr|sqlite_stmt|dbstat)\b/i', $sql)) throw new HubDatabaseStudioException('SQL exceeds the safe read-only contract', 'DATABASE_QUERY_REJECTED');
        $normalized = strtolower(str_replace(['"', "'", '`', '[', ']'], '', $sql));
        foreach ($this->protectedObjectNames() as $name) if (preg_match('/(?<![a-z0-9_])' . preg_quote(strtolower($name), '/') . '(?![a-z0-9_])/', $normalized)) throw new HubDatabaseStudioException('SQL references protected data', 'DATABASE_TABLE_RESTRICTED');
        foreach ($this->protectedColumnNames() as $name) if (preg_match('/(?<![a-z0-9_])' . preg_quote(strtolower($name), '/') . '(?![a-z0-9_])/', $normalized)) throw new HubDatabaseStudioException('SQL references a protected column', 'DATABASE_TABLE_RESTRICTED');
        return $sql;
    }
    private function protectedObjectNames(): array { $names = []; foreach ($this->pdo->query("SELECT name FROM sqlite_master WHERE type IN ('table','view') AND name NOT LIKE 'sqlite_%'")->fetchAll() as $row) { $name = (string) $row['name']; if ($this->isSensitiveTable($name)) $names[] = $name; } return $names; }
    private function protectedColumnNames(): array { $names = []; foreach ($this->pdo->query("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")->fetchAll() as $row) { $table = (string) $row['name']; if ($this->isSensitiveTable($table)) continue; foreach ($this->columns($table) as $column) if ($column['redacted']) $names[$column['name']] = true; } return array_keys($names); }
    private function isSensitiveTable(string $name): bool { return preg_match('/(?:password|credential|token|session|pairing|recovery|rate_limit|secret)/i', $name) === 1; }
    private static function isSensitiveColumn(string $name): bool { return preg_match('/(?:password|secret|token|credential|csrf|api[_-]?key|private[_-]?key|(?:^|_)code_hash$|(?:^|_)session_hash$|(?:^|_)metadata_hash$)/i', $name) === 1; }

    private function normalizeRow(array $row): array
    {
        $out = []; foreach ($row as $key => $value) { $name = (string) $key; if (self::isSensitiveColumn($name)) { $out[$name] = '[ซ่อนข้อมูลอ่อนไหว]'; continue; } if (is_string($value)) { if (preg_match('//u', $value) !== 1 || preg_match('/[\x00-\x08\x0b\x0c\x0e-\x1f]/', $value)) $out[$name] = '[binary ' . strlen($value) . ' bytes]'; else $out[$name] = strlen($value) > 4000 ? substr($value, 0, 3999) . '…' : $value; } elseif (is_int($value) || is_float($value) || is_bool($value) || $value === null) $out[$name] = $value; else $out[$name] = (string) $value; } return $out;
    }
    private function boundedPragma(string $sql, int $limit): array { $out = []; $q = $this->pdo->query($sql); if (!$q instanceof PDOStatement) return ['unavailable']; while (($value = $q->fetchColumn()) !== false && count($out) < $limit) $out[] = is_scalar($value) ? (string) $value : 'unknown'; return $out; }
    private function backupMetadata(): array
    {
        $root = getenv('AWH_HUB_BACKUP_ROOT'); if (!is_string($root) || $root === '' || !is_dir($root) || is_link($root)) return ['configured' => false, 'latest' => null]; $candidates = glob(rtrim($root, DIRECTORY_SEPARATOR) . DIRECTORY_SEPARATOR . '*'); if (!is_array($candidates)) return ['configured' => true, 'latest' => null]; $latestPath = null; $latestAt = 0;
        foreach ($candidates as $path) { if (!is_file($path) || is_link($path)) continue; $time = (int) (@filemtime($path) ?: 0); if ($time > $latestAt) { $latestAt = $time; $latestPath = $path; } } if ($latestPath === null) return ['configured' => true, 'latest' => null]; return ['configured' => true, 'latest' => ['name' => basename($latestPath), 'sizeBytes' => (int) (@filesize($latestPath) ?: 0), 'modifiedAt' => gmdate('c', $latestAt)]];
    }
    private function preferredTimeColumn(array $columns): string { $safe = array_values(array_filter($columns, static fn (array $column): bool => !$column['redacted'])); $names = array_column($safe, 'name'); foreach (['occurred_at', 'created_at', 'updated_at', 'applied_at'] as $candidate) if (in_array($candidate, $names, true)) return $candidate; if ($names === []) throw new HubDatabaseStudioException('Audit table is protected', 'DATABASE_TABLE_RESTRICTED'); return $names[0]; }
    private static function searchText(?string $value): ?string { if ($value === null) return null; $value = trim($value); if ($value === '') return null; if (strlen($value) > 160 || preg_match('/[\x00-\x1f\x7f]/', $value)) throw new HubDatabaseStudioException('Search text is invalid', 'DATABASE_REQUEST_INVALID'); return $value; }
    private static function exportScalar(mixed $value): string|int|float|null { if ($value === null || is_string($value) || is_int($value) || is_float($value)) return $value; if (is_bool($value)) return $value ? 1 : 0; return (string) $value; }
    private static function quoteIdentifier(string $identifier): string { return '[' . $identifier . ']'; }
    private static function tableExists(PDO $pdo, string $table): bool { $q = $pdo->prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = :name"); $q->execute(['name' => $table]); return $q->fetchColumn() !== false; }
}
