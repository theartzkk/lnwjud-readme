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

$fixtureText = "FILE: fixture.txt\nSEGMENT: 1 OF 1\n000001 | สวัสดี AiPASS 🙂\n";
$fixturePart = [['path'=>'fixture.txt','segment'=>1,'text'=>$fixtureText,'bytes'=>strlen($fixtureText)]];
$contextDoc = $docx->invoke($service, 'AiPASS Tamper Fixture Context', str_repeat('b', 40), 1, 1, $fixturePart);
$sourceDoc = $docx->invoke($service, 'AiPASS Tamper Fixture Source', str_repeat('b', 40), 1, 1, $fixturePart);
aipass_bound_assert(is_array($contextDoc) && is_array($sourceDoc), 'tamper fixtures must render');

$deliveryReflection = new ReflectionClass(HubAiPassBundleDelivery::class);
$verifyDoc = $deliveryReflection->getMethod('verifyDocxTextBudget');
if (method_exists($verifyDoc, 'setAccessible')) $verifyDoc->setAccessible(true);
$contextActual = (int)$verifyDoc->invoke(null, (string)$contextDoc['bytes']);
$sourceActual = (int)$verifyDoc->invoke(null, (string)$sourceDoc['bytes']);
aipass_bound_assert($contextActual > 1 && $contextActual === (int)$contextDoc['textBytes'], 'context actual text must fit declared conservative budget');
aipass_bound_assert($sourceActual > 1 && $sourceActual === (int)$sourceDoc['textBytes'], 'source actual text must fit declared conservative budget');

$contextName = 'B01_01_AIPASS_REVIEW_CONTEXT.docx';
$sourceName = 'B01_02_AIPASS_SOURCE_EVIDENCE_PART_001_OF_001.docx';
$files = [
    ['index'=>0,'name'=>$contextName,'batch'=>1,'role'=>'CONTEXT','mimeType'=>HubAiPassProjectExportService::DOCX_MIME,'sizeBytes'=>strlen((string)$contextDoc['bytes']),'sha256'=>hash('sha256',(string)$contextDoc['bytes']),'extractedTextBytes'=>(int)$contextDoc['textBytes']],
    ['index'=>1,'name'=>$sourceName,'batch'=>1,'role'=>'SOURCE','mimeType'=>HubAiPassProjectExportService::DOCX_MIME,'sizeBytes'=>strlen((string)$sourceDoc['bytes']),'sha256'=>hash('sha256',(string)$sourceDoc['bytes']),'extractedTextBytes'=>(int)$sourceDoc['textBytes']],
];
$totalText = array_sum(array_column($files, 'extractedTextBytes'));
$baseManifest = [
    'schemaVersion'=>2,'format'=>'AIPASS_DIRECT_DOCX','batchCount'=>1,
    'fileTextByteCeiling'=>HubAiPassProjectExportService::FILE_TEXT_BYTE_CEILING,
    'batchTextByteCeiling'=>HubAiPassProjectExportService::BATCH_TEXT_BYTE_CEILING,
    'maxFilesPerBatch'=>HubAiPassProjectExportService::MAX_FILES_PER_BATCH,
    'files'=>$files,
    'batches'=>[['batch'=>1,'files'=>[0,1],'fileCount'=>2,'extractedTextBytes'=>$totalText]],
];
$writeBundle = static function(array $manifest, array $extra = []) use ($contextName, $sourceName, $contextDoc, $sourceDoc): string {
    $tmp = tempnam(sys_get_temp_dir(), 'awh-aipass-bundle-');
    aipass_bound_assert(is_string($tmp), 'bundle temp path');
    @unlink($tmp);
    $zip = new ZipArchive();
    aipass_bound_assert($zip->open($tmp, ZipArchive::CREATE|ZipArchive::EXCL) === true, 'bundle fixture open');
    $zip->addFromString($contextName, (string)$contextDoc['bytes']);
    $zip->addFromString($sourceName, (string)$sourceDoc['bytes']);
    $zip->addFromString('SAFETY_MANIFEST.json', json_encode($manifest, JSON_UNESCAPED_UNICODE|JSON_UNESCAPED_SLASHES|JSON_THROW_ON_ERROR));
    foreach ($extra as $name => $bytes) $zip->addFromString((string)$name, (string)$bytes);
    aipass_bound_assert($zip->close(), 'bundle fixture close');
    return $tmp;
};
$mustReject = static function(callable $callback, string $message): void {
    try { $callback(); }
    catch (HubAiPassProjectExportException) { return; }
    throw new RuntimeException($message);
};

$validBundle = $writeBundle($baseManifest);
try {
    $verified = HubAiPassBundleDelivery::manifest($validBundle);
    aipass_bound_assert(($verified['batchCount'] ?? null) === 1, 'valid direct-DOCX bundle must verify');
    $downloaded = HubAiPassBundleDelivery::document($validBundle, 1);
    aipass_bound_assert(($downloaded['name'] ?? null) === $sourceName && ($downloaded['mimeType'] ?? null) === HubAiPassProjectExportService::DOCX_MIME, 'verified document delivery must return direct DOCX');
    $landing = HubAiPassBundleDelivery::landingPage($validBundle, '/api/v1/control/artifacts/example/download');
    aipass_bound_assert(str_contains($landing, 'ผ่านขนาดจำกัด ✓') && str_contains($landing, 'อัปโหลดพร้อมกัน 2 ไฟล์') && str_contains($landing, 'ข้อความแนะนำสำหรับ AiPASS'), 'AiPASS landing page must guide one verified Batch at a time');
    aipass_bound_assert(str_contains($landing, 'อย่าอัปโหลดหลาย Batch พร้อมกัน') && str_contains($landing, 'conservative safety bound ไม่ใช่ exact token count'), 'AiPASS landing page must explain batch and byte-bound safety correctly');
    aipass_bound_assert(!str_contains($landing, 'ZIP') && !str_contains($landing, '.zip'), 'AiPASS user-facing landing page must not expose internal bundle format');
} finally { aipass_bound_clean($validBundle); }

$hiddenBundle = $writeBundle($baseManifest, ['hidden.txt'=>'shadow payload']);
try { $mustReject(static fn() => HubAiPassBundleDelivery::manifest($hiddenBundle), 'hidden internal bundle payload must fail closed'); }
finally { aipass_bound_clean($hiddenBundle); }

$duplicateManifest = $baseManifest;
$duplicateManifest['batches'][0]['files'] = [0,0];
$duplicateManifest['batches'][0]['extractedTextBytes'] = 2 * (int)$files[0]['extractedTextBytes'];
$duplicateBundle = $writeBundle($duplicateManifest);
try { $mustReject(static fn() => HubAiPassBundleDelivery::manifest($duplicateBundle), 'duplicate batch mapping must fail closed'); }
finally { aipass_bound_clean($duplicateBundle); }

$totalManifest = $baseManifest;
$totalManifest['batches'][0]['extractedTextBytes'] = $totalText - 1;
$totalBundle = $writeBundle($totalManifest);
try { $mustReject(static fn() => HubAiPassBundleDelivery::manifest($totalBundle), 'forged batch byte total must fail closed'); }
finally { aipass_bound_clean($totalBundle); }

$contextManifest = $baseManifest;
$contextManifest['files'][0]['role'] = 'SOURCE';
$contextBundle = $writeBundle($contextManifest);
try { $mustReject(static fn() => HubAiPassBundleDelivery::manifest($contextBundle), 'batch without exactly one context DOCX must fail closed'); }
finally { aipass_bound_clean($contextBundle); }

$understatedManifest = $baseManifest;
$understatedManifest['files'][0]['extractedTextBytes'] = $contextActual - 1;
$understatedManifest['batches'][0]['extractedTextBytes'] = ($contextActual - 1) + (int)$files[1]['extractedTextBytes'];
$understatedBundle = $writeBundle($understatedManifest);
try { $mustReject(static fn() => HubAiPassBundleDelivery::manifest($understatedBundle), 'DOCX actual text above declared budget must fail closed'); }
finally { aipass_bound_clean($understatedBundle); }

aipass_bound_assert(HubAiPassProjectExportService::FILE_TEXT_BYTE_CEILING === 350000, 'per-file conservative ceiling');
aipass_bound_assert(HubAiPassProjectExportService::BATCH_TEXT_BYTE_CEILING === 650000, 'per-batch conservative ceiling');
aipass_bound_assert(HubAiPassProjectExportService::MAX_FILES_PER_BATCH === 16, 'batch file-count ceiling');
aipass_bound_assert(HubAiPassProjectExportService::MAX_BATCHES === 16, 'batch-count ceiling');
fwrite(STDOUT, "AWH AiPASS DOCX boundaries: PASS\n");