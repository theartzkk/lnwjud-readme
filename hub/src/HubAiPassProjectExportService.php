<?php

declare(strict_types=1);

require_once __DIR__ . '/HubProjectVaultService.php';

final class HubAiPassProjectExportException extends RuntimeException
{
    public function __construct(string $message, public readonly string $codeName = 'AIPASS_EXPORT_FAILED') { parent::__construct($message); }
}

/**
 * Human-in-the-loop TH-AI Passport bridge.
 *
 * AWH keeps one internal ZIP only as the existing atomic Artifact object. The
 * user-facing delivery contract is individual DOCX files grouped into bounded
 * review batches. AiPASS must never be asked to ingest the internal ZIP.
 */
final class HubAiPassProjectExportService
{
    public const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    public const FILE_TEXT_BYTE_CEILING = 350000;
    public const BATCH_TEXT_BYTE_CEILING = 650000;
    public const MAX_FILES_PER_BATCH = 16;
    public const MAX_BATCHES = 16;

    private const SOURCE_DOC_CONTENT_TARGET_BYTES = 280000;
    private const SOURCE_SEGMENT_TARGET_BYTES = 120000;
    private const CONTEXT_RESERVE_BYTES = 25000;
    private const MAX_PACKAGE_BYTES = 64 * 1024 * 1024;
    private const MAX_DELIVERY_FILES = 100;
    private const TEXT_EXTENSIONS = ['php','js','mjs','cjs','ts','tsx','jsx','css','scss','html','htm','sql','md','txt','json','yml','yaml','xml','sh','bash','py','ini','conf','toml'];

    public function __construct(private readonly HubProjectVaultService $vaults) {}

    /** @param array<string,mixed> $source @return array{fileName:string,bytes:string,manifest:array<string,mixed>} */
    public function build(string $projectId, array $source, ?string $now = null): array
    {
        $projectId = self::uuid($projectId);
        $at = self::timestamp($now ?? gmdate('c'));
        $revision = self::gitSha((string)($source['canonicalRevision'] ?? ''));
        $vaultRevision = self::uuid((string)($source['canonicalVaultRevisionId'] ?? ''));
        if (($source['canonicalVaultReady'] ?? false) !== true || !is_string($source['repository'] ?? null) || !is_string($source['ref'] ?? null) || !is_string($source['projectName'] ?? null)) {
            throw new HubAiPassProjectExportException('Canonical project review source is not ready', 'AIPASS_SOURCE_NOT_READY');
        }

        $projectName = (string)$source['projectName'];
        $repository = (string)$source['repository'];
        $ref = (string)$source['ref'];
        $vault = $this->vaults->vault();
        $vaultManifest = $vault->manifest($projectId, $vaultRevision);
        $segments = [];
        $skipped = [];
        $redactions = [];
        $included = [];

        foreach ($vaultManifest as $entry) {
            $path = (string)$entry['path'];
            $size = (int)$entry['sizeBytes'];
            $reason = $this->pathPolicy($path, $size);
            if ($reason !== null) { $skipped[] = ['path'=>$path,'reason'=>$reason]; continue; }
            try { $read = $vault->reviewReadText($projectId, $vaultRevision, $path); }
            catch (HubProjectVaultException) { $skipped[] = ['path'=>$path,'reason'=>'NON_TEXT_OR_UNREADABLE']; continue; }
            if (($read['truncated'] ?? false) === true) { $skipped[] = ['path'=>$path,'reason'=>'TEXT_FILE_TOO_LARGE']; continue; }
            [$text, $count] = $this->sanitize((string)$read['content']);
            if ($count > 0) $redactions[] = ['path'=>$path,'count'=>$count];
            if (trim($text) === '') { $skipped[] = ['path'=>$path,'reason'=>'EMPTY_AFTER_SANITIZE']; continue; }
            array_push($segments, ...$this->sourceSegments($path, $text));
            $included[] = $path;
        }
        if ($segments === []) throw new HubAiPassProjectExportException('No reviewable source remained after safety filtering', 'AIPASS_SOURCE_EMPTY');

        $parts = $this->packSegments($segments);
        $partCount = count($parts);
        $sourceDocs = [];
        foreach ($parts as $index => $part) {
            $document = $this->sourceDocx($projectName, $revision, $index + 1, $partCount, $part);
            self::assertFileBudget($document['textBytes']);
            $sourceDocs[] = ['part'=>$index + 1, 'bytes'=>$document['bytes'], 'textBytes'=>$document['textBytes']];
        }

        $batchSourceGroups = $this->batchSourceDocuments($sourceDocs);
        $batchCount = count($batchSourceGroups);
        if ($batchCount < 1 || $batchCount > self::MAX_BATCHES) throw new HubAiPassProjectExportException('Project requires too many AiPASS review batches', 'AIPASS_EXPORT_TOO_LARGE');

        $bundleFiles = [];
        $deliveryFiles = [];
        $batchManifest = [];
        $deliveryIndex = 0;
        foreach ($batchSourceGroups as $batchOffset => $batchSources) {
            $batch = $batchOffset + 1;
            $partsInBatch = array_map(static fn(array $item): int => (int)$item['part'], $batchSources);
            $context = $this->contextDocx($projectName, $repository, $ref, $revision, $vaultRevision, $at, count($included), $partCount, $skipped, $redactions, $batch, $batchCount, $partsInBatch);
            self::assertFileBudget($context['textBytes']);

            $contextName = $batch === 1 ? '01_AIPASS_REVIEW_CONTEXT.docx' : sprintf('B%02d_01_AIPASS_REVIEW_CONTEXT.docx', $batch);
            $batchFiles = [];
            $batchTextBytes = 0;
            $contextMeta = $this->deliveryMeta($deliveryIndex++, $contextName, $batch, 'CONTEXT', $context['bytes'], $context['textBytes']);
            $bundleFiles[$contextName] = $context['bytes'];
            $deliveryFiles[] = $contextMeta;
            $batchFiles[] = $contextMeta['index'];
            $batchTextBytes += $context['textBytes'];

            $position = 2;
            foreach ($batchSources as $sourceDoc) {
                $sourceName = sprintf('B%02d_%02d_AIPASS_SOURCE_EVIDENCE_PART_%03d_OF_%03d.docx', $batch, $position++, $sourceDoc['part'], $partCount);
                $meta = $this->deliveryMeta($deliveryIndex++, $sourceName, $batch, 'SOURCE', (string)$sourceDoc['bytes'], (int)$sourceDoc['textBytes']);
                $bundleFiles[$sourceName] = (string)$sourceDoc['bytes'];
                $deliveryFiles[] = $meta;
                $batchFiles[] = $meta['index'];
                $batchTextBytes += (int)$sourceDoc['textBytes'];
            }
            if (count($batchFiles) > self::MAX_FILES_PER_BATCH || $batchTextBytes > self::BATCH_TEXT_BYTE_CEILING) {
                throw new HubAiPassProjectExportException('AiPASS batch exceeds the safe review budget', 'AIPASS_EXPORT_TOO_LARGE');
            }
            $batchManifest[] = ['batch'=>$batch,'files'=>$batchFiles,'fileCount'=>count($batchFiles),'extractedTextBytes'=>$batchTextBytes];
        }
        if (count($deliveryFiles) > self::MAX_DELIVERY_FILES) throw new HubAiPassProjectExportException('AiPASS export contains too many review documents', 'AIPASS_EXPORT_TOO_LARGE');

        $safety = [
            'schemaVersion'=>2,
            'format'=>'AIPASS_DIRECT_DOCX',
            'projectId'=>$projectId,
            'projectName'=>$projectName,
            'repository'=>$repository,
            'ref'=>$ref,
            'canonicalRevision'=>$revision,
            'canonicalVaultRevisionId'=>$vaultRevision,
            'generatedAt'=>$at,
            'includedCount'=>count($included),
            'skipped'=>$skipped,
            'redactions'=>$redactions,
            'sourcePartCount'=>$partCount,
            'batchCount'=>$batchCount,
            'fileTextByteCeiling'=>self::FILE_TEXT_BYTE_CEILING,
            'batchTextByteCeiling'=>self::BATCH_TEXT_BYTE_CEILING,
            'maxFilesPerBatch'=>self::MAX_FILES_PER_BATCH,
            'tokenCountMode'=>'CONSERVATIVE_UTF8_BYTE_BOUND_NOT_EXACT_PROVIDER_TOKENS',
            'files'=>$deliveryFiles,
            'batches'=>$batchManifest,
            'policies'=>[
                'EXACT_CANONICAL_GIT_SHA',
                'CANONICAL_VAULT_REVISION_ONLY',
                'NO_LOCAL_WORKING_TREE',
                'TEXT_SOURCE_ONLY',
                'NO_DATABASE_OR_ARCHIVE_FILES',
                'SECRET_PATTERN_REDACTION',
                'COMMON_PII_REDACTION',
                'AIPASS_DIRECT_DOCX_ONLY',
                'AIPASS_INTERNAL_BUNDLE_NEVER_UPLOAD',
                'PER_FILE_UTF8_BYTE_HARD_CEILING',
                'PER_BATCH_UTF8_BYTE_HARD_CEILING',
                'MANUAL_AIPASS_TRANSPORT_ONLY',
                'NO_FAKE_VISUAL_EVIDENCE',
            ],
        ];
        $bundleFiles['SAFETY_MANIFEST.json'] = json_encode($safety, JSON_UNESCAPED_UNICODE|JSON_UNESCAPED_SLASHES|JSON_PRETTY_PRINT|JSON_THROW_ON_ERROR) . "\n";
        $package = $this->zipBytes($bundleFiles);
        if (strlen($package) > self::MAX_PACKAGE_BYTES) throw new HubAiPassProjectExportException('AiPASS internal bundle exceeds safe artifact size', 'AIPASS_EXPORT_TOO_LARGE');

        $slug = preg_replace('/[^A-Z0-9]+/', '-', strtoupper($projectName)) ?? 'PROJECT';
        $slug = trim(substr($slug, 0, 48), '-');
        if ($slug === '') $slug = 'PROJECT';
        return ['fileName'=>$slug.'-AIPASS-INTERNAL-BUNDLE-'.substr($revision,0,12).'.zip','bytes'=>$package,'manifest'=>$safety];
    }

    private function pathPolicy(string $path, int $size): ?string
    {
        if ($size < 1 || $size > HubProjectVault::MAX_REVIEW_READ_BYTES) return 'SIZE_POLICY';
        $lower = strtolower(str_replace('\\', '/', $path));
        $base = basename($lower);
        $ext = strtolower(pathinfo($base, PATHINFO_EXTENSION));
        if (preg_match('#(^|/)(?:node_modules|vendor|dist|build|coverage|\.git|\.cache|uploads?|backups?|private|secrets?|credentials?)(/|$)#', $lower) === 1) return 'PATH_POLICY';
        if ($base === '.env' || str_starts_with($base, '.env.') || preg_match('/\.(?:db|sqlite3?|dump|csv|tsv|xlsx?|xlsm|docx?|pptx?|pdf|zip|7z|rar|tar|gz|png|jpe?g|gif|webp|heic|mp4|mov|mp3|wav|pem|key|p12|pfx)$/', $base) === 1) return 'FILE_TYPE_POLICY';
        if (!in_array($ext, self::TEXT_EXTENSIONS, true) && !in_array($base, ['dockerfile','makefile'], true)) return 'TEXT_ALLOWLIST';
        return null;
    }

    /** @return array{0:string,1:int} */
    private function sanitize(string $text): array
    {
        $count = 0;
        $text = self::xmlText($text);
        $patterns = [
            '/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----.*?-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/s'=>'[REDACTED_PRIVATE_KEY]',
            '/\b(?:sk|rk|pk)-[A-Za-z0-9_-]{20,}\b/'=>'[REDACTED_API_KEY]',
            '/\bgh[pousr]_[A-Za-z0-9]{20,}\b|\bgithub_pat_[A-Za-z0-9_]{20,}\b/'=>'[REDACTED_GITHUB_TOKEN]',
            '/\bxox[baprs]-[0-9A-Za-z-]{20,}\b/'=>'[REDACTED_TOKEN]',
            '/\bAIza[0-9A-Za-z_-]{30,}\b/'=>'[REDACTED_API_KEY]',
            '/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/'=>'[REDACTED_SESSION_TOKEN]',
            '/\b[0-9]{13}\b/'=>'[REDACTED_THAI_ID]',
            '/(?<!\d)(?:\+66|0)(?:\d[ -]?){8,9}(?!\d)/'=>'[REDACTED_PHONE]',
            '/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i'=>'[REDACTED_EMAIL]',
        ];
        foreach ($patterns as $pattern => $replacement) {
            $text = preg_replace_callback($pattern, function() use (&$count, $replacement) { $count++; return $replacement; }, $text) ?? $text;
        }
        $assignment = '/((?:password|passwd|secret|api[_-]?key|access[_-]?token|refresh[_-]?token|authorization|line[_-]?(?:channel[_-]?)?access[_-]?token)\s*[=:]\s*)(["\'])([^"\'\r\n]{4,})(\2)/i';
        $text = preg_replace_callback($assignment, function($match) use (&$count) { $count++; return $match[1].$match[2].'[REDACTED_SECRET]'.$match[4]; }, $text) ?? $text;
        return [$text, $count];
    }

    /** @return list<array{path:string,segment:int,text:string,bytes:int}> */
    private function sourceSegments(string $path, string $text): array
    {
        $lines = preg_split('/\R/u', $text) ?: [$text];
        $numbered = '';
        foreach ($lines as $index => $line) $numbered .= str_pad((string)($index + 1), 6, '0', STR_PAD_LEFT) . ' | ' . $line . "\n";
        $chunks = self::splitUtf8Bytes($numbered, self::SOURCE_SEGMENT_TARGET_BYTES);
        $segments = [];
        $total = count($chunks);
        foreach ($chunks as $index => $chunk) {
            $rendered = 'FILE: ' . $path . "\nSEGMENT: " . ($index + 1) . ' OF ' . $total . "\n" . $chunk;
            $segments[] = ['path'=>$path,'segment'=>$index + 1,'text'=>$rendered,'bytes'=>strlen($rendered)];
        }
        return $segments;
    }

    /** @param list<array{path:string,segment:int,text:string,bytes:int}> $segments @return list<list<array{path:string,segment:int,text:string,bytes:int}>> */
    private function packSegments(array $segments): array
    {
        $parts = [];
        $current = [];
        $bytes = 0;
        foreach ($segments as $segment) {
            $size = (int)$segment['bytes'];
            if ($size > self::SOURCE_DOC_CONTENT_TARGET_BYTES) throw new HubAiPassProjectExportException('One source segment exceeds the safe AiPASS document budget', 'AIPASS_SOURCE_FILE_TOO_LARGE');
            if ($current !== [] && $bytes + $size > self::SOURCE_DOC_CONTENT_TARGET_BYTES) { $parts[] = $current; $current = []; $bytes = 0; }
            $current[] = $segment;
            $bytes += $size;
        }
        if ($current !== []) $parts[] = $current;
        if ($parts === [] || count($parts) > self::MAX_DELIVERY_FILES) throw new HubAiPassProjectExportException('Project requires too many AiPASS source documents', 'AIPASS_EXPORT_TOO_LARGE');
        return $parts;
    }

    /** @param list<array{part:int,bytes:string,textBytes:int}> $documents @return list<list<array{part:int,bytes:string,textBytes:int}>> */
    private function batchSourceDocuments(array $documents): array
    {
        $groups = [];
        $current = [];
        $bytes = 0;
        $sourceBudget = self::BATCH_TEXT_BYTE_CEILING - self::CONTEXT_RESERVE_BYTES;
        foreach ($documents as $document) {
            $size = (int)$document['textBytes'];
            if ($size > $sourceBudget) throw new HubAiPassProjectExportException('One AiPASS source document exceeds the batch budget', 'AIPASS_EXPORT_TOO_LARGE');
            if ($current !== [] && (count($current) >= self::MAX_FILES_PER_BATCH - 1 || $bytes + $size > $sourceBudget)) {
                $groups[] = $current; $current = []; $bytes = 0;
            }
            $current[] = $document;
            $bytes += $size;
        }
        if ($current !== []) $groups[] = $current;
        return $groups;
    }

    /** @param list<array{path:string,segment:int,text:string,bytes:int}> $part @return array{bytes:string,textBytes:int} */
    private function sourceDocx(string $project, string $revision, int $number, int $total, array $part): array
    {
        $title = 'AiPASS Source Evidence — ' . $project . ' — Part ' . $number . ' of ' . $total;
        $subtitle = 'Exact canonical revision: ' . $revision;
        $body = $this->paragraph($title, 'Title') . $this->paragraph($subtitle, 'Subtitle');
        foreach ($part as $section) {
            $heading = (string)$section['path'] . ' · segment ' . (int)$section['segment'];
            $body .= $this->paragraph($heading, 'Heading1') . $this->paragraphsFromText((string)$section['text'], 'Code');
        }
        return $this->docx($body, $title);
    }

    /** @param list<array<string,mixed>> $skipped @param list<array<string,mixed>> $redactions @param list<int> $partsInBatch @return array{bytes:string,textBytes:int} */
    private function contextDocx(string $project, string $repository, string $ref, string $revision, string $vaultRevision, string $at, int $included, int $partCount, array $skipped, array $redactions, int $batch, int $batchCount, array $partsInBatch): array
    {
        $parts = implode(', ', $partsInBatch);
        $prompt = "ROLE: Independent technical reviewer. You are not the implementation or deployment authority.\n\nSOURCE OF TRUTH\nProject: {$project}\nRepository: {$repository}\nRef: {$ref}\nExact commit: {$revision}\nCanonical AWH Vault revision: {$vaultRevision}\nGenerated: {$at}\nAiPASS batch: {$batch} of {$batchCount}\nSource parts in this batch: {$parts}\n\nUPLOAD RULE\nUpload only the DOCX files listed in this batch. Do not upload the internal AWH bundle. Do not combine this batch with another batch in the same review context. AWH enforces a conservative final UTF-8 text-byte ceiling per DOCX and per batch; this is deliberately below the 1,000,000-token context boundary and is not presented as an exact provider-token count.\n\nREVIEW\nRead every attached source-evidence DOCX in this batch. Identify root causes, duplicate/competing authorities, adjacent blockers, regressions, security/data risks, mobile UX problems, and maintainability issues. Do not invent missing facts. Mark missing evidence explicitly. Tie every implementation claim to a file path and line evidence when available. Prefer root-cause fixes over patches. Do not propose parallel databases, queues, project stores, memory stores, document engines, or AI systems when an existing authority can be extended.\n\nFor BAY EXCUSE X or another Thai school/government-document system, also inspect Thai official-document correctness, A4 geometry, print/preview parity, Thai glyph clipping, signatures, data correctness, iOS/Safari printing, timetable/report authority, and privacy of student/parent data.\n\nOUTPUT\nReturn a prioritized review for this batch with P0/P1/P2 severity. For each finding provide: title, severity, evidence paths/lines, root cause, impact, recommended outcome, adjacent dependencies, regression risk, and concrete acceptance tests. End with BATCH {$batch} OF {$batchCount} COMPLETE and a compact carry-forward summary that can be combined with the other batch reviews. Do not claim runtime health solely from source code.\n";
        $safety = 'Safety summary: ' . $included . ' text source files included across ' . $partCount . ' source DOCX parts; ' . count($skipped) . ' files skipped by policy; ' . array_sum(array_map(static fn($row)=>(int)($row['count'] ?? 0), $redactions)) . ' redactions applied. No production database, local working tree, secrets, or fabricated visual evidence is included.';
        $title = 'AiPASS Independent Review Context — ' . $project . ' — Batch ' . $batch . ' of ' . $batchCount;
        $subtitle = 'Exact canonical Git SHA: ' . $revision;
        $body = $this->paragraph($title, 'Title') . $this->paragraph($subtitle, 'Subtitle') . $this->paragraphsFromText($prompt, 'Normal') . $this->paragraph($safety, 'Note');
        return $this->docx($body, $title);
    }

    /** @return array{index:int,name:string,batch:int,role:string,mimeType:string,sizeBytes:int,sha256:string,extractedTextBytes:int} */
    private function deliveryMeta(int $index, string $name, int $batch, string $role, string $bytes, int $textBytes): array
    {
        self::assertFileBudget($textBytes);
        if (preg_match('/\.docx$/i', $name) !== 1 || str_contains(strtolower($name), '.zip')) throw new HubAiPassProjectExportException('AiPASS delivery filename is invalid', 'AIPASS_EXPORT_FAILED');
        return ['index'=>$index,'name'=>$name,'batch'=>$batch,'role'=>$role,'mimeType'=>self::DOCX_MIME,'sizeBytes'=>strlen($bytes),'sha256'=>hash('sha256',$bytes),'extractedTextBytes'=>$textBytes];
    }

    private static function assertFileBudget(int $bytes): void
    {
        if ($bytes < 1 || $bytes > self::FILE_TEXT_BYTE_CEILING) throw new HubAiPassProjectExportException('AiPASS DOCX exceeds the conservative text budget', 'AIPASS_SOURCE_FILE_TOO_LARGE');
    }

    /** @return list<string> */
    private static function splitUtf8Bytes(string $value, int $limit): array
    {
        if ($limit < 1024) throw new HubAiPassProjectExportException('AiPASS text split limit is invalid', 'AIPASS_EXPORT_FAILED');
        $chunks = [];
        while ($value !== '') {
            if (strlen($value) <= $limit) { $chunks[] = $value; break; }
            if (function_exists('mb_strcut')) $chunk = mb_strcut($value, 0, $limit, 'UTF-8');
            else {
                $chunk = substr($value, 0, $limit);
                while ($chunk !== '' && preg_match('//u', $chunk) !== 1) $chunk = substr($chunk, 0, -1);
            }
            if (!is_string($chunk) || $chunk === '') throw new HubAiPassProjectExportException('AiPASS UTF-8 source could not be split safely', 'AIPASS_EXPORT_FAILED');
            $chunks[] = $chunk;
            $value = substr($value, strlen($chunk));
        }
        return $chunks;
    }

    private function paragraphsFromText(string $text, string $style): string
    {
        $lines = preg_split('/\R/u', $text) ?: [$text];
        $out = '';
        for ($i = 0; $i < count($lines); $i += 80) $out .= $this->paragraph(implode("\n", array_slice($lines, $i, 80)), $style);
        return $out;
    }

    private function paragraph(string $text, string $style): string
    {
        $chunks = explode("\n", self::xmlText($text));
        $runs = '';
        foreach ($chunks as $index => $line) {
            if ($index > 0) $runs .= '<w:r><w:br/></w:r>';
            $runs .= '<w:r><w:t xml:space="preserve">' . self::xml($line === '' ? ' ' : $line) . '</w:t></w:r>';
        }
        return '<w:p><w:pPr><w:pStyle w:val="' . $style . '"/></w:pPr>' . $runs . '</w:p>';
    }

    /** @return array{bytes:string,textBytes:int} */
    private function docx(string $body, string $title): array
    {
        $document = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' . $body . '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="900" w:right="900" w:bottom="900" w:left="900"/></w:sectPr></w:body></w:document>';
        $styles = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:eastAsia="Arial"/><w:lang w:val="en-US" w:eastAsia="th-TH"/></w:rPr></w:rPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:rPr><w:sz w:val="19"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:rPr><w:b/><w:sz w:val="34"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Subtitle"><w:name w:val="Subtitle"/><w:basedOn w:val="Normal"/><w:rPr><w:sz w:val="20"/><w:color w:val="555555"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="Heading 1"/><w:basedOn w:val="Normal"/><w:rPr><w:b/><w:sz w:val="24"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Code"><w:name w:val="Code"/><w:basedOn w:val="Normal"/><w:rPr><w:rFonts w:ascii="Courier New" w:hAnsi="Courier New" w:eastAsia="Arial"/><w:sz w:val="15"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Note"><w:name w:val="Note"/><w:basedOn w:val="Normal"/><w:rPr><w:i/><w:color w:val="666666"/></w:rPr></w:style></w:styles>';
        $types = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>';
        $rels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>';
        $docrels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>';
        $bytes = $this->zipBytes(['[Content_Types].xml'=>$types,'_rels/.rels'=>$rels,'word/document.xml'=>$document,'word/styles.xml'=>$styles,'word/_rels/document.xml.rels'=>$docrels]);
        return ['bytes'=>$bytes,'textBytes'=>self::documentXmlTextBytes($document)];
    }

    public static function documentXmlTextBytes(string $xml): int
    {
        if ($xml === '' || preg_match('//u', $xml) !== 1) throw new HubAiPassProjectExportException('AiPASS DOCX document XML is invalid', 'AIPASS_EXPORT_FAILED');
        $xml = preg_replace('/<w:(?:br|cr)\s*\/?>/i', "\n", $xml) ?? $xml;
        $plain = html_entity_decode(strip_tags($xml), ENT_QUOTES|ENT_XML1, 'UTF-8');
        if (preg_match('//u', $plain) !== 1) throw new HubAiPassProjectExportException('AiPASS DOCX text is invalid UTF-8', 'AIPASS_EXPORT_FAILED');
        return strlen($plain);
    }

    /** @param array<string,string> $files */
    private function zipBytes(array $files): string
    {
        if (!class_exists('ZipArchive')) throw new HubAiPassProjectExportException('ZIP support is unavailable', 'AIPASS_EXPORT_UNAVAILABLE');
        $tmp = tempnam(sys_get_temp_dir(), 'awh-aipass-');
        if (!is_string($tmp)) throw new HubAiPassProjectExportException('AiPASS staging is unavailable', 'AIPASS_EXPORT_UNAVAILABLE');
        @unlink($tmp);
        $zip = new ZipArchive();
        if ($zip->open($tmp, ZipArchive::CREATE|ZipArchive::EXCL) !== true) throw new HubAiPassProjectExportException('AiPASS staging is unavailable', 'AIPASS_EXPORT_UNAVAILABLE');
        $open = true;
        try {
            foreach ($files as $name => $bytes) if (!$zip->addFromString($name, $bytes)) throw new HubAiPassProjectExportException('AiPASS file could not be staged', 'AIPASS_EXPORT_FAILED');
            if (!$zip->close()) throw new HubAiPassProjectExportException('AiPASS package could not be finalized', 'AIPASS_EXPORT_FAILED');
            $open = false;
            $bytes = file_get_contents($tmp);
            if (!is_string($bytes) || strlen($bytes) < 100) throw new HubAiPassProjectExportException('AiPASS package is invalid', 'AIPASS_EXPORT_FAILED');
            return $bytes;
        } finally {
            if ($open) { try { $zip->close(); } catch (Throwable) {} }
            @unlink($tmp);
        }
    }

    private static function xmlText(string $value): string { $value = str_replace("\0", '', $value); return preg_replace('/[^\x09\x0A\x0D\x20-\x{D7FF}\x{E000}-\x{FFFD}\x{10000}-\x{10FFFF}]/u', '�', $value) ?? ''; }
    private static function xml(string $value): string { return htmlspecialchars($value, ENT_XML1|ENT_QUOTES, 'UTF-8'); }
    private static function gitSha(string $value): string { $value = strtolower(trim($value)); if (preg_match('/^[0-9a-f]{40}$/', $value) !== 1) throw new HubAiPassProjectExportException('Canonical revision is invalid', 'AIPASS_SOURCE_NOT_READY'); return $value; }
    private static function uuid(string $value): string { if (preg_match('/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i', $value) !== 1) throw new HubAiPassProjectExportException('Project revision identity is invalid', 'AIPASS_SOURCE_NOT_READY'); return strtolower($value); }
    private static function timestamp(string $value): string { if (strtotime($value) === false) throw new HubAiPassProjectExportException('AiPASS export time is invalid', 'AIPASS_EXPORT_INVALID'); return gmdate('c', strtotime($value)); }
}

/**
 * Verified user-facing delivery of individual AiPASS DOCX files from the one
 * internal atomic Artifact bundle. Artifact/session/project authorization is
 * still performed by HubControlPlaneService before this class is called.
 */
final class HubAiPassBundleDelivery
{
    private const MAX_MANIFEST_BYTES = 512 * 1024;
    private const MAX_DOCX_BYTES = 24 * 1024 * 1024;

    /** @return array<string,mixed> */
    public static function manifest(string $bundlePath): array
    {
        [$zip, $manifest] = self::openBundle($bundlePath);
        try {
            $files = $manifest['files'] ?? null;
            $batches = $manifest['batches'] ?? null;
            if (($manifest['schemaVersion'] ?? null) !== 2 || ($manifest['format'] ?? null) !== 'AIPASS_DIRECT_DOCX' || !is_array($files) || !array_is_list($files) || !is_array($batches) || !array_is_list($batches)) throw new HubAiPassProjectExportException('AiPASS delivery manifest is invalid', 'AIPASS_EXPORT_FAILED');
            if (($manifest['fileTextByteCeiling'] ?? null) !== HubAiPassProjectExportService::FILE_TEXT_BYTE_CEILING || ($manifest['batchTextByteCeiling'] ?? null) !== HubAiPassProjectExportService::BATCH_TEXT_BYTE_CEILING || ($manifest['maxFilesPerBatch'] ?? null) !== HubAiPassProjectExportService::MAX_FILES_PER_BATCH) throw new HubAiPassProjectExportException('AiPASS delivery policy does not match the active safe boundary', 'AIPASS_EXPORT_FAILED');
            if (count($files) < 1 || count($files) > 100 || count($batches) < 1 || count($batches) > HubAiPassProjectExportService::MAX_BATCHES) throw new HubAiPassProjectExportException('AiPASS delivery manifest is outside the safe bound', 'AIPASS_EXPORT_TOO_LARGE');
            if (!is_int($manifest['batchCount'] ?? null) || $manifest['batchCount'] !== count($batches)) throw new HubAiPassProjectExportException('AiPASS batch count is invalid', 'AIPASS_EXPORT_FAILED');
            $names = [];
            foreach ($files as $index => $file) {
                if (!is_array($file) || ($file['index'] ?? null) !== $index || !is_string($file['name'] ?? null) || preg_match('/^[A-Za-z0-9_-]{1,150}\.docx$/', (string)$file['name']) !== 1 || isset($names[(string)$file['name']])) throw new HubAiPassProjectExportException('AiPASS DOCX identity is invalid', 'AIPASS_EXPORT_FAILED');
                if (!in_array($file['role'] ?? null, ['CONTEXT','SOURCE'], true) || !is_int($file['batch'] ?? null) || $file['batch'] < 1 || $file['batch'] > count($batches) || ($file['mimeType'] ?? null) !== HubAiPassProjectExportService::DOCX_MIME || !is_int($file['sizeBytes'] ?? null) || $file['sizeBytes'] < 100 || $file['sizeBytes'] > self::MAX_DOCX_BYTES || !is_string($file['sha256'] ?? null) || preg_match('/^[0-9a-f]{64}$/', (string)$file['sha256']) !== 1 || !is_int($file['extractedTextBytes'] ?? null) || $file['extractedTextBytes'] < 1 || $file['extractedTextBytes'] > HubAiPassProjectExportService::FILE_TEXT_BYTE_CEILING) throw new HubAiPassProjectExportException('AiPASS DOCX metadata is invalid', 'AIPASS_EXPORT_FAILED');
                $name = (string)$file['name'];
                $stat = $zip->statName($name);
                $bytes = $zip->getFromName($name);
                if (!is_array($stat) || (int)($stat['size'] ?? -1) !== (int)$file['sizeBytes'] || !is_string($bytes) || strlen($bytes) !== (int)$file['sizeBytes'] || !hash_equals((string)$file['sha256'], hash('sha256', $bytes))) throw new HubAiPassProjectExportException('AiPASS DOCX integrity check failed', 'AIPASS_EXPORT_FAILED');
                if (self::verifyDocxTextBudget($bytes) !== (int)$file['extractedTextBytes']) throw new HubAiPassProjectExportException('AiPASS DOCX text budget metadata does not match the document', 'AIPASS_EXPORT_FAILED');
                $names[$name] = true;
            }
            $allowedEntries = $names + ['SAFETY_MANIFEST.json'=>true];
            if ($zip->numFiles !== count($allowedEntries)) throw new HubAiPassProjectExportException('AiPASS internal bundle contains unexpected entries', 'AIPASS_EXPORT_FAILED');
            $zipEntries = [];
            for ($entryIndex = 0; $entryIndex < $zip->numFiles; $entryIndex++) {
                $entry = $zip->getNameIndex($entryIndex);
                if (!is_string($entry) || $entry === '' || isset($zipEntries[$entry]) || !isset($allowedEntries[$entry])) throw new HubAiPassProjectExportException('AiPASS internal bundle contains an unexpected or duplicate entry', 'AIPASS_EXPORT_FAILED');
                $zipEntries[$entry] = true;
            }
            $mappedFiles = [];
            foreach ($batches as $offset => $batch) {
                if (!is_array($batch) || ($batch['batch'] ?? null) !== $offset + 1 || !is_array($batch['files'] ?? null) || !array_is_list($batch['files']) || !is_int($batch['fileCount'] ?? null) || $batch['fileCount'] !== count($batch['files']) || $batch['fileCount'] < 2 || $batch['fileCount'] > HubAiPassProjectExportService::MAX_FILES_PER_BATCH || !is_int($batch['extractedTextBytes'] ?? null) || $batch['extractedTextBytes'] < 1 || $batch['extractedTextBytes'] > HubAiPassProjectExportService::BATCH_TEXT_BYTE_CEILING) throw new HubAiPassProjectExportException('AiPASS batch metadata is invalid', 'AIPASS_EXPORT_FAILED');
                $batchTextBytes = 0;
                $contextCount = 0;
                foreach ($batch['files'] as $fileIndex) {
                    if (!is_int($fileIndex) || !isset($files[$fileIndex]) || (int)$files[$fileIndex]['batch'] !== $offset + 1 || isset($mappedFiles[$fileIndex])) throw new HubAiPassProjectExportException('AiPASS batch file mapping is invalid or duplicated', 'AIPASS_EXPORT_FAILED');
                    $mappedFiles[$fileIndex] = true;
                    $batchTextBytes += (int)$files[$fileIndex]['extractedTextBytes'];
                    if (($files[$fileIndex]['role'] ?? null) === 'CONTEXT') $contextCount++;
                }
                if ($contextCount !== 1 || $batchTextBytes !== (int)$batch['extractedTextBytes']) throw new HubAiPassProjectExportException('AiPASS batch context or text budget does not match its files', 'AIPASS_EXPORT_FAILED');
            }
            if (count($mappedFiles) !== count($files)) throw new HubAiPassProjectExportException('AiPASS delivery manifest leaves DOCX files unmapped', 'AIPASS_EXPORT_FAILED');
            return $manifest;
        } finally { $zip->close(); }
    }

    /** @return array{name:string,mimeType:string,bytes:string,sizeBytes:int,batch:int,extractedTextBytes:int} */
    public static function document(string $bundlePath, int $index): array
    {
        $manifest = self::manifest($bundlePath);
        $files = $manifest['files'];
        if ($index < 0 || !isset($files[$index]) || !is_array($files[$index])) throw new HubAiPassProjectExportException('AiPASS DOCX was not found', 'AIPASS_EXPORT_FAILED');
        $file = $files[$index];
        $zip = new ZipArchive();
        if ($zip->open($bundlePath, ZipArchive::RDONLY|ZipArchive::CHECKCONS) !== true) throw new HubAiPassProjectExportException('AiPASS internal bundle is unavailable', 'AIPASS_EXPORT_FAILED');
        try { $bytes = $zip->getFromName((string)$file['name']); }
        finally { $zip->close(); }
        if (!is_string($bytes) || strlen($bytes) !== (int)$file['sizeBytes'] || !hash_equals((string)$file['sha256'], hash('sha256', $bytes))) throw new HubAiPassProjectExportException('AiPASS DOCX integrity check failed', 'AIPASS_EXPORT_FAILED');
        if (self::verifyDocxTextBudget($bytes) !== (int)$file['extractedTextBytes']) throw new HubAiPassProjectExportException('AiPASS DOCX text budget metadata does not match the document', 'AIPASS_EXPORT_FAILED');
        return ['name'=>(string)$file['name'],'mimeType'=>HubAiPassProjectExportService::DOCX_MIME,'bytes'=>$bytes,'sizeBytes'=>strlen($bytes),'batch'=>(int)$file['batch'],'extractedTextBytes'=>(int)$file['extractedTextBytes']];
    }

    public static function landingPage(string $bundlePath, string $downloadPath): string
    {
        $manifest = self::manifest($bundlePath);
        $projectRaw = (string)($manifest['projectName'] ?? 'Project');
        $project = self::html($projectRaw);
        $repository = self::html((string)($manifest['repository'] ?? ''));
        $ref = self::html((string)($manifest['ref'] ?? ''));
        $revisionRaw = (string)($manifest['canonicalRevision'] ?? '');
        $revision = self::html(substr($revisionRaw, 0, 12));
        $vault = self::html(substr((string)($manifest['canonicalVaultRevisionId'] ?? ''), 0, 8));
        $batchCount = (int)$manifest['batchCount'];
        $fileCount = count($manifest['files']);
        $sections = '';
        foreach ($manifest['batches'] as $batch) {
            $number = (int)$batch['batch'];
            $batchBytes = (int)$batch['extractedTextBytes'];
            $batchFiles = (int)$batch['fileCount'];
            $percent = min(100, max(0, (int)round(($batchBytes / HubAiPassProjectExportService::BATCH_TEXT_BYTE_CEILING) * 100)));
            $links = '';
            foreach ($batch['files'] as $index) {
                $file = $manifest['files'][$index];
                $name = self::html((string)$file['name']);
                $textBytes = (int)$file['extractedTextBytes'];
                $textKb = number_format($textBytes / 1024, 1);
                $href = self::html($downloadPath . '?aipass=docx&index=' . (int)$index);
                $role = ($file['role'] ?? '') === 'CONTEXT' ? 'Context / คำสั่งตรวจ' : 'Source evidence / หลักฐานโค้ด';
                $links .= '<li><a class="file" href="' . $href . '"><span><strong>' . $name . '</strong><small>' . self::html($role) . ' · ข้อความ ' . $textKb . ' KB</small></span><b>ดาวน์โหลด DOCX</b></a></li>';
            }
            $prompt = self::html(
                "ตรวจ Batch {$number}/{$batchCount} ของโปรเจกต์ {$projectRaw} จาก canonical revision {$revisionRaw}\n" .
                "ใช้เฉพาะ DOCX ใน Batch นี้เป็นหลักฐาน ห้ามสมมติข้อมูลที่ไม่มีในเอกสาร\n" .
                "สรุป: (1) P0 ที่ต้องหยุดก่อนใช้งาน (2) P1 ที่ควรแก้ (3) P2 ที่ควรปรับปรุง (4) จุดแข็งที่ควรรักษา (5) ไฟล์/โมดูลที่เกี่ยวข้องถ้าระบุได้\n" .
                "อย่าสรุปว่านี่คือผลตรวจทั้งโปรเจกต์จนกว่าจะตรวจครบทุก Batch"
            );
            $sections .= '<section class="batch"><div class="batch-head"><div><span class="eyebrow">BATCH ' . $number . '</span><h2>ชุด ' . $number . ' / ' . $batchCount . '</h2><p>อัปโหลดพร้อมกัน ' . $batchFiles . ' ไฟล์ใน review context เดียว</p></div><span class="pass">ผ่านขนาดจำกัด ✓</span></div><ol class="files">' . $links . '</ol><div class="meter"><div class="meter-row"><span>ขนาดข้อความรวม</span><strong>' . number_format($batchBytes) . ' / ' . number_format(HubAiPassProjectExportService::BATCH_TEXT_BYTE_CEILING) . ' bytes</strong></div><div class="bar" aria-hidden="true"><span style="width:' . $percent . '%"></span></div><small>' . $batchFiles . ' / ' . HubAiPassProjectExportService::MAX_FILES_PER_BATCH . ' files · conservative safety bound ไม่ใช่ exact token count</small></div><details><summary>ข้อความแนะนำสำหรับ AiPASS</summary><pre>' . $prompt . '</pre></details></section>';
        }
        $fileCeiling = number_format(HubAiPassProjectExportService::FILE_TEXT_BYTE_CEILING);
        return '<!doctype html><html lang="th"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><title>AiPASS DOCX · ' . $project . '</title><style>:root{color-scheme:dark}*{box-sizing:border-box}body{font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;max-width:900px;margin:0 auto;padding:max(20px,env(safe-area-inset-top)) 16px max(32px,env(safe-area-inset-bottom));background:#0b0d10;color:#f5f7fa;line-height:1.45}h1{font-size:clamp(1.55rem,6vw,2.2rem);margin:.25rem 0 .5rem}h2{font-size:1.2rem;margin:.15rem 0}p{margin:.45rem 0}.eyebrow{font-size:.72rem;font-weight:800;letter-spacing:.1em;color:#ff9b52}.hero{padding:18px;border:1px solid #2a3038;border-radius:18px;background:#11151b}.summary{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin:16px 0}.summary div{padding:12px;border-radius:14px;background:#15191f;border:1px solid #252b33}.summary strong,.summary small{display:block}.summary small{margin-top:3px;color:#aeb7c2;overflow-wrap:anywhere}.steps{padding:14px 16px;border-radius:14px;background:#142018;border:1px solid #284b35;color:#d9f5e4}.steps strong{color:#83e7ad}.batch{background:#15191f;border:1px solid #2a3038;border-radius:18px;padding:16px;margin:18px 0}.batch-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}.batch-head p{color:#aeb7c2}.pass{flex:none;padding:6px 9px;border-radius:999px;background:#173425;color:#8ff0b6;font-size:.76rem;font-weight:700}.files{list-style:none;padding:0;margin:14px 0}.files li+li{margin-top:9px}.file{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:13px;border-radius:14px;background:#0f1318;border:1px solid #2a3038;color:#f5f7fa;text-decoration:none}.file:hover{border-color:#55718c}.file span{min-width:0}.file strong,.file small{display:block;overflow-wrap:anywhere}.file small{margin-top:4px;color:#aeb7c2}.file b{flex:none;color:#9bd2ff;font-size:.82rem}.meter{margin-top:12px;color:#aeb7c2}.meter-row{display:flex;justify-content:space-between;gap:10px;font-size:.82rem}.bar{height:7px;border-radius:999px;background:#262c34;overflow:hidden;margin:7px 0}.bar span{display:block;height:100%;background:#68c994;border-radius:inherit}.meter small{font-size:.76rem}details{margin-top:14px;border-top:1px solid #2a3038;padding-top:12px}summary{cursor:pointer;color:#9bd2ff;font-weight:700}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#0d1116;border-radius:12px;padding:12px;color:#e8edf3;font:inherit;font-size:.86rem}.footer{color:#8f9aa7;font-size:.82rem;margin:22px 2px}@media(max-width:620px){.summary{grid-template-columns:1fr}.batch-head{display:block}.pass{display:inline-block;margin-top:8px}.file{align-items:flex-start;flex-direction:column}.file b{font-size:.88rem}.meter-row{display:block}.meter-row strong{display:block;margin-top:2px}}</style></head><body><div class="hero"><span class="eyebrow">AIPASS REVIEW</span><h1>' . $project . '</h1><p>ชุด DOCX นี้สร้างจาก Source ที่ AWH ยืนยันแล้ว</p><div class="summary"><div><strong>' . $batchCount . ' Batch</strong><small>' . $fileCount . ' DOCX ทั้งหมด</small></div><div><strong>' . $revision . '</strong><small>' . $repository . ' · ' . $ref . '</small></div><div><strong>' . $vault . '</strong><small>canonical cache snapshot</small></div></div><div class="steps"><strong>ทำทีละ Batch:</strong> ดาวน์โหลดไฟล์ของชุดเดียวกัน → อัปโหลดพร้อมกันเข้า AiPASS → เก็บผลตอบกลับ → แล้วจึงไป Batch ถัดไป อย่าอัปโหลดหลาย Batch พร้อมกัน</div><p class="footer">AWH แสดงเฉพาะ DOCX ที่ผ่าน integrity check แล้ว · แต่ละไฟล์ถูกจำกัดข้อความไม่เกิน ' . $fileCeiling . ' bytes แบบ conservative เพื่อมี safety headroom โดยไม่อ้างว่าเป็น exact provider-token count</p></div>' . $sections . '<p class="footer">เมื่อครบทุก Batch ให้นำผล review แต่ละชุดกลับเข้า AWH เพื่อสังเคราะห์ findings รวมก่อนแก้ Source</p></body></html>';
    }

    /** @return array{0:ZipArchive,1:array<string,mixed>} */
    private static function openBundle(string $bundlePath): array
    {
        if ($bundlePath === '' || !is_file($bundlePath) || is_link($bundlePath)) throw new HubAiPassProjectExportException('AiPASS internal bundle is unavailable', 'AIPASS_EXPORT_FAILED');
        $zip = new ZipArchive();
        if ($zip->open($bundlePath, ZipArchive::RDONLY|ZipArchive::CHECKCONS) !== true) throw new HubAiPassProjectExportException('AiPASS internal bundle is invalid', 'AIPASS_EXPORT_FAILED');
        $raw = $zip->getFromName('SAFETY_MANIFEST.json');
        if (!is_string($raw) || strlen($raw) < 20 || strlen($raw) > self::MAX_MANIFEST_BYTES) { $zip->close(); throw new HubAiPassProjectExportException('AiPASS delivery manifest is unavailable', 'AIPASS_EXPORT_FAILED'); }
        try { $manifest = json_decode($raw, true, 64, JSON_THROW_ON_ERROR); }
        catch (Throwable) { $zip->close(); throw new HubAiPassProjectExportException('AiPASS delivery manifest is invalid', 'AIPASS_EXPORT_FAILED'); }
        if (!is_array($manifest) || array_is_list($manifest)) { $zip->close(); throw new HubAiPassProjectExportException('AiPASS delivery manifest is invalid', 'AIPASS_EXPORT_FAILED'); }
        return [$zip, $manifest];
    }

    private static function verifyDocxTextBudget(string $bytes): int
    {
        if (strlen($bytes) < 100 || strlen($bytes) > self::MAX_DOCX_BYTES || !str_starts_with($bytes, "PK\x03\x04")) throw new HubAiPassProjectExportException('AiPASS DOCX is invalid', 'AIPASS_EXPORT_FAILED');
        $tmp = tempnam(sys_get_temp_dir(), 'awh-aipass-docx-');
        if (!is_string($tmp) || file_put_contents($tmp, $bytes, LOCK_EX) !== strlen($bytes)) { if (is_string($tmp)) @unlink($tmp); throw new HubAiPassProjectExportException('AiPASS DOCX verification is unavailable', 'AIPASS_EXPORT_FAILED'); }
        $doc = new ZipArchive();
        $opened = false;
        try {
            if ($doc->open($tmp, ZipArchive::RDONLY|ZipArchive::CHECKCONS) !== true) throw new HubAiPassProjectExportException('AiPASS DOCX is not a valid Office document', 'AIPASS_EXPORT_FAILED');
            $opened = true;
            $xml = $doc->getFromName('word/document.xml');
            if (!is_string($xml) || strlen($xml) < 20) throw new HubAiPassProjectExportException('AiPASS DOCX has no document body', 'AIPASS_EXPORT_FAILED');
            $textBytes = HubAiPassProjectExportService::documentXmlTextBytes($xml);
            if ($textBytes < 1 || $textBytes > HubAiPassProjectExportService::FILE_TEXT_BYTE_CEILING) throw new HubAiPassProjectExportException('AiPASS DOCX exceeds the verified text budget', 'AIPASS_SOURCE_FILE_TOO_LARGE');
            return $textBytes;
        } finally { if ($opened) $doc->close(); @unlink($tmp); }
    }

    private static function html(string $value): string { return htmlspecialchars($value, ENT_QUOTES|ENT_SUBSTITUTE|ENT_HTML5, 'UTF-8'); }
}
