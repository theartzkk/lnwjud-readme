<?php

declare(strict_types=1);

final class HubEnrollmentException extends RuntimeException
{
    public function __construct(string $message, public readonly string $codeName = 'ENROLLMENT_FAILED')
    {
        parent::__construct($message);
    }
}

/** Local/server domain service. It is not wired to the browser read gateway. */
final class HubEnrollmentService
{
    private const UUID = '/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i';
    private const CODE = '/^[A-Za-z0-9_-]{32,128}$/';
    private const SHA256 = '/^[0-9a-f]{64}$/i';
    private const TTL_SECONDS = 600;
    private const TOKEN_TTL_SECONDS = 2592000;

    private function __construct(private readonly PDO $pdo)
    {
    }

    public static function open(string $databasePath, string $schemaPath): self
    {
        if ($databasePath === '' || str_contains($databasePath, "\0")) {
            throw new HubEnrollmentException('Enrollment database configuration is invalid', 'DATABASE_CONFIG_INVALID');
        }
        try {
            $pdo = new PDO('sqlite:' . $databasePath, null, null, [
                PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
                PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
                PDO::ATTR_EMULATE_PREPARES => false,
            ]);
            $pdo->exec('PRAGMA foreign_keys = ON');
            $pdo->exec('PRAGMA busy_timeout = 2500');
            $schema = @file_get_contents($schemaPath);
            if (!is_string($schema) || $schema === '') throw new RuntimeException('schema unavailable');
            $pdo->exec($schema);
        } catch (Throwable) {
            throw new HubEnrollmentException('Enrollment storage is unavailable', 'DATABASE_UNAVAILABLE');
        }
        return new self($pdo);
    }

    public function initializeOwner(string $userId, string $displayName, array $projectIds, ?string $now = null): array
    {
        $userId = self::uuid($userId, 'userId');
        $displayName = self::portableText($displayName, 'displayName', 80);
        $now = self::timestamp($now ?? gmdate('c'), 'now');
        $projects = array_values(array_unique(array_map(fn (mixed $id): string => self::uuid((string) $id, 'projectId'), $projectIds)));
        try {
            $this->pdo->beginTransaction();
            if ((int) $this->pdo->query('SELECT COUNT(*) FROM owner_bootstrap')->fetchColumn() !== 0) {
                throw new HubEnrollmentException('Owner bootstrap is already closed', 'BOOTSTRAP_CLOSED');
            }
            $user = $this->pdo->prepare('INSERT INTO hub_users(user_id, display_name, created_at, revoked_at) VALUES(:id, :name, :created, NULL)');
            $user->execute(['id' => $userId, 'name' => $displayName, 'created' => $now]);
            foreach ($projects as $projectId) {
                $this->assertProjectExists($projectId);
                $membership = $this->pdo->prepare('INSERT INTO user_project_memberships(user_id, project_id, role, created_at, revoked_at) VALUES(:user, :project, \'owner\', :created, NULL)');
                $membership->execute(['user' => $userId, 'project' => $projectId, 'created' => $now]);
            }
            $bootstrap = $this->pdo->prepare('INSERT INTO owner_bootstrap(singleton_id, owner_user_id, initialized_at, bootstrap_closed) VALUES(1, :user, :at, 1)');
            $bootstrap->execute(['user' => $userId, 'at' => $now]);
            $this->pdo->commit();
        } catch (HubEnrollmentException $error) {
            if ($this->pdo->inTransaction()) $this->pdo->rollBack();
            throw $error;
        } catch (Throwable) {
            if ($this->pdo->inTransaction()) $this->pdo->rollBack();
            throw new HubEnrollmentException('Owner bootstrap failed closed', 'BOOTSTRAP_FAILED');
        }
        return ['schemaVersion' => 1, 'userId' => $userId, 'displayName' => $displayName, 'initializedAt' => $now, 'bootstrapClosed' => true];
    }

    public function issuePairingCode(string $ownerUserId, array $projectIds, ?string $now = null, int $ttlSeconds = self::TTL_SECONDS): array
    {
        $ownerUserId = self::uuid($ownerUserId, 'userId');
        $now = self::timestamp($now ?? gmdate('c'), 'now');
        if ($ttlSeconds < 1 || $ttlSeconds > 900) throw new HubEnrollmentException('Pairing expiry is outside the safe bound', 'PAIRING_TTL_INVALID');
        $this->assertOwner($ownerUserId);
        $projects = array_values(array_unique(array_map(fn (mixed $id): string => self::uuid((string) $id, 'projectId'), $projectIds)));
        foreach ($projects as $projectId) $this->assertOwnerProject($ownerUserId, $projectId);
        $code = self::base64url(random_bytes(24));
        $codeId = self::uuid(strtolower(sprintf('%08x-%04x-4%03x-%04x-%012x', random_int(0, 0xffffffff), random_int(0, 0xffff), random_int(0, 0xfff), random_int(0x8000, 0xbfff), random_int(0, 0xffffffffffff))), 'pairingCodeId');
        $expires = gmdate('c', strtotime($now) + $ttlSeconds);
        try {
            $this->pdo->beginTransaction();
            $insert = $this->pdo->prepare('INSERT INTO pairing_codes(pairing_code_id, user_id, code_hash, issued_at, expires_at, consumed_at, revoked_at) VALUES(:id, :user, :hash, :issued, :expires, NULL, NULL)');
            $insert->execute(['id' => $codeId, 'user' => $ownerUserId, 'hash' => hash('sha256', $code), 'issued' => $now, 'expires' => $expires]);
            $link = $this->pdo->prepare('INSERT INTO pairing_projects(pairing_code_id, project_id) VALUES(:code, :project)');
            foreach ($projects as $projectId) $link->execute(['code' => $codeId, 'project' => $projectId]);
            $this->pdo->commit();
        } catch (Throwable) {
            if ($this->pdo->inTransaction()) $this->pdo->rollBack();
            throw new HubEnrollmentException('Pairing code could not be created', 'PAIRING_CREATE_FAILED');
        }
        return ['schemaVersion' => 1, 'pairingCode' => $code, 'pairingCodeId' => $codeId, 'issuedAt' => $now, 'expiresAt' => $expires, 'projectCount' => count($projects)];
    }

    public function enrollDevice(array $request, ?string $now = null): array
    {
        self::exactKeys($request, ['appVersion', 'arch', 'deviceId', 'displayName', 'pairingCode', 'platform', 'schemaVersion']);
        if (($request['schemaVersion'] ?? null) !== 1) throw new HubEnrollmentException('Unsupported enrollment schema', 'SCHEMA_VERSION');
        $code = self::text($request['pairingCode'] ?? null, 'pairingCode', 128);
        if (!preg_match(self::CODE, $code)) throw new HubEnrollmentException('Pairing code is malformed', 'PAIRING_CODE_INVALID');
        $deviceId = self::uuid((string) ($request['deviceId'] ?? ''), 'deviceId');
        $display = self::portableText((string) ($request['displayName'] ?? ''), 'displayName', 80);
        $platform = self::text($request['platform'] ?? null, 'platform', 16);
        if (!in_array($platform, ['darwin', 'win32', 'linux'], true)) throw new HubEnrollmentException('Platform is unsupported', 'FIELD_INVALID');
        $arch = self::text($request['arch'] ?? null, 'arch', 32);
        $appVersion = self::text($request['appVersion'] ?? null, 'appVersion', 32);
        $now = self::timestamp($now ?? gmdate('c'), 'now');
        $pairing = $this->pdo->prepare('SELECT pairing_code_id, user_id, expires_at, consumed_at, revoked_at FROM pairing_codes WHERE code_hash = :hash');
        $pairing->execute(['hash' => hash('sha256', $code)]);
        $record = $pairing->fetch();
        if (!is_array($record)) throw new HubEnrollmentException('Pairing code is invalid', 'PAIRING_CODE_INVALID');
        if ($record['revoked_at'] !== null) throw new HubEnrollmentException('Pairing code is revoked', 'PAIRING_REVOKED');
        if ($record['consumed_at'] !== null) throw new HubEnrollmentException('Pairing code was already used', 'PAIRING_REPLAY');
        if (strtotime((string) $record['expires_at']) <= strtotime($now)) throw new HubEnrollmentException('Pairing code has expired', 'PAIRING_EXPIRED');
        if ($this->deviceExists($deviceId)) throw new HubEnrollmentException('Device is already enrolled', 'DEVICE_DUPLICATE');
        $projects = $this->pdo->prepare('SELECT project_id FROM pairing_projects WHERE pairing_code_id = :id ORDER BY project_id');
        $projects->execute(['id' => $record['pairing_code_id']]);
        $projectIds = array_map(static fn (array $row): string => (string) $row['project_id'], $projects->fetchAll());
        $tokenId = self::uuid(strtolower(sprintf('%08x-%04x-4%03x-%04x-%012x', random_int(0, 0xffffffff), random_int(0, 0xffff), random_int(0, 0xfff), random_int(0x8000, 0xbfff), random_int(0, 0xffffffffffff))), 'tokenId');
        $token = self::base64url(random_bytes(32));
        $expires = gmdate('c', strtotime($now) + self::TOKEN_TTL_SECONDS);
        try {
            $this->pdo->beginTransaction();
            $device = $this->pdo->prepare('INSERT INTO devices(device_id, display_name, platform, arch, app_version, last_seen_at, revoked_at) VALUES(:id, :name, :platform, :arch, :version, :last, NULL)');
            $device->execute(['id' => $deviceId, 'name' => $display, 'platform' => $platform, 'arch' => $arch, 'version' => $appVersion, 'last' => $now]);
            $enrollment = $this->pdo->prepare('INSERT INTO device_enrollments(device_id, user_id, enrolled_at, revoked_at) VALUES(:device, :user, :at, NULL)');
            $enrollment->execute(['device' => $deviceId, 'user' => $record['user_id'], 'at' => $now]);
            $membership = $this->pdo->prepare('INSERT INTO device_project_memberships(device_id, project_id, role, created_at, revoked_at) VALUES(:device, :project, \'member\', :at, NULL)');
            foreach ($projectIds as $projectId) $membership->execute(['device' => $deviceId, 'project' => $projectId, 'at' => $now]);
            $tokenInsert = $this->pdo->prepare('INSERT INTO device_tokens(token_id, user_id, device_id, token_hash, created_at, expires_at, revoked_at, last_used_at, rotated_from_token_id, replaced_by_token_id) VALUES(:id, :user, :device, :hash, :created, :expires, NULL, NULL, NULL, NULL)');
            $tokenInsert->execute(['id' => $tokenId, 'user' => $record['user_id'], 'device' => $deviceId, 'hash' => hash('sha256', $token), 'created' => $now, 'expires' => $expires]);
            $consume = $this->pdo->prepare('UPDATE pairing_codes SET consumed_at = :at WHERE pairing_code_id = :id AND consumed_at IS NULL');
            $consume->execute(['at' => $now, 'id' => $record['pairing_code_id']]);
            if ($consume->rowCount() !== 1) throw new RuntimeException('pairing race');
            $this->pdo->commit();
        } catch (HubEnrollmentException $error) {
            if ($this->pdo->inTransaction()) $this->pdo->rollBack();
            throw $error;
        } catch (Throwable) {
            if ($this->pdo->inTransaction()) $this->pdo->rollBack();
            throw new HubEnrollmentException('Device enrollment failed closed', 'ENROLLMENT_FAILED');
        }
        return ['schemaVersion' => 1, 'deviceId' => $deviceId, 'userId' => (string) $record['user_id'], 'accessToken' => $token, 'expiresAt' => $expires, 'tokenType' => 'Bearer', 'projectCount' => count($projectIds)];
    }

    public function rotateToken(string $presentedToken, string $deviceId, ?string $now = null): array
    {
        $auth = $this->authenticate($presentedToken, $deviceId, $now);
        $now = self::timestamp($now ?? gmdate('c'), 'now');
        $newId = self::uuid(strtolower(sprintf('%08x-%04x-4%03x-%04x-%012x', random_int(0, 0xffffffff), random_int(0, 0xffff), random_int(0, 0xfff), random_int(0x8000, 0xbfff), random_int(0, 0xffffffffffff))), 'tokenId');
        $token = self::base64url(random_bytes(32));
        $expires = gmdate('c', strtotime($now) + self::TOKEN_TTL_SECONDS);
        $this->pdo->beginTransaction();
        try {
            $this->pdo->prepare('UPDATE device_tokens SET revoked_at = :at, replaced_by_token_id = :new WHERE token_id = :old')->execute(['at' => $now, 'new' => $newId, 'old' => $auth['token_id']]);
            $this->pdo->prepare('INSERT INTO device_tokens(token_id, user_id, device_id, token_hash, created_at, expires_at, revoked_at, last_used_at, rotated_from_token_id, replaced_by_token_id) VALUES(:id, :user, :device, :hash, :created, :expires, NULL, NULL, :old, NULL)')->execute(['id' => $newId, 'user' => $auth['user_id'], 'device' => $deviceId, 'hash' => hash('sha256', $token), 'created' => $now, 'expires' => $expires, 'old' => $auth['token_id']]);
            $this->pdo->commit();
        } catch (Throwable) {
            if ($this->pdo->inTransaction()) $this->pdo->rollBack();
            throw new HubEnrollmentException('Token rotation failed closed', 'TOKEN_ROTATION_FAILED');
        }
        return ['schemaVersion' => 1, 'deviceId' => $deviceId, 'accessToken' => $token, 'expiresAt' => $expires, 'tokenType' => 'Bearer'];
    }

    public function revokeToken(string $presentedToken, string $deviceId, ?string $now = null): void
    {
        $auth = $this->authenticate($presentedToken, $deviceId, $now);
        $this->pdo->prepare('UPDATE device_tokens SET revoked_at = :at WHERE token_id = :id AND revoked_at IS NULL')->execute(['at' => self::timestamp($now ?? gmdate('c'), 'now'), 'id' => $auth['token_id']]);
    }

    public function assertProjectAccess(string $presentedToken, string $projectId, ?string $now = null): array
    {
        $projectId = self::uuid($projectId, 'projectId');
        $auth = $this->authenticate($presentedToken, null, $now);
        $query = $this->pdo->prepare('SELECT 1 FROM device_project_memberships WHERE device_id = :device AND project_id = :project AND revoked_at IS NULL');
        $query->execute(['device' => $auth['device_id'], 'project' => $projectId]);
        if ($query->fetchColumn() === false) throw new HubEnrollmentException('Device is not authorized for this project', 'PROJECT_FORBIDDEN');
        return ['userId' => $auth['user_id'], 'deviceId' => $auth['device_id'], 'projectId' => $projectId];
    }

    private function authenticate(string $token, ?string $deviceId, ?string $now): array
    {
        if ($token === '' || strlen($token) > 512 || preg_match('/[\x00-\x1F\x7F]/', $token)) throw new HubEnrollmentException('Device credential is invalid', 'TOKEN_INVALID');
        if ($deviceId !== null) $deviceId = self::uuid($deviceId, 'deviceId');
        $query = $this->pdo->prepare('SELECT t.token_id, t.user_id, t.device_id, t.expires_at, t.revoked_at, e.revoked_at AS enrollment_revoked, u.revoked_at AS user_revoked FROM device_tokens t JOIN device_enrollments e ON e.device_id = t.device_id JOIN hub_users u ON u.user_id = t.user_id WHERE t.token_hash = :hash');
        $query->execute(['hash' => hash('sha256', $token)]);
        $row = $query->fetch();
        $at = strtotime(self::timestamp($now ?? gmdate('c'), 'now'));
        if (!is_array($row) || ($deviceId !== null && $row['device_id'] !== $deviceId) || $row['revoked_at'] !== null || $row['enrollment_revoked'] !== null || $row['user_revoked'] !== null || strtotime((string) $row['expires_at']) <= $at) throw new HubEnrollmentException('Device credential is not active', 'TOKEN_REJECTED');
        $this->pdo->prepare('UPDATE device_tokens SET last_used_at = :at WHERE token_id = :id')->execute(['at' => gmdate('c', $at), 'id' => $row['token_id']]);
        return $row;
    }

    private function assertOwner(string $userId): void
    {
        $query = $this->pdo->prepare('SELECT 1 FROM owner_bootstrap WHERE singleton_id = 1 AND owner_user_id = :user');
        $query->execute(['user' => $userId]);
        if ($query->fetchColumn() === false) throw new HubEnrollmentException('Owner bootstrap is not valid', 'BOOTSTRAP_INVALID');
    }

    private function assertProjectExists(string $projectId): void
    {
        $query = $this->pdo->prepare('SELECT 1 FROM projects WHERE project_id = :id');
        $query->execute(['id' => $projectId]);
        if ($query->fetchColumn() === false) throw new HubEnrollmentException('Project is not indexed', 'PROJECT_NOT_FOUND');
    }

    private function assertOwnerProject(string $userId, string $projectId): void
    {
        $query = $this->pdo->prepare('SELECT 1 FROM user_project_memberships WHERE user_id = :user AND project_id = :project AND revoked_at IS NULL');
        $query->execute(['user' => $userId, 'project' => $projectId]);
        if ($query->fetchColumn() === false) throw new HubEnrollmentException('Owner is not authorized for this project', 'PROJECT_FORBIDDEN');
    }

    private function deviceExists(string $deviceId): bool
    {
        $query = $this->pdo->prepare('SELECT 1 FROM devices WHERE device_id = :id');
        $query->execute(['id' => $deviceId]);
        return $query->fetchColumn() !== false;
    }

    private static function exactKeys(array $value, array $keys): void
    {
        $actual = array_keys($value);
        sort($actual); $expected = $keys; sort($expected);
        if ($actual !== $expected) throw new HubEnrollmentException('Enrollment payload contains unsupported fields', 'SCHEMA_FIELDS');
    }

    private static function uuid(string $value, string $field): string
    {
        if (!preg_match(self::UUID, $value)) throw new HubEnrollmentException($field . ' is invalid', 'ID_INVALID');
        return strtolower($value);
    }

    private static function text(mixed $value, string $field, int $max): string
    {
        if (!is_string($value) || $value === '' || strlen($value) > $max || preg_match('/[\x00-\x1F\x7F]/', $value)) throw new HubEnrollmentException($field . ' is invalid', 'FIELD_INVALID');
        return $value;
    }

    private static function portableText(string $value, string $field, int $max): string
    {
        $value = trim(self::text($value, $field, $max));
        if ($value === '' || str_contains($value, '/') || str_contains($value, '\\') || preg_match('#^(?:[A-Za-z]:|~|https?://)#i', $value)) throw new HubEnrollmentException($field . ' is not portable', 'PORTABILITY_INVALID');
        return $value;
    }

    private static function timestamp(string $value, string $field): string
    {
        if (strtotime($value) === false) throw new HubEnrollmentException($field . ' is invalid', 'DATE_INVALID');
        return $value;
    }

    private static function base64url(string $bytes): string
    {
        return rtrim(strtr(base64_encode($bytes), '+/', '-_'), '=');
    }
}
