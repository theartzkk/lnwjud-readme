<?php

declare(strict_types=1);

/**
 * Sole persistent provider-secret boundary. Provider identity is allowlisted
 * into a filename; secrets never enter SQLite, browser payloads, tasks,
 * artifacts, memory, logs or worker messages.
 */
final class HubProviderCredentialStoreException extends RuntimeException
{
    public function __construct(string $message, public readonly string $codeName = 'PROVIDER_CREDENTIAL_FAILED') { parent::__construct($message); }
}

final class HubProviderCredentialStore
{
    private const DEFAULT_PROVIDER = 'openai';
    private const DEFAULT_ROOT = '/var/lib/awh-hub/provider-credentials';

    public function __construct(private readonly string $root, private readonly string $providerId = self::DEFAULT_PROVIDER)
    {
        if ($root === '' || str_contains($root, "\0") || !str_starts_with($root, '/')) throw new HubProviderCredentialStoreException('Provider credential storage is invalid', 'PROVIDER_CREDENTIAL_STORE_INVALID');
        self::provider($providerId);
    }

    public static function fromEnvironment(string $providerId = self::DEFAULT_PROVIDER): self
    {
        $providerId = self::provider($providerId); $configured = getenv('AWH_PROVIDER_CREDENTIAL_ROOT');
        if (!is_string($configured) || $configured === '') return new self(self::DEFAULT_ROOT, $providerId);
        if ($configured === self::DEFAULT_ROOT) return new self($configured, $providerId);
        $temporary = rtrim(sys_get_temp_dir(), '/') . '/awh-';
        if (PHP_SAPI === 'cli' && str_starts_with($configured, $temporary)) return new self($configured, $providerId);
        throw new HubProviderCredentialStoreException('Provider credential storage is invalid', 'PROVIDER_CREDENTIAL_STORE_INVALID');
    }

    public function providerId(): string { return $this->providerId; }
    public function configured(): bool { return $this->read() !== null; }

    public function read(): ?string
    {
        $path=$this->path(); clearstatcache(true,$path); if (!file_exists($path) && !is_link($path)) return null;
        $this->assertRegularSecretFile($path); $size=@filesize($path);
        if (!is_int($size) || $size < 1 || $size > 4096) throw new HubProviderCredentialStoreException('Provider credential is invalid','PROVIDER_CREDENTIAL_STORE_INVALID');
        return $this->secret(trim((string)@file_get_contents($path)));
    }

    public function replace(string $value): void
    {
        $secret=$this->secret($value); $this->ensureRoot(); $path=$this->path();
        if (file_exists($path) || is_link($path)) $this->assertRegularSecretFile($path);
        $temporary=tempnam($this->root,'.credential-'); $rootDirectory=realpath($this->root); $temporaryDirectory=is_string($temporary)?realpath(dirname($temporary)):false;
        if (!is_string($temporary) || !is_string($rootDirectory) || !is_string($temporaryDirectory) || !hash_equals($rootDirectory,$temporaryDirectory)) throw new HubProviderCredentialStoreException('Provider credential could not be stored','PROVIDER_CREDENTIAL_STORE_FAILED');
        try {
            if (@file_put_contents($temporary,$secret."\n",LOCK_EX) === false || !@chmod($temporary,0600)) throw new HubProviderCredentialStoreException('Provider credential could not be stored','PROVIDER_CREDENTIAL_STORE_FAILED');
            clearstatcache(true,$temporary); $this->assertRegularSecretFile($temporary);
            if (!@rename($temporary,$path)) throw new HubProviderCredentialStoreException('Provider credential could not be stored','PROVIDER_CREDENTIAL_STORE_FAILED');
            clearstatcache(true,$path); $this->assertRegularSecretFile($path);
        } catch (Throwable $error) {
            if (is_string($temporary) && is_file($temporary) && !is_link($temporary)) @unlink($temporary);
            if ($error instanceof HubProviderCredentialStoreException) throw $error;
            throw new HubProviderCredentialStoreException('Provider credential could not be stored','PROVIDER_CREDENTIAL_STORE_FAILED');
        }
    }

    public function remove(): void
    {
        $path=$this->path(); clearstatcache(true,$path); if (!file_exists($path) && !is_link($path)) return;
        $this->assertRegularSecretFile($path); if (!@unlink($path)) throw new HubProviderCredentialStoreException('Provider credential could not be removed','PROVIDER_CREDENTIAL_STORE_FAILED');
    }

    private function ensureRoot(): void
    {
        if (!file_exists($this->root) && !@mkdir($this->root,0700,true) && !is_dir($this->root)) throw new HubProviderCredentialStoreException('Provider credential storage is unavailable','PROVIDER_CREDENTIAL_STORE_FAILED');
        clearstatcache(true,$this->root); $stat=@lstat($this->root);
        if (!is_dir($this->root) || is_link($this->root) || !is_array($stat) || (((int)$stat['mode'] & 0o027) !== 0)) throw new HubProviderCredentialStoreException('Provider credential storage is invalid','PROVIDER_CREDENTIAL_STORE_INVALID');
        @chmod($this->root,0700);
    }

    private function path(): string { return rtrim($this->root,'/').'/'.$this->providerId.'.key'; }
    private function assertRegularSecretFile(string $path): void
    {
        $stat=@lstat($path); if (!is_file($path) || is_link($path) || !is_array($stat) || (((int)$stat['mode'] & 0o077) !== 0)) throw new HubProviderCredentialStoreException('Provider credential storage is invalid','PROVIDER_CREDENTIAL_STORE_INVALID');
    }
    private function secret(string $value): string
    {
        $value=trim($value); $length=strlen($value);
        if ($this->providerId === 'openai' && preg_match('/^sk-[A-Za-z0-9_-]{20,512}$/',$value) !== 1) throw new HubProviderCredentialStoreException('Provider credential is invalid','PROVIDER_CREDENTIAL_INVALID');
        if ($this->providerId !== 'openai' && ($length < 16 || $length > 4096 || preg_match('/[\x00-\x20\x7f]/',$value))) throw new HubProviderCredentialStoreException('Provider credential is invalid','PROVIDER_CREDENTIAL_INVALID');
        return $value;
    }
    private static function provider(string $value): string
    {
        $value=strtolower(trim($value)); if (preg_match('/^[a-z0-9][a-z0-9._-]{1,63}$/',$value) !== 1) throw new HubProviderCredentialStoreException('Provider identity is invalid','PROVIDER_CREDENTIAL_STORE_INVALID'); return $value;
    }
}
