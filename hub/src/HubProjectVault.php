<?php

declare(strict_types=1);

/**
 * Private canonical content storage for an AWH Project.  The database keeps
 * identity, revision and audit metadata; bytes live beneath one opaque,
 * non-web-served root.  A Vault revision is immutable once committed.
 */
final class HubProjectVaultException extends RuntimeException
{
    public function __construct(string $message, public readonly string $codeName = 'PROJECT_VAULT_FAILED') { parent::__construct($message); }
}

final class HubProjectVault
{
    public const MAX_ARCHIVE_BYTES = 1024 * 1024 * 1024;
    public const MAX_FILE_BYTES = 512 * 1024 * 1024;
    public const MAX_CONTENT_BYTES = 2 * 1024 * 1024 * 1024;
    public const MAX_FILES = 10000;
    public const MAX_FILE_READ_BYTES = 256 * 1024;

    public function __construct(private readonly string $root) {}

    public static function fromEnvironment(): self
    {
        $root = getenv('AWH_PROJECT_VAULT_ROOT');
        if (!is_string($root) || $root === '') $root = '/var/lib/awh-hub/project-vault';
        if (str_contains($root, "\0") || !str_starts_with($root, '/')) throw new HubProjectVaultException('Project Vault storage is not configured', 'PROJECT_VAULT_UNAVAILABLE');
        return new self(rtrim($root, '/'));
    }

    /**
     * Extracts a bounded archive into an immutable staging revision.  The
     * caller records/promotes the returned revision in SQLite only after this
     * method succeeds; failed database promotion can remove it safely.
     *
     * @return array{revisionId:string,contentSha256:string,manifestJson:string,contentBytes:int,fileCount:int}
     */
    public function ingestZip(string $projectId, string $archive, string $revisionId): array
    {
        $projectId = self::uuid($projectId); $revisionId = self::uuid($revisionId);
        if (!class_exists('ZipArchive') || !is_file($archive) || is_link($archive) || !is_readable($archive)) throw new HubProjectVaultException('Project archive is unavailable', 'PROJECT_ARCHIVE_INVALID');
        $archiveBytes = @filesize($archive);
        if (!is_int($archiveBytes) || $archiveBytes < 1 || $archiveBytes > self::MAX_ARCHIVE_BYTES) throw new HubProjectVaultException('Project archive exceeds the safe limit', 'PROJECT_ARCHIVE_TOO_LARGE');
        $this->assertRoot();
        $projectRoot = $this->projectRoot($projectId); $revisions = $projectRoot . '/revisions';
        if (!is_dir($revisions) && !@mkdir($revisions, 0700, true) && !is_dir($revisions)) throw new HubProjectVaultException('Project Vault storage is unavailable', 'PROJECT_VAULT_UNAVAILABLE');
        if (is_link($projectRoot) || is_link($revisions)) throw new HubProjectVaultException('Project Vault storage is unsafe', 'PROJECT_VAULT_UNAVAILABLE');
        $destination = $revisions . '/' . strtolower($revisionId);
        if (file_exists($destination) || is_link($destination)) throw new HubProjectVaultException('Project revision already exists', 'PROJECT_REVISION_CONFLICT');
        $staging = $revisions . '/.staging-' . strtolower($revisionId) . '-' . bin2hex(random_bytes(6));
        $zip = new ZipArchive();
        if ($zip->open($archive, ZipArchive::RDONLY | ZipArchive::CHECKCONS) !== true) throw new HubProjectVaultException('Project archive is invalid', 'PROJECT_ARCHIVE_INVALID');
        if ($zip->numFiles < 1 || $zip->numFiles > self::MAX_FILES) { $zip->close(); throw new HubProjectVaultException('Project archive contains too many files', 'PROJECT_ARCHIVE_INVALID'); }
        $manifest = []; $paths = []; $total = 0;
        try {
            if (!@mkdir($staging, 0700, true) || is_link($staging)) throw new HubProjectVaultException('Project Vault storage is unavailable', 'PROJECT_VAULT_UNAVAILABLE');
            for ($index = 0; $index < $zip->numFiles; $index++) {
                $stat = $zip->statIndex($index, ZipArchive::FL_UNCHANGED);
                if (!is_array($stat) || !is_string($stat['name'] ?? null) || !is_int($stat['size'] ?? null) || !is_int($stat['comp_size'] ?? null)) throw new HubProjectVaultException('Project archive metadata is invalid', 'PROJECT_ARCHIVE_INVALID');
                $path = self::archivePath($stat['name']);
                if ($path === null) continue;
                if (isset($paths[$path])) throw new HubProjectVaultException('Project archive contains duplicate files', 'PROJECT_ARCHIVE_INVALID');
                $paths[$path] = true;
                $attributes = (int) ($stat['external_attributes'] ?? 0);
                if ((($attributes >> 16) & 0170000) === 0120000) throw new HubProjectVaultException('Project archive contains unsupported links', 'PROJECT_ARCHIVE_UNSAFE');
                $size = (int) $stat['size']; $compressed = (int) $stat['comp_size'];
                if ($size < 0 || $size > self::MAX_FILE_BYTES || ($compressed > 0 && $size > $compressed * 200) || self::sensitivePath($path)) throw new HubProjectVaultException('Project archive contains unsafe content', 'PROJECT_ARCHIVE_UNSAFE');
                $total += $size;
                if ($total > self::MAX_CONTENT_BYTES) throw new HubProjectVaultException('Project archive expands beyond the safe limit', 'PROJECT_ARCHIVE_TOO_LARGE');
                if (str_ends_with($stat['name'], '/')) { $this->mkdirFor($staging . '/' . $path); continue; }
                $target = $staging . '/' . $path; $this->mkdirFor($target);
                $input = $zip->getStream($stat['name']); $output = @fopen($target, 'xb');
                if (!is_resource($input) || $output === false) { if (is_resource($input)) fclose($input); if (is_resource($output)) fclose($output); throw new HubProjectVaultException('Project file could not be extracted', 'PROJECT_ARCHIVE_INVALID'); }
                $copied = 0; $hash = hash_init('sha256');
                try {
                    while (!feof($input)) {
                        $chunk = fread($input, 65536);
                        if ($chunk === false) throw new HubProjectVaultException('Project file could not be read', 'PROJECT_ARCHIVE_INVALID');
                        if ($chunk === '') continue;
                        $copied += strlen($chunk);
                        if ($copied > $size || $copied > self::MAX_FILE_BYTES || fwrite($output, $chunk) !== strlen($chunk)) throw new HubProjectVaultException('Project file could not be verified', 'PROJECT_ARCHIVE_INVALID');
                        hash_update($hash, $chunk);
                    }
                } finally { fclose($input); fclose($output); }
                if ($copied !== $size) throw new HubProjectVaultException('Project file size does not match the archive', 'PROJECT_ARCHIVE_INVALID');
                @chmod($target, 0640);
                $manifest[] = ['path' => $path, 'sha256' => hash_final($hash), 'sizeBytes' => $copied];
            }
            if ($manifest === []) throw new HubProjectVaultException('Project archive has no usable files', 'PROJECT_ARCHIVE_INVALID');
            usort($manifest, static fn (array $left, array $right): int => strcmp($left['path'], $right['path']));
            $manifestJson = json_encode(['schemaVersion' => 1, 'files' => $manifest], JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);
            $contentSha256 = hash('sha256', $manifestJson);
            if (!@rename($staging, $destination)) throw new HubProjectVaultException('Project revision could not be committed', 'PROJECT_VAULT_UNAVAILABLE');
            @chmod($destination, 0750);
            return ['revisionId' => $revisionId, 'contentSha256' => $contentSha256, 'manifestJson' => $manifestJson, 'contentBytes' => $total, 'fileCount' => count($manifest)];
        } catch (Throwable $error) {
            $this->removeDirectory($staging);
            if ($error instanceof HubProjectVaultException) throw $error;
            throw new HubProjectVaultException('Project archive could not be stored', 'PROJECT_VAULT_FAILED');
        } finally { $zip->close(); }
    }

    /**
     * Captures an already-isolated task workspace as an immutable candidate
     * revision.  This deliberately uses the same content limits and path
     * policy as archive ingestion: a task cannot smuggle a link, secret, or
     * filesystem escape back into canonical Project content.
     *
     * @return array{revisionId:string,contentSha256:string,manifestJson:string,contentBytes:int,fileCount:int}
     */
    public function ingestDirectory(string $projectId, string $workspace, string $revisionId): array
    {
        $projectId = self::uuid($projectId); $revisionId = self::uuid($revisionId);
        if ($workspace === '' || str_contains($workspace, "\0") || !str_starts_with($workspace, '/') || is_link($workspace) || !is_dir($workspace)) throw new HubProjectVaultException('Task workspace is unavailable', 'TASK_WORKSPACE_INVALID');
        $source = realpath($workspace);
        if (!is_string($source) || $source === '' || is_link($source)) throw new HubProjectVaultException('Task workspace is unavailable', 'TASK_WORKSPACE_INVALID');
        $this->assertRoot();
        $projectRoot = $this->projectRoot($projectId); $revisions = $projectRoot . '/revisions';
        if (!is_dir($revisions) && !@mkdir($revisions, 0700, true) && !is_dir($revisions)) throw new HubProjectVaultException('Project Vault storage is unavailable', 'PROJECT_VAULT_UNAVAILABLE');
        if (is_link($projectRoot) || is_link($revisions)) throw new HubProjectVaultException('Project Vault storage is unsafe', 'PROJECT_VAULT_UNAVAILABLE');
        $destination = $revisions . '/' . strtolower($revisionId);
        if (file_exists($destination) || is_link($destination)) throw new HubProjectVaultException('Project revision already exists', 'PROJECT_REVISION_CONFLICT');
        $staging = $revisions . '/.staging-' . strtolower($revisionId) . '-' . bin2hex(random_bytes(6));
        $manifest = []; $total = 0;
        try {
            if (!@mkdir($staging, 0700, true) || is_link($staging)) throw new HubProjectVaultException('Project Vault storage is unavailable', 'PROJECT_VAULT_UNAVAILABLE');
            $iterator = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($source, FilesystemIterator::SKIP_DOTS), RecursiveIteratorIterator::LEAVES_ONLY);
            foreach ($iterator as $file) {
                if (!$file instanceof SplFileInfo || $file->isLink() || !$file->isFile()) throw new HubProjectVaultException('Task workspace contains unsupported content', 'TASK_WORKSPACE_INVALID');
                $physical = $file->getRealPath();
                if (!is_string($physical) || !str_starts_with($physical, $source . DIRECTORY_SEPARATOR)) throw new HubProjectVaultException('Task workspace is unsafe', 'TASK_WORKSPACE_INVALID');
                $relative = str_replace(DIRECTORY_SEPARATOR, '/', substr($physical, strlen($source) + 1));
                $path = self::archivePath($relative);
                if ($path === null || self::sensitivePath($path)) throw new HubProjectVaultException('Task workspace contains restricted content', 'TASK_WORKSPACE_INVALID');
                $size = $file->getSize();
                if ($size < 0 || $size > self::MAX_FILE_BYTES) throw new HubProjectVaultException('Task workspace exceeds the safe limit', 'TASK_WORKSPACE_INVALID');
                $total += $size;
                if (count($manifest) >= self::MAX_FILES || $total > self::MAX_CONTENT_BYTES) throw new HubProjectVaultException('Task workspace exceeds the safe limit', 'TASK_WORKSPACE_INVALID');
                $target = $staging . '/' . $path; $this->mkdirFor($target);
                if (!@copy($physical, $target) || is_link($target) || @filesize($target) !== $size) throw new HubProjectVaultException('Task workspace could not be captured', 'TASK_WORKSPACE_UNAVAILABLE');
                $hash = hash_file('sha256', $target);
                if (!is_string($hash) || !preg_match('/^[0-9a-f]{64}$/', $hash)) throw new HubProjectVaultException('Task workspace could not be verified', 'TASK_WORKSPACE_UNAVAILABLE');
                @chmod($target, 0640); $manifest[] = ['path' => $path, 'sha256' => $hash, 'sizeBytes' => $size];
            }
            if ($manifest === []) throw new HubProjectVaultException('Task workspace has no usable files', 'TASK_WORKSPACE_INVALID');
            usort($manifest, static fn (array $left, array $right): int => strcmp($left['path'], $right['path']));
            $manifestJson = json_encode(['schemaVersion' => 1, 'files' => $manifest], JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);
            $contentSha256 = hash('sha256', $manifestJson);
            if (!@rename($staging, $destination)) throw new HubProjectVaultException('Project revision could not be committed', 'PROJECT_VAULT_UNAVAILABLE');
            @chmod($destination, 0750);
            return ['revisionId' => $revisionId, 'contentSha256' => $contentSha256, 'manifestJson' => $manifestJson, 'contentBytes' => $total, 'fileCount' => count($manifest)];
        } catch (Throwable $error) {
            $this->removeDirectory($staging);
            if ($error instanceof HubProjectVaultException) throw $error;
            throw new HubProjectVaultException('Task workspace could not be captured', 'TASK_WORKSPACE_UNAVAILABLE');
        }
    }

    /** @return list<array{path:string,sha256:string,sizeBytes:int}> */
    public function manifest(string $projectId, string $revisionId): array
    {
        $directory = $this->revisionDirectory($projectId, $revisionId); $manifest = [];
        $iterator = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($directory, FilesystemIterator::SKIP_DOTS));
        foreach ($iterator as $file) {
            if (!$file instanceof SplFileInfo || $file->isLink() || !$file->isFile()) throw new HubProjectVaultException('Project revision is unsafe', 'PROJECT_VAULT_UNAVAILABLE');
            $path = substr($file->getPathname(), strlen($directory) + 1);
            $manifest[] = ['path' => str_replace(DIRECTORY_SEPARATOR, '/', $path), 'sha256' => (string) hash_file('sha256', $file->getPathname()), 'sizeBytes' => (int) $file->getSize()];
        }
        usort($manifest, static fn (array $left, array $right): int => strcmp($left['path'], $right['path'])); return $manifest;
    }

    /** @return list<array{path:string,sizeBytes:int}> */
    public function search(string $projectId, string $revisionId, string $query, int $limit = 20): array
    {
        $needle = strtolower(trim($query)); if ($needle === '' || strlen($needle) > 120) throw new HubProjectVaultException('Project search query is invalid', 'PROJECT_CONTEXT_INVALID');
        $matches = []; foreach ($this->manifest($projectId, $revisionId) as $file) if (str_contains(strtolower($file['path']), $needle)) { $matches[] = ['path' => $file['path'], 'sizeBytes' => $file['sizeBytes']]; if (count($matches) >= max(1, min($limit, 50))) break; }
        return $matches;
    }

    /** @return array{path:string,content:string,truncated:bool} */
    public function readText(string $projectId, string $revisionId, string $relativePath): array
    {
        $path = self::archivePath($relativePath); if ($path === null || self::sensitivePath($path)) throw new HubProjectVaultException('Project file is not available to tools', 'PROJECT_CONTEXT_FORBIDDEN');
        $base = $this->revisionDirectory($projectId, $revisionId); $file = $base . '/' . $path;
        if (!is_file($file) || is_link($file) || !is_readable($file)) throw new HubProjectVaultException('Project file was not found', 'PROJECT_FILE_NOT_FOUND');
        $size = @filesize($file); if (!is_int($size) || $size > 2 * 1024 * 1024 || self::binary($file)) throw new HubProjectVaultException('Project file is not readable text', 'PROJECT_CONTEXT_FORBIDDEN');
        $handle = @fopen($file, 'rb'); if ($handle === false) throw new HubProjectVaultException('Project file was not found', 'PROJECT_FILE_NOT_FOUND');
        $content = stream_get_contents($handle, self::MAX_FILE_READ_BYTES + 1); fclose($handle);
        if (!is_string($content)) throw new HubProjectVaultException('Project file could not be read', 'PROJECT_CONTEXT_FORBIDDEN');
        $truncated = strlen($content) > self::MAX_FILE_READ_BYTES; if ($truncated) $content = substr($content, 0, self::MAX_FILE_READ_BYTES);
        return ['path' => $path, 'content' => $content, 'truncated' => $truncated];
    }

    /** Materialises one immutable revision for an isolated task workspace. */
    public function materialize(string $projectId, string $revisionId, string $workspace): void
    {
        if ($workspace === '' || str_contains($workspace, "\0") || !str_starts_with($workspace, '/')) throw new HubProjectVaultException('Task workspace is invalid', 'TASK_WORKSPACE_INVALID');
        $source = $this->revisionDirectory($projectId, $revisionId); if (file_exists($workspace) || is_link($workspace)) throw new HubProjectVaultException('Task workspace already exists', 'TASK_WORKSPACE_CONFLICT');
        try {
            if (!@mkdir($workspace, 0700, true)) throw new HubProjectVaultException('Task workspace is unavailable', 'TASK_WORKSPACE_UNAVAILABLE');
            foreach ($this->manifest($projectId, $revisionId) as $entry) {
                $target = $workspace . '/' . $entry['path']; $this->mkdirFor($target);
                if (!@copy($source . '/' . $entry['path'], $target) || is_link($target) || @filesize($target) !== $entry['sizeBytes'] || !hash_equals($entry['sha256'], (string) hash_file('sha256', $target))) throw new HubProjectVaultException('Task workspace could not be verified', 'TASK_WORKSPACE_UNAVAILABLE');
                @chmod($target, 0640);
            }
        } catch (Throwable $error) { $this->removeDirectory($workspace); if ($error instanceof HubProjectVaultException) throw $error; throw new HubProjectVaultException('Task workspace could not be prepared', 'TASK_WORKSPACE_UNAVAILABLE'); }
    }

    /**
     * Builds a bounded, uncompressed ZIP of one immutable revision for a
     * trusted executor.  The archive is an interchange format only: it never
     * becomes a second source authority and it is created from the exact
     * revision named by a leased task.
     */
    public function archive(string $projectId, string $revisionId, string $destination): array
    {
        $projectId = self::uuid($projectId); $revisionId = self::uuid($revisionId);
        if (!class_exists('ZipArchive') || $destination === '' || str_contains($destination, "\0") || !str_starts_with($destination, '/') || file_exists($destination) || is_link($destination)) throw new HubProjectVaultException('Task archive is unavailable', 'TASK_WORKSPACE_UNAVAILABLE');
        $source = $this->revisionDirectory($projectId, $revisionId); $directory = dirname($destination);
        if (!is_dir($directory) || is_link($directory) || (((int) (@stat($directory)['mode'] ?? 0) & 0o022) !== 0)) throw new HubProjectVaultException('Task archive storage is unavailable', 'TASK_WORKSPACE_UNAVAILABLE');
        $zip = new ZipArchive();
        if ($zip->open($destination, ZipArchive::CREATE | ZipArchive::EXCL) !== true) throw new HubProjectVaultException('Task archive is unavailable', 'TASK_WORKSPACE_UNAVAILABLE');
        try {
            $count = 0; $bytes = 0;
            foreach ($this->manifest($projectId, $revisionId) as $entry) {
                $path = self::archivePath($entry['path']);
                if ($path === null || self::sensitivePath($path) || !is_file($source . '/' . $path) || is_link($source . '/' . $path)) throw new HubProjectVaultException('Project revision is unsafe', 'PROJECT_VAULT_UNAVAILABLE');
                if (!$zip->addFile($source . '/' . $path, $path) || !$zip->setCompressionName($path, ZipArchive::CM_STORE)) throw new HubProjectVaultException('Task archive could not be created', 'TASK_WORKSPACE_UNAVAILABLE');
                $count++; $bytes += (int) $entry['sizeBytes'];
            }
            if ($count < 1 || $bytes > self::MAX_CONTENT_BYTES || !$zip->close()) throw new HubProjectVaultException('Task archive could not be created', 'TASK_WORKSPACE_UNAVAILABLE');
            $archiveBytes = @filesize($destination); $sha = hash_file('sha256', $destination);
            if (!is_int($archiveBytes) || $archiveBytes < 1 || $archiveBytes > self::MAX_ARCHIVE_BYTES || !is_string($sha) || !preg_match('/^[0-9a-f]{64}$/', $sha)) throw new HubProjectVaultException('Task archive could not be verified', 'TASK_WORKSPACE_UNAVAILABLE');
            @chmod($destination, 0640); return ['sizeBytes' => $archiveBytes, 'sha256' => $sha, 'fileCount' => $count];
        } catch (Throwable $error) {
            $zip->close(); @unlink($destination);
            if ($error instanceof HubProjectVaultException) throw $error;
            throw new HubProjectVaultException('Task archive could not be created', 'TASK_WORKSPACE_UNAVAILABLE');
        }
    }

    public function removeRevision(string $projectId, string $revisionId): void { try { $this->removeDirectory($this->revisionDirectory($projectId, $revisionId)); } catch (Throwable) {} }
    private function projectRoot(string $projectId): string { return $this->root . '/projects/' . strtolower(self::uuid($projectId)); }
    private function revisionDirectory(string $projectId, string $revisionId): string { $this->assertRoot(); $path = $this->projectRoot($projectId) . '/revisions/' . strtolower(self::uuid($revisionId)); if (!is_dir($path) || is_link($path)) throw new HubProjectVaultException('Project revision is not available', 'PROJECT_REVISION_NOT_FOUND'); return $path; }
    private function assertRoot(): void { $stat = @stat($this->root); if (!is_dir($this->root) || is_link($this->root) || !is_array($stat) || (((int) $stat['mode'] & 0o022) !== 0)) throw new HubProjectVaultException('Project Vault storage is unavailable', 'PROJECT_VAULT_UNAVAILABLE'); }
    private function mkdirFor(string $file): void { $directory = dirname($file); if (!is_dir($directory) && !@mkdir($directory, 0700, true) && !is_dir($directory)) throw new HubProjectVaultException('Project Vault storage is unavailable', 'PROJECT_VAULT_UNAVAILABLE'); if (is_link($directory)) throw new HubProjectVaultException('Project Vault storage is unsafe', 'PROJECT_VAULT_UNAVAILABLE'); }
    private function removeDirectory(string $directory): void { if (!is_dir($directory) || is_link($directory)) return; $items = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($directory, FilesystemIterator::SKIP_DOTS), RecursiveIteratorIterator::CHILD_FIRST); foreach ($items as $item) { if (!$item instanceof SplFileInfo) continue; $path = $item->getPathname(); if ($item->isLink() || $item->isFile()) @unlink($path); elseif ($item->isDir()) @rmdir($path); } @rmdir($directory); }
    private static function uuid(string $value): string { if (preg_match('/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i', $value) !== 1) throw new HubProjectVaultException('Project reference is invalid', 'PROJECT_VAULT_INVALID'); return $value; }
    private static function archivePath(string $value): ?string { $path = str_replace('\\', '/', $value); if ($path === '' || str_contains($path, "\0") || str_starts_with($path, '/') || preg_match('#^[A-Za-z]:/#', $path) === 1) throw new HubProjectVaultException('Project archive path is unsafe', 'PROJECT_ARCHIVE_UNSAFE'); $parts = explode('/', rtrim($path, '/')); if ($parts === ['']) return null; foreach ($parts as $part) if ($part === '' || $part === '.' || $part === '..' || strlen($part) > 180 || preg_match('/[\x00-\x1f\x7f]/', $part)) throw new HubProjectVaultException('Project archive path is unsafe', 'PROJECT_ARCHIVE_UNSAFE'); $normalized = implode('/', $parts); if (strlen($normalized) > 900) throw new HubProjectVaultException('Project archive path is unsafe', 'PROJECT_ARCHIVE_UNSAFE'); return $normalized; }
    private static function sensitivePath(string $path): bool { $base = strtolower((string) basename($path)); return $base === '.env' || preg_match('/(?:^|[._-])(?:id_rsa|id_ed25519|credential|secret|private[_-]?key|token)(?:[._-]|$)|\.(?:pem|key|p12|pfx)$/', $base) === 1 || str_contains(strtolower($path), '/.ssh/'); }
    private static function binary(string $path): bool { $handle = @fopen($path, 'rb'); if ($handle === false) return true; $chunk = fread($handle, 4096); fclose($handle); return !is_string($chunk) || str_contains($chunk, "\0"); }
}
