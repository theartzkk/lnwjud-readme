<?php

declare(strict_types=1);

require_once __DIR__ . '/HubOwnerAuthMigration.php';
require_once __DIR__ . '/HubFinalProductMigration.php';
require_once __DIR__ . '/HubAccountHostingMigration.php';

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
        $now = self::timestamp($now ?? gmdate('c')); $at = strtotime($now); $normalized = strtolower(trim($username)); $rateKey = self::rateKey($rateKey, $normalized);
        $this->assertRate($rateKey, $now);
        $login = strtolower(trim($username));
        if ($login === '' || strlen($login) > 160 || preg_match('/[\x00-\x1F\x7F]/', $login)) { $this->failedRate($rateKey, $now); throw new HubOwnerAuthException('Username or password is incorrect', 'AUTH_FAILED'); }
        if (str_contains($login, '@') && $this->finalSchemaPresent()) {
            $q = $this->pdo->prepare('SELECT p.user_id,p.username,p.password_hash,p.enabled FROM owner_passwords p JOIN control_user_profiles u ON u.user_id=p.user_id WHERE lower(u.email)=:login LIMIT 1');
            $q->execute(['login' => $login]);
        } else {
            try { $login = self::username($login); } catch (HubOwnerAuthException) { $this->failedRate($rateKey, $now); throw new HubOwnerAuthException('Username or password is incorrect', 'AUTH_FAILED'); }
            $q = $this->pdo->prepare('SELECT user_id, username, password_hash, enabled FROM owner_passwords WHERE username = :login'); $q->execute(['login' => $login]);
        }
        $record = $q->fetch();
        $hash = is_array($record) && is_string($record['password_hash']) ? $record['password_hash'] : self::dummyHash();
        if (!is_array($record) || (int) $record['enabled'] !== 1 || !password_verify($password, $hash)) { $this->failedRate($rateKey, $now); throw new HubOwnerAuthException('Username or password is incorrect', 'AUTH_FAILED'); }
        if ($this->finalSchemaPresent()) { $profile = $this->profile((string) $record['user_id']); if ($profile === null || $profile['status'] !== 'ACTIVE') { $this->failedRate($rateKey, $now); throw new HubOwnerAuthException('Username or password is incorrect', 'AUTH_FAILED'); } }
        $this->clearRate($rateKey); $session = self::randomToken(); $csrf = self::randomToken(24); $expires = gmdate('c', $at + ($remember ? self::REMEMBER_TTL : self::SESSION_TTL));
        $id = self::uuid();
        // A successful password login is a fresh verification, but only for
        // this bounded window; session renewal cannot extend it indefinitely.
        $this->pdo->prepare("INSERT INTO control_sessions(session_id, session_hash, user_id, device_id, csrf_hash, created_at, expires_at, last_seen_at, revoked_at, session_kind, remembered_until, step_up_at) VALUES(:id, :hash, :user, NULL, :csrf, :created, :expires, :last, NULL, 'password', :remembered, :step_up)")->execute(['id' => $id, 'hash' => hash('sha256', $session), 'user' => $record['user_id'], 'csrf' => hash('sha256', $csrf), 'created' => $now, 'expires' => $expires, 'last' => $now, 'remembered' => $remember ? $expires : null, 'step_up' => $now]);
        $this->audit((string) $record['user_id'], 'login_success', $now);
        return ['sessionToken' => $session, 'csrfToken' => $csrf, 'expiresAt' => $expires, 'userId' => (string) $record['user_id'], 'remembered' => $remember, 'role' => $this->finalSchemaPresent() ? ($this->profile((string) $record['user_id'])['role'] ?? 'STAFF') : 'OWNER'];
    }

    public function session(string $token, ?string $now = null): array
    {
        $row = $this->sessionRow($token, $now); $now = self::timestamp($now ?? gmdate('c')); $csrf = self::randomToken(24);
        $this->pdo->prepare('UPDATE control_sessions SET csrf_hash = :csrf, last_seen_at = :at WHERE session_id = :id')->execute(['csrf' => hash('sha256', $csrf), 'at' => $now, 'id' => $row['session_id']]);
        return ['userId' => (string) $row['user_id'], 'expiresAt' => (string) $row['expires_at'], 'csrfToken' => $csrf, 'remembered' => $row['remembered_until'] !== null, 'role' => $this->finalSchemaPresent() ? ($this->profile((string) $row['user_id'])['role'] ?? 'STAFF') : 'OWNER'];
    }

    /** Read authenticated identity without rotating CSRF or extending the session. */
    public function authenticatedUser(string $token, ?string $now = null): array { $row=$this->sessionRow($token,$now); return ['userId'=>(string)$row['user_id'],'role'=>$this->finalSchemaPresent()?($this->profile((string)$row['user_id'])['role']??'STAFF'):'OWNER']; }

    public function logout(string $token): void { $row = $this->sessionRow($token); $this->pdo->prepare('UPDATE control_sessions SET revoked_at = :at WHERE session_id = :id')->execute(['at' => gmdate('c'), 'id' => $row['session_id']]); $this->audit((string) $row['user_id'], 'logout', gmdate('c')); }
    public function logoutAll(string $token): void { $row = $this->sessionRow($token); $this->pdo->prepare('UPDATE control_sessions SET revoked_at = :at WHERE user_id = :user AND revoked_at IS NULL')->execute(['at' => gmdate('c'), 'user' => $row['user_id']]); $this->audit((string) $row['user_id'], 'logout_all', gmdate('c')); }
    public function sessions(string $token): array { $row = $this->sessionRow($token); $q = $this->pdo->prepare("SELECT session_id, created_at, expires_at, last_seen_at, remembered_until FROM control_sessions WHERE user_id = :user AND session_kind = 'password' AND revoked_at IS NULL ORDER BY last_seen_at DESC LIMIT 20"); $q->execute(['user' => $row['user_id']]); return ['schemaVersion' => 1, 'sessions' => array_map(static fn (array $item): array => ['sessionId' => (string) $item['session_id'], 'createdAt' => (string) $item['created_at'], 'expiresAt' => (string) $item['expires_at'], 'lastSeenAt' => (string) $item['last_seen_at'], 'remembered' => $item['remembered_until'] !== null, 'current' => (string) $item['session_id'] === (string) $row['session_id']], $q->fetchAll())]; }
    public function revokeSession(string $token, string $csrf, string $sessionId): void { $row = $this->authorize($token, $csrf); if (!self::isUuid($sessionId)) throw new HubOwnerAuthException('Session is invalid', 'SESSION_INVALID'); $at = gmdate('c'); $q = $this->pdo->prepare("UPDATE control_sessions SET revoked_at = :at WHERE session_id = :id AND user_id = :user AND session_kind = 'password' AND revoked_at IS NULL"); $q->execute(['at' => $at, 'id' => strtolower($sessionId), 'user' => $row['user_id']]); if ($q->rowCount() !== 1) throw new HubOwnerAuthException('Session was not found', 'SESSION_NOT_FOUND'); $this->audit((string) $row['user_id'], 'session_revoked', $at); }

    /** Canonical account identity: the Hub user row, never a browser profile cache. */
    public function identity(string $token): array
    {
        $session = $this->sessionRow($token); $q = $this->pdo->prepare('SELECT u.display_name, p.username FROM hub_users u JOIN owner_passwords p ON p.user_id = u.user_id AND p.enabled = 1 WHERE u.user_id = :user AND u.revoked_at IS NULL'); $q->execute(['user' => $session['user_id']]); $row = $q->fetch();
        if (!is_array($row)) throw new HubOwnerAuthException('Account identity is unavailable', 'AUTH_UNAVAILABLE');
        return ['schemaVersion' => 1, 'displayName' => (string) $row['display_name'], 'username' => (string) $row['username']];
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
        $now = gmdate('c'); $this->pdo->prepare('UPDATE owner_passwords SET password_hash = :hash, password_changed_at = :at WHERE user_id = :user')->execute(['hash' => self::hashPassword($newPassword), 'at' => $now, 'user' => $row['user_id']]); $this->pdo->prepare('UPDATE control_sessions SET revoked_at = :at WHERE user_id = :user AND revoked_at IS NULL')->execute(['at' => $now, 'user' => $row['user_id']]); $this->audit((string) $row['user_id'], 'password_changed', $now);
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
        $this->pdo->beginTransaction(); try { $this->pdo->prepare('UPDATE auth_recovery_codes SET used_at = :at WHERE recovery_code_id = :id AND used_at IS NULL')->execute(['at' => $now, 'id' => $match]); if ((int) $this->pdo->query('SELECT changes()')->fetchColumn() !== 1) throw new RuntimeException('recovery race'); $this->pdo->prepare('UPDATE owner_passwords SET password_hash = :hash, password_changed_at = :at WHERE user_id = :user')->execute(['hash' => self::hashPassword($newPassword), 'at' => $now, 'user' => $user]); $this->pdo->prepare('UPDATE control_sessions SET revoked_at = :at WHERE user_id = :user AND revoked_at IS NULL')->execute(['at' => $now, 'user' => $user]); $this->audit((string) $user, 'recovery_used', $now); $this->pdo->commit(); $this->clearRate($rateKey); } catch (Throwable) { if ($this->pdo->inTransaction()) $this->pdo->rollBack(); throw new HubOwnerAuthException('Recovery could not be completed', 'RECOVERY_FAILED'); }
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
            $update = $this->pdo->prepare('UPDATE owner_passwords SET password_hash = :hash, password_changed_at = :at WHERE user_id = :user AND enabled = 1');
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

    /** Legacy M9 compatibility only. Current M17 product has no invitation UX or route. */
    public function inviteUser(string $token, string $csrf, array $payload, ?string $now = null): array
    {
        if ((int)$this->pdo->query('PRAGMA user_version')->fetchColumn() >= 17) throw new HubOwnerAuthException('Invitation links are not used by AWH', 'INVITATION_DISABLED');
        $owner=$this->authorize($token,$csrf,$now);$this->assertFinalReady();$this->assertOwner((string)$owner['user_id']);self::exactPayloadKeys($payload,['displayName','email','projectIds','role','username']);
        $display=self::displayName($payload['displayName']??null);$username=self::username((string)($payload['username']??''));$email=self::optionalEmail($payload['email']??null);$role=self::legacyRole($payload['role']??null);$projects=self::projectIds($payload['projectIds']??null);$at=self::timestamp($now??gmdate('c'));self::assertRecentStepUpSession($owner,$at);foreach($projects as $project)$this->assertOwnerProject((string)$owner['user_id'],$project);$existing=$this->pdo->prepare('SELECT 1 FROM owner_passwords WHERE username=:username');$existing->execute(['username'=>$username]);if($existing->fetchColumn()!==false)throw new HubOwnerAuthException('Username is not available','USERNAME_UNAVAILABLE');$code=self::randomToken(24);$id=self::uuid();
        try{$this->pdo->beginTransaction();$this->pdo->prepare('INSERT INTO control_user_invitations(invitation_id,code_hash,display_name,username,email,system_role,project_ids_json,created_by_user_id,created_at,expires_at,accepted_at,accepted_user_id,revoked_at) VALUES(:id,:hash,:display,:username,:email,:role,:projects,:owner,:at,:expires,NULL,NULL,NULL)')->execute(['id'=>$id,'hash'=>self::hashPassword($code),'display'=>$display,'username'=>$username,'email'=>$email,'role'=>$role,'projects'=>json_encode($projects,JSON_THROW_ON_ERROR),'owner'=>$owner['user_id'],'at'=>$at,'expires'=>gmdate('c',strtotime($at)+7*86400)]);$this->audit((string)$owner['user_id'],'user_invited',$at);$this->pdo->commit();}catch(Throwable $error){if($this->pdo->inTransaction())$this->pdo->rollBack();if($error instanceof HubOwnerAuthException)throw $error;throw new HubOwnerAuthException('Invitation could not be created','INVITATION_FAILED');}
        return ['invitationId'=>$id,'username'=>$username,'role'=>$role,'projectCount'=>count($projects),'expiresAt'=>gmdate('c',strtotime($at)+7*86400),'invitationCode'=>$code];
    }

    public function acceptInvitation(array $payload, ?string $now = null, ?string $rateKey = null): array
    {
        if ((int)$this->pdo->query('PRAGMA user_version')->fetchColumn() >= 17) throw new HubOwnerAuthException('Invitation links are not used by AWH', 'INVITATION_DISABLED');
        $this->assertFinalReady();self::exactPayloadKeys($payload,['invitationCode','password','schemaVersion']);if(($payload['schemaVersion']??null)!==1)throw new HubOwnerAuthException('Invitation is invalid','PAYLOAD_INVALID');$code=$payload['invitationCode']??null;if(!is_string($code)||!preg_match('/^[A-Za-z0-9_-]{32,128}$/',$code))throw new HubOwnerAuthException('Invitation could not be accepted','INVITATION_FAILED');self::password((string)($payload['password']??''));$at=self::timestamp($now??gmdate('c'));$this->assertRate(self::rateKey($rateKey??'','invite'),$at);$q=$this->pdo->prepare('SELECT * FROM control_user_invitations WHERE accepted_at IS NULL AND revoked_at IS NULL AND expires_at>:at ORDER BY created_at DESC LIMIT 50');$q->execute(['at'=>$at]);$invite=null;foreach($q->fetchAll() as $candidate)if(is_string($candidate['code_hash']??null)&&password_verify($code,(string)$candidate['code_hash'])){$invite=$candidate;break;}if(!is_array($invite))throw new HubOwnerAuthException('Invitation could not be accepted','INVITATION_FAILED');
        try{$this->pdo->beginTransaction();$id=self::uuid();$this->pdo->prepare('INSERT INTO hub_users(user_id,display_name,created_at,revoked_at) VALUES(:id,:display,:at,NULL)')->execute(['id'=>$id,'display'=>$invite['display_name'],'at'=>$at]);$this->pdo->prepare('INSERT INTO owner_passwords(user_id,username,password_hash,password_changed_at,enabled) VALUES(:user,:username,:hash,:at,1)')->execute(['user'=>$id,'username'=>$invite['username'],'hash'=>self::hashPassword((string)$payload['password']),'at'=>$at]);$this->pdo->prepare("INSERT INTO control_user_profiles(user_id,display_name,email,system_role,status,created_at,updated_at) VALUES(:id,:display,:email,:role,'ACTIVE',:at,:at)")->execute(['id'=>$id,'display'=>$invite['display_name'],'email'=>$invite['email'],'role'=>$invite['system_role'],'at'=>$at]);$projects=json_decode((string)$invite['project_ids_json'],true,32,JSON_THROW_ON_ERROR);if(!is_array($projects)||array_is_list($projects)===false)throw new RuntimeException('invalid invitation project list');$membership=$this->pdo->prepare("INSERT INTO user_project_memberships(user_id,project_id,role,created_at,revoked_at) VALUES(:user,:project,'member',:at,NULL)");$capability=$this->pdo->prepare('INSERT INTO control_project_capabilities(user_id,project_id,capability,granted_by_user_id,created_at,revoked_at) VALUES(:user,:project,:capability,:owner,:at,NULL)');foreach($projects as $project){$membership->execute(['user'=>$id,'project'=>$project,'at'=>$at]);foreach(self::legacyRoleCapabilities((string)$invite['system_role']) as $name)$capability->execute(['user'=>$id,'project'=>$project,'capability'=>$name,'owner'=>$invite['created_by_user_id'],'at'=>$at]);}$this->pdo->prepare('UPDATE control_user_invitations SET accepted_at=:at,accepted_user_id=:user WHERE invitation_id=:invite AND accepted_at IS NULL AND revoked_at IS NULL')->execute(['at'=>$at,'user'=>$id,'invite'=>$invite['invitation_id']]);$this->audit($id,'invitation_accepted',$at);$this->pdo->commit();return ['username'=>(string)$invite['username'],'userId'=>$id];}catch(Throwable $error){if($this->pdo->inTransaction())$this->pdo->rollBack();if($error instanceof HubOwnerAuthException)throw $error;throw new HubOwnerAuthException('Invitation could not be accepted','INVITATION_FAILED');}
    }

    /** Public application: password is chosen by the applicant but no login authority is created. */
    public function registerAccessRequest(array $payload, ?string $now = null, ?string $rateKey = null): array
    {
        $this->assertAccountHostingReady();
        self::exactPayloadKeys($payload, ['displayName','email','note','password','personType','phone','requestedArea','schemaVersion','username']);
        if (($payload['schemaVersion'] ?? null) !== 1) throw new HubOwnerAuthException('Registration request is invalid', 'PAYLOAD_INVALID');
        $display = self::displayName($payload['displayName'] ?? null); $username = self::username((string)($payload['username'] ?? '')); self::password((string)($payload['password'] ?? ''));
        $email = self::optionalEmail($payload['email'] ?? null); $phone = self::optionalPhone($payload['phone'] ?? null); $personType = self::personType($payload['personType'] ?? null);
        $area = self::optionalText($payload['requestedArea'] ?? null, 120); $note = self::optionalText($payload['note'] ?? null, 500); $at = self::timestamp($now ?? gmdate('c'));
        $key = self::rateKey($rateKey ?? '', 'register:' . $username); $this->assertRate($key, $at);
        $existing = $this->pdo->prepare('SELECT 1 FROM owner_passwords WHERE username=:username'); $existing->execute(['username'=>$username]); if ($existing->fetchColumn() !== false) { $this->failedRate($key,$at); throw new HubOwnerAuthException('Username is not available','USERNAME_UNAVAILABLE'); }
        $pending = $this->pdo->prepare("SELECT 1 FROM control_account_requests WHERE lower(username)=:username AND state='PENDING'"); $pending->execute(['username'=>$username]); if ($pending->fetchColumn() !== false) throw new HubOwnerAuthException('Registration request is already pending','REGISTRATION_PENDING');
        $id = self::uuid();
        try {
            $this->pdo->prepare("INSERT INTO control_account_requests(request_id,display_name,username,email,phone,person_type,requested_area,note,password_hash,state,submitted_at,reviewed_at,reviewed_by_user_id,resolved_user_id) VALUES(:id,:display,:username,:email,:phone,:person,:area,:note,:hash,'PENDING',:at,NULL,NULL,NULL)")->execute(['id'=>$id,'display'=>$display,'username'=>$username,'email'=>$email,'phone'=>$phone,'person'=>$personType,'area'=>$area,'note'=>$note,'hash'=>self::hashPassword((string)$payload['password']),'at'=>$at]);
            $this->failedRate($key,$at);
        } catch (PDOException $error) { throw new HubOwnerAuthException('Registration request could not be saved', str_contains(strtolower($error->getMessage()), 'unique') ? 'USERNAME_UNAVAILABLE' : 'REGISTRATION_FAILED'); }
        return ['requestId'=>$id,'state'=>'PENDING','message'=>'ส่งคำขอใช้งานแล้ว รอผู้ดูแลพิจารณา'];
    }

    /** Owner creates a normal account directly; no invitation code or generated password exists. */
    public function createUserDirect(string $token, string $csrf, array $payload, ?string $now = null): array
    {
        $owner=$this->authorize($token,$csrf,$now); $this->assertAccountHostingReady(); $this->assertOwner((string)$owner['user_id']);
        self::exactPayloadKeys($payload,['displayName','email','mustChangePassword','password','personType','phone','projectIds','role','schemaVersion','username']);
        if (($payload['schemaVersion']??null)!==1 || !is_bool($payload['mustChangePassword']??null)) throw new HubOwnerAuthException('Account request is invalid','PAYLOAD_INVALID');
        $at=self::timestamp($now??gmdate('c')); self::assertRecentStepUpSession($owner,$at);
        $display=self::displayName($payload['displayName']??null); $username=self::username((string)($payload['username']??'')); self::password((string)($payload['password']??''));
        $email=self::optionalEmail($payload['email']??null); $phone=self::optionalPhone($payload['phone']??null); $person=self::personType($payload['personType']??null); $role=self::platformRole($payload['role']??null); $projects=self::projectIds($payload['projectIds']??null,true);
        foreach($projects as $project) $this->assertOwnerProject((string)$owner['user_id'],$project);
        $id=self::uuid();
        try { $this->pdo->beginTransaction(); $this->createAccountRecord($id,$display,$username,self::hashPassword((string)$payload['password']),$email,$phone,$person,$role,$projects,(bool)$payload['mustChangePassword'],(string)$owner['user_id'],$at); $this->audit((string)$owner['user_id'],'user_created',$at); $this->pdo->commit(); }
        catch(PDOException $error){if($this->pdo->inTransaction())$this->pdo->rollBack();throw new HubOwnerAuthException('Account could not be created',str_contains(strtolower($error->getMessage()),'unique')?'USERNAME_UNAVAILABLE':'USER_CREATE_FAILED');}
        catch(Throwable $error){if($this->pdo->inTransaction())$this->pdo->rollBack();if($error instanceof HubOwnerAuthException)throw $error;throw new HubOwnerAuthException('Account could not be created','USER_CREATE_FAILED');}
        return ['userId'=>$id,'username'=>$username,'role'=>$role,'projectIds'=>$projects,'status'=>'ACTIVE'];
    }

    public function accountRequests(string $token, ?string $now = null): array
    {
        $row=$this->sessionRow($token, $now); $this->assertAccountHostingReady(); $this->assertOwner((string)$row['user_id']);
        $q=$this->pdo->query("SELECT request_id,display_name,username,email,phone,person_type,requested_area,note,state,submitted_at,reviewed_at FROM control_account_requests ORDER BY CASE state WHEN 'PENDING' THEN 0 ELSE 1 END,submitted_at DESC LIMIT 100");
        return ['schemaVersion'=>1,'requests'=>array_map(static fn(array $r):array=>['requestId'=>(string)$r['request_id'],'displayName'=>(string)$r['display_name'],'username'=>(string)$r['username'],'email'=>$r['email'],'phone'=>$r['phone'],'personType'=>(string)$r['person_type'],'requestedArea'=>$r['requested_area'],'note'=>$r['note'],'state'=>(string)$r['state'],'submittedAt'=>(string)$r['submitted_at'],'reviewedAt'=>$r['reviewed_at']],$q->fetchAll())];
    }

    public function reviewAccountRequest(string $token,string $csrf,string $requestId,array $payload,?string $now=null): array
    {
        $owner=$this->authorize($token,$csrf,$now);$this->assertAccountHostingReady();$this->assertOwner((string)$owner['user_id']);if(!self::isUuid($requestId))throw new HubOwnerAuthException('Registration request is invalid','REGISTRATION_NOT_FOUND');
        self::exactPayloadKeys($payload,['decision','projectIds','role','schemaVersion']); if(($payload['schemaVersion']??null)!==1 || !in_array($payload['decision']??null,['APPROVE','REJECT'],true))throw new HubOwnerAuthException('Review request is invalid','PAYLOAD_INVALID');
        $at=self::timestamp($now??gmdate('c'));self::assertRecentStepUpSession($owner,$at);$role=self::platformRole($payload['role']??'VIEWER');$projects=self::projectIds($payload['projectIds']??[],true);foreach($projects as $project)$this->assertOwnerProject((string)$owner['user_id'],$project);
        try{$this->pdo->beginTransaction();$q=$this->pdo->prepare("SELECT * FROM control_account_requests WHERE request_id=:id AND state='PENDING'");$q->execute(['id'=>strtolower($requestId)]);$request=$q->fetch();if(!is_array($request))throw new HubOwnerAuthException('Registration request was not found','REGISTRATION_NOT_FOUND');
            if($payload['decision']==='REJECT'){$this->pdo->prepare("UPDATE control_account_requests SET state='REJECTED',password_hash=NULL,reviewed_at=:at,reviewed_by_user_id=:owner WHERE request_id=:id AND state='PENDING'")->execute(['at'=>$at,'owner'=>$owner['user_id'],'id'=>$requestId]);$this->audit((string)$owner['user_id'],'account_request_rejected',$at);$this->pdo->commit();return ['requestId'=>strtolower($requestId),'state'=>'REJECTED'];}
            if(!is_string($request['password_hash'])||$request['password_hash']==='')throw new HubOwnerAuthException('Registration password is unavailable','REGISTRATION_FAILED');$id=self::uuid();$this->createAccountRecord($id,(string)$request['display_name'],(string)$request['username'],(string)$request['password_hash'],$request['email']===null?null:(string)$request['email'],$request['phone']===null?null:(string)$request['phone'],(string)$request['person_type'],$role,$projects,false,(string)$owner['user_id'],$at);
            $this->pdo->prepare("UPDATE control_account_requests SET state='APPROVED',password_hash=NULL,reviewed_at=:at,reviewed_by_user_id=:owner,resolved_user_id=:user WHERE request_id=:id AND state='PENDING'")->execute(['at'=>$at,'owner'=>$owner['user_id'],'user'=>$id,'id'=>$requestId]);$this->audit((string)$owner['user_id'],'account_request_approved',$at);$this->pdo->commit();return ['requestId'=>strtolower($requestId),'state'=>'APPROVED','userId'=>$id,'username'=>(string)$request['username'],'role'=>$role,'projectIds'=>$projects];
        }catch(Throwable $error){if($this->pdo->inTransaction())$this->pdo->rollBack();if($error instanceof HubOwnerAuthException)throw $error;if($error instanceof PDOException&&str_contains(strtolower($error->getMessage()),'unique'))throw new HubOwnerAuthException('Username or email is already used','USERNAME_UNAVAILABLE');throw new HubOwnerAuthException('Registration request could not be reviewed','REGISTRATION_FAILED');}
    }

    public function people(string $token): array
    {
        $row = $this->sessionRow($token); $this->assertFinalReady(); $this->assertOwner((string) $row['user_id']);
        $q = $this->pdo->query("SELECT p.user_id, p.display_name, p.email, p.phone, p.person_type, p.must_change_password, p.system_role, p.status, u.created_at, MAX(s.last_seen_at) AS last_seen_at FROM control_user_profiles p JOIN hub_users u ON u.user_id = p.user_id LEFT JOIN control_sessions s ON s.user_id = p.user_id AND s.revoked_at IS NULL GROUP BY p.user_id ORDER BY CASE WHEN p.system_role = 'OWNER' THEN 0 ELSE 1 END, p.display_name LIMIT 100");
        $people = [];
        $projects = $this->pdo->prepare('SELECT project_id FROM user_project_memberships WHERE user_id = :user AND revoked_at IS NULL ORDER BY project_id');
        foreach ($q->fetchAll() as $person) {
            $projects->execute(['user' => $person['user_id']]);
            $people[] = ['userId' => (string) $person['user_id'], 'displayName' => (string) $person['display_name'], 'email' => $person['email'] === null ? null : (string) $person['email'], 'phone' => $person['phone'] === null ? null : (string) $person['phone'], 'personType' => (string) $person['person_type'], 'mustChangePassword' => (int)$person['must_change_password'] === 1, 'role' => (string) $person['system_role'], 'status' => (string) $person['status'], 'createdAt' => (string) $person['created_at'], 'lastSeenAt' => $person['last_seen_at'] === null ? null : (string) $person['last_seen_at'], 'projectIds' => array_map(static fn (array $item): string => (string) $item['project_id'], $projects->fetchAll())];
        }
        return ['schemaVersion' => 1, 'people' => $people];
    }

    /** Owner-only role/project access editor for an existing non-owner account. */
    public function updateUserAccess(string $token, string $csrf, string $userId, array $payload, ?string $now = null): array
    {
        $owner = $this->authorize($token, $csrf, $now); $this->assertFinalReady(); $this->assertOwner((string) $owner['user_id']);
        if (!self::isUuid($userId) || hash_equals((string) $owner['user_id'], strtolower($userId))) throw new HubOwnerAuthException('Owner access cannot be edited here', 'USER_ACCESS_FORBIDDEN');
        self::exactPayloadKeys($payload, ['projectIds', 'role', 'schemaVersion']); if (($payload['schemaVersion'] ?? null) !== 1) throw new HubOwnerAuthException('User access request is invalid', 'PAYLOAD_INVALID');
        $role = self::platformRole($payload['role'] ?? null); $projects = self::projectIds($payload['projectIds'] ?? null, true); $at = self::timestamp($now ?? gmdate('c')); self::assertRecentStepUpSession($owner, $at);
        foreach ($projects as $project) $this->assertOwnerProject((string) $owner['user_id'], $project);
        $profile = $this->pdo->prepare("SELECT status, system_role FROM control_user_profiles WHERE user_id = :user"); $profile->execute(['user' => strtolower($userId)]); $current = $profile->fetch();
        if (!is_array($current) || (string) $current['status'] !== 'ACTIVE') throw new HubOwnerAuthException('User was not found', 'USER_NOT_FOUND');
        if ((string) $current['system_role'] === 'OWNER') throw new HubOwnerAuthException('Owner access cannot be edited here', 'USER_ACCESS_FORBIDDEN');
        try {
            $this->pdo->beginTransaction();
            $this->pdo->prepare('UPDATE control_user_profiles SET system_role = :role, updated_at = :at WHERE user_id = :user')->execute(['role' => $role, 'at' => $at, 'user' => strtolower($userId)]);
            $this->pdo->prepare('UPDATE user_project_memberships SET revoked_at = :at WHERE user_id = :user AND revoked_at IS NULL')->execute(['at' => $at, 'user' => strtolower($userId)]);
            $this->pdo->prepare('UPDATE control_project_capabilities SET revoked_at = :at WHERE user_id = :user AND revoked_at IS NULL')->execute(['at' => $at, 'user' => strtolower($userId)]);
            $membership = $this->pdo->prepare("INSERT INTO user_project_memberships(user_id, project_id, role, created_at, revoked_at) VALUES(:user, :project, 'member', :at, NULL) ON CONFLICT(user_id, project_id) DO UPDATE SET role='member', revoked_at=NULL");
            $capability = $this->pdo->prepare('INSERT INTO control_project_capabilities(user_id, project_id, capability, granted_by_user_id, created_at, revoked_at) VALUES(:user, :project, :capability, :owner, :at, NULL) ON CONFLICT(user_id, project_id, capability) DO UPDATE SET granted_by_user_id=excluded.granted_by_user_id, created_at=excluded.created_at, revoked_at=NULL');
            foreach ($projects as $project) { $membership->execute(['user' => strtolower($userId), 'project' => $project, 'at' => $at]); foreach (self::roleCapabilities($role) as $name) $capability->execute(['user' => strtolower($userId), 'project' => $project, 'capability' => $name, 'owner' => $owner['user_id'], 'at' => $at]); }
            $this->pdo->prepare('UPDATE control_sessions SET revoked_at = :at WHERE user_id = :user AND revoked_at IS NULL')->execute(['at' => $at, 'user' => strtolower($userId)]);
            $this->audit((string) $owner['user_id'], 'user_access_updated', $at); $this->pdo->commit();
        } catch (Throwable $error) { if ($this->pdo->inTransaction()) $this->pdo->rollBack(); if ($error instanceof HubOwnerAuthException) throw $error; throw new HubOwnerAuthException('User access could not be updated', 'USER_ACCESS_UPDATE_FAILED'); }
        return ['userId' => strtolower($userId), 'role' => $role, 'projectIds' => $projects, 'reauthenticateUser' => true];
    }

    public function revokeUser(string $token, string $csrf, string $userId, ?string $now = null): void
    {
        $owner = $this->authorize($token, $csrf, $now); $this->assertFinalReady(); $this->assertOwner((string) $owner['user_id']); if (!self::isUuid($userId) || hash_equals((string) $owner['user_id'], strtolower($userId))) throw new HubOwnerAuthException('This account cannot be revoked', 'USER_REVOKE_FORBIDDEN'); $at = self::timestamp($now ?? gmdate('c')); self::assertRecentStepUpSession($owner, $at);
        try { $this->pdo->beginTransaction(); $this->pdo->prepare('UPDATE control_user_profiles SET status = \'REVOKED\', updated_at = :at WHERE user_id = :user AND system_role != \'OWNER\' AND status = \'ACTIVE\'')->execute(['at' => $at, 'user' => strtolower($userId)]); if ($this->pdo->query('SELECT changes()')->fetchColumn() !== 1) throw new HubOwnerAuthException('User was not found', 'USER_NOT_FOUND'); $this->pdo->prepare('UPDATE hub_users SET revoked_at = :at WHERE user_id = :user')->execute(['at' => $at, 'user' => strtolower($userId)]); $this->pdo->prepare('UPDATE user_project_memberships SET revoked_at = :at WHERE user_id = :user AND revoked_at IS NULL')->execute(['at' => $at, 'user' => strtolower($userId)]); $this->pdo->prepare('UPDATE control_project_capabilities SET revoked_at = :at WHERE user_id = :user AND revoked_at IS NULL')->execute(['at' => $at, 'user' => strtolower($userId)]); $this->pdo->prepare('UPDATE control_sessions SET revoked_at = :at WHERE user_id = :user AND revoked_at IS NULL')->execute(['at' => $at, 'user' => strtolower($userId)]); $this->audit((string) $owner['user_id'], 'user_revoked', $at); $this->pdo->commit(); } catch (Throwable $error) { if ($this->pdo->inTransaction()) $this->pdo->rollBack(); if ($error instanceof HubOwnerAuthException) throw $error; throw new HubOwnerAuthException('User could not be revoked', 'USER_REVOKE_FAILED'); }
    }

    public function authorize(string $token, string $csrf, ?string $now = null): array { $row = $this->sessionRow($token, $now); if ($csrf === '' || !hash_equals((string) $row['csrf_hash'], hash('sha256', $csrf))) throw new HubOwnerAuthException('Request could not be verified', 'CSRF_REJECTED'); return $row; }

    private function sessionRow(string $token, ?string $now = null): array { if ($token === '' || strlen($token) > 512 || preg_match('/[\x00-\x1F\x7F]/', $token)) throw new HubOwnerAuthException('Session is invalid', 'SESSION_INVALID'); $q = $this->pdo->prepare("SELECT s.* FROM control_sessions s JOIN hub_users u ON u.user_id = s.user_id AND u.revoked_at IS NULL WHERE s.session_hash = :hash AND s.session_kind = 'password'"); $q->execute(['hash' => hash('sha256', $token)]); $row = $q->fetch(); $at = strtotime(self::timestamp($now ?? gmdate('c'))); $inactivity = is_array($row) && $row['remembered_until'] !== null ? self::REMEMBER_TTL : self::INACTIVITY_TTL; if (!is_array($row) || $row['revoked_at'] !== null || strtotime((string) $row['expires_at']) <= $at || strtotime((string) $row['last_seen_at']) + $inactivity <= $at) throw new HubOwnerAuthException('Session is expired', 'SESSION_EXPIRED'); return $row; }
    private function assertRate(string $key, string $now): void { $q = $this->pdo->prepare('SELECT window_started_at, attempts, blocked_until FROM auth_login_rate_limits WHERE rate_key = :key'); $q->execute(['key' => $key]); $row = $q->fetch(); if (!is_array($row)) return; $at = strtotime($now); if ($row['blocked_until'] !== null && strtotime((string) $row['blocked_until']) > $at) throw new HubOwnerAuthException('Too many attempts', 'RATE_LIMITED'); if (strtotime((string) $row['window_started_at']) + self::RATE_WINDOW <= $at) $this->clearRate($key); }
    private function failedRate(string $key, string $now): void { $q = $this->pdo->prepare('SELECT attempts, window_started_at FROM auth_login_rate_limits WHERE rate_key = :key'); $q->execute(['key' => $key]); $row = $q->fetch(); $attempts = is_array($row) && strtotime((string) $row['window_started_at']) + self::RATE_WINDOW > strtotime($now) ? (int) $row['attempts'] + 1 : 1; $blocked = $attempts >= self::RATE_MAX ? gmdate('c', strtotime($now) + 900) : null; $this->pdo->prepare('INSERT INTO auth_login_rate_limits(rate_key, window_started_at, attempts, blocked_until) VALUES(:key, :at, :attempts, :blocked) ON CONFLICT(rate_key) DO UPDATE SET window_started_at = excluded.window_started_at, attempts = excluded.attempts, blocked_until = excluded.blocked_until')->execute(['key' => $key, 'at' => is_array($row) && strtotime((string) $row['window_started_at']) + self::RATE_WINDOW > strtotime($now) ? $row['window_started_at'] : $now, 'attempts' => $attempts, 'blocked' => $blocked]); }
    private function clearRate(string $key): void { $this->pdo->prepare('DELETE FROM auth_login_rate_limits WHERE rate_key = :key')->execute(['key' => $key]); }
    private function createRecoveryCodes(string $user, string $now): array { $this->pdo->prepare("DELETE FROM auth_recovery_codes WHERE user_id = :user AND used_at IS NULL AND recovery_code_id NOT LIKE 'reset-%'")->execute(['user' => $user]); $plain = []; $insert = $this->pdo->prepare('INSERT INTO auth_recovery_codes(recovery_code_id, user_id, code_hash, created_at, used_at) VALUES(:id, :user, :hash, :at, NULL)'); for ($i = 0; $i < 8; $i++) { $code = strtoupper(bin2hex(random_bytes(6))); $plain[] = $code; $insert->execute(['id' => self::uuid(), 'user' => $user, 'hash' => self::hashPassword($code), 'at' => $now]); } return $plain; }
    private function audit(string $user, string $event, string $now): void { $this->pdo->prepare('INSERT INTO auth_audit_events(event_id, user_id, event_name, occurred_at, metadata_hash) VALUES(:id, :user, :event, :at, NULL)')->execute(['id' => self::uuid(), 'user' => $user, 'event' => $event, 'at' => $now]); }
    private function assertFinalReady(): void { HubFinalProductMigration::assertCapabilityReady($this->pdo, dirname(__DIR__) . '/migrations/008_final_product.sql'); }
    private function assertAccountHostingReady(): void { HubAccountHostingMigration::assertCapabilityReady($this->pdo, dirname(__DIR__) . '/migrations/016_account_hosting.sql'); }
    private function finalSchemaPresent(): bool { return $this->pdo->query("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'control_user_profiles'")->fetchColumn() !== false; }
    private function assertOwner(string $userId): void { $q = $this->pdo->prepare('SELECT owner_user_id FROM owner_bootstrap WHERE singleton_id = 1 AND bootstrap_closed = 1'); $q->execute(); if (!hash_equals((string) $q->fetchColumn(), $userId)) throw new HubOwnerAuthException('Owner access is required', 'OWNER_FORBIDDEN'); }
    private function assertOwnerProject(string $userId, string $projectId): void { $q = $this->pdo->prepare("SELECT 1 FROM control_project_capabilities WHERE user_id = :user AND project_id = :project AND capability = 'project.read' AND revoked_at IS NULL"); $q->execute(['user' => $userId, 'project' => $projectId]); if ($q->fetchColumn() === false) throw new HubOwnerAuthException('Project is not available', 'PROJECT_FORBIDDEN'); }
    private function profile(string $userId): ?array { if (!$this->finalSchemaPresent()) return null; $q = $this->pdo->prepare('SELECT system_role, status FROM control_user_profiles WHERE user_id = :user'); $q->execute(['user' => $userId]); $row = $q->fetch(); return is_array($row) ? ['role' => (string) $row['system_role'], 'status' => (string) $row['status']] : null; }
    private static function exactPayloadKeys(array $value, array $allowed): void { $actual = array_keys($value); sort($actual); sort($allowed); if ($actual !== $allowed) throw new HubOwnerAuthException('Payload fields are invalid', 'SCHEMA_FIELDS'); }
    private static function displayName(mixed $value): string { if (!is_string($value)) throw new HubOwnerAuthException('Display name is invalid', 'PAYLOAD_INVALID'); $value = trim($value); if ($value === '' || strlen($value) > 80 || preg_match('/[\x00-\x1f\x7f]/', $value)) throw new HubOwnerAuthException('Display name is invalid', 'PAYLOAD_INVALID'); return $value; }
    private static function optionalEmail(mixed $value): ?string { if ($value === null || $value === '') return null; if (!is_string($value) || strlen($value) > 160 || filter_var($value, FILTER_VALIDATE_EMAIL) === false) throw new HubOwnerAuthException('Email is invalid', 'PAYLOAD_INVALID'); return strtolower($value); }
    private static function optionalPhone(mixed $value): ?string { if ($value === null || $value === '') return null; if (!is_string($value)) throw new HubOwnerAuthException('Phone is invalid','PAYLOAD_INVALID'); $value=trim($value); if(!preg_match('/^[0-9+() .-]{6,30}$/',$value)) throw new HubOwnerAuthException('Phone is invalid','PAYLOAD_INVALID'); return $value; }
    private static function optionalText(mixed $value,int $max): ?string { if($value===null||$value==='')return null;if(!is_string($value))throw new HubOwnerAuthException('Text is invalid','PAYLOAD_INVALID');$value=trim($value);if(strlen($value)>$max||preg_match('/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/',$value))throw new HubOwnerAuthException('Text is invalid','PAYLOAD_INVALID');return $value===''?null:$value; }
    private static function personType(mixed $value): string { if(!is_string($value)||!in_array(strtoupper($value),['DIRECTOR','TEACHER','STAFF','PARENT','STUDENT','OTHER'],true))throw new HubOwnerAuthException('Person type is invalid','PAYLOAD_INVALID');return strtoupper($value); }
    private static function legacyRole(mixed $value): string { if(!is_string($value)||!in_array($value,['COLLABORATOR','VIEWER','APPROVER'],true))throw new HubOwnerAuthException('Role is invalid','PAYLOAD_INVALID');return $value; }
    private static function legacyRoleCapabilities(string $role): array { return match($role){'COLLABORATOR'=>['project.read','conversation.write','attachment.upload'],'APPROVER'=>['project.read','approval.decide'],'VIEWER'=>['project.read'],default=>throw new HubOwnerAuthException('Role is invalid','PAYLOAD_INVALID')}; }
    private static function platformRole(mixed $value): string { if (!is_string($value) || !in_array(strtoupper($value), ['ADMIN','DIRECTOR','TEACHER','STAFF','VIEWER'], true)) throw new HubOwnerAuthException('Role is invalid', 'PAYLOAD_INVALID'); return strtoupper($value); }
    private static function projectIds(mixed $value,bool $allowEmpty=false): array { if (!is_array($value) || array_is_list($value) === false || (!$allowEmpty && count($value)<1) || count($value) > 50) throw new HubOwnerAuthException('Project permissions are invalid', 'PAYLOAD_INVALID'); $out = []; foreach ($value as $id) { if (!is_string($id) || !self::isUuid($id)) throw new HubOwnerAuthException('Project permissions are invalid', 'PAYLOAD_INVALID'); $out[] = strtolower($id); } if (count(array_unique($out)) !== count($out)) throw new HubOwnerAuthException('Project permissions are invalid', 'PAYLOAD_INVALID'); return $out; }
    private static function roleCapabilities(string $role): array { return match ($role) { 'ADMIN' => ['project.read','conversation.write','attachment.upload','approval.decide','deployment.approve'], 'DIRECTOR' => ['project.read','approval.decide'], 'TEACHER','STAFF' => ['project.read','conversation.write','attachment.upload'], 'VIEWER' => ['project.read'], default => throw new HubOwnerAuthException('Role is invalid', 'PAYLOAD_INVALID') }; }
    private function createAccountRecord(string $id,string $display,string $username,string $passwordHash,?string $email,?string $phone,string $person,string $role,array $projects,bool $mustChange,string $owner,string $at): void {
        $exists=$this->pdo->prepare('SELECT 1 FROM owner_passwords WHERE username=:username');$exists->execute(['username'=>$username]);if($exists->fetchColumn()!==false)throw new HubOwnerAuthException('Username is not available','USERNAME_UNAVAILABLE');
        $this->pdo->prepare('INSERT INTO hub_users(user_id,display_name,created_at,revoked_at) VALUES(:id,:display,:at,NULL)')->execute(['id'=>$id,'display'=>$display,'at'=>$at]);
        $this->pdo->prepare('INSERT INTO owner_passwords(user_id,username,password_hash,password_changed_at,enabled) VALUES(:id,:username,:hash,:at,1)')->execute(['id'=>$id,'username'=>$username,'hash'=>$passwordHash,'at'=>$at]);
        $this->pdo->prepare("INSERT INTO control_user_profiles(user_id,display_name,email,phone,person_type,system_role,status,must_change_password,created_at,updated_at) VALUES(:id,:display,:email,:phone,:person,:role,'ACTIVE',:must,:at,:at)")->execute(['id'=>$id,'display'=>$display,'email'=>$email,'phone'=>$phone,'person'=>$person,'role'=>$role,'must'=>$mustChange?1:0,'at'=>$at]);
        $membership=$this->pdo->prepare("INSERT INTO user_project_memberships(user_id,project_id,role,created_at,revoked_at) VALUES(:user,:project,'member',:at,NULL)");$cap=$this->pdo->prepare('INSERT INTO control_project_capabilities(user_id,project_id,capability,granted_by_user_id,created_at,revoked_at) VALUES(:user,:project,:cap,:owner,:at,NULL)');
        foreach($projects as $project){$membership->execute(['user'=>$id,'project'=>$project,'at'=>$at]);foreach(self::roleCapabilities($role) as $name)$cap->execute(['user'=>$id,'project'=>$project,'cap'=>$name,'owner'=>$owner,'at'=>$at]);}
    }
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
