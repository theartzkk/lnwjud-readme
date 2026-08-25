<?php

declare(strict_types=1);

require_once __DIR__ . '/HubOwnerAuthMigration.php';
require_once __DIR__ . '/HubFinalProductMigration.php';
require_once __DIR__ . '/HubWorkspaceProductMigration.php';

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
    private const RESET_TOKEN_TTL = 900;
    /** Fresh password verification window for account and security changes. */
    private const STEP_UP_TTL = 900;

    private function __construct(private readonly PDO $pdo) {}

    /** Share the canonical owner-auth authority with the control plane. */
    public static function fromPdo(PDO $pdo): self
    {
        return new self($pdo);
    }

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
        $now = self::timestamp($now ?? gmdate('c')); $at = strtotime($now); $identity = strtolower(trim($username)); $rateKey = self::rateKey($rateKey, $identity);
        $this->assertRate($rateKey, $now);
        $emailLogin = filter_var($identity, FILTER_VALIDATE_EMAIL) !== false;
        if (!$emailLogin) { try { $identity = self::username($identity); } catch (HubOwnerAuthException) { $this->failedRate($rateKey, $now); throw new HubOwnerAuthException('Username or password is incorrect', 'AUTH_FAILED'); } }
        if ($this->workspaceSchemaPresent()) {
            $q = $this->pdo->prepare("SELECT p.user_id, p.username, p.password_hash, p.enabled, p.must_change_password, u.email FROM owner_passwords p JOIN control_user_profiles u ON u.user_id = p.user_id WHERE p.username = :identity OR lower(COALESCE(u.email, '')) = :identity LIMIT 2");
        } else {
            $q = $this->pdo->prepare('SELECT user_id, username, password_hash, enabled, 0 AS must_change_password, NULL AS email FROM owner_passwords WHERE username = :identity LIMIT 2');
        }
        $q->execute(['identity' => $identity]); $records = $q->fetchAll(); $record = count($records) === 1 ? $records[0] : null;
        $hash = is_array($record) && is_string($record['password_hash']) ? $record['password_hash'] : self::dummyHash();
        if (!is_array($record) || (int) $record['enabled'] !== 1 || !password_verify($password, $hash)) { $this->failedRate($rateKey, $now); throw new HubOwnerAuthException('Username or password is incorrect', 'AUTH_FAILED'); }
        $profile = $this->finalSchemaPresent() ? $this->profile((string) $record['user_id']) : null;
        if ($this->finalSchemaPresent() && ($profile === null || $profile['status'] !== 'ACTIVE' || ($profile['disabled'] ?? false))) { $this->failedRate($rateKey, $now); throw new HubOwnerAuthException('Username or password is incorrect', 'AUTH_FAILED'); }
        $this->clearRate($rateKey); $session = self::randomToken(); $csrf = self::randomToken(24); $expires = gmdate('c', $at + ($remember ? self::REMEMBER_TTL : self::SESSION_TTL)); $id = self::uuid();
        $this->pdo->prepare("INSERT INTO control_sessions(session_id, session_hash, user_id, device_id, csrf_hash, created_at, expires_at, last_seen_at, revoked_at, session_kind, remembered_until, step_up_at) VALUES(:id, :hash, :user, NULL, :csrf, :created, :expires, :last, NULL, 'password', :remembered, :step_up)")->execute(['id' => $id, 'hash' => hash('sha256', $session), 'user' => $record['user_id'], 'csrf' => hash('sha256', $csrf), 'created' => $now, 'expires' => $expires, 'last' => $now, 'remembered' => $remember ? $expires : null, 'step_up' => $now]);
        if ($this->workspaceSchemaPresent()) $this->pdo->prepare('UPDATE control_user_profiles SET last_login_at = :at WHERE user_id = :user')->execute(['at' => $now, 'user' => $record['user_id']]);
        $this->audit((string) $record['user_id'], 'login_success', $now);
        return ['sessionToken' => $session, 'csrfToken' => $csrf, 'expiresAt' => $expires, 'userId' => (string) $record['user_id'], 'remembered' => $remember, 'role' => $profile['role'] ?? 'OWNER', 'mustChangePassword' => (int) ($record['must_change_password'] ?? 0) === 1];
    }

    public function session(string $token, ?string $now = null): array
    {
        $row = $this->sessionRow($token, $now); $now = self::timestamp($now ?? gmdate('c')); $csrf = self::randomToken(24);
        $this->pdo->prepare('UPDATE control_sessions SET csrf_hash = :csrf, last_seen_at = :at WHERE session_id = :id')->execute(['csrf' => hash('sha256', $csrf), 'at' => $now, 'id' => $row['session_id']]);
        $profile = $this->finalSchemaPresent() ? $this->profile((string) $row['user_id']) : null;
        $flags = $this->passwordFlags((string) $row['user_id']);
        return ['userId' => (string) $row['user_id'], 'expiresAt' => (string) $row['expires_at'], 'csrfToken' => $csrf, 'remembered' => $row['remembered_until'] !== null, 'role' => $profile['role'] ?? 'OWNER', 'mustChangePassword' => $flags['mustChangePassword']];
    }

    public function logout(string $token): void { $row = $this->sessionRow($token); $this->pdo->prepare('UPDATE control_sessions SET revoked_at = :at WHERE session_id = :id')->execute(['at' => gmdate('c'), 'id' => $row['session_id']]); $this->audit((string) $row['user_id'], 'logout', gmdate('c')); }
    public function logoutAll(string $token): void { $row = $this->sessionRow($token); $this->pdo->prepare('UPDATE control_sessions SET revoked_at = :at WHERE user_id = :user AND revoked_at IS NULL')->execute(['at' => gmdate('c'), 'user' => $row['user_id']]); $this->audit((string) $row['user_id'], 'logout_all', gmdate('c')); }
    public function sessions(string $token): array { $row = $this->sessionRow($token); $q = $this->pdo->prepare("SELECT session_id, created_at, expires_at, last_seen_at, remembered_until FROM control_sessions WHERE user_id = :user AND session_kind = 'password' AND revoked_at IS NULL ORDER BY last_seen_at DESC LIMIT 20"); $q->execute(['user' => $row['user_id']]); return ['schemaVersion' => 1, 'sessions' => array_map(static fn (array $item): array => ['sessionId' => (string) $item['session_id'], 'createdAt' => (string) $item['created_at'], 'expiresAt' => (string) $item['expires_at'], 'lastSeenAt' => (string) $item['last_seen_at'], 'remembered' => $item['remembered_until'] !== null, 'current' => (string) $item['session_id'] === (string) $row['session_id']], $q->fetchAll())]; }
    public function revokeSession(string $token, string $csrf, string $sessionId): void { $row = $this->authorize($token, $csrf); if (!self::isUuid($sessionId)) throw new HubOwnerAuthException('Session is invalid', 'SESSION_INVALID'); $at = gmdate('c'); $q = $this->pdo->prepare("UPDATE control_sessions SET revoked_at = :at WHERE session_id = :id AND user_id = :user AND session_kind = 'password' AND revoked_at IS NULL"); $q->execute(['at' => $at, 'id' => strtolower($sessionId), 'user' => $row['user_id']]); if ($q->rowCount() !== 1) throw new HubOwnerAuthException('Session was not found', 'SESSION_NOT_FOUND'); $this->audit((string) $row['user_id'], 'session_revoked', $at); }

    /** Canonical account identity: the Hub user row, never a browser profile cache. */
    public function identity(string $token): array
    {
        $session = $this->sessionRow($token); $q = $this->pdo->prepare('SELECT u.display_name, p.username FROM hub_users u JOIN owner_passwords p ON p.user_id = u.user_id AND p.enabled = 1 WHERE u.user_id = :user AND u.revoked_at IS NULL'); $q->execute(['user' => $session['user_id']]); $row = $q->fetch();
        if (!is_array($row)) throw new HubOwnerAuthException('Account identity is unavailable', 'AUTH_UNAVAILABLE');
        $profile = $this->finalSchemaPresent() ? $this->profile((string) $session['user_id']) : null; $flags = $this->passwordFlags((string) $session['user_id']);
        return ['schemaVersion' => 2, 'displayName' => (string) $row['display_name'], 'username' => (string) $row['username'], 'email' => $profile['email'] ?? null, 'role' => $profile['role'] ?? 'OWNER', 'features' => $this->effectiveFeatures((string) $session['user_id'], $profile['role'] ?? 'OWNER'), 'mustChangePassword' => $flags['mustChangePassword']];
    }

    public function updateDisplayName(string $token, string $csrf, string $displayName, ?string $now = null): array
    {
        $session = $this->authorize($token, $csrf, $now); $displayName = self::displayName($displayName); $at = self::timestamp($now ?? gmdate('c'));
        try {
            $this->pdo->beginTransaction();
            $this->pdo->prepare('UPDATE hub_users SET display_name = :display WHERE user_id = :user AND revoked_at IS NULL')->execute(['display' => $displayName, 'user' => $session['user_id']]);
            if ($this->pdo->query("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'control_user_profiles'")->fetchColumn() !== false) $this->pdo->prepare('UPDATE control_user_profiles SET display_name = :display, updated_at = :at WHERE user_id = :user')->execute(['display' => $displayName, 'at' => $at, 'user' => $session['user_id']]);
            $this->audit((string) $session['user_id'], 'display_name_changed', $at); $this->pdo->commit();
        } catch (Throwable $error) {
            if ($this->pdo->inTransaction()) $this->pdo->rollBack();
            throw new HubOwnerAuthException('Account identity could not be changed', 'AUTH_UNAVAILABLE');
        }
        return $this->identity($token);
    }

    public function changePassword(string $token, string $csrf, string $oldPassword, string $newPassword): void
    {
        $row = $this->authorize($token, $csrf); self::password($newPassword); $q = $this->pdo->prepare('SELECT password_hash FROM owner_passwords WHERE user_id = :user AND enabled = 1'); $q->execute(['user' => $row['user_id']]); $hash = $q->fetchColumn();
        if (!is_string($hash) || !password_verify($oldPassword, $hash)) throw new HubOwnerAuthException('Current password is incorrect', 'AUTH_FAILED');
        $now = gmdate('c'); $sql = $this->workspaceSchemaPresent() ? 'UPDATE owner_passwords SET password_hash = :hash, password_changed_at = :at, must_change_password = 0 WHERE user_id = :user' : 'UPDATE owner_passwords SET password_hash = :hash, password_changed_at = :at WHERE user_id = :user'; $this->pdo->prepare($sql)->execute(['hash' => self::hashPassword($newPassword), 'at' => $now, 'user' => $row['user_id']]); $this->pdo->prepare('UPDATE control_sessions SET revoked_at = :at WHERE user_id = :user AND revoked_at IS NULL')->execute(['at' => $now, 'user' => $row['user_id']]); $this->audit((string) $row['user_id'], 'password_changed', $now);
    }

    /** Rename the existing owner login identity; it never creates another owner. */
    public function changeUsername(string $token, string $csrf, string $currentPassword, string $newUsername): void
    {
        $row = $this->authorize($token, $csrf); $newUsername = self::username($newUsername);
        $q = $this->pdo->prepare('SELECT password_hash, username FROM owner_passwords WHERE user_id = :user AND enabled = 1'); $q->execute(['user' => $row['user_id']]); $record = $q->fetch();
        if (!is_array($record) || !is_string($record['password_hash']) || !password_verify($currentPassword, $record['password_hash'])) throw new HubOwnerAuthException('Current password is incorrect', 'AUTH_FAILED');
        if (hash_equals((string) $record['username'], $newUsername)) return;
        $now = gmdate('c');
        try {
            $this->pdo->beginTransaction();
            $update = $this->pdo->prepare('UPDATE owner_passwords SET username = :username, password_changed_at = :at WHERE user_id = :user AND enabled = 1');
            $update->execute(['username' => $newUsername, 'at' => $now, 'user' => $row['user_id']]);
            if ($update->rowCount() !== 1) throw new RuntimeException('owner identity changed');
            $this->pdo->prepare('UPDATE control_sessions SET revoked_at = :at WHERE user_id = :user AND revoked_at IS NULL')->execute(['at' => $now, 'user' => $row['user_id']]);
            $this->audit((string) $row['user_id'], 'username_changed', $now);
            $this->pdo->commit();
        } catch (PDOException $error) {
            if ($this->pdo->inTransaction()) $this->pdo->rollBack();
            throw new HubOwnerAuthException('Username is not available', 'USERNAME_UNAVAILABLE');
        } catch (Throwable $error) {
            if ($this->pdo->inTransaction()) $this->pdo->rollBack();
            if ($error instanceof HubOwnerAuthException) throw $error;
            throw new HubOwnerAuthException('Owner username could not be changed', 'AUTH_UNAVAILABLE');
        }
    }

    public function createRecoveryCodesForSession(string $token, string $csrf, ?string $now = null): array
    {
        $row = $this->authorize($token, $csrf, $now); $at = self::timestamp($now ?? gmdate('c')); self::assertRecentStepUpSession($row, $at);
        return $this->createRecoveryCodes((string) $row['user_id'], $at);
    }

    public function recover(string $username, string $recoveryCode, string $newPassword, ?string $now = null, ?string $rateKey = null): void
    {
        self::password($newPassword); $now = self::timestamp($now ?? gmdate('c')); $rateKey = self::rateKey($rateKey ?? '', strtolower(trim($username))); $this->assertRate($rateKey, $now);
        try { $username = self::username($username); } catch (HubOwnerAuthException) { $this->failedRate($rateKey, $now); throw new HubOwnerAuthException('Recovery could not be completed', 'RECOVERY_FAILED'); }
        $q = $this->pdo->prepare('SELECT user_id FROM owner_passwords WHERE username = :username AND enabled = 1'); $q->execute(['username' => strtolower($username)]); $user = $q->fetchColumn();
        if (!is_string($user)) { $this->failedRate($rateKey, $now); throw new HubOwnerAuthException('Recovery could not be completed', 'RECOVERY_FAILED'); }
        $codes = $this->pdo->prepare("SELECT recovery_code_id, code_hash FROM auth_recovery_codes WHERE user_id = :user AND used_at IS NULL AND recovery_code_id NOT LIKE 'reset-%'"); $codes->execute(['user' => $user]); $match = null; foreach ($codes->fetchAll() as $code) if (password_verify($recoveryCode, (string) $code['code_hash'])) { $match = $code['recovery_code_id']; break; }
        if (!is_string($match)) { $this->failedRate($rateKey, $now); throw new HubOwnerAuthException('Recovery could not be completed', 'RECOVERY_FAILED'); }
        $this->pdo->beginTransaction(); try { $this->pdo->prepare('UPDATE auth_recovery_codes SET used_at = :at WHERE recovery_code_id = :id AND used_at IS NULL')->execute(['at' => $now, 'id' => $match]); if ((int) $this->pdo->query('SELECT changes()')->fetchColumn() !== 1) throw new RuntimeException('recovery race'); $passwordSql = $this->workspaceSchemaPresent() ? 'UPDATE owner_passwords SET password_hash = :hash, password_changed_at = :at, must_change_password = 0 WHERE user_id = :user' : 'UPDATE owner_passwords SET password_hash = :hash, password_changed_at = :at WHERE user_id = :user'; $this->pdo->prepare($passwordSql)->execute(['hash' => self::hashPassword($newPassword), 'at' => $now, 'user' => $user]); $this->pdo->prepare('UPDATE control_sessions SET revoked_at = :at WHERE user_id = :user AND revoked_at IS NULL')->execute(['at' => $now, 'user' => $user]); $this->audit((string) $user, 'recovery_used', $now); $this->pdo->commit(); $this->clearRate($rateKey); } catch (Throwable) { if ($this->pdo->inTransaction()) $this->pdo->rollBack(); throw new HubOwnerAuthException('Recovery could not be completed', 'RECOVERY_FAILED'); }
    }

    /**
     * Issue a browser reset link only to the canonical Owner through an
     * already trusted device. The raw token is returned once to the caller so
     * the local trusted device can open the browser; it is never logged or
     * persisted in plaintext.
     */
    public function issueOwnerPasswordResetLink(string $requestingUserId, ?string $now = null): array
    {
        $this->assertOwner($requestingUserId);
        $owner = $this->pdo->prepare('SELECT owner_user_id FROM owner_bootstrap WHERE singleton_id = 1 AND bootstrap_closed = 1');
        $owner->execute();
        $ownerUserId = $owner->fetchColumn();
        if (!is_string($ownerUserId)) throw new HubOwnerAuthException('Owner identity is unavailable', 'OWNER_NOT_READY');
        $password = $this->pdo->prepare('SELECT 1 FROM owner_passwords WHERE user_id = :user AND enabled = 1');
        $password->execute(['user' => $ownerUserId]);
        if ($password->fetchColumn() === false) throw new HubOwnerAuthException('Owner password is unavailable', 'OWNER_NOT_READY');
        $at = self::timestamp($now ?? gmdate('c'));
        $expires = gmdate('c', strtotime($at) + self::RESET_TOKEN_TTL);
        $token = self::randomToken();
        try {
            $this->pdo->beginTransaction();
            $this->pdo->prepare("DELETE FROM auth_recovery_codes WHERE user_id = :user AND recovery_code_id LIKE 'reset-%' AND used_at IS NULL")->execute(['user' => $ownerUserId]);
            $this->pdo->prepare('INSERT INTO auth_recovery_codes(recovery_code_id, user_id, code_hash, created_at, used_at) VALUES(:id, :user, :hash, :at, NULL)')->execute(['id' => 'reset-' . self::uuid(), 'user' => $ownerUserId, 'hash' => self::hashPassword($token), 'at' => $at]);
            $this->audit($ownerUserId, 'password_reset_link_issued', $at);
            $this->pdo->commit();
        } catch (Throwable $error) {
            if ($this->pdo->inTransaction()) $this->pdo->rollBack();
            if ($error instanceof HubOwnerAuthException) throw $error;
            throw new HubOwnerAuthException('Password reset link could not be created', 'RESET_ISSUE_FAILED');
        }
        return ['resetPath' => '/#awh-reset=' . rawurlencode($token), 'expiresAt' => $expires];
    }

    /** Consume a reset token atomically, update the existing Owner password, and revoke password sessions. */
    public function resetPasswordWithToken(string $token, string $newPassword, ?string $now = null, ?string $rateKey = null): void
    {
        self::password($newPassword);
        $at = self::timestamp($now ?? gmdate('c'));
        $rateKey = self::rateKey($rateKey ?? '', 'owner-reset');
        $this->assertRate($rateKey, $at);
        $owner = $this->pdo->prepare('SELECT owner_user_id FROM owner_bootstrap WHERE singleton_id = 1 AND bootstrap_closed = 1');
        $owner->execute();
        $ownerUserId = $owner->fetchColumn();
        $validFormat = preg_match('/^[A-Za-z0-9_-]{43}$/', $token) === 1;
        $match = null;
        if (is_string($ownerUserId) && $validFormat) {
            $tokens = $this->pdo->prepare("SELECT recovery_code_id, code_hash, created_at FROM auth_recovery_codes WHERE user_id = :user AND recovery_code_id LIKE 'reset-%' AND used_at IS NULL");
            $tokens->execute(['user' => $ownerUserId]);
            foreach ($tokens->fetchAll() as $candidate) {
                $created = strtotime((string) $candidate['created_at']);
                if ($created !== false && $created + self::RESET_TOKEN_TTL > strtotime($at) && password_verify($token, (string) $candidate['code_hash'])) { $match = $candidate['recovery_code_id']; break; }
            }
        }
        if (!is_string($ownerUserId) || !is_string($match)) {
            $this->failedRate($rateKey, $at);
            throw new HubOwnerAuthException('Password reset link is invalid or expired', 'RESET_FAILED');
        }
        try {
            $this->pdo->beginTransaction();
            $consume = $this->pdo->prepare('UPDATE auth_recovery_codes SET used_at = :at WHERE recovery_code_id = :id AND user_id = :user AND used_at IS NULL');
            $consume->execute(['at' => $at, 'id' => $match, 'user' => $ownerUserId]);
            if ($consume->rowCount() !== 1) throw new RuntimeException('reset token race');
            $passwordSql = $this->workspaceSchemaPresent() ? 'UPDATE owner_passwords SET password_hash = :hash, password_changed_at = :at, must_change_password = 0 WHERE user_id = :user AND enabled = 1' : 'UPDATE owner_passwords SET password_hash = :hash, password_changed_at = :at WHERE user_id = :user AND enabled = 1'; $update = $this->pdo->prepare($passwordSql);
            $update->execute(['hash' => self::hashPassword($newPassword), 'at' => $at, 'user' => $ownerUserId]);
            if ($update->rowCount() !== 1) throw new RuntimeException('owner password update failed');
            $this->pdo->prepare("UPDATE control_sessions SET revoked_at = :at WHERE user_id = :user AND session_kind = 'password' AND revoked_at IS NULL")->execute(['at' => $at, 'user' => $ownerUserId]);
            $this->audit($ownerUserId, 'password_reset_token_used', $at);
            $this->pdo->commit();
            $this->clearRate($rateKey);
        } catch (Throwable) {
            if ($this->pdo->inTransaction()) $this->pdo->rollBack();
            throw new HubOwnerAuthException('Password reset link is invalid or expired', 'RESET_FAILED');
        }
    }

    public function stepUp(string $token, string $csrf, string $password): array { $row = $this->authorize($token, $csrf); $q = $this->pdo->prepare('SELECT password_hash FROM owner_passwords WHERE user_id = :user AND enabled = 1'); $q->execute(['user' => $row['user_id']]); $hash = $q->fetchColumn(); if (!is_string($hash) || !password_verify($password, $hash)) throw new HubOwnerAuthException('Authentication is required', 'STEP_UP_REQUIRED'); $at = gmdate('c'); $this->pdo->prepare('UPDATE control_sessions SET step_up_at = :at, last_seen_at = :at WHERE session_id = :id')->execute(['at' => $at, 'id' => $row['session_id']]); $this->audit((string) $row['user_id'], 'step_up_success', $at); return ['stepUpUntil' => gmdate('c', strtotime($at) + self::STEP_UP_TTL)]; }

    /**
     * Shared server-side policy used by both Owner Auth and the control plane.
     * @param array{step_up_at?:mixed} $session
     */
    public static function assertRecentStepUpSession(array $session, ?string $now = null): void
    {
        $at = strtotime(self::timestamp($now ?? gmdate('c'))); $stepUp = $session['step_up_at'] ?? null;
        if (!is_string($stepUp) || strtotime($stepUp) === false || strtotime($stepUp) + self::STEP_UP_TTL < $at) throw new HubOwnerAuthException('Authentication is required', 'STEP_UP_REQUIRED');
    }

    /** Owner-created invitation; only the one-time code is returned to the caller. */
    public function inviteUser(string $token, string $csrf, array $payload, ?string $now = null): array
    {
        $manager = $this->authorize($token, $csrf, $now); $this->assertFinalReady();
        if ($this->workspaceSchemaPresent()) $this->assertUserManager((string) $manager['user_id']); else $this->assertOwner((string) $manager['user_id']);
        self::exactPayloadKeys($payload, ['displayName', 'email', 'projectIds', 'role', 'username']);
        $display = self::displayName($payload['displayName'] ?? null); $username = self::username((string) ($payload['username'] ?? '')); $email = self::optionalEmail($payload['email'] ?? null); $projects = self::projectIds($payload['projectIds'] ?? null); $at = self::timestamp($now ?? gmdate('c')); self::assertRecentStepUpSession($manager, $at);
        if ($this->workspaceSchemaPresent()) { $workspaceRole = self::workspaceRoleInput($payload['role'] ?? null); if ($workspaceRole === 'OWNER') throw new HubOwnerAuthException('Role is invalid', 'PAYLOAD_INVALID'); $systemRole = self::legacyRoleForWorkspace($workspaceRole); }
        else { $systemRole = self::legacyCollaboratorRole($payload['role'] ?? null); $workspaceRole = self::workspaceRoleInput($systemRole); }
        foreach ($projects as $project) $this->assertOwnerProject((string) $manager['user_id'], $project);
        $this->assertIdentityAvailable($username, $email);
        $code = self::randomToken(24); $id = self::uuid();
        try {
            $this->pdo->beginTransaction();
            if ($this->workspaceSchemaPresent()) $sql = 'INSERT INTO control_user_invitations(invitation_id, code_hash, display_name, username, email, system_role, workspace_role, project_ids_json, created_by_user_id, created_at, expires_at, accepted_at, accepted_user_id, revoked_at) VALUES(:id, :hash, :display, :username, :email, :systemRole, :workspaceRole, :projects, :owner, :at, :expires, NULL, NULL, NULL)';
            else $sql = 'INSERT INTO control_user_invitations(invitation_id, code_hash, display_name, username, email, system_role, project_ids_json, created_by_user_id, created_at, expires_at, accepted_at, accepted_user_id, revoked_at) VALUES(:id, :hash, :display, :username, :email, :systemRole, :projects, :owner, :at, :expires, NULL, NULL, NULL)';
            $params = ['id'=>$id,'hash'=>self::hashPassword($code),'display'=>$display,'username'=>$username,'email'=>$email,'systemRole'=>$systemRole,'projects'=>json_encode($projects, JSON_THROW_ON_ERROR),'owner'=>$manager['user_id'],'at'=>$at,'expires'=>gmdate('c', strtotime($at)+7*86400)]; if ($this->workspaceSchemaPresent()) $params['workspaceRole'] = $workspaceRole;
            $this->pdo->prepare($sql)->execute($params); $this->audit((string) $manager['user_id'], 'user_invited', $at); $this->pdo->commit();
        } catch (Throwable $error) { if ($this->pdo->inTransaction()) $this->pdo->rollBack(); if ($error instanceof HubOwnerAuthException) throw $error; throw new HubOwnerAuthException('Invitation could not be created', 'INVITATION_FAILED'); }
        return ['invitationId'=>$id,'username'=>$username,'role'=>$this->workspaceSchemaPresent()?$workspaceRole:$systemRole,'projectCount'=>count($projects),'expiresAt'=>gmdate('c', strtotime($at)+7*86400),'invitationCode'=>$code];
    }

    /** Public one-time invitation acceptance creates a normal password login, never a second owner. */
    public function acceptInvitation(array $payload, ?string $now = null, ?string $rateKey = null): array
    {
        $this->assertFinalReady(); self::exactPayloadKeys($payload, ['invitationCode', 'password', 'schemaVersion']); if (($payload['schemaVersion'] ?? null) !== 1) throw new HubOwnerAuthException('Invitation is invalid', 'PAYLOAD_INVALID');
        $code = $payload['invitationCode'] ?? null; if (!is_string($code) || !preg_match('/^[A-Za-z0-9_-]{32,128}$/', $code)) throw new HubOwnerAuthException('Invitation could not be accepted', 'INVITATION_FAILED'); self::password((string) ($payload['password'] ?? ''));
        $at = self::timestamp($now ?? gmdate('c')); $this->assertRate(self::rateKey($rateKey ?? '', 'invite'), $at);
        $q = $this->pdo->prepare('SELECT * FROM control_user_invitations WHERE accepted_at IS NULL AND revoked_at IS NULL AND expires_at > :at ORDER BY created_at DESC LIMIT 50'); $q->execute(['at'=>$at]); $invite = null;
        foreach ($q->fetchAll() as $candidate) if (is_string($candidate['code_hash'] ?? null) && password_verify($code, (string) $candidate['code_hash'])) { $invite = $candidate; break; }
        if (!is_array($invite)) throw new HubOwnerAuthException('Invitation could not be accepted', 'INVITATION_FAILED');
        $workspaceRole = $this->workspaceSchemaPresent() ? self::workspaceRoleInput((string) ($invite['workspace_role'] ?? $invite['system_role'])) : self::workspaceRoleInput((string) $invite['system_role']);
        $systemRole = (string) $invite['system_role'];
        try {
            $this->pdo->beginTransaction(); $id = self::uuid();
            $this->assertIdentityAvailable((string) $invite['username'], $invite['email'] === null ? null : (string) $invite['email']);
            $this->pdo->prepare('INSERT INTO hub_users(user_id, display_name, created_at, revoked_at) VALUES(:id, :display, :at, NULL)')->execute(['id'=>$id,'display'=>$invite['display_name'],'at'=>$at]);
            if ($this->workspaceSchemaPresent()) $passwordSql = 'INSERT INTO owner_passwords(user_id, username, password_hash, password_changed_at, enabled, must_change_password) VALUES(:user, :username, :hash, :at, 1, 0)';
            else $passwordSql = 'INSERT INTO owner_passwords(user_id, username, password_hash, password_changed_at, enabled) VALUES(:user, :username, :hash, :at, 1)';
            $this->pdo->prepare($passwordSql)->execute(['user'=>$id,'username'=>$invite['username'],'hash'=>self::hashPassword((string) $payload['password']),'at'=>$at]);
            if ($this->workspaceSchemaPresent()) $profileSql = "INSERT INTO control_user_profiles(user_id, display_name, email, system_role, workspace_role, status, created_at, updated_at) VALUES(:id, :display, :email, :systemRole, :workspaceRole, 'ACTIVE', :at, :at)";
            else $profileSql = "INSERT INTO control_user_profiles(user_id, display_name, email, system_role, status, created_at, updated_at) VALUES(:id, :display, :email, :systemRole, 'ACTIVE', :at, :at)";
            $profileParams = ['id'=>$id,'display'=>$invite['display_name'],'email'=>$invite['email'],'systemRole'=>$systemRole,'at'=>$at]; if ($this->workspaceSchemaPresent()) $profileParams['workspaceRole'] = $workspaceRole; $this->pdo->prepare($profileSql)->execute($profileParams);
            $projects = json_decode((string) $invite['project_ids_json'], true, 32, JSON_THROW_ON_ERROR); if (!is_array($projects) || array_is_list($projects) === false) throw new RuntimeException('invalid invitation project list');
            $this->grantProjects($id, $projects, $workspaceRole, (string) $invite['created_by_user_id'], $at);
            $this->pdo->prepare('UPDATE control_user_invitations SET accepted_at = :at, accepted_user_id = :user WHERE invitation_id = :invite AND accepted_at IS NULL AND revoked_at IS NULL')->execute(['at'=>$at,'user'=>$id,'invite'=>$invite['invitation_id']]);
            $this->audit($id, 'invitation_accepted', $at); $this->pdo->commit(); return ['username'=>(string) $invite['username'],'userId'=>$id];
        } catch (Throwable $error) { if ($this->pdo->inTransaction()) $this->pdo->rollBack(); if ($error instanceof HubOwnerAuthException) throw $error; throw new HubOwnerAuthException('Invitation could not be accepted', 'INVITATION_FAILED'); }
    }

    public function people(string $token): array
    {
        $row = $this->sessionRow($token); $this->assertFinalReady();
        if ($this->workspaceSchemaPresent()) $this->assertUserManager((string) $row['user_id']); else $this->assertOwner((string) $row['user_id']);
        if ($this->workspaceSchemaPresent()) $sql = "SELECT p.user_id,p.display_name,p.email,p.system_role,p.workspace_role,p.status,p.disabled_at,p.last_login_at,u.created_at,op.username,op.enabled,MAX(s.last_seen_at) AS last_seen_at FROM control_user_profiles p JOIN hub_users u ON u.user_id=p.user_id JOIN owner_passwords op ON op.user_id=p.user_id LEFT JOIN control_sessions s ON s.user_id=p.user_id AND s.revoked_at IS NULL GROUP BY p.user_id ORDER BY CASE WHEN p.workspace_role='OWNER' THEN 0 WHEN p.workspace_role='ADMIN' THEN 1 ELSE 2 END,p.display_name LIMIT 100";
        else $sql = "SELECT p.user_id,p.display_name,p.email,p.system_role,NULL AS workspace_role,p.status,NULL AS disabled_at,NULL AS last_login_at,u.created_at,op.username,op.enabled,MAX(s.last_seen_at) AS last_seen_at FROM control_user_profiles p JOIN hub_users u ON u.user_id=p.user_id JOIN owner_passwords op ON op.user_id=p.user_id LEFT JOIN control_sessions s ON s.user_id=p.user_id AND s.revoked_at IS NULL GROUP BY p.user_id ORDER BY CASE WHEN p.system_role='OWNER' THEN 0 ELSE 1 END,p.display_name LIMIT 100";
        $people=[]; $projects=$this->pdo->prepare('SELECT project_id FROM user_project_memberships WHERE user_id=:user AND revoked_at IS NULL ORDER BY project_id');
        foreach ($this->pdo->query($sql)->fetchAll() as $person) {
            $projects->execute(['user'=>$person['user_id']]); $role=$this->workspaceSchemaPresent()?(string)$person['workspace_role']:(string)$person['system_role']; $status=(string)$person['status']; if ($status==='ACTIVE' && ($person['disabled_at']!==null || (int)$person['enabled']!==1)) $status='DISABLED';
            $quota=$this->workspaceSchemaPresent()?$this->quotaForUser((string)$person['user_id']):['aiDailyRequests'=>null,'aiMonthlyMicrounits'=>null];
            $people[]=['userId'=>(string)$person['user_id'],'displayName'=>(string)$person['display_name'],'username'=>(string)$person['username'],'email'=>$person['email']===null?null:(string)$person['email'],'role'=>$role,'status'=>$status,'createdAt'=>(string)$person['created_at'],'lastLoginAt'=>$person['last_login_at']===null?null:(string)$person['last_login_at'],'lastSeenAt'=>$person['last_seen_at']===null?null:(string)$person['last_seen_at'],'projectIds'=>array_map(static fn(array $item):string=>(string)$item['project_id'],$projects->fetchAll()),'features'=>$this->workspaceSchemaPresent()?$this->effectiveFeatures((string)$person['user_id'],$role):self::featureDefaults(self::workspaceRoleInput($role)),'quota'=>$quota];
        }
        return ['schemaVersion'=>$this->workspaceSchemaPresent()?2:1,'people'=>$people];
    }

    /** Owner-only role/project access editor for an existing non-owner account. */
    public function updateUserAccess(string $token, string $csrf, string $userId, array $payload, ?string $now = null): array
    {
        $manager=$this->authorize($token,$csrf,$now); $this->assertFinalReady(); $managerRole=$this->workspaceSchemaPresent()?$this->assertUserManager((string)$manager['user_id']):'OWNER'; if (!$this->workspaceSchemaPresent()) $this->assertOwner((string)$manager['user_id']);
        if (!self::isUuid($userId)||hash_equals((string)$manager['user_id'],strtolower($userId))) throw new HubOwnerAuthException('Owner access cannot be edited here','USER_ACCESS_FORBIDDEN');
        self::exactPayloadKeys($payload,['projectIds','role','schemaVersion']); if (($payload['schemaVersion']??null)!==1) throw new HubOwnerAuthException('User access request is invalid','PAYLOAD_INVALID');
        $projects=self::projectIds($payload['projectIds']??null); $at=self::timestamp($now??gmdate('c')); self::assertRecentStepUpSession($manager,$at);
        if ($this->workspaceSchemaPresent()) { $role=self::workspaceRoleInput($payload['role']??null); if ($role==='OWNER'||($managerRole==='ADMIN'&&$role==='ADMIN')) throw new HubOwnerAuthException('Role is not available to this manager','USER_ACCESS_FORBIDDEN'); $systemRole=self::legacyRoleForWorkspace($role); }
        else { $systemRole=self::legacyCollaboratorRole($payload['role']??null); $role=$systemRole; }
        foreach ($projects as $project) $this->assertOwnerProject((string)$manager['user_id'],$project);
        $profile=$this->pdo->prepare($this->workspaceSchemaPresent()?'SELECT status,workspace_role FROM control_user_profiles WHERE user_id=:user':'SELECT status,system_role AS workspace_role FROM control_user_profiles WHERE user_id=:user'); $profile->execute(['user'=>strtolower($userId)]); $current=$profile->fetch();
        if (!is_array($current)||(string)$current['status']!=='ACTIVE') throw new HubOwnerAuthException('User was not found','USER_NOT_FOUND'); if ((string)$current['workspace_role']==='OWNER') throw new HubOwnerAuthException('Owner access cannot be edited here','USER_ACCESS_FORBIDDEN');
        try { $this->pdo->beginTransaction();
            if ($this->workspaceSchemaPresent()) $this->pdo->prepare('UPDATE control_user_profiles SET system_role=:systemRole,workspace_role=:workspaceRole,updated_at=:at WHERE user_id=:user')->execute(['systemRole'=>$systemRole,'workspaceRole'=>$role,'at'=>$at,'user'=>strtolower($userId)]);
            else $this->pdo->prepare('UPDATE control_user_profiles SET system_role=:systemRole,updated_at=:at WHERE user_id=:user')->execute(['systemRole'=>$systemRole,'at'=>$at,'user'=>strtolower($userId)]);
            $this->pdo->prepare('UPDATE user_project_memberships SET revoked_at=:at WHERE user_id=:user AND revoked_at IS NULL')->execute(['at'=>$at,'user'=>strtolower($userId)]); $this->pdo->prepare('UPDATE control_project_capabilities SET revoked_at=:at WHERE user_id=:user AND revoked_at IS NULL')->execute(['at'=>$at,'user'=>strtolower($userId)]); $this->grantProjects(strtolower($userId),$projects,$this->workspaceSchemaPresent()?$role:$systemRole,(string)$manager['user_id'],$at); $this->pdo->prepare('UPDATE control_sessions SET revoked_at=:at WHERE user_id=:user AND revoked_at IS NULL')->execute(['at'=>$at,'user'=>strtolower($userId)]); $this->audit((string)$manager['user_id'],'user_access_updated',$at); $this->pdo->commit();
        } catch (Throwable $error) { if ($this->pdo->inTransaction()) $this->pdo->rollBack(); if ($error instanceof HubOwnerAuthException) throw $error; throw new HubOwnerAuthException('User access could not be updated','USER_ACCESS_UPDATE_FAILED'); }
        return ['userId'=>strtolower($userId),'role'=>$role,'projectIds'=>$projects,'reauthenticateUser'=>true];
    }

    /** Create a conventional human account without exposing worker/device credentials. */
    public function createUser(string $token, string $csrf, array $payload, ?string $now = null): array
    {
        $manager=$this->authorize($token,$csrf,$now); $this->assertWorkspaceReady(); $managerRole=$this->assertUserManager((string)$manager['user_id']);
        self::exactPayloadKeys($payload,['displayName','email','projectIds','role','schemaVersion','temporaryPassword','username']); if (($payload['schemaVersion']??null)!==1) throw new HubOwnerAuthException('User request is invalid','PAYLOAD_INVALID');
        $display=self::displayName($payload['displayName']??null); $username=self::username((string)($payload['username']??'')); $email=self::optionalEmail($payload['email']??null); self::password((string)($payload['temporaryPassword']??'')); $role=self::workspaceRoleInput($payload['role']??null); $projects=self::projectIds($payload['projectIds']??null); $at=self::timestamp($now??gmdate('c')); self::assertRecentStepUpSession($manager,$at);
        if ($role==='OWNER'||($managerRole==='ADMIN'&&$role==='ADMIN')) throw new HubOwnerAuthException('Role is not available to this manager','USER_ACCESS_FORBIDDEN'); foreach ($projects as $project) $this->assertOwnerProject((string)$manager['user_id'],$project); $this->assertIdentityAvailable($username,$email);
        $id=self::uuid(); $systemRole=self::legacyRoleForWorkspace($role);
        try { $this->pdo->beginTransaction();
            $this->pdo->prepare('INSERT INTO hub_users(user_id,display_name,created_at,revoked_at) VALUES(:id,:display,:at,NULL)')->execute(['id'=>$id,'display'=>$display,'at'=>$at]);
            $this->pdo->prepare('INSERT INTO owner_passwords(user_id,username,password_hash,password_changed_at,enabled,must_change_password) VALUES(:id,:username,:hash,:at,1,1)')->execute(['id'=>$id,'username'=>$username,'hash'=>self::hashPassword((string)$payload['temporaryPassword']),'at'=>$at]);
            $this->pdo->prepare("INSERT INTO control_user_profiles(user_id,display_name,email,system_role,workspace_role,status,created_at,updated_at,disabled_at,last_login_at) VALUES(:id,:display,:email,:systemRole,:workspaceRole,'ACTIVE',:at,:at,NULL,NULL)")->execute(['id'=>$id,'display'=>$display,'email'=>$email,'systemRole'=>$systemRole,'workspaceRole'=>$role,'at'=>$at]);
            $this->grantProjects($id,$projects,$role,(string)$manager['user_id'],$at); $this->audit((string)$manager['user_id'],'user_created',$at); $this->pdo->commit();
        } catch (PDOException $error) { if ($this->pdo->inTransaction()) $this->pdo->rollBack(); throw new HubOwnerAuthException('Username or email is not available','USERNAME_UNAVAILABLE'); }
        catch (Throwable $error) { if ($this->pdo->inTransaction()) $this->pdo->rollBack(); if ($error instanceof HubOwnerAuthException) throw $error; throw new HubOwnerAuthException('User could not be created','USER_CREATE_FAILED'); }
        return ['userId'=>$id,'username'=>$username,'email'=>$email,'role'=>$role,'projectIds'=>$projects,'mustChangePassword'=>true];
    }

    public function updateManagedUserIdentity(string $token,string $csrf,string $userId,array $payload,?string $now=null): array
    {
        $manager=$this->authorize($token,$csrf,$now); $this->assertWorkspaceReady(); $managerRole=$this->assertUserManager((string)$manager['user_id']); $targetRole=$this->assertManagedTarget($managerRole,$userId); self::exactPayloadKeys($payload,['displayName','email','schemaVersion','username']); if (($payload['schemaVersion']??null)!==1) throw new HubOwnerAuthException('User request is invalid','PAYLOAD_INVALID');
        $display=self::displayName($payload['displayName']??null); $username=self::username((string)($payload['username']??'')); $email=self::optionalEmail($payload['email']??null); $at=self::timestamp($now??gmdate('c')); self::assertRecentStepUpSession($manager,$at); $this->assertIdentityAvailable($username,$email,strtolower($userId));
        try { $this->pdo->beginTransaction(); $this->pdo->prepare('UPDATE hub_users SET display_name=:display WHERE user_id=:user')->execute(['display'=>$display,'user'=>strtolower($userId)]); $this->pdo->prepare('UPDATE owner_passwords SET username=:username WHERE user_id=:user')->execute(['username'=>$username,'user'=>strtolower($userId)]); $this->pdo->prepare('UPDATE control_user_profiles SET display_name=:display,email=:email,updated_at=:at WHERE user_id=:user')->execute(['display'=>$display,'email'=>$email,'at'=>$at,'user'=>strtolower($userId)]); $this->pdo->prepare('UPDATE control_sessions SET revoked_at=:at WHERE user_id=:user AND revoked_at IS NULL')->execute(['at'=>$at,'user'=>strtolower($userId)]); $this->audit((string)$manager['user_id'],'user_identity_updated',$at); $this->pdo->commit(); }
        catch (PDOException) { if ($this->pdo->inTransaction()) $this->pdo->rollBack(); throw new HubOwnerAuthException('Username or email is not available','USERNAME_UNAVAILABLE'); }
        catch (Throwable $error) { if ($this->pdo->inTransaction()) $this->pdo->rollBack(); if ($error instanceof HubOwnerAuthException) throw $error; throw new HubOwnerAuthException('User identity could not be updated','USER_ACCESS_UPDATE_FAILED'); }
        return ['userId'=>strtolower($userId),'displayName'=>$display,'username'=>$username,'email'=>$email,'role'=>$targetRole,'reauthenticateUser'=>true];
    }

    public function resetManagedUserPassword(string $token,string $csrf,string $userId,array $payload,?string $now=null): array
    {
        $manager=$this->authorize($token,$csrf,$now); $this->assertWorkspaceReady(); $managerRole=$this->assertUserManager((string)$manager['user_id']); $this->assertManagedTarget($managerRole,$userId); self::exactPayloadKeys($payload,['schemaVersion','temporaryPassword']); if (($payload['schemaVersion']??null)!==1) throw new HubOwnerAuthException('Password request is invalid','PAYLOAD_INVALID'); self::password((string)($payload['temporaryPassword']??'')); $at=self::timestamp($now??gmdate('c')); self::assertRecentStepUpSession($manager,$at);
        $this->pdo->beginTransaction(); try { $this->pdo->prepare('UPDATE owner_passwords SET password_hash=:hash,password_changed_at=:at,must_change_password=1 WHERE user_id=:user')->execute(['hash'=>self::hashPassword((string)$payload['temporaryPassword']),'at'=>$at,'user'=>strtolower($userId)]); if ((int)$this->pdo->query('SELECT changes()')->fetchColumn()!==1) throw new HubOwnerAuthException('User was not found','USER_NOT_FOUND'); $this->pdo->prepare('UPDATE control_sessions SET revoked_at=:at WHERE user_id=:user AND revoked_at IS NULL')->execute(['at'=>$at,'user'=>strtolower($userId)]); $this->audit((string)$manager['user_id'],'user_password_reset',$at); $this->pdo->commit(); }
        catch (Throwable $error) { if ($this->pdo->inTransaction()) $this->pdo->rollBack(); if ($error instanceof HubOwnerAuthException) throw $error; throw new HubOwnerAuthException('Password could not be reset','USER_ACCESS_UPDATE_FAILED'); }
        return ['userId'=>strtolower($userId),'mustChangePassword'=>true,'reauthenticateUser'=>true];
    }

    public function setManagedUserEnabled(string $token,string $csrf,string $userId,array $payload,?string $now=null): array
    {
        $manager=$this->authorize($token,$csrf,$now); $this->assertWorkspaceReady(); $managerRole=$this->assertUserManager((string)$manager['user_id']); $this->assertManagedTarget($managerRole,$userId); self::exactPayloadKeys($payload,['enabled','schemaVersion']); if (($payload['schemaVersion']??null)!==1||!is_bool($payload['enabled']??null)) throw new HubOwnerAuthException('User request is invalid','PAYLOAD_INVALID'); $at=self::timestamp($now??gmdate('c')); self::assertRecentStepUpSession($manager,$at); $enabled=$payload['enabled'];
        $this->pdo->beginTransaction(); try { $this->pdo->prepare('UPDATE control_user_profiles SET disabled_at=:disabled,updated_at=:at WHERE user_id=:user AND status=\'ACTIVE\'')->execute(['disabled'=>$enabled?null:$at,'at'=>$at,'user'=>strtolower($userId)]); if ((int)$this->pdo->query('SELECT changes()')->fetchColumn()!==1) throw new HubOwnerAuthException('User was not found','USER_NOT_FOUND'); $this->pdo->prepare('UPDATE control_sessions SET revoked_at=:at WHERE user_id=:user AND revoked_at IS NULL')->execute(['at'=>$at,'user'=>strtolower($userId)]); $this->audit((string)$manager['user_id'],$enabled?'user_enabled':'user_disabled',$at); $this->pdo->commit(); }
        catch (Throwable $error) { if ($this->pdo->inTransaction()) $this->pdo->rollBack(); if ($error instanceof HubOwnerAuthException) throw $error; throw new HubOwnerAuthException('User state could not be changed','USER_ACCESS_UPDATE_FAILED'); }
        return ['userId'=>strtolower($userId),'enabled'=>$enabled,'reauthenticateUser'=>true];
    }

    public function updateManagedUserFeatures(string $token,string $csrf,string $userId,array $payload,?string $now=null): array
    {
        $manager=$this->authorize($token,$csrf,$now); $this->assertWorkspaceReady(); $managerRole=$this->assertUserManager((string)$manager['user_id']); $targetRole=$this->assertManagedTarget($managerRole,$userId); self::exactPayloadKeys($payload,['features','schemaVersion']); if (($payload['schemaVersion']??null)!==1||!is_array($payload['features']??null)||array_is_list($payload['features'])) throw new HubOwnerAuthException('Feature request is invalid','PAYLOAD_INVALID'); $features=self::featureOverrides($payload['features']); if ($managerRole==='ADMIN') foreach (['developer.use','devices.use','users.manage','system.manage','database.view'] as $key) if (array_key_exists($key,$features)) throw new HubOwnerAuthException('Feature is not available to this manager','USER_ACCESS_FORBIDDEN'); $at=self::timestamp($now??gmdate('c')); self::assertRecentStepUpSession($manager,$at);
        $this->pdo->beginTransaction(); try { $this->pdo->prepare('DELETE FROM control_user_feature_permissions WHERE user_id=:user')->execute(['user'=>strtolower($userId)]); $insert=$this->pdo->prepare('INSERT INTO control_user_feature_permissions(user_id,feature_key,allowed,updated_by_user_id,updated_at) VALUES(:user,:key,:allowed,:manager,:at)'); foreach ($features as $key=>$allowed) $insert->execute(['user'=>strtolower($userId),'key'=>$key,'allowed'=>$allowed?1:0,'manager'=>$manager['user_id'],'at'=>$at]); $this->pdo->prepare('UPDATE control_sessions SET revoked_at=:at WHERE user_id=:user AND revoked_at IS NULL')->execute(['at'=>$at,'user'=>strtolower($userId)]); $this->audit((string)$manager['user_id'],'user_features_updated',$at); $this->pdo->commit(); }
        catch (Throwable $error) { if ($this->pdo->inTransaction()) $this->pdo->rollBack(); if ($error instanceof HubOwnerAuthException) throw $error; throw new HubOwnerAuthException('Features could not be updated','USER_ACCESS_UPDATE_FAILED'); }
        return ['userId'=>strtolower($userId),'role'=>$targetRole,'features'=>$this->effectiveFeatures(strtolower($userId),$targetRole),'reauthenticateUser'=>true];
    }

    public function updateManagedUserQuota(string $token,string $csrf,string $userId,array $payload,?string $now=null): array
    {
        $manager=$this->authorize($token,$csrf,$now); $this->assertWorkspaceReady(); $managerRole=$this->assertUserManager((string)$manager['user_id']); $this->assertManagedTarget($managerRole,$userId); self::exactPayloadKeys($payload,['aiDailyRequests','aiMonthlyMicrounits','schemaVersion']); if (($payload['schemaVersion']??null)!==1) throw new HubOwnerAuthException('Quota request is invalid','PAYLOAD_INVALID'); $daily=self::nullableBoundedInt($payload['aiDailyRequests']??null,100000); $monthly=self::nullableBoundedInt($payload['aiMonthlyMicrounits']??null,1000000000000); $at=self::timestamp($now??gmdate('c')); self::assertRecentStepUpSession($manager,$at);
        $this->pdo->prepare('INSERT INTO control_user_quotas(user_id,ai_daily_requests,ai_monthly_microunits,updated_by_user_id,updated_at) VALUES(:user,:daily,:monthly,:manager,:at) ON CONFLICT(user_id) DO UPDATE SET ai_daily_requests=excluded.ai_daily_requests,ai_monthly_microunits=excluded.ai_monthly_microunits,updated_by_user_id=excluded.updated_by_user_id,updated_at=excluded.updated_at')->execute(['user'=>strtolower($userId),'daily'=>$daily,'monthly'=>$monthly,'manager'=>$manager['user_id'],'at'=>$at]); $this->audit((string)$manager['user_id'],'user_quota_updated',$at); return ['userId'=>strtolower($userId),'quota'=>$this->quotaForUser(strtolower($userId))];
    }

    public function revokeUser(string $token, string $csrf, string $userId, ?string $now = null): void
    {
        $manager=$this->authorize($token,$csrf,$now); $this->assertFinalReady();
        if ($this->workspaceSchemaPresent()) { $managerRole=$this->assertUserManager((string)$manager['user_id']); $this->assertManagedTarget($managerRole,$userId); }
        else { $this->assertOwner((string)$manager['user_id']); if (!self::isUuid($userId)||hash_equals((string)$manager['user_id'],strtolower($userId))) throw new HubOwnerAuthException('This account cannot be revoked','USER_REVOKE_FORBIDDEN'); }
        $at=self::timestamp($now??gmdate('c')); self::assertRecentStepUpSession($manager,$at);
        try { $this->pdo->beginTransaction(); $where=$this->workspaceSchemaPresent()?"workspace_role!='OWNER'":"system_role!='OWNER'"; $this->pdo->prepare("UPDATE control_user_profiles SET status='REVOKED',updated_at=:at WHERE user_id=:user AND $where AND status='ACTIVE'")->execute(['at'=>$at,'user'=>strtolower($userId)]); if ((int)$this->pdo->query('SELECT changes()')->fetchColumn()!==1) throw new HubOwnerAuthException('User was not found','USER_NOT_FOUND'); $this->pdo->prepare('UPDATE hub_users SET revoked_at=:at WHERE user_id=:user')->execute(['at'=>$at,'user'=>strtolower($userId)]); $this->pdo->prepare('UPDATE user_project_memberships SET revoked_at=:at WHERE user_id=:user AND revoked_at IS NULL')->execute(['at'=>$at,'user'=>strtolower($userId)]); $this->pdo->prepare('UPDATE control_project_capabilities SET revoked_at=:at WHERE user_id=:user AND revoked_at IS NULL')->execute(['at'=>$at,'user'=>strtolower($userId)]); $this->pdo->prepare('UPDATE control_sessions SET revoked_at=:at WHERE user_id=:user AND revoked_at IS NULL')->execute(['at'=>$at,'user'=>strtolower($userId)]); $this->audit((string)$manager['user_id'],'user_revoked',$at); $this->pdo->commit(); }
        catch (Throwable $error) { if ($this->pdo->inTransaction()) $this->pdo->rollBack(); if ($error instanceof HubOwnerAuthException) throw $error; throw new HubOwnerAuthException('User could not be revoked','USER_REVOKE_FAILED'); }
    }

    /** Canonical product-feature decision shared by every AWH surface. */
    public function featureAllowed(string $userId, string $feature): bool
    {
        if (!$this->workspaceSchemaPresent()) return true;
        $profile = $this->profile(strtolower($userId));
        if ($profile === null || $profile['status'] !== 'ACTIVE' || ($profile['disabled'] ?? false)) return false;
        $features = $this->effectiveFeatures(strtolower($userId), (string) $profile['role']);
        return array_key_exists($feature, $features) && $features[$feature] === true;
    }

    public function authorize(string $token, string $csrf, ?string $now = null): array { $row = $this->sessionRow($token, $now); if ($csrf === '' || !hash_equals((string) $row['csrf_hash'], hash('sha256', $csrf))) throw new HubOwnerAuthException('Request could not be verified', 'CSRF_REJECTED'); return $row; }

    private function sessionRow(string $token, ?string $now = null): array { if ($token === '' || strlen($token) > 512 || preg_match('/[\x00-\x1F\x7F]/', $token)) throw new HubOwnerAuthException('Session is invalid', 'SESSION_INVALID'); $q = $this->pdo->prepare("SELECT s.* FROM control_sessions s JOIN hub_users u ON u.user_id = s.user_id AND u.revoked_at IS NULL WHERE s.session_hash = :hash AND s.session_kind = 'password'"); $q->execute(['hash' => hash('sha256', $token)]); $row = $q->fetch(); $at = strtotime(self::timestamp($now ?? gmdate('c'))); $inactivity = is_array($row) && $row['remembered_until'] !== null ? self::REMEMBER_TTL : self::INACTIVITY_TTL; if (!is_array($row) || $row['revoked_at'] !== null || strtotime((string) $row['expires_at']) <= $at || strtotime((string) $row['last_seen_at']) + $inactivity <= $at) throw new HubOwnerAuthException('Session is expired', 'SESSION_EXPIRED'); return $row; }
    private function assertRate(string $key, string $now): void { $q = $this->pdo->prepare('SELECT window_started_at, attempts, blocked_until FROM auth_login_rate_limits WHERE rate_key = :key'); $q->execute(['key' => $key]); $row = $q->fetch(); if (!is_array($row)) return; $at = strtotime($now); if ($row['blocked_until'] !== null && strtotime((string) $row['blocked_until']) > $at) throw new HubOwnerAuthException('Too many attempts', 'RATE_LIMITED'); if (strtotime((string) $row['window_started_at']) + self::RATE_WINDOW <= $at) $this->clearRate($key); }
    private function failedRate(string $key, string $now): void { $q = $this->pdo->prepare('SELECT attempts, window_started_at FROM auth_login_rate_limits WHERE rate_key = :key'); $q->execute(['key' => $key]); $row = $q->fetch(); $attempts = is_array($row) && strtotime((string) $row['window_started_at']) + self::RATE_WINDOW > strtotime($now) ? (int) $row['attempts'] + 1 : 1; $blocked = $attempts >= self::RATE_MAX ? gmdate('c', strtotime($now) + 900) : null; $this->pdo->prepare('INSERT INTO auth_login_rate_limits(rate_key, window_started_at, attempts, blocked_until) VALUES(:key, :at, :attempts, :blocked) ON CONFLICT(rate_key) DO UPDATE SET window_started_at = excluded.window_started_at, attempts = excluded.attempts, blocked_until = excluded.blocked_until')->execute(['key' => $key, 'at' => is_array($row) && strtotime((string) $row['window_started_at']) + self::RATE_WINDOW > strtotime($now) ? $row['window_started_at'] : $now, 'attempts' => $attempts, 'blocked' => $blocked]); }
    private function clearRate(string $key): void { $this->pdo->prepare('DELETE FROM auth_login_rate_limits WHERE rate_key = :key')->execute(['key' => $key]); }
    private function createRecoveryCodes(string $user, string $now): array { $this->pdo->prepare("DELETE FROM auth_recovery_codes WHERE user_id = :user AND used_at IS NULL AND recovery_code_id NOT LIKE 'reset-%'")->execute(['user' => $user]); $plain = []; $insert = $this->pdo->prepare('INSERT INTO auth_recovery_codes(recovery_code_id, user_id, code_hash, created_at, used_at) VALUES(:id, :user, :hash, :at, NULL)'); for ($i = 0; $i < 8; $i++) { $code = strtoupper(bin2hex(random_bytes(6))); $plain[] = $code; $insert->execute(['id' => self::uuid(), 'user' => $user, 'hash' => self::hashPassword($code), 'at' => $now]); } return $plain; }
    private function audit(string $user, string $event, string $now): void { $this->pdo->prepare('INSERT INTO auth_audit_events(event_id, user_id, event_name, occurred_at, metadata_hash) VALUES(:id, :user, :event, :at, NULL)')->execute(['id' => self::uuid(), 'user' => $user, 'event' => $event, 'at' => $now]); }
    private function assertFinalReady(): void { HubFinalProductMigration::assertCapabilityReady($this->pdo, dirname(__DIR__) . '/migrations/008_final_product.sql'); }
    private function finalSchemaPresent(): bool { return $this->pdo->query("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'control_user_profiles'")->fetchColumn() !== false; }
    private function workspaceSchemaPresent(): bool { try { if ((int) $this->pdo->query('PRAGMA user_version')->fetchColumn() < 13) return false; $columns = array_column($this->pdo->query('PRAGMA table_info(control_user_profiles)')->fetchAll(), 'name'); return in_array('workspace_role', $columns, true) && $this->pdo->query("SELECT 1 FROM sqlite_master WHERE type='table' AND name='control_user_feature_permissions'")->fetchColumn() !== false; } catch (Throwable) { return false; } }
    private function assertOwner(string $userId): void { $q = $this->pdo->prepare('SELECT owner_user_id FROM owner_bootstrap WHERE singleton_id = 1 AND bootstrap_closed = 1'); $q->execute(); if (!hash_equals((string) $q->fetchColumn(), $userId)) throw new HubOwnerAuthException('Owner access is required', 'OWNER_FORBIDDEN'); }
    private function assertUserManager(string $userId): string { $profile = $this->profile($userId); if ($profile === null || $profile['status'] !== 'ACTIVE' || ($profile['disabled'] ?? false)) throw new HubOwnerAuthException('User management is not available', 'OWNER_FORBIDDEN'); $role = (string) $profile['role']; if ($role === 'OWNER') return $role; $features = $this->effectiveFeatures($userId, $role); if ($role !== 'ADMIN' || ($features['users.manage'] ?? false) !== true) throw new HubOwnerAuthException('User management is not available', 'OWNER_FORBIDDEN'); return $role; }
    private function assertOwnerProject(string $userId, string $projectId): void { $q = $this->pdo->prepare("SELECT 1 FROM control_project_capabilities WHERE user_id = :user AND project_id = :project AND capability = 'project.read' AND revoked_at IS NULL"); $q->execute(['user' => $userId, 'project' => $projectId]); if ($q->fetchColumn() === false) throw new HubOwnerAuthException('Project is not available', 'PROJECT_FORBIDDEN'); }
    private function profile(string $userId): ?array { if (!$this->finalSchemaPresent()) return null; if ($this->workspaceSchemaPresent()) { $q = $this->pdo->prepare('SELECT workspace_role, status, email, disabled_at FROM control_user_profiles WHERE user_id = :user'); $q->execute(['user' => $userId]); $row = $q->fetch(); return is_array($row) ? ['role' => (string) $row['workspace_role'], 'status' => (string) $row['status'], 'email' => $row['email'] === null ? null : (string) $row['email'], 'disabled' => $row['disabled_at'] !== null] : null; } $q = $this->pdo->prepare('SELECT system_role, status, email FROM control_user_profiles WHERE user_id = :user'); $q->execute(['user' => $userId]); $row = $q->fetch(); return is_array($row) ? ['role' => (string) $row['system_role'], 'status' => (string) $row['status'], 'email' => $row['email'] === null ? null : (string) $row['email'], 'disabled' => false] : null; }
    private function passwordFlags(string $userId): array { if (!$this->workspaceSchemaPresent()) return ['mustChangePassword' => false]; $q = $this->pdo->prepare('SELECT must_change_password FROM owner_passwords WHERE user_id = :user'); $q->execute(['user' => $userId]); return ['mustChangePassword' => (int) $q->fetchColumn() === 1]; }
    private function effectiveFeatures(string $userId, string $role): array { $features = self::featureDefaults(self::workspaceRoleInput($role)); if (!$this->workspaceSchemaPresent()) return $features; $q = $this->pdo->prepare('SELECT feature_key, allowed FROM control_user_feature_permissions WHERE user_id = :user'); $q->execute(['user' => $userId]); foreach ($q->fetchAll() as $row) if (array_key_exists((string) $row['feature_key'], $features)) $features[(string) $row['feature_key']] = (int) $row['allowed'] === 1; return $features; }
    private static function featureDefaults(string $role): array { $all = ['ai.chat'=>false,'tools.pdf'=>false,'tools.image'=>false,'documents.use'=>false,'files.use'=>false,'tasks.use'=>false,'approvals.use'=>false,'projects.use'=>false,'developer.use'=>false,'devices.use'=>false,'automations.use'=>false,'users.manage'=>false,'system.manage'=>false,'database.view'=>false]; $enable = match ($role) { 'OWNER' => array_keys($all), 'ADMIN' => ['ai.chat','tools.pdf','tools.image','documents.use','files.use','tasks.use','approvals.use','projects.use','automations.use','users.manage'], 'DIRECTOR' => ['ai.chat','tools.pdf','tools.image','documents.use','files.use','tasks.use','approvals.use'], 'TEACHER','STAFF' => ['ai.chat','tools.pdf','tools.image','documents.use','files.use','tasks.use'], 'VIEWER' => ['files.use','tasks.use'], default => [] }; foreach ($enable as $key) $all[$key] = true; return $all; }
    private function assertWorkspaceReady(): void { HubWorkspaceProductMigration::assertCapabilityReady($this->pdo, dirname(__DIR__) . '/migrations/012_workspace_product.sql'); }
    private function assertManagedTarget(string $managerRole,string $userId): string { if (!self::isUuid($userId)) throw new HubOwnerAuthException('User was not found','USER_NOT_FOUND'); $userId=strtolower($userId); $profile=$this->profile($userId); if ($profile===null||$profile['status']!=='ACTIVE'||$profile['role']==='OWNER') throw new HubOwnerAuthException('This account cannot be managed here','USER_ACCESS_FORBIDDEN'); if ($managerRole==='ADMIN'&&$profile['role']==='ADMIN') throw new HubOwnerAuthException('This account requires Owner access','USER_ACCESS_FORBIDDEN'); return (string)$profile['role']; }
    private function assertIdentityAvailable(string $username,?string $email,?string $exceptUserId=null): void { $sql="SELECT op.user_id FROM owner_passwords op LEFT JOIN control_user_profiles p ON p.user_id=op.user_id WHERE (op.username=:username OR lower(COALESCE(p.email,''))=:username OR (:email IS NOT NULL AND (op.username=:email OR lower(COALESCE(p.email,''))=:email)))"; $params=['username'=>$username,'email'=>$email]; if ($exceptUserId!==null) { $sql.=' AND op.user_id != :except'; $params['except']=$exceptUserId; } $q=$this->pdo->prepare($sql.' LIMIT 1'); $q->execute($params); if ($q->fetchColumn()!==false) throw new HubOwnerAuthException('Username or email is not available','USERNAME_UNAVAILABLE'); }
    private function grantProjects(string $userId,array $projects,string $role,string $managerUserId,string $at): void { if ($projects===[]) return; $membership=$this->pdo->prepare("INSERT INTO user_project_memberships(user_id,project_id,role,created_at,revoked_at) VALUES(:user,:project,'member',:at,NULL) ON CONFLICT(user_id,project_id) DO UPDATE SET role='member',revoked_at=NULL"); $capability=$this->pdo->prepare('INSERT INTO control_project_capabilities(user_id,project_id,capability,granted_by_user_id,created_at,revoked_at) VALUES(:user,:project,:capability,:manager,:at,NULL) ON CONFLICT(user_id,project_id,capability) DO UPDATE SET granted_by_user_id=excluded.granted_by_user_id,created_at=excluded.created_at,revoked_at=NULL'); foreach ($projects as $project) { $membership->execute(['user'=>$userId,'project'=>$project,'at'=>$at]); foreach (self::roleCapabilities($role) as $name) $capability->execute(['user'=>$userId,'project'=>$project,'capability'=>$name,'manager'=>$managerUserId,'at'=>$at]); } }
    private function quotaForUser(string $userId): array { if (!$this->workspaceSchemaPresent()) return ['aiDailyRequests'=>null,'aiMonthlyMicrounits'=>null]; $q=$this->pdo->prepare('SELECT ai_daily_requests,ai_monthly_microunits FROM control_user_quotas WHERE user_id=:user'); $q->execute(['user'=>$userId]); $row=$q->fetch(); return ['aiDailyRequests'=>is_array($row)&&$row['ai_daily_requests']!==null?(int)$row['ai_daily_requests']:null,'aiMonthlyMicrounits'=>is_array($row)&&$row['ai_monthly_microunits']!==null?(int)$row['ai_monthly_microunits']:null]; }
    private static function featureOverrides(array $value): array { $allowed=array_keys(self::featureDefaults('OWNER')); if (count($value)>count($allowed)) throw new HubOwnerAuthException('Feature request is invalid','PAYLOAD_INVALID'); $out=[]; foreach ($value as $key=>$enabled) { if (!is_string($key)||!in_array($key,$allowed,true)||!is_bool($enabled)) throw new HubOwnerAuthException('Feature request is invalid','PAYLOAD_INVALID'); $out[$key]=$enabled; } return $out; }
    private static function nullableBoundedInt(mixed $value,int $max): ?int { if ($value===null) return null; if (!is_int($value)||$value<0||$value>$max) throw new HubOwnerAuthException('Quota request is invalid','PAYLOAD_INVALID'); return $value; }
    private static function legacyCollaboratorRole(mixed $value): string { if (!is_string($value)||!in_array($value,['COLLABORATOR','VIEWER','APPROVER'],true)) throw new HubOwnerAuthException('Role is invalid','PAYLOAD_INVALID'); return $value; }
    private static function exactPayloadKeys(array $value, array $allowed): void { $actual = array_keys($value); sort($actual); sort($allowed); if ($actual !== $allowed) throw new HubOwnerAuthException('Payload fields are invalid', 'SCHEMA_FIELDS'); }
    private static function displayName(mixed $value): string { if (!is_string($value)) throw new HubOwnerAuthException('Display name is invalid', 'PAYLOAD_INVALID'); $value = trim($value); if ($value === '' || strlen($value) > 80 || preg_match('/[\x00-\x1f\x7f]/', $value)) throw new HubOwnerAuthException('Display name is invalid', 'PAYLOAD_INVALID'); return $value; }
    private static function optionalEmail(mixed $value): ?string { if ($value === null || $value === '') return null; if (!is_string($value) || strlen($value) > 160 || filter_var($value, FILTER_VALIDATE_EMAIL) === false) throw new HubOwnerAuthException('Email is invalid', 'PAYLOAD_INVALID'); return strtolower($value); }
    private static function workspaceRoleInput(mixed $value): string { if (!is_string($value)) throw new HubOwnerAuthException('Role is invalid', 'PAYLOAD_INVALID'); return match ($value) { 'OWNER' => 'OWNER', 'ADMIN' => 'ADMIN', 'DIRECTOR','APPROVER' => 'DIRECTOR', 'TEACHER' => 'TEACHER', 'STAFF','COLLABORATOR' => 'STAFF', 'VIEWER' => 'VIEWER', default => throw new HubOwnerAuthException('Role is invalid', 'PAYLOAD_INVALID') }; }
    private static function legacyRoleForWorkspace(string $role): string { return match ($role) { 'OWNER' => 'OWNER', 'DIRECTOR' => 'APPROVER', 'VIEWER' => 'VIEWER', 'ADMIN','TEACHER','STAFF' => 'COLLABORATOR', default => throw new HubOwnerAuthException('Role is invalid', 'PAYLOAD_INVALID') }; }
    private static function collaboratorRole(mixed $value): string { $role = self::workspaceRoleInput($value); if ($role === 'OWNER') throw new HubOwnerAuthException('Role is invalid', 'PAYLOAD_INVALID'); return $role; }
    private static function projectIds(mixed $value): array { if (!is_array($value) || array_is_list($value) === false || count($value) > 20) throw new HubOwnerAuthException('Project permissions are invalid', 'PAYLOAD_INVALID'); $out = []; foreach ($value as $id) { if (!is_string($id) || !self::isUuid($id)) throw new HubOwnerAuthException('Project permissions are invalid', 'PAYLOAD_INVALID'); $out[] = strtolower($id); } if (count(array_unique($out)) !== count($out)) throw new HubOwnerAuthException('Project permissions are invalid', 'PAYLOAD_INVALID'); return $out; }
    private static function roleCapabilities(string $role): array { $role = self::workspaceRoleInput($role); return match ($role) { 'OWNER' => ['project.read','conversation.write','attachment.upload','approval.decide','deployment.approve'], 'ADMIN','DIRECTOR' => ['project.read','conversation.write','attachment.upload','approval.decide'], 'TEACHER','STAFF' => ['project.read','conversation.write','attachment.upload'], 'VIEWER' => ['project.read'], default => throw new HubOwnerAuthException('Role is invalid', 'PAYLOAD_INVALID') }; }
    private static function username(string $value): string { $value = strtolower(trim($value)); if (!preg_match(self::USERNAME, $value)) throw new HubOwnerAuthException('Username is invalid', 'USERNAME_INVALID'); return $value; }
    private static function password(string $value): void { if (strlen($value) < 8 || strlen($value) > 512 || preg_match('/[\x00-\x1F\x7F]/', $value)) throw new HubOwnerAuthException('Password must contain at least 8 characters', 'PASSWORD_INVALID'); }
    private static function hashPassword(string $value): string { return password_hash($value, defined('PASSWORD_ARGON2ID') ? PASSWORD_ARGON2ID : PASSWORD_DEFAULT); }
    private static function dummyHash(): string { static $hash; return $hash ??= self::hashPassword('AWH invalid authentication sentinel'); }
    private static function rateKey(string $value, string $username): string { return hash('sha256', substr($value, 0, 128) . "\n" . $username); }
    private static function timestamp(string $value): string { if (strtotime($value) === false) throw new HubOwnerAuthException('Authentication time is invalid', 'AUTH_TIME_INVALID'); return gmdate('c', strtotime($value)); }
    private static function uuid(): string { $bytes = random_bytes(16); $bytes[6] = chr((ord($bytes[6]) & 15) | 64); $bytes[8] = chr((ord($bytes[8]) & 63) | 128); return vsprintf('%s%s-%s-%s-%s-%s%s%s', str_split(bin2hex($bytes), 4)); }
    private static function isUuid(string $value): bool { return preg_match('/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i', $value) === 1; }
    private static function randomToken(int $bytes = 32): string { return rtrim(strtr(base64_encode(random_bytes($bytes)), '+/', '-_'), '='); }
}
