<?php

declare(strict_types=1);

/**
 * Private object storage for task outputs.  Artifact metadata remains in the
 * existing control_artifacts authority; this class only owns verified bytes.
 * Keys are opaque and never expose a VPS path to a browser or worker.
 */
final class HubArtifactStoreException extends RuntimeException
{
    public function __construct(string $message, public readonly string $codeName = 'ARTIFACT_STORAGE_FAILED') { parent::__construct($message); }
}

final class HubArtifactStore
{
    public const MAX_OBJECT_BYTES = 1024 * 1024 * 1024;

    public function __construct(private readonly string $root) {}

    public static function fromEnvironment(): self
    {
        $root = getenv('AWH_ARTIFACT_ROOT');
        if (!is_string($root) || $root === '') $root = '/var/lib/awh-hub/artifacts';
        if (str_contains($root, "\0") || !str_starts_with($root, '/')) throw new HubArtifactStoreException('Artifact storage is not configured', 'ARTIFACT_STORAGE_UNAVAILABLE');
        return new self(rtrim($root, '/'));
    }

    /** @return array{storageKey:string,sha256:string,sizeBytes:int} */
    public function storeFile(string $artifactId, string $source): array
    {
        $this->assertArtifactId($artifactId);
        if ($source === '' || !is_file($source) || is_link($source) || !is_readable($source)) throw new HubArtifactStoreException('Artifact output is unavailable', 'ARTIFACT_OUTPUT_INVALID');
        $size = @filesize($source);
        if (!is_int($size) || $size < 1 || $size > self::MAX_OBJECT_BYTES) throw new HubArtifactStoreException('Artifact output exceeds the safe limit', 'ARTIFACT_OUTPUT_TOO_LARGE');
        $this->assertRoot();
        $key = strtolower(substr($artifactId, 0, 2)) . '/' . strtolower($artifactId) . '.bin'; $destination = $this->absolute($key); $directory = dirname($destination);
        if (!is_dir($directory) && !@mkdir($directory, 0700, true) && !is_dir($directory)) throw new HubArtifactStoreException('Artifact storage is unavailable', 'ARTIFACT_STORAGE_UNAVAILABLE');
        if (is_link($directory) || file_exists($destination)) throw new HubArtifactStoreException('Artifact storage is unsafe', 'ARTIFACT_STORAGE_UNAVAILABLE');
        $temporary = $directory . '/.' . strtolower($artifactId) . '.upload-' . bin2hex(random_bytes(6));
        try {
            $input = @fopen($source, 'rb'); $output = @fopen($temporary, 'xb');
            if ($input === false || $output === false) { if (is_resource($input)) fclose($input); if (is_resource($output)) fclose($output); throw new HubArtifactStoreException('Artifact could not be stored', 'ARTIFACT_STORAGE_FAILED'); }
            $copied = stream_copy_to_stream($input, $output); fclose($input); fclose($output);
            if (!is_int($copied) || $copied !== $size) throw new HubArtifactStoreException('Artifact output could not be verified', 'ARTIFACT_STORAGE_FAILED');
            $sha = hash_file('sha256', $temporary);
            if (!is_string($sha) || !preg_match('/^[0-9a-f]{64}$/', $sha)) throw new HubArtifactStoreException('Artifact output could not be verified', 'ARTIFACT_STORAGE_FAILED');
            @chmod($temporary, 0640);
            if (!@rename($temporary, $destination)) throw new HubArtifactStoreException('Artifact could not be committed', 'ARTIFACT_STORAGE_FAILED');
            @chmod($destination, 0640);
            return ['storageKey' => $key, 'sha256' => $sha, 'sizeBytes' => $size];
        } catch (Throwable $error) {
            @unlink($temporary);
            if ($error instanceof HubArtifactStoreException) throw $error;
            throw new HubArtifactStoreException('Artifact could not be stored', 'ARTIFACT_STORAGE_FAILED');
        }
    }

    public function read(string $storageKey): string
    {
        $this->assertRoot(); $path = $this->absolute($storageKey);
        if (is_link(dirname($path)) || !is_file($path) || is_link($path) || !is_readable($path)) throw new HubArtifactStoreException('Artifact is no longer available', 'ARTIFACT_NOT_FOUND');
        return $path;
    }

    public function remove(?string $storageKey): void
    {
        if ($storageKey === null || $storageKey === '') return;
        try { $this->assertRoot(); $path = $this->absolute($storageKey); if (!is_link(dirname($path)) && is_file($path) && !is_link($path)) @unlink($path); } catch (Throwable) { /* DB metadata remains recoverable; cleanup is best effort. */ }
    }

    private function absolute(string $key): string
    {
        if (!preg_match('#^[0-9a-f]{2}/[0-9a-f-]{36}\.bin$#', $key)) throw new HubArtifactStoreException('Artifact storage key is invalid', 'ARTIFACT_STORAGE_INVALID');
        return $this->root . '/' . $key;
    }

    private function assertRoot(): void
    {
        $stat = @stat($this->root);
        if (!is_dir($this->root) || is_link($this->root) || !is_array($stat) || (((int) $stat['mode'] & 0o022) !== 0)) throw new HubArtifactStoreException('Artifact storage is unavailable', 'ARTIFACT_STORAGE_UNAVAILABLE');
    }

    private function assertArtifactId(string $artifactId): void
    {
        if (preg_match('/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i', $artifactId) !== 1) throw new HubArtifactStoreException('Artifact reference is invalid', 'ARTIFACT_STORAGE_INVALID');
    }
}
