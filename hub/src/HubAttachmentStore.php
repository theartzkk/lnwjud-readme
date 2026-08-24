<?php

declare(strict_types=1);

/**
 * Private, opaque attachment storage.  Callers receive IDs and safe metadata,
 * never a server filesystem path.  The root is deliberately outside a release
 * directory so a pointer rollback cannot delete user files.
 */
final class HubAttachmentStoreException extends RuntimeException
{
    public function __construct(string $message, public readonly string $codeName = 'ATTACHMENT_FAILED') { parent::__construct($message); }
}

final class HubAttachmentStore
{
    // The Nginx control location permits a 64 MiB multipart request.  Leave
    // room for multipart metadata and enforce the same aggregate policy in
    // the service; this keeps one oversized multi-file request from relying
    // on a proxy failure as its only guard.
    public const MAX_FILE_BYTES = 60 * 1024 * 1024;
    public const MAX_TOTAL_BYTES = 60 * 1024 * 1024;
    private const ALLOWED = [
        'jpg' => ['image/jpeg', 'image/pjpeg'], 'jpeg' => ['image/jpeg', 'image/pjpeg'], 'png' => ['image/png'], 'webp' => ['image/webp'], 'gif' => ['image/gif'], 'heic' => ['image/heic', 'image/heif'],
        'pdf' => ['application/pdf'], 'txt' => ['text/plain'], 'md' => ['text/plain', 'text/markdown'], 'csv' => ['text/csv', 'text/plain', 'application/csv'],
        'doc' => ['application/msword', 'application/octet-stream'], 'docx' => ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/zip'],
        'xls' => ['application/vnd.ms-excel', 'application/octet-stream'], 'xlsx' => ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/zip'],
        'ppt' => ['application/vnd.ms-powerpoint', 'application/octet-stream'], 'pptx' => ['application/vnd.openxmlformats-officedocument.presentationml.presentation', 'application/zip'],
        'zip' => ['application/zip', 'application/x-zip-compressed'],
        'mp3' => ['audio/mpeg'], 'm4a' => ['audio/mp4', 'audio/x-m4a'], 'wav' => ['audio/wav', 'audio/x-wav'],
        'mp4' => ['video/mp4'], 'mov' => ['video/quicktime'], 'webm' => ['video/webm'],
        'js' => ['text/javascript', 'application/javascript', 'text/plain'], 'ts' => ['text/plain', 'application/typescript'], 'json' => ['application/json', 'text/plain'], 'php' => ['text/x-php', 'text/plain'], 'html' => ['text/html', 'text/plain'], 'css' => ['text/css', 'text/plain'],
    ];

    public function __construct(private readonly string $root) {}

    public static function fromEnvironment(): self
    {
        $root = getenv('AWH_ATTACHMENT_ROOT');
        if (!is_string($root) || $root === '') $root = '/var/lib/awh-hub/attachments';
        if (str_contains($root, "\0") || !str_starts_with($root, '/')) throw new HubAttachmentStoreException('Attachment storage is not configured', 'ATTACHMENT_STORAGE_UNAVAILABLE');
        return new self(rtrim($root, '/'));
    }

    /** @return array{name:string,mimeType:string,sizeBytes:int,sha256:string,storageKey:string,kind:string} */
    public function accept(array $file, string $attachmentId): array
    {
        if (!preg_match('/^[0-9a-f-]{36}$/i', $attachmentId)) throw new HubAttachmentStoreException('Attachment reference is invalid', 'ATTACHMENT_INVALID');
        $name = $this->name($file['name'] ?? null); $tmp = $file['tmp_name'] ?? null; $error = $file['error'] ?? null; $size = $file['size'] ?? null;
        if (!is_string($tmp) || $tmp === '' || !is_int($error) || $error !== UPLOAD_ERR_OK || !is_int($size) || $size < 1 || $size > self::MAX_FILE_BYTES || !is_file($tmp) || is_link($tmp) || @filesize($tmp) !== $size) throw new HubAttachmentStoreException('Attachment upload is invalid', 'ATTACHMENT_INVALID');
        $extension = strtolower((string) pathinfo($name, PATHINFO_EXTENSION));
        if (!isset(self::ALLOWED[$extension]) || $this->unsafeName($name)) throw new HubAttachmentStoreException('This attachment type is not allowed', 'ATTACHMENT_TYPE_FORBIDDEN');
        $mime = $this->mime($tmp); if (!in_array($mime, self::ALLOWED[$extension], true)) throw new HubAttachmentStoreException('Attachment content does not match its file type', 'ATTACHMENT_TYPE_FORBIDDEN');
        $sha = hash_file('sha256', $tmp); if (!is_string($sha) || !preg_match('/^[0-9a-f]{64}$/', $sha)) throw new HubAttachmentStoreException('Attachment could not be verified', 'ATTACHMENT_STORAGE_FAILED');
        $this->assertRoot(); $storageKey = strtolower(substr($attachmentId, 0, 2)) . '/' . strtolower($attachmentId) . '.bin'; $destination = $this->absolute($storageKey); $directory = dirname($destination);
        if (!is_dir($directory) && !@mkdir($directory, 0700, true) && !is_dir($directory)) throw new HubAttachmentStoreException('Attachment storage is unavailable', 'ATTACHMENT_STORAGE_UNAVAILABLE');
        if (is_link($directory) || file_exists($destination)) throw new HubAttachmentStoreException('Attachment storage is unsafe', 'ATTACHMENT_STORAGE_UNAVAILABLE');
        $temporary = $directory . '/.' . strtolower($attachmentId) . '.upload-' . bin2hex(random_bytes(6));
        try {
            // Do not rename a PHP upload directly: its temp directory may be
            // a different filesystem.  Copy into a private same-directory temp
            // file, then rename it atomically only after the byte count matches.
            $input = @fopen($tmp, 'rb'); $output = @fopen($temporary, 'xb');
            if ($input === false || $output === false) { if (is_resource($input)) fclose($input); if (is_resource($output)) fclose($output); throw new HubAttachmentStoreException('Attachment could not be stored', 'ATTACHMENT_STORAGE_FAILED'); }
            $copied = stream_copy_to_stream($input, $output); fclose($input); fclose($output);
            if (!is_int($copied) || $copied !== $size) throw new HubAttachmentStoreException('Attachment could not be verified', 'ATTACHMENT_STORAGE_FAILED');
            @chmod($temporary, 0640);
            if (!@rename($temporary, $destination)) throw new HubAttachmentStoreException('Attachment could not be committed', 'ATTACHMENT_STORAGE_FAILED');
            @chmod($destination, 0640);
        } catch (Throwable $error) { @unlink($temporary); if ($error instanceof HubAttachmentStoreException) throw $error; throw new HubAttachmentStoreException('Attachment could not be stored', 'ATTACHMENT_STORAGE_FAILED'); }
        return ['name' => $name, 'mimeType' => $mime, 'sizeBytes' => $size, 'sha256' => $sha, 'storageKey' => $storageKey, 'kind' => str_starts_with($mime, 'image/') ? 'image' : 'document'];
    }

    public function read(string $storageKey): string
    {
        $this->assertRoot(); $path = $this->absolute($storageKey); if (is_link(dirname($path)) || !is_file($path) || is_link($path) || !is_readable($path)) throw new HubAttachmentStoreException('Attachment is no longer available', 'ATTACHMENT_NOT_FOUND'); return $path;
    }

    public function remove(?string $storageKey): void
    {
        if ($storageKey === null || $storageKey === '') return;
        try { $this->assertRoot(); $path = $this->absolute($storageKey); if (!is_link(dirname($path)) && is_file($path) && !is_link($path)) @unlink($path); } catch (Throwable) { /* DB state remains authoritative; cleanup may be retried safely. */ }
    }

    private function absolute(string $key): string
    {
        if (!preg_match('#^[0-9a-f]{2}/[0-9a-f-]{36}\.bin$#', $key)) throw new HubAttachmentStoreException('Attachment storage key is invalid', 'ATTACHMENT_INVALID');
        return $this->root . '/' . $key;
    }

    private function assertRoot(): void
    {
        $stat = @stat($this->root);
        if (!is_dir($this->root) || is_link($this->root) || !is_array($stat) || (((int) $stat['mode'] & 0o022) !== 0)) throw new HubAttachmentStoreException('Attachment storage is unavailable', 'ATTACHMENT_STORAGE_UNAVAILABLE');
    }

    private function name(mixed $value): string
    {
        if (!is_string($value)) throw new HubAttachmentStoreException('Attachment name is invalid', 'ATTACHMENT_INVALID');
        $name = trim(str_replace('\\', '/', $value)); $name = basename($name);
        if ($name === '' || strlen($name) > 160 || preg_match('/[\x00-\x1f\x7f]/', $name)) throw new HubAttachmentStoreException('Attachment name is invalid', 'ATTACHMENT_INVALID');
        return $name;
    }

    private function unsafeName(string $name): bool
    {
        $lower = strtolower($name);
        return preg_match('/(?:^|[._-])(?:env|pem|key|p12|pfx|id_rsa|credential|secret|token)(?:[._-]|$)/', $lower) === 1 || str_contains($lower, '.ssh');
    }

    private function mime(string $path): string
    {
        if (!class_exists('finfo')) throw new HubAttachmentStoreException('Attachment type inspection is unavailable', 'ATTACHMENT_STORAGE_UNAVAILABLE');
        $value = (new finfo(FILEINFO_MIME_TYPE))->file($path); if (!is_string($value) || $value === '' || strlen($value) > 120) throw new HubAttachmentStoreException('Attachment type inspection failed', 'ATTACHMENT_INVALID'); return strtolower($value);
    }
}
