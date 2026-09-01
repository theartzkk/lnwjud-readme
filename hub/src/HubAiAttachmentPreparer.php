<?php

declare(strict_types=1);

final class HubAiAttachmentPreparerException extends RuntimeException
{
    public function __construct(string $message, public readonly string $codeName = 'ATTACHMENT_AI_INPUT_FAILED') { parent::__construct($message); }
}

/**
 * Ephemeral provider-input adapter. Canonical attachments remain byte-identical;
 * unsupported camera formats and oversized images are normalized only for one AI request.
 */
final class HubAiAttachmentPreparer
{
    public const MAX_IMAGE_SOURCE_BYTES = 60 * 1024 * 1024;
    public const MAX_DOCUMENT_BYTES = 47 * 1024 * 1024;
    public const MAX_PREPARED_IMAGE_BYTES = 16 * 1024 * 1024;
    private const MAX_IMAGE_EDGE = 2048;
    private const IMAGE_MIMES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
    private const HEIF_MIMES = ['image/heic', 'image/heif'];
    private const DOCUMENT_EXTENSIONS = ['pdf','txt','md','csv','doc','docx','xls','xlsx','ppt','pptx','js','ts','json','php','html','css'];

    public function __construct(private readonly string $vipsThumbnail = '/usr/bin/vipsthumbnail')
    {
        if ($vipsThumbnail === '' || str_contains($vipsThumbnail, "\0") || !str_starts_with($vipsThumbnail, '/')) throw new HubAiAttachmentPreparerException('Image preparation runtime configuration is invalid', 'IMAGE_INPUT_RUNTIME_INVALID');
    }
    /** @param array{name:string,mimeType:string,path:string,sizeBytes:int} $attachment
     *  @return array{name:string,mimeType:string,bytes:string,sizeBytes:int,kind:string}
     */
    public function prepare(array $attachment): array
    {
        $name = (string)($attachment['name'] ?? '');
        $mime = strtolower((string)($attachment['mimeType'] ?? ''));
        $path = (string)($attachment['path'] ?? '');
        $size = (int)($attachment['sizeBytes'] ?? 0);
        if ($name === '' || $path === '' || $size < 1 || !is_file($path) || is_link($path) || !is_readable($path) || @filesize($path) !== $size) throw new HubAiAttachmentPreparerException('Attachment is unavailable for AI analysis', 'ATTACHMENT_AI_INPUT_UNAVAILABLE');

        if (in_array($mime, self::HEIF_MIMES, true)) return $this->normalizeImage($name, $path, $size);
        if (str_starts_with($mime, 'image/')) {
            if (!in_array($mime, self::IMAGE_MIMES, true)) throw new HubAiAttachmentPreparerException('This image format is not supported for AI analysis', 'ATTACHMENT_AI_INPUT_UNSUPPORTED');
            if ($size > self::MAX_IMAGE_SOURCE_BYTES) throw new HubAiAttachmentPreparerException('This image is too large for AI analysis', 'ATTACHMENT_AI_INPUT_TOO_LARGE');
            if ($this->needsNormalization($path, $mime, $size)) return $this->normalizeImage($name, $path, $size);
            return $this->readOriginal($name, $mime, $path, $size, 'image');
        }

        $extension = strtolower((string)pathinfo($name, PATHINFO_EXTENSION));
        if (!in_array($extension, self::DOCUMENT_EXTENSIONS, true)) throw new HubAiAttachmentPreparerException('This file type is not supported for direct AI analysis', 'ATTACHMENT_AI_INPUT_UNSUPPORTED');
        if ($size > self::MAX_DOCUMENT_BYTES) throw new HubAiAttachmentPreparerException('This file is too large for direct AI analysis', 'ATTACHMENT_AI_INPUT_TOO_LARGE');
        return $this->readOriginal($name, $mime, $path, $size, 'document');
    }
    private function needsNormalization(string $path, string $mime, int $size): bool
    {
        if ($mime === 'image/gif' || $size > self::MAX_PREPARED_IMAGE_BYTES) return true;
        $dimensions = @getimagesize($path);
        if (!is_array($dimensions) || !isset($dimensions[0], $dimensions[1])) throw new HubAiAttachmentPreparerException('Image dimensions could not be inspected', 'ATTACHMENT_AI_INPUT_UNSUPPORTED');
        $width = (int)$dimensions[0]; $height = (int)$dimensions[1];
        if ($width < 1 || $height < 1) throw new HubAiAttachmentPreparerException('Image dimensions are invalid', 'ATTACHMENT_AI_INPUT_UNSUPPORTED');
        return max($width, $height) > self::MAX_IMAGE_EDGE;
    }

    /** @return array{name:string,mimeType:string,bytes:string,sizeBytes:int,kind:string} */
    private function normalizeImage(string $name, string $path, int $size): array
    {
        if ($size > self::MAX_IMAGE_SOURCE_BYTES) throw new HubAiAttachmentPreparerException('This image is too large for AI analysis', 'ATTACHMENT_AI_INPUT_TOO_LARGE');
        if (!is_file($this->vipsThumbnail) || is_link($this->vipsThumbnail) || !is_executable($this->vipsThumbnail)) throw new HubAiAttachmentPreparerException('Image preparation runtime is not ready', 'IMAGE_INPUT_RUNTIME_UNAVAILABLE');
        $root = rtrim(sys_get_temp_dir(), '/') . '/awh-ai-images';
        if (!is_dir($root) && !@mkdir($root, 0700, true) && !is_dir($root)) throw new HubAiAttachmentPreparerException('Temporary image workspace is unavailable', 'IMAGE_INPUT_RUNTIME_UNAVAILABLE');
        @chmod($root, 0700);
        $output = $root . '/' . bin2hex(random_bytes(16)) . '.jpg';
        try {
            $this->runThumbnail($path, $output);
            return $this->readConverted($name, $output);
        } finally { if (is_file($output) && !is_link($output)) @unlink($output); }
    }
    private function runThumbnail(string $input, string $output): void
    {
        $args = [$this->vipsThumbnail, '--size=' . self::MAX_IMAGE_EDGE . 'x' . self::MAX_IMAGE_EDGE . '>', '--rotate', '--delete', '--output=' . $output . '[Q=88]', $input];
        $pipes = [];
        $process = @proc_open($args, [0=>['pipe','r'],1=>['pipe','w'],2=>['pipe','w']], $pipes, null, ['LC_ALL'=>'C','VIPS_CONCURRENCY'=>'2'], ['bypass_shell'=>true]);
        if (!is_resource($process)) throw new HubAiAttachmentPreparerException('Image preparation runtime could not start', 'IMAGE_INPUT_RUNTIME_UNAVAILABLE');
        fclose($pipes[0]); stream_set_blocking($pipes[1], false); stream_set_blocking($pipes[2], false);
        $started = microtime(true); $exitCode = null;
        try {
            while (true) {
                @stream_get_contents($pipes[1]); @stream_get_contents($pipes[2]);
                $status = proc_get_status($process);
                if (!is_array($status)) throw new HubAiAttachmentPreparerException('Image preparation runtime state is unavailable', 'IMAGE_INPUT_RUNTIME_FAILED');
                if (!$status['running']) { $exitCode = (int)$status['exitcode']; break; }
                if (microtime(true) - $started > 20.0) { @proc_terminate($process, 9); throw new HubAiAttachmentPreparerException('Image preparation timed out', 'IMAGE_INPUT_RUNTIME_FAILED'); }
                usleep(20000);
            }
        } finally {
            foreach ([1,2] as $index) if (isset($pipes[$index]) && is_resource($pipes[$index])) fclose($pipes[$index]);
            @proc_close($process);
        }
        if ($exitCode !== 0 || !is_file($output) || is_link($output)) throw new HubAiAttachmentPreparerException('Image could not be prepared for AI analysis', 'ATTACHMENT_AI_INPUT_CONVERSION_FAILED');
    }
    /** @return array{name:string,mimeType:string,bytes:string,sizeBytes:int,kind:string} */
    private function readConverted(string $name, string $path): array
    {
        $size = @filesize($path);
        if (!is_int($size) || $size < 1 || $size > self::MAX_PREPARED_IMAGE_BYTES) throw new HubAiAttachmentPreparerException('Prepared image is too large for AI analysis', 'ATTACHMENT_AI_INPUT_TOO_LARGE');
        if (!class_exists('finfo')) throw new HubAiAttachmentPreparerException('Image inspection runtime is unavailable', 'IMAGE_INPUT_RUNTIME_UNAVAILABLE');
        $mime = (new finfo(FILEINFO_MIME_TYPE))->file($path);
        if ($mime !== 'image/jpeg') throw new HubAiAttachmentPreparerException('Prepared image did not produce a safe JPEG', 'ATTACHMENT_AI_INPUT_CONVERSION_FAILED');
        $dimensions = @getimagesize($path);
        if (!is_array($dimensions) || max((int)$dimensions[0], (int)$dimensions[1]) > self::MAX_IMAGE_EDGE) throw new HubAiAttachmentPreparerException('Prepared image dimensions are invalid', 'ATTACHMENT_AI_INPUT_CONVERSION_FAILED');
        $raw = @file_get_contents($path);
        if (!is_string($raw) || strlen($raw) !== $size) throw new HubAiAttachmentPreparerException('Prepared image could not be read', 'ATTACHMENT_AI_INPUT_CONVERSION_FAILED');
        $convertedName = preg_match('/\.[^.]+$/', $name) === 1 ? (string)preg_replace('/\.[^.]+$/', '.jpg', $name) : $name . '.jpg';
        return ['name'=>$convertedName,'mimeType'=>'image/jpeg','bytes'=>$raw,'sizeBytes'=>$size,'kind'=>'image'];
    }

    /** @return array{name:string,mimeType:string,bytes:string,sizeBytes:int,kind:string} */
    private function readOriginal(string $name, string $mime, string $path, int $size, string $kind): array
    {
        $raw = @file_get_contents($path);
        if (!is_string($raw) || strlen($raw) !== $size) throw new HubAiAttachmentPreparerException('Attachment could not be read for AI analysis', 'ATTACHMENT_AI_INPUT_UNAVAILABLE');
        return ['name'=>$name,'mimeType'=>$mime,'bytes'=>$raw,'sizeBytes'=>$size,'kind'=>$kind];
    }
}
