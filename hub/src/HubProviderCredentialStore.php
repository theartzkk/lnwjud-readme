<?php

declare(strict_types=1);

/**
 * The sole persistent provider-secret boundary.  It is intentionally a
 * server-side file store rather than a database column: SQLite, exports,
 * browser responses, tasks, artifacts and worker messages never carry a key.
 */
final class HubProviderCredentialStoreException extends RuntimeException
{
    public function __construct(string $message, public readonly string $codeName = 'PROVIDER_CREDENTIAL_FAILED') { parent::__construct($message); }
}

final class HubProviderCredentialStore
{
    private const PROVIDER = 'openai';
    private const DEFAULT_ROOT = '/var/lib/awh-hub/provider-credentials';

    public function __construct(private readonly string $root)
    {
        if ($root === '' || str_contains($root, "\0") || !str_starts_with($root, '/')) throw new HubProviderCredentialStoreException('Provider credential storage is invalid', 'PROVIDER_CREDENTIAL_STORE_INVALID');
    }

    public static function fromEnvironment(): self
    {
        $configured = getenv('AWH_PROVIDER_CREDENTIAL_ROOT');
        if (!is_string($configured) || $configured === '') return new self(self::DEFAULT_ROOT);
        if ($configured === self::DEFAULT_ROOT) return new self($configured);
        // A test-only root is accepted by CLI fixtures.  FPM can never turn an
        // arbitrary environment value into a credential path.
        $temporary = rtrim(sys_get_temp_dir(), '/') . '/awh-';
        if (PHP_SAPI === 'cli' && str_starts_with($configured, $temporary)) return new self($configured);
        throw new HubProviderCredentialStoreException('Provider credential storage is invalid', 'PROVIDER_CREDENTIAL_STORE_INVALID');
    }

    public function configured(): bool { return $this->read() !== null; }

    public function read(): ?string
    {
        $path = $this->path();
        clearstatcache(true, $path);
        if (!file_exists($path) && !is_link($path)) return null;
        $this->assertRegularSecretFile($path);
        $size = @filesize($path); if (!is_int($size) || $size < 1 || $size > 1024) throw new HubProviderCredentialStoreException('Provider credential is invalid', 'PROVIDER_CREDENTIAL_STORE_INVALID');
        $value = trim((string) @file_get_contents($path));
        return self::secret($value);
    }

    public function replace(string $value): void
    {
        $secret = self::secret($value); $this->ensureRoot(); $path = $this->path();
        if (file_exists($path) || is_link($path)) $this->assertRegularSecretFile($path);
        $temporary = tempnam($this->root, '.credential-');
        // macOS may canonicalize /tmp to /private/tmp in tempnam().  Compare
        // the resolved directory rather than its spelling, while still
        // rejecting a temp file outside the protected credential directory.
        $rootDirectory = realpath($this->root); $temporaryDirectory = is_string($temporary) ? realpath(dirname($temporary)) : false;
        if (!is_string($temporary) || !is_string($rootDirectory) || !is_string($temporaryDirectory) || !hash_equals($rootDirectory, $temporaryDirectory)) throw new HubProviderCredentialStoreException('Provider credential could not be stored', 'PROVIDER_CREDENTIAL_STORE_FAILED');
        try {
            if (@file_put_contents($temporary, $secret . "\n", LOCK_EX) === false || !@chmod($temporary, 0600)) throw new HubProviderCredentialStoreException('Provider credential could not be stored', 'PROVIDER_CREDENTIAL_STORE_FAILED');
            clearstatcache(true, $temporary); $this->assertRegularSecretFile($temporary);
            if (!@rename($temporary, $path)) throw new HubProviderCredentialStoreException('Provider credential could not be stored', 'PROVIDER_CREDENTIAL_STORE_FAILED');
            clearstatcache(true, $path); $this->assertRegularSecretFile($path);
        } catch (Throwable $error) {
            if (is_file($temporary) && !is_link($temporary)) @unlink($temporary);
            if ($error instanceof HubProviderCredentialStoreException) throw $error;
            throw new HubProviderCredentialStoreException('Provider credential could not be stored', 'PROVIDER_CREDENTIAL_STORE_FAILED');
        }
    }

    public function remove(): void
    {
        $path = $this->path(); clearstatcache(true, $path); if (!file_exists($path) && !is_link($path)) return;
        $this->assertRegularSecretFile($path);
        if (!@unlink($path)) throw new HubProviderCredentialStoreException('Provider credential could not be removed', 'PROVIDER_CREDENTIAL_STORE_FAILED');
    }

    private function ensureRoot(): void
    {
        if (!file_exists($this->root) && !@mkdir($this->root, 0700, true) && !is_dir($this->root)) throw new HubProviderCredentialStoreException('Provider credential storage is unavailable', 'PROVIDER_CREDENTIAL_STORE_FAILED');
        clearstatcache(true, $this->root); $stat = @lstat($this->root);
        if (!is_dir($this->root) || is_link($this->root) || !is_array($stat) || (((int) $stat['mode'] & 0o027) !== 0)) throw new HubProviderCredentialStoreException('Provider credential storage is invalid', 'PROVIDER_CREDENTIAL_STORE_INVALID');
        @chmod($this->root, 0700);
    }

    private function path(): string { return rtrim($this->root, '/') . '/' . self::PROVIDER . '.key'; }

    private function assertRegularSecretFile(string $path): void
    {
        $stat = @lstat($path);
        if (!is_file($path) || is_link($path) || !is_array($stat) || (((int) $stat['mode'] & 0o077) !== 0)) throw new HubProviderCredentialStoreException('Provider credential storage is invalid', 'PROVIDER_CREDENTIAL_STORE_INVALID');
    }

    private static function secret(string $value): string
    {
        $value = trim($value);
        if (preg_match('/^sk-[A-Za-z0-9_-]{20,512}$/', $value) !== 1) throw new HubProviderCredentialStoreException('Provider credential is invalid', 'PROVIDER_CREDENTIAL_INVALID');
        return $value;
    }
}
