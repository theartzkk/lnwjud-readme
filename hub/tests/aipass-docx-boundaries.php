<?php

declare(strict_types=1);

require_once dirname(__DIR__) . '/src/HubAiPassProjectExportService.php';

function aipass_bound_assert(bool $condition, string $message): void { if (!$condition) throw new RuntimeException($message); }
function aipass_bound_clean(string $path): void { if (is_file($path)) @unlink($path); }

if (!class_exists('ZipArchive')) { fwrite(STDOUT, "AWH AiPASS DOCX boundaries: SKIP ZipArchive unavailable\n"); exit(77); }

$reflection = new ReflectionClass(HubAiPassProjectExportService::class);
$service = $reflection->newInstanceWithoutConstructor();
$split = $reflection->getMethod('splitUtf8Bytes');
$segments = $reflection->getMethod('sourceSegments');
$pack = $reflection->getMethod('packSegments');
$docx = $reflection->getMethod('sourceDocx');
foreach ([$split, $segments, $pack, $docx] as $method) { if (method_exists($method, 'setAccessible')) $method->setAccessible(true); }

$samples = [
    'thai' => str_repeat('โรงเรียนบ้านเอือดใหญ่ทดสอบระบบภาษาไทยและเอกสารราชการ', 12000),
    'emoji' => str_repeat('🙂🚀📚🧠✅', 35000),
    'minified' => str_repeat("const x='abcdefghijklmnopqrstuvwxyz0123456789';function f(){return x+x;}", 12000),
    'no-whitespace-thai' => str_repeat('ก', 220000),
];

foreach ($samples as $label => $text) {
    aipass_bound_assert(strlen($text) > 350000, $label . ' fixture must exceed one output DOCX budget');
    $chunks = $split->invoke(null, $text, 120000);
    aipass_bound_assert(is_array($chunks) && count($chunks) >= 4, $label . ' must split into multiple UTF-8 chunks');
    aipass_bound_assert(implode('', $chunks) === $text, $label . ' UTF-8 split must be lossless');
    foreach ($chunks as $chunk) {
        aipass_bound_assert(is_string($chunk) && strlen($chunk) <= 120000 && preg_match('//u', $chunk) === 1, $label . ' chunk must be valid bounded UTF-8');
    }

    $sourceSegments = $segments->invoke($service, $label . '.txt', $text);
    $parts = $pack->invoke($service, $sourceSegments);
    aipass_bound_assert(is_array($parts) && count($parts) >= 2, $label . ' must produce multiple source DOCX parts');
    foreach ($parts as $index => $part) {
        $rendered = $docx->invoke($service, 'AiPASS UTF-8 Fixture', str_repeat('a', 40), $index + 1, count($parts), $part);
        aipass_bound_assert(is_array($rendered) && is_string($rendered['bytes'] ?? null), $label . ' DOCX must render');
        aipass_bound_assert((int)($rendered['textBytes'] ?? 0) > 0 && (int)$rendered['textBytes'] <= HubAiPassProjectExportService::FILE_TEXT_BYTE_CEILING, $label . ' declared final text budget must be bounded');
        $tmp = tempnam(sys_get_temp_dir(), 'awh-aipass-bound-');
        aipass_bound_assert(is_string($tmp) && file_put_contents($tmp, $rendered['bytes'], LOCK_EX) === strlen($rendered['bytes']), $label . ' DOCX fixture must be persisted');
        try {
            $zip = new ZipArchive();
            aipass_bound_assert($zip->open($tmp, ZipArchive::RDONLY|ZipArchive::CHECKCONS) === true, $label . ' output must be valid DOCX ZIP');
            $xml = $zip->getFromName('word/document.xml');
            $zip->close();
            aipass_bound_assert(is_string($xml) && strlen($xml) > 20, $label . ' DOCX must contain document.xml');
            $xml = preg_replace('/<w:(?:br|cr)\s*\/?>/i', "\n", $xml) ?? $xml;
            $plain = html_entity_decode(strip_tags($xml), ENT_QUOTES|ENT_XML1, 'UTF-8');
            aipass_bound_assert(preg_match('//u', $plain) === 1, $label . ' extracted DOCX text must remain valid UTF-8');
            aipass_bound_assert(strlen($plain) <= HubAiPassProjectExportService::FILE_TEXT_BYTE_CEILING, $label . ' extracted DOCX text must stay below the 350k-byte hard ceiling');
        } finally { aipass_bound_clean((string)$tmp); }
    }
}

aipass_bound_assert(HubAiPassProjectExportService::FILE_TEXT_BYTE_CEILING === 350000, 'per-file conservative ceiling');
aipass_bound_assert(HubAiPassProjectExportService::BATCH_TEXT_BYTE_CEILING === 650000, 'per-batch conservative ceiling');
aipass_bound_assert(HubAiPassProjectExportService::MAX_FILES_PER_BATCH === 16, 'batch file-count ceiling');
aipass_bound_assert(HubAiPassProjectExportService::MAX_BATCHES === 16, 'batch-count ceiling');
fwrite(STDOUT, "AWH AiPASS DOCX boundaries: PASS\n");