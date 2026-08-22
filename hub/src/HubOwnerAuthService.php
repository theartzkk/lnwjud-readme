<?php

declare(strict_types=1);

require_once __DIR__ . '/HubOwnerAuthMigration.php';

final class HubOwnerAuthException extends RuntimeException
{
    public function __construct(string $message, public readonly string $codeName = 'AUTH_FAILED') { parent::__construct($message); }
}

/** Username/password owner access over the canonical M4 control session tables. */
final class HubOwnerAuthService
{
    private const USERNAME = '/^[a-z][a-z0-9._-]{2,63}$/';
    private const SESSION_TTL = 28800;
    private const REMEMBER_TTL = 2592000;
    private const INACTIVITY_TTL = 43200;
    private const RATE_WINDOW = 600;
    private const RATE_MAX = 5;

    private function __construct(private readonly PDO $pdo) {}

    public static function openExisting(string $databasePath, ?string $migrationSqlPath = null): self
    {
        try {
            $pdo = new PDO('sqlite:' . $databasePath, null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC, PDO::ATTR_EMULATE_PREPARES => false]);
            $pdo->exec('PRAGMA foreign_keys = ON'); $pdo->exec('PRAGMA busy_timeout = 2500');
            $migrationSqlPath ??= dirname(__DIR__) . '/migrations/004_owner_auth.sql';
            HubOwnerAuthMigration::assertCapabilityReady($pdo, $migrationSqlPath);
            return new self($pdo);
        } catch (HubOwnerAuthMigrationException $error) { throw new HubOwnerAuthException('Owner authentication is not ready', $error->codeName); }
        catch (Throwable) { throw new HubOwnerAuthException('Owner authentication is unavailable', 'AUTH_UNAVAILABLE'); }
    }

    /** Provision exactly one username/password binding for the existing owner identity. */
    public function provisionInitial(string $username, string $password, ?string $now = null): array
    {
        $username = self::username($username); self::password($password); $now = self::timestamp($now ?? gmdate('c'));
        $owner = $this->pdo->query('SELECT owner_user_id FROM owner_bootstrap WHERE singleton_id = 1 AND bootstrap_closed = 1')->fetchColumn();
        if (!is_string($owner)) throw new HubOwnerAuthException('Owner identity is unavailable', 'OWNER_NOT_READY');
        $ownerCheck = $this->pdo->prepare('SELECT user_id FROM hub_users WHERE user_id = :user AND revoked_at IS NULL'); $ownerCheck->execute(['user' => $owner]);
        if ($ownerCheck->fetchColumn() !== $owner) throw new HubOwnerAuthException('Owner identity is unavailable', 'OWNER_NOT_READY');
        try {
            $this->pdo->beginTransaction();
            if ((int) $this->pdo->query('SELECT COUNT(*) FROM owner_passwords')->fetchColumn() !== 0) throw new HubOwnerAuthException('Owner password is already provisioned', 'AUTH_ALREADY_PROVISIONED');
            $hash = self::hashPassword($password);
            $this->pdo->prepare('INSERT INTO owner_passwords(user_id, username, password_hash, password_changed_at, enabled) VALUES(:user, :username, :hash, :at, 1)')->execute(['user' => $owner, 'username' => $username, 'hash' => $hash, 'at' => $now]);
            $codes = $this->createRecoveryCodes((string) $owner, $now);
            $this->audit((string) $owner, 'owner_auth_provisioned', $now);
            $this->pdo->commit();
            return ['userId' => $owner, 'username' => $username, 'recoveryCodes' => $codes];
        } catch (Throwable $error) {
            if ($this->pdo->inTransaction()) $this->pdo->rollBack();
            if ($error instanceof HubOwnerAuthException) throw $error;
            throw new HubOwnerAuthException('Owner authentication setup failed', 'AUTH_PROVISION_FAILED');
        }
    }

    public function login(string $username, string $password, bool $remember, string $rateKey, ?string $now = null): array
    {
        $now = self::timestamp($now ?? gmdate('c')); $at = strtotime($now); $normalized = strtolower(trim($username)); $rateKey = self::rateKey($rateKey, $normalized);
        $this->assertRate($rateKey, $now);
        try { $normalized = self::username($username); } catch (HubOwnerAuthException) { $this->failedRate($rateKey, $now); throw new HubOwnerAuthException('Username or password is incorrect', 'AUTH_FAILED'); }
        $q = $this->pdo->prepare('SELECT user_id, username, password_hash, enabled FROM owner_passwords WHERE username = :username'); $q->execute(['username' => $normalized]); $record = $q->fetch();
        $hash = is_array($record) && is_string($record['password_hash']) ? $record['password_hash'] : self::dummyHash();
        if (!is_array($record) || (int) $record['enabled'] !== 1 || !password_verify($password, $hash)) { $this->failedRate($rateKey, $now); throw new HubOwnerAuthException('Username or password is incorrect', 'AUTH_FAILED'); }
        $this->clearRate($rateKey); $session = self::randomToken(); $csrf = self::randomToken(24); $expires = gmdate('c', $at + ($remember ? self::REMEMBER_TTL : self::SESSION_TTL));
        $id = self::uuid();
        $this->pdo->prepare("INSERT INTO control_sessions(session_id, session_hash, user_id, device_id, csrf_hash, created_at, expires_at, last_seen_at, revoked_at, session_kind, remembered_until, step_up_at) VALUES(:id, :hash, :user, NULL, :csrf, :created, :expires, :last, NULL, 'password', :remembered, NULL)")->execute(['id' => $id, 'hash' => hash('sha256', $session), 'user' => $record['user_id'], 'csrf' => hash('sha256', $csrf), 'created' => $now, 'expires' => $expires, 'last' => $now, 'remembered' => $remember ? $expires : null]);
        $this->audit((string) $record['user_id'], 'login_success', $now);
        return ['sessionToken' => $session, 'csrfToken' => $csrf, 'expiresAt' => $expires, 'userId' => (string) $record['user_id'], 'remembered' => $remember];
    }

    public function session(string $token, ?string $now = null): array
    {
        $row = $this->sessionRow($token, $now); $now = self::timestamp($now ?? gmdate('c')); $csrf = self::randomToken(24);
        $this->pdo->prepare('UPDATE control_sessions SET csrf_hash = :csrf, last_seen_at = :at WHERE session_id = :id')->execute(['csrf' => hash('sha256', $csrf), 'at' => $now, 'id' => $row['session_id']]);
        return ['userId' => (string) $row['user_id'], 'expiresAt' => (string) $row['expires_at'], 'csrfToken' => $csrf, 'remembered' => $row['remembered_until'] !== null];
    }

    public function logout(string $token): void { $row = $this->sessionRow($token); $this->pdo->prepare('UPDATE control_sessions SET revoked_at = :at WHERE session_id = :id')->execute(['at' => gmdate('c'), 'id' => $row['session_id']]); $this->audit((string) $row['user_id'], 'logout', gmdate('c')); }
    public function logoutAll(string $token): void { $row = $this->sessionRow($token); $this->pdo->prepare('UPDATE control_sessions SET revoked_at = :at WHERE user_id = :user AND revoked_at IS NULL')->execute(['at' => gmdate('c'), 'user' => $row['user_id']]); $this->audit((string) $row['user_id'], 'logout_all', gmdate('c')); }
    public function sessions(string $token): array { $row = $this->sessionRow($token); $q = $this->pdo->prepare("SELECT session_id, created_at, expires_at, last_seen_at, remembered_until FROM control_sessions WHERE user_id = :user AND session_kind = 'password' AND revoked_at IS NULL ORDER BY last_seen_at DESC LIMIT 20"); $q->execute(['user' => $row['user_id']]); return ['schemaVersion' => 1, 'sessions' => array_map(static fn (array $item): array => ['sessionId' => (string) $item['session_id'], 'createdAt' => (string) $item['created_at'], 'expiresAt' => (string) $item['expires_at'], 'lastSeenAt' => (string) $item['last_seen_at'], 'remembered' => $item['remembered_until'] !== null, 'current' => (string) $item['session_id'] === (string) $row['session_id']], $q->fetchAll())]; }
    public function revokeSession(string $token, string $csrf, string $sessionId): void { $row = $this->authorize($token, $csrf); if (!self::isUuid($sessionId)) throw new HubOwnerAuthException('Session is invalid', 'SESSION_INVALID'); $at = gmdate('c'); $q = $this->pdo->prepare("UPDATE control_sessions SET revoked_at = :at WHERE session_id = :id AND user_id = :user AND session_kind = 'password' AND revoked_at IS NULL"); $q->execute(['at' => $at, 'id' => strtolower($sessionId), 'user' => $row['user_id']]); if ($q->rowCount() !== 1) throw new HubOwnerAuthException('Session was not found', 'SESSION_NOT_FOUND'); $this->audit((string) $row['user_id'], 'session_revoked', $at); }

    public function changePassword(string $token, string $csrf, string $oldPassword, string $newPassword): void
    {
        $row = $this->authorize($token, $csrf); self::password($newPassword); $q = $this->pdo->prepare('SELECT password_hash FROM owner_passwords WHERE user_id = :user AND enabled = 1'); $q->execute(['user' => $row['user_id']]); $hash = $q->fetchColumn();
        if (!is_string($hash) || !password_verify($oldPassword, $hash)) throw new HubOwnerAuthException('Current password is incorrect', 'AUTH_FAILED');
        $now = gmdate('c'); $this->pdo->prepare('UPDATE owner_passwords SET password_hash = :hash, password_changed_at = :at WHERE user_id = :user')->execute(['hash' => self::hashPassword($newPassword), 'at' => $now, 'user' => $row['user_id']]); $this->pdo->prepare('UPDATE control_sessions SET revoked_at = :at WHERE user_id = :user AND revoked_at IS NULL')->execute(['at' => $now, 'user' => $row['user_id']]); $this->audit((string) $row['user_id'], 'password_changed', $now);
    }

    public function createRecoveryCodesForSession(string $token, string $csrf): array { $row = $this->authorize($token, $csrf); return $this->createRecoveryCodes((string) $row['user_id'], gmdate('c')); }

    public function recover(string $username, string $recoveryCode, string $newPassword, ?string $now = null, ?string $rateKey = null): void
    {
        self::password($newPassword); $now = self::timestamp($now ?? gmdate('c')); $rateKey = self::rateKey($rateKey ?? '', strtolower(trim($username))); $this->assertRate($rateKey, $now);
        try { $username = self::username($username); } catch (HubOwnerAuthException) { $this->failedRate($rateKey, $now); throw new HubOwnerAuthException('Recovery could not be completed', 'RECOVERY_FAILED'); }
        $q = $this->pdo->prepare('SELECT user_id FROM owner_passwords WHERE username = :username AND enabled = 1'); $q->execute(['username' => strtolower($username)]); $user = $q->fetchColumn();
        if (!is_string($user)) { $this->failedRate($rateKey, $now); throw new HubOwnerAuthException('Recovery could not be completed', 'RECOVERY_FAILED'); }
        $codes = $this->pdo->prepare('SELECT recovery_code_id, code_hash FROM auth_recovery_codes WHERE user_id = :user AND used_at IS NULL'); $codes->execute(['user' => $user]); $match = null; foreach ($codes->fetchAll() as $code) if (password_verify($recoveryCode, (string) $code['code_hash'])) { $match = $code['recovery_code_id']; break; }
        if (!is_string($match)) { $this->failedRate($rateKey, $now); throw new HubOwnerAuthException('Recovery could not be completed', 'RECOVERY_FAILED'); }
        $this->pdo->beginTransaction(); try { $this->pdo->prepare('UPDATE auth_recovery_codes SET used_at = :at WHERE recovery_code_id = :id AND used_at IS NULL')->execute(['at' => $now, 'id' => $match]); if ((int) $this->pdo->query('SELECT changes()')->fetchColumn() !== 1) throw new RuntimeException('recovery race'); $this->pdo->prepare('UPDATE owner_passwords SET password_hash = :hash, password_changed_at = :at WHERE user_id = :user')->execute(['hash' => self::hashPassword($newPassword), 'at' => $now, 'user' => $user]); $this->pdo->prepare('UPDATE control_sessions SET revoked_at = :at WHERE user_id = :user AND revoked_at IS NULL')->execute(['at' => $now, 'user' => $user]); $this->audit((string) $user, 'recovery_used', $now); $this->pdo->commit(); $this->clearRate($rateKey); } catch (Throwable) { if ($this->pdo->inTransaction()) $this->pdo->rollBack(); throw new HubOwnerAuthException('Recovery could not be completed', 'RECOVERY_FAILED'); }
    }

    public function stepUp(string $token, string $csrf, string $password): array { $row = $this->authorize($token, $csrf); $q = $this->pdo->prepare('SELECT password_hash FROM owner_passwords WHERE user_id = :user AND enabled = 1'); $q->execute(['user' => $row['user_id']]); $hash = $q->fetchColumn(); if (!is_string($hash) || !password_verify($password, $hash)) throw new HubOwnerAuthException('Authentication is required', 'STEP_UP_REQUIRED'); $at = gmdate('c'); $this->pdo->prepare('UPDATE control_sessions SET step_up_at = :at, last_seen_at = :at WHERE session_id = :id')->execute(['at' => $at, 'id' => $row['session_id']]); $this->audit((string) $row['user_id'], 'step_up_success', $at); return ['stepUpUntil' => gmdate('c', strtotime($at) + 900)]; }

    public function authorize(string $token, string $csrf): array { $row = $this->sessionRow($token); if ($csrf === '' || !hash_equals((string) $row['csrf_hash'], hash('sha256', $csrf))) throw new HubOwnerAuthException('Request could not be verified', 'CSRF_REJECTED'); return $row; }

    private function sessionRow(string $token, ?string $now = null): array { if ($token === '' || strlen($token) > 512 || preg_match('/[\x00-\x1F\x7F]/', $token)) throw new HubOwnerAuthException('Session is invalid', 'SESSION_INVALID'); $q = $this->pdo->prepare("SELECT * FROM control_sessions WHERE session_hash = :hash AND session_kind = 'password'"); $q->execute(['hash' => hash('sha256', $token)]); $row = $q->fetch(); $at = strtotime(self::timestamp($now ?? gmdate('c'))); $inactivity = is_array($row) && $row['remembered_until'] !== null ? self::REMEMBER_TTL : self::INACTIVITY_TTL; if (!is_array($row) || $row['revoked_at'] !== null || strtotime((string) $row['expires_at']) <= $at || strtotime((string) $row['last_seen_at']) + $inactivity <= $at) throw new HubOwnerAuthException('Session is expired', 'SESSION_EXPIRED'); return $row; }
    private function assertRate(string $key, string $now): void { $q = $this->pdo->prepare('SELECT window_started_at, attempts, blocked_until FROM auth_login_rate_limits WHERE rate_key = :key'); $q->execute(['key' => $key]); $row = $q->fetch(); if (!is_array($row)) return; $at = strtotime($now); if ($row['blocked_until'] !== null && strtotime((string) $row['blocked_until']) > $at) throw new HubOwnerAuthException('Too many attempts', 'RATE_LIMITED'); if (strtotime((string) $row['window_started_at']) + self::RATE_WINDOW <= $at) $this->clearRate($key); }
    private function failedRate(string $key, string $now): void { $q = $this->pdo->prepare('SELECT attempts, window_started_at FROM auth_login_rate_limits WHERE rate_key = :key'); $q->execute(['key' => $key]); $row = $q->fetch(); $attempts = is_array($row) && strtotime((string) $row['window_started_at']) + self::RATE_WINDOW > strtotime($now) ? (int) $row['attempts'] + 1 : 1; $blocked = $attempts >= self::RATE_MAX ? gmdate('c', strtotime($now) + 900) : null; $this->pdo->prepare('INSERT INTO auth_login_rate_limits(rate_key, window_started_at, attempts, blocked_until) VALUES(:key, :at, :attempts, :blocked) ON CONFLICT(rate_key) DO UPDATE SET window_started_at = excluded.window_started_at, attempts = excluded.attempts, blocked_until = excluded.blocked_until')->execute(['key' => $key, 'at' => is_array($row) && strtotime((string) $row['window_started_at']) + self::RATE_WINDOW > strtotime($now) ? $row['window_started_at'] : $now, 'attempts' => $attempts, 'blocked' => $blocked]); }
    private function clearRate(string $key): void { $this->pdo->prepare('DELETE FROM auth_login_rate_limits WHERE rate_key = :key')->execute(['key' => $key]); }
    private function createRecoveryCodes(string $user, string $now): array { $this->pdo->prepare('DELETE FROM auth_recovery_codes WHERE user_id = :user AND used_at IS NULL')->execute(['user' => $user]); $plain = []; $insert = $this->pdo->prepare('INSERT INTO auth_recovery_codes(recovery_code_id, user_id, code_hash, created_at, used_at) VALUES(:id, :user, :hash, :at, NULL)'); for ($i = 0; $i < 8; $i++) { $code = strtoupper(bin2hex(random_bytes(6))); $plain[] = $code; $insert->execute(['id' => self::uuid(), 'user' => $user, 'hash' => self::hashPassword($code), 'at' => $now]); } return $plain; }
    private function audit(string $user, string $event, string $now): void { $this->pdo->prepare('INSERT INTO auth_audit_events(event_id, user_id, event_name, occurred_at, metadata_hash) VALUES(:id, :user, :event, :at, NULL)')->execute(['id' => self::uuid(), 'user' => $user, 'event' => $event, 'at' => $now]); }
    private static function username(string $value): string { $value = strtolower(trim($value)); if (!preg_match(self::USERNAME, $value)) throw new HubOwnerAuthException('Username is invalid', 'USERNAME_INVALID'); return $value; }
    private static function password(string $value): void { if (strlen($value) < 12 || strlen($value) > 512 || preg_match('/[\x00-\x1F\x7F]/', $value)) throw new HubOwnerAuthException('Password is invalid', 'PASSWORD_INVALID'); }
    private static function hashPassword(string $value): string { return password_hash($value, defined('PASSWORD_ARGON2ID') ? PASSWORD_ARGON2ID : PASSWORD_DEFAULT); }
    private static function dummyHash(): string { static $hash; return $hash ??= self::hashPassword('AWH invalid authentication sentinel'); }
    private static function rateKey(string $value, string $username): string { return hash('sha256', substr($value, 0, 128) . "\n" . $username); }
    private static function timestamp(string $value): string { if (strtotime($value) === false) throw new HubOwnerAuthException('Authentication time is invalid', 'AUTH_TIME_INVALID'); return gmdate('c', strtotime($value)); }
    private static function uuid(): string { $bytes = random_bytes(16); $bytes[6] = chr((ord($bytes[6]) & 15) | 64); $bytes[8] = chr((ord($bytes[8]) & 63) | 128); return vsprintf('%s%s-%s-%s-%s-%s%s%s', str_split(bin2hex($bytes), 4)); }
    private static function isUuid(string $value): bool { return preg_match('/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i', $value) === 1; }
    private static function randomToken(int $bytes = 32): string { return rtrim(strtr(base64_encode(random_bytes($bytes)), '+/', '-_'), '='); }
}
