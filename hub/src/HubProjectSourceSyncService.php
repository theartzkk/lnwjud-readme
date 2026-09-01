<?php

declare(strict_types=1);

require_once __DIR__ . '/HubCloudWorkflowService.php';
require_once __DIR__ . '/HubProjectSourceAuthorityService.php';
require_once __DIR__ . '/HubProjectVaultService.php';

final class HubProjectSourceSyncException extends RuntimeException
{
    public function __construct(string $message, public readonly string $codeName = 'PROJECT_SOURCE_SYNC_FAILED') { parent::__construct($message); }
}

/**
 * Server-first canonical source cache. It never promotes or replaces the
 * working Project Vault. One exact remote Git SHA is stored as an immutable
 * Vault revision and mapped through projects.canonical_source_vault_revision_id.
 */
final class HubProjectSourceSyncService
{
    private const MAX_NORMALIZED_BYTES = 128 * 1024 * 1024;
    private const MAX_FILE_BYTES = 32 * 1024 * 1024;
    private const MAX_FILES = 10000;

    public function __construct(
        private readonly PDO $pdo,
        private readonly HubCloudWorkflowService $cloud,
        private readonly HubProjectSourceAuthorityService $sources,
        private readonly HubProjectVaultService $vaults,
    ) {}

    /** @return array<string,mixed> */
    public function sync(string $projectId, ?string $now = null): array
    {
        $at=self::timestamp($now ?? gmdate('c'));
        try { $source=$this->sources->state($projectId,true,$at); }
        catch(HubProjectSourceAuthorityException $error){ throw new HubProjectSourceSyncException('Canonical project source is unavailable',$error->codeName); }
        if(($source['provider']??null)!=='GITHUB' || !is_string($source['repository']??null) || !is_string($source['ref']??null) || !is_string($source['canonicalRevision']??null)) throw new HubProjectSourceSyncException('Canonical project source is not configured','PROJECT_SOURCE_UNRESOLVED');
        $revision=self::gitSha((string)$source['canonicalRevision']);
        $bound=$source['canonicalVaultRevisionId']??null;
        if(is_string($bound) && ($source['canonicalVaultReady']??false)===true){ return $source + ['synced'=>false,'sourceMode'=>'CANONICAL_REMOTE_CACHE']; }

        $owner=$this->pdo->query('SELECT owner_user_id FROM owner_bootstrap WHERE singleton_id=1 AND bootstrap_closed=1')->fetchColumn();
        if(!is_string($owner)) throw new HubProjectSourceSyncException('AWH Owner authority is unavailable','OWNER_AUTHORITY_UNAVAILABLE');
        $before=$this->vaults->state($projectId); $expected=is_string($before['activeRevisionId']??null)?(string)$before['activeRevisionId']:null;
        $archive=null;
        try {
            $bytes=$this->cloud->downloadRepositoryArchive((string)$source['repository'],$revision);
            $archive=$this->normalizeGitHubArchive($bytes);
            $latest=$this->cloud->canonicalRepositoryRevision((string)$source['repository'],(string)$source['ref']);
            if(!hash_equals($revision,$latest)) throw new HubProjectSourceSyncException('Canonical source moved while snapshot was being prepared','PROJECT_SOURCE_REVISION_CONFLICT');
            $ingested=$this->vaults->ingestArchive($projectId,$archive,$owner,null,$expected,$at);
            $vaultRevision=$this->resolveIngestedRevision($ingested,$expected);
            $mapped=$this->sources->bindCanonicalVaultRevision($projectId,$revision,$vaultRevision,$at);
            return $mapped + ['synced'=>true,'sourceMode'=>'CANONICAL_REMOTE_CACHE'];
        } catch(HubProjectSourceSyncException $error){ throw $error; }
        catch(HubCloudWorkflowException|HubProjectVaultException|HubProjectSourceAuthorityException $error){ $code=property_exists($error,'codeName')?$error->codeName:'PROJECT_SOURCE_SYNC_FAILED'; throw new HubProjectSourceSyncException('Canonical project source could not be cached',$code); }
        finally { if(is_string($archive)) @unlink($archive); }
    }

    /** @param array<string,mixed> $ingested */
    private function resolveIngestedRevision(array $ingested, ?string $expected): string
    {
        foreach(['createdRevisionId','duplicateRevisionId'] as $key) if(is_string($ingested[$key]??null)) return self::uuid((string)$ingested[$key]);
        $active=$ingested['activeRevisionId']??null;
        if(is_string($active) && ($expected===null || !hash_equals($active,$expected))) return self::uuid($active);
        // Duplicate of the currently active revision has no duplicate marker in some older Vault implementations.
        if(is_string($active) && ($ingested['changed']??null)===false) return self::uuid($active);
        throw new HubProjectSourceSyncException('Canonical Vault revision could not be identified','PROJECT_SOURCE_VAULT_INVALID');
    }

    /** GitHub zipballs contain one generated root directory. Repack without it. */
    private function normalizeGitHubArchive(string $bytes): string
    {
        if(!class_exists('ZipArchive') || strlen($bytes)<100 || strlen($bytes)>self::MAX_NORMALIZED_BYTES) throw new HubProjectSourceSyncException('Project source archive is invalid','PROJECT_ARCHIVE_INVALID');
        $input=tempnam(sys_get_temp_dir(),'awh-github-source-in-'); $output=tempnam(sys_get_temp_dir(),'awh-github-source-out-');
        if(!is_string($input)||!is_string($output)){ if(is_string($input))@unlink($input);if(is_string($output))@unlink($output);throw new HubProjectSourceSyncException('Project source staging is unavailable','PROJECT_SOURCE_STORAGE_FAILED'); }
        @unlink($output);
        try {
            if(file_put_contents($input,$bytes,LOCK_EX)!==strlen($bytes)) throw new HubProjectSourceSyncException('Project source staging failed','PROJECT_SOURCE_STORAGE_FAILED');
            $source=new ZipArchive(); if($source->open($input,ZipArchive::RDONLY|ZipArchive::CHECKCONS)!==true) throw new HubProjectSourceSyncException('Project source archive is invalid','PROJECT_ARCHIVE_INVALID');
            $target=new ZipArchive(); if($target->open($output,ZipArchive::CREATE|ZipArchive::EXCL)!==true){$source->close();throw new HubProjectSourceSyncException('Project source staging failed','PROJECT_SOURCE_STORAGE_FAILED');}
            $root=null;$count=0;$total=0;
            try {
                if($source->numFiles<1||$source->numFiles>self::MAX_FILES+1) throw new HubProjectSourceSyncException('Project source archive contains too many files','PROJECT_ARCHIVE_INVALID');
                for($i=0;$i<$source->numFiles;$i++){
                    $stat=$source->statIndex($i,ZipArchive::FL_UNCHANGED); if(!is_array($stat)||!is_string($stat['name']??null)||!is_int($stat['size']??null)) throw new HubProjectSourceSyncException('Project source archive metadata is invalid','PROJECT_ARCHIVE_INVALID');
                    $name=str_replace('\\','/',(string)$stat['name']); if($name===''||str_starts_with($name,'/')||str_contains($name,"\0")) throw new HubProjectSourceSyncException('Project source archive path is unsafe','PROJECT_ARCHIVE_UNSAFE');
                    $segments=explode('/',rtrim($name,'/')); if(count($segments)<1||$segments[0]===''||$segments[0]==='.'||$segments[0]==='..') throw new HubProjectSourceSyncException('Project source archive root is invalid','PROJECT_ARCHIVE_UNSAFE');
                    if($root===null)$root=$segments[0]; elseif($root!==$segments[0]) throw new HubProjectSourceSyncException('Project source archive has multiple roots','PROJECT_ARCHIVE_UNSAFE');
                    if(count($segments)===1) continue;
                    $relative=implode('/',array_slice($segments,1)); self::safeRelativePath($relative);
                    $attrs=(int)($stat['external_attributes']??0); if((($attrs>>16)&0170000)===0120000) throw new HubProjectSourceSyncException('Project source archive contains links','PROJECT_ARCHIVE_UNSAFE');
                    if(str_ends_with($name,'/')) continue;
                    $size=(int)$stat['size']; if($size<0||$size>self::MAX_FILE_BYTES) throw new HubProjectSourceSyncException('Project source file exceeds safe limit','PROJECT_ARCHIVE_TOO_LARGE');
                    $total+=$size; $count++; if($total>self::MAX_NORMALIZED_BYTES||$count>self::MAX_FILES) throw new HubProjectSourceSyncException('Project source archive exceeds safe limit','PROJECT_ARCHIVE_TOO_LARGE');
                    $stream=$source->getStream((string)$stat['name']); if(!is_resource($stream)) throw new HubProjectSourceSyncException('Project source file is unreadable','PROJECT_ARCHIVE_INVALID');
                    $content=stream_get_contents($stream,self::MAX_FILE_BYTES+1); fclose($stream); if(!is_string($content)||strlen($content)!==$size) throw new HubProjectSourceSyncException('Project source file could not be verified','PROJECT_ARCHIVE_INVALID');
                    if(!$target->addFromString($relative,$content)) throw new HubProjectSourceSyncException('Project source staging failed','PROJECT_SOURCE_STORAGE_FAILED');
                }
                if($root===null||$count<1) throw new HubProjectSourceSyncException('Project source archive has no files','PROJECT_ARCHIVE_INVALID');
            } finally { $source->close(); $target->close(); }
            $size=@filesize($output); if(!is_int($size)||$size<1||$size>self::MAX_NORMALIZED_BYTES) throw new HubProjectSourceSyncException('Normalized project archive is invalid','PROJECT_ARCHIVE_TOO_LARGE');
            @chmod($output,0600); return $output;
        } catch(Throwable $error){ @unlink($output); if($error instanceof HubProjectSourceSyncException)throw $error; throw new HubProjectSourceSyncException('Project source archive normalization failed','PROJECT_ARCHIVE_INVALID'); }
        finally { @unlink($input); }
    }

    private static function safeRelativePath(string $path): void
    {
        if($path===''||strlen($path)>900||str_starts_with($path,'/')||preg_match('#^[A-Za-z]:/#',$path)===1) throw new HubProjectSourceSyncException('Project source path is unsafe','PROJECT_ARCHIVE_UNSAFE');
        foreach(explode('/',$path) as $part) if($part===''||$part==='.'||$part==='..'||strlen($part)>180||preg_match('/[\x00-\x1f\x7f]/',$part)) throw new HubProjectSourceSyncException('Project source path is unsafe','PROJECT_ARCHIVE_UNSAFE');
    }
    private static function gitSha(string $value): string{$value=strtolower(trim($value));if(preg_match('/^[0-9a-f]{40}$/',$value)!==1)throw new HubProjectSourceSyncException('Canonical revision is invalid','PROJECT_SOURCE_INVALID');return $value;}
    private static function uuid(string $value): string{if(preg_match('/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i',$value)!==1)throw new HubProjectSourceSyncException('Vault revision identity is invalid','PROJECT_SOURCE_VAULT_INVALID');return strtolower($value);}
    private static function timestamp(string $value): string{if(strtotime($value)===false)throw new HubProjectSourceSyncException('Project source sync time is invalid','PROJECT_SOURCE_INVALID');return gmdate('c',strtotime($value));}
}
