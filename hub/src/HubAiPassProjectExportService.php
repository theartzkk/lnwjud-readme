<?php

declare(strict_types=1);

require_once __DIR__ . '/HubProjectVaultService.php';

final class HubAiPassProjectExportException extends RuntimeException
{
    public function __construct(string $message, public readonly string $codeName = 'AIPASS_EXPORT_FAILED') { parent::__construct($message); }
}

/**
 * Human-in-the-loop TH-AI Passport bridge. It emits attachable DOCX evidence
 * from one exact canonical remote Vault revision. It never calls AiPASS APIs.
 */
final class HubAiPassProjectExportService
{
    private const PART_TEXT_CHARS = 750000;
    private const MAX_PARTS = 24;
    private const MAX_PACKAGE_BYTES = 64 * 1024 * 1024;
    private const TEXT_EXTENSIONS = ['php','js','mjs','cjs','ts','tsx','jsx','css','scss','html','htm','sql','md','txt','json','yml','yaml','xml','sh','bash','py','ini','conf','toml'];

    public function __construct(private readonly HubProjectVaultService $vaults) {}

    /** @param array<string,mixed> $source @return array{fileName:string,bytes:string,manifest:array<string,mixed>} */
    public function build(string $projectId, array $source, ?string $now = null): array
    {
        $projectId=self::uuid($projectId); $at=self::timestamp($now ?? gmdate('c'));
        $revision=self::gitSha((string)($source['canonicalRevision']??'')); $vaultRevision=self::uuid((string)($source['canonicalVaultRevisionId']??''));
        if(($source['canonicalVaultReady']??false)!==true || !is_string($source['repository']??null) || !is_string($source['ref']??null) || !is_string($source['projectName']??null)) throw new HubAiPassProjectExportException('Canonical project review source is not ready','AIPASS_SOURCE_NOT_READY');
        $vault=$this->vaults->vault(); $manifest=$vault->manifest($projectId,$vaultRevision);
        $sections=[];$skipped=[];$redactions=[];$included=[];
        foreach($manifest as $entry){
            $path=(string)$entry['path']; $size=(int)$entry['sizeBytes'];
            $reason=$this->pathPolicy($path,$size); if($reason!==null){$skipped[]=['path'=>$path,'reason'=>$reason];continue;}
            try{$read=$vault->reviewReadText($projectId,$vaultRevision,$path);}catch(HubProjectVaultException){$skipped[]=['path'=>$path,'reason'=>'NON_TEXT_OR_UNREADABLE'];continue;}
            if(($read['truncated']??false)===true){$skipped[]=['path'=>$path,'reason'=>'TEXT_FILE_TOO_LARGE'];continue;}
            [$text,$count]=$this->sanitize((string)$read['content']);
            if($count>0)$redactions[]=['path'=>$path,'count'=>$count];
            if(trim($text)===''){$skipped[]=['path'=>$path,'reason'=>'EMPTY_AFTER_SANITIZE'];continue;}
            $section=$this->sourceSection($path,$text); $sections[]=['path'=>$path,'text'=>$section,'chars'=>mb_strlen($section,'UTF-8')]; $included[]=$path;
        }
        if($sections===[]) throw new HubAiPassProjectExportException('No reviewable source remained after safety filtering','AIPASS_SOURCE_EMPTY');
        $parts=$this->partition($sections);
        $context=$this->contextDocx((string)$source['projectName'],(string)$source['repository'],(string)$source['ref'],$revision,$vaultRevision,$at,count($included),count($parts),$skipped,$redactions);
        $files=['01_AIPASS_REVIEW_CONTEXT.docx'=>$context];
        $partCount=count($parts);
        foreach($parts as $index=>$part){$letter=$this->partLabel($index);$name=sprintf('02%s_AIPASS_SOURCE_EVIDENCE_PART_%d_OF_%d.docx',$letter,$index+1,$partCount);$files[$name]=$this->sourceDocx((string)$source['projectName'],$revision,$index+1,$partCount,$part);}
        $transfer="TH-AI Passport manual bridge\nProject: {$source['projectName']}\nRepository: {$source['repository']}\nRef: {$source['ref']}\nExact revision: {$revision}\n\nUpload 01_AIPASS_REVIEW_CONTEXT.docx and every 02*_AIPASS_SOURCE_EVIDENCE_*.docx to Claude in AiPASS. Do not upload this ZIP directly if AiPASS rejects ZIP files.\n";
        $safety=['schemaVersion'=>1,'projectId'=>$projectId,'projectName'=>$source['projectName'],'repository'=>$source['repository'],'ref'=>$source['ref'],'canonicalRevision'=>$revision,'canonicalVaultRevisionId'=>$vaultRevision,'generatedAt'=>$at,'includedCount'=>count($included),'skipped'=>$skipped,'redactions'=>$redactions,'sourcePartCount'=>$partCount,'policies'=>['EXACT_CANONICAL_GIT_SHA','CANONICAL_VAULT_REVISION_ONLY','NO_LOCAL_WORKING_TREE','TEXT_SOURCE_ONLY','NO_DATABASE_OR_ARCHIVE_FILES','SECRET_PATTERN_REDACTION','COMMON_PII_REDACTION','MANUAL_AIPASS_TRANSPORT_ONLY','NO_FAKE_VISUAL_EVIDENCE']];
        $files['00_TRANSFER_INSTRUCTIONS.txt']=$transfer;
        $files['CURRENT_REVISION.json']=json_encode(['schemaVersion'=>1,'project'=>$source['projectName'],'repository'=>$source['repository'],'ref'=>$source['ref'],'commit'=>$revision,'canonicalVaultRevisionId'=>$vaultRevision,'generatedAt'=>$at,'sourceMode'=>'canonical-remote-vault-snapshot'],JSON_UNESCAPED_UNICODE|JSON_UNESCAPED_SLASHES|JSON_PRETTY_PRINT|JSON_THROW_ON_ERROR)."\n";
        $files['SAFETY_MANIFEST.json']=json_encode($safety,JSON_UNESCAPED_UNICODE|JSON_UNESCAPED_SLASHES|JSON_PRETTY_PRINT|JSON_THROW_ON_ERROR)."\n";
        $package=$this->zipBytes($files); if(strlen($package)>self::MAX_PACKAGE_BYTES) throw new HubAiPassProjectExportException('AiPASS export package exceeds safe artifact size','AIPASS_EXPORT_TOO_LARGE');
        $slug=preg_replace('/[^A-Z0-9]+/','-',strtoupper((string)$source['projectName']))??'PROJECT';$slug=trim(substr($slug,0,48),'-');if($slug==='')$slug='PROJECT';
        return ['fileName'=>$slug.'-AIPASS-REVIEW-'.substr($revision,0,12).'.zip','bytes'=>$package,'manifest'=>$safety];
    }

    private function pathPolicy(string $path,int $size): ?string
    {
        if($size<1||$size>HubProjectVault::MAX_REVIEW_READ_BYTES)return 'SIZE_POLICY';
        $lower=strtolower(str_replace('\\','/',$path));$base=basename($lower);$ext=strtolower(pathinfo($base,PATHINFO_EXTENSION));
        if(preg_match('#(^|/)(?:node_modules|vendor|dist|build|coverage|\.git|\.cache|uploads?|backups?|private|secrets?|credentials?)(/|$)#',$lower)===1)return 'PATH_POLICY';
        if($base==='.env'||str_starts_with($base,'.env.')||preg_match('/\.(?:db|sqlite3?|dump|csv|tsv|xlsx?|xlsm|docx?|pptx?|pdf|zip|7z|rar|tar|gz|png|jpe?g|gif|webp|heic|mp4|mov|mp3|wav|pem|key|p12|pfx)$/',$base)===1)return 'FILE_TYPE_POLICY';
        if(!in_array($ext,self::TEXT_EXTENSIONS,true) && !in_array($base,['dockerfile','makefile'],true))return 'TEXT_ALLOWLIST';
        return null;
    }

    /** @return array{0:string,1:int} */
    private function sanitize(string $text): array
    {
        $count=0; $text=self::xmlText($text);
        $patterns=[
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
        foreach($patterns as $pattern=>$replacement){$text=preg_replace_callback($pattern,function()use(&$count,$replacement){$count++;return $replacement;},$text)??$text;}
        $assignment='/((?:password|passwd|secret|api[_-]?key|access[_-]?token|refresh[_-]?token|authorization|line[_-]?(?:channel[_-]?)?access[_-]?token)\s*[=:]\s*)(["\'])([^"\'\r\n]{4,})(\2)/i';
        $text=preg_replace_callback($assignment,function($m)use(&$count){$count++;return $m[1].$m[2].'[REDACTED_SECRET]'.$m[4];},$text)??$text;
        return [$text,$count];
    }

    private function sourceSection(string $path,string $text): string
    {
        $lines=preg_split('/\R/u',$text)?:[$text];$out=["FILE: ".$path];foreach($lines as $i=>$line)$out[]=str_pad((string)($i+1),6,'0',STR_PAD_LEFT).' | '.$line;return implode("\n",$out)."\n";
    }

    /** @param list<array{path:string,text:string,chars:int}> $sections @return list<list<array{path:string,text:string,chars:int}>> */
    private function partition(array $sections): array
    {
        $parts=[];$current=[];$chars=0;
        foreach($sections as $section){$size=(int)$section['chars'];if($current!==[] && $chars+$size>self::PART_TEXT_CHARS){$parts[]=$current;$current=[];$chars=0;}if($size>self::PART_TEXT_CHARS)throw new HubAiPassProjectExportException('One source file is too large for a safe AiPASS document','AIPASS_SOURCE_FILE_TOO_LARGE');$current[]=$section;$chars+=$size;}
        if($current!==[])$parts[]=$current;if(count($parts)>self::MAX_PARTS)throw new HubAiPassProjectExportException('Project requires too many AiPASS source parts','AIPASS_EXPORT_TOO_LARGE');return $parts;
    }

    /** @param list<array{path:string,text:string,chars:int}> $part */
    private function sourceDocx(string $project,string $revision,int $number,int $total,array $part): string
    {
        $body=$this->paragraph('AiPASS Source Evidence — '.$project.' — Part '.$number.' of '.$total,'Title');
        $body.=$this->paragraph('Exact canonical revision: '.$revision,'Subtitle');
        foreach($part as $section){$body.=$this->paragraph((string)$section['path'],'Heading1');$body.=$this->paragraphsFromText((string)$section['text'],'Code');}
        return $this->docx($body,'AiPASS Source Evidence — '.$project);
    }

    /** @param list<array<string,mixed>> $skipped @param list<array<string,mixed>> $redactions */
    private function contextDocx(string $project,string $repository,string $ref,string $revision,string $vaultRevision,string $at,int $included,int $partCount,array $skipped,array $redactions): string
    {
        $prompt="ROLE: Independent technical reviewer. You are not the implementation or deployment authority.\n\nSOURCE OF TRUTH\nProject: {$project}\nRepository: {$repository}\nRef: {$ref}\nExact commit: {$revision}\nCanonical AWH Vault revision: {$vaultRevision}\nGenerated: {$at}\n\nREVIEW\nRead every attached source-evidence DOCX. Identify root causes, duplicate/competing authorities, adjacent blockers, regressions, security/data risks, mobile UX problems, and maintainability issues. Do not invent missing facts. Mark missing evidence explicitly. Tie every implementation claim to a file path and line evidence when available. Prefer root-cause fixes over patches. Do not propose parallel databases, queues, project stores, memory stores, document engines, or AI systems when an existing authority can be extended.\n\nFor BAY EXCUSE X or another Thai school/government-document system, also inspect Thai official-document correctness, A4 geometry, print/preview parity, Thai glyph clipping, signatures, data correctness, iOS/Safari printing, timetable/report authority, and privacy of student/parent data.\n\nOUTPUT\nReturn a prioritized review with P0/P1/P2 severity. For each finding provide: title, severity, evidence paths/lines, root cause, impact, recommended outcome, adjacent dependencies, regression risk, and concrete acceptance tests. Finish with a short implementation order. Do not claim runtime health solely from source code.\n";
        $safety="Safety summary: {$included} text source files included across {$partCount} DOCX parts; ".count($skipped)." files skipped by policy; ".array_sum(array_map(static fn($r)=>(int)($r['count']??0),$redactions))." redactions applied. No production database, local working tree, secrets, or fabricated visual evidence is included.";
        $body=$this->paragraph('AiPASS Independent Review Context — '.$project,'Title');$body.=$this->paragraph('Exact canonical Git SHA: '.$revision,'Subtitle');$body.=$this->paragraphsFromText($prompt,'Normal');$body.=$this->paragraph($safety,'Note');
        return $this->docx($body,'AiPASS Review Context — '.$project);
    }

    private function partLabel(int $index): string { $n=$index;$label='';do{$label=chr(65+($n%26)).$label;$n=intdiv($n,26)-1;}while($n>=0);return $label; }
    private function paragraphsFromText(string $text,string $style): string{$lines=preg_split('/\R/u',$text)?:[$text];$out='';for($i=0;$i<count($lines);$i+=80)$out.=$this->paragraph(implode("\n",array_slice($lines,$i,80)),$style);return $out;}
    private function paragraph(string $text,string $style): string{$chunks=explode("\n",self::xmlText($text));$runs='';foreach($chunks as $i=>$line){if($i>0)$runs.='<w:r><w:br/></w:r>';$runs.='<w:r><w:t xml:space="preserve">'.self::xml($line===''?' ':$line).'</w:t></w:r>'; }return '<w:p><w:pPr><w:pStyle w:val="'.$style.'"/></w:pPr>'.$runs.'</w:p>';}

    private function docx(string $body,string $title): string
    {
        $document='<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>'.$body.'<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="900" w:right="900" w:bottom="900" w:left="900"/></w:sectPr></w:body></w:document>';
        $styles='<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:eastAsia="Arial"/><w:lang w:val="en-US" w:eastAsia="th-TH"/></w:rPr></w:rPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:rPr><w:sz w:val="19"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:rPr><w:b/><w:sz w:val="34"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Subtitle"><w:name w:val="Subtitle"/><w:basedOn w:val="Normal"/><w:rPr><w:sz w:val="20"/><w:color w:val="555555"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="Heading 1"/><w:basedOn w:val="Normal"/><w:rPr><w:b/><w:sz w:val="24"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Code"><w:name w:val="Code"/><w:basedOn w:val="Normal"/><w:rPr><w:rFonts w:ascii="Courier New" w:hAnsi="Courier New" w:eastAsia="Arial"/><w:sz w:val="15"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Note"><w:name w:val="Note"/><w:basedOn w:val="Normal"/><w:rPr><w:i/><w:color w:val="666666"/></w:rPr></w:style></w:styles>';
        $types='<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>';
        $rels='<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>';
        $docrels='<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>';
        return $this->zipBytes(['[Content_Types].xml'=>$types,'_rels/.rels'=>$rels,'word/document.xml'=>$document,'word/styles.xml'=>$styles,'word/_rels/document.xml.rels'=>$docrels]);
    }

    /** @param array<string,string> $files */
    private function zipBytes(array $files): string
    {
        if(!class_exists('ZipArchive'))throw new HubAiPassProjectExportException('ZIP support is unavailable','AIPASS_EXPORT_UNAVAILABLE');$tmp=tempnam(sys_get_temp_dir(),'awh-aipass-');if(!is_string($tmp))throw new HubAiPassProjectExportException('AiPASS staging is unavailable','AIPASS_EXPORT_UNAVAILABLE');@unlink($tmp);$zip=new ZipArchive();if($zip->open($tmp,ZipArchive::CREATE|ZipArchive::EXCL)!==true)throw new HubAiPassProjectExportException('AiPASS staging is unavailable','AIPASS_EXPORT_UNAVAILABLE');try{foreach($files as $name=>$bytes){if(!$zip->addFromString($name,$bytes))throw new HubAiPassProjectExportException('AiPASS file could not be staged','AIPASS_EXPORT_FAILED');}$zip->close();$bytes=file_get_contents($tmp);if(!is_string($bytes)||strlen($bytes)<100)throw new HubAiPassProjectExportException('AiPASS package is invalid','AIPASS_EXPORT_FAILED');return $bytes;}finally{if($zip->status===ZipArchive::ER_OK){@$zip->close();}@unlink($tmp);}
    }

    private static function xmlText(string $value): string { $value=str_replace("\0",'',$value);return preg_replace('/[^\x09\x0A\x0D\x20-\x{D7FF}\x{E000}-\x{FFFD}\x{10000}-\x{10FFFF}]/u','�',$value)??''; }
    private static function xml(string $value): string{return htmlspecialchars($value,ENT_XML1|ENT_QUOTES,'UTF-8');}
    private static function gitSha(string $value): string{$value=strtolower(trim($value));if(preg_match('/^[0-9a-f]{40}$/',$value)!==1)throw new HubAiPassProjectExportException('Canonical revision is invalid','AIPASS_SOURCE_NOT_READY');return $value;}
    private static function uuid(string $value): string{if(preg_match('/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i',$value)!==1)throw new HubAiPassProjectExportException('Project revision identity is invalid','AIPASS_SOURCE_NOT_READY');return strtolower($value);}
    private static function timestamp(string $value): string{if(strtotime($value)===false)throw new HubAiPassProjectExportException('AiPASS export time is invalid','AIPASS_EXPORT_INVALID');return gmdate('c',strtotime($value));}
}
