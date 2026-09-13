<?php

declare(strict_types=1);

require_once __DIR__ . '/HubProjectSourceAuthorityMigration.php';
require_once __DIR__ . '/HubVaultSourceAuthorityMigration.php';
require_once __DIR__ . '/HubCloudWorkflowService.php';

final class HubProjectSourceAuthorityException extends RuntimeException
{
    public function __construct(string $message, public readonly string $codeName = 'PROJECT_SOURCE_FAILED') { parent::__construct($message); }
}

/**
 * Canonical project-source projection. M21 separates the authority decision
 * from optional upstream/mirror provenance: AWH_VAULT can be authoritative
 * while GitHub remains a non-blocking mirror.
 */
final class HubProjectSourceAuthorityService
{
    public function __construct(private readonly PDO $pdo, private readonly ?HubCloudWorkflowService $cloud) {}

    /** @return array<string,mixed> */
    public function state(string $projectId, bool $refresh = false, ?string $now = null): array
    {
        $this->assertReady(); $projectId=self::uuid($projectId); $row=$this->row($projectId);
        $authority=$row['canonical_source_authority'];
        $provider=$row['canonical_source_provider']; $repository=$row['canonical_source_repository']; $ref=$row['canonical_source_ref'];
        $mirrorRevision=$row['canonical_source_revision']; $observed=$row['canonical_source_observed_at'];
        $canonicalVault=$row['canonical_source_vault_revision_id']; $contentSha=$row['canonical_source_content_sha256'];
        if ($authority === null && $provider === 'GITHUB') $authority='GITHUB';

        if ($refresh && $authority === 'GITHUB' && $provider === 'GITHUB' && is_string($repository) && $repository !== '') {
            if ($this->cloud === null) throw new HubProjectSourceAuthorityException('Canonical GitHub source cannot be refreshed because AWH Cloud is unavailable','PROJECT_SOURCE_PROVIDER_UNAVAILABLE');
            try {
                if (!is_string($ref) || $ref === '') $ref=$this->cloud->repositoryDefaultRef($repository);
                $canonical=$this->cloud->canonicalRepositoryRevision($repository,$ref); $observed=self::timestamp($now ?? gmdate('c'));
            } catch (HubCloudWorkflowException $error) { throw new HubProjectSourceAuthorityException('Canonical project source could not be resolved',$error->codeName); }
            $this->pdo->prepare("UPDATE projects SET canonical_source_ref=:ref,canonical_source_revision=:revision,canonical_source_observed_at=:at,canonical_source_vault_revision_id=CASE WHEN canonical_source_revision=:revision THEN canonical_source_vault_revision_id ELSE NULL END,canonical_source_content_sha256=CASE WHEN canonical_source_revision=:revision THEN canonical_source_content_sha256 ELSE NULL END WHERE project_id=:project AND canonical_source_authority='GITHUB' AND canonical_source_provider='GITHUB' AND canonical_source_repository=:repository")->execute(['ref'=>$ref,'revision'=>$canonical,'at'=>$observed,'project'=>$projectId,'repository'=>$repository]);
            $row=$this->row($projectId); $mirrorRevision=$row['canonical_source_revision']; $canonicalVault=$row['canonical_source_vault_revision_id']; $contentSha=$row['canonical_source_content_sha256'];
        }

        $vault=$this->pdo->prepare('SELECT active_revision_id,sync_state,updated_at FROM control_project_vaults WHERE project_id=:project');$vault->execute(['project'=>$projectId]);$vaultRow=$vault->fetch();
        $canonicalVaultReady=false; $canonicalVaultState=null; $vaultContentSha=null;
        if (is_string($canonicalVault)) {
            $q=$this->pdo->prepare('SELECT content_sha256,state FROM control_project_vault_revisions WHERE project_id=:project AND revision_id=:revision');$q->execute(['project'=>$projectId,'revision'=>$canonicalVault]);$revisionRow=$q->fetch();
            if (is_array($revisionRow)) { $canonicalVaultReady=true; $canonicalVaultState=(string)$revisionRow['state']; $vaultContentSha=strtolower((string)$revisionRow['content_sha256']); }
        }

        $local=$row['source_revision']; $state='NOT_CONFIGURED'; $canonicalRevision=null;
        if ($authority === 'GITHUB' && $provider === 'GITHUB' && is_string($repository) && $repository !== '') {
            $canonicalRevision=is_string($mirrorRevision)&&$mirrorRevision!==''?(string)$mirrorRevision:null;
            $state=is_string($canonicalRevision) ? (is_string($local) && strtolower($local)===strtolower($canonicalRevision) ? 'CURRENT' : 'REMOTE_AHEAD_OR_DIFFERENT') : 'UNRESOLVED';
        } elseif ($authority === 'AWH_VAULT') {
            $canonicalRevision=is_string($contentSha)&&self::isSha256($contentSha)?strtolower($contentSha):null;
            $active=is_array($vaultRow)&&is_string($vaultRow['active_revision_id']??null)?(string)$vaultRow['active_revision_id']:null;
            if ($canonicalRevision===null || !$canonicalVaultReady || !is_string($canonicalVault) || !is_string($vaultContentSha) || !hash_equals($canonicalRevision,$vaultContentSha)) $state='UNRESOLVED';
            elseif ($canonicalVaultState==='ACTIVE' && is_string($active) && hash_equals(strtolower($active),strtolower($canonicalVault))) $state='CURRENT';
            else $state='REMOTE_AHEAD_OR_DIFFERENT';
        }

        $workflowCompatible=false;
        if ($this->cloud !== null && $authority === 'GITHUB' && $provider === 'GITHUB' && is_string($repository) && is_string($ref)) {
            try { $workflow=$this->cloud->sourceIdentity(); $workflowCompatible=strcasecmp((string)$workflow['repository'],$repository)===0 && (string)$workflow['ref']===$ref; } catch (Throwable) { $workflowCompatible=false; }
        }

        return [
            'schemaVersion'=>2,'projectId'=>$projectId,'projectName'=>(string)$row['name'],'projectType'=>(string)$row['type'],
            'authority'=>$authority===null?null:(string)$authority,
            'provider'=>$provider===null?null:(string)$provider,'repository'=>$repository===null?null:(string)$repository,'ref'=>$ref===null?null:(string)$ref,
            'canonicalRevision'=>$canonicalRevision,'mirrorRevision'=>$mirrorRevision===null?null:(string)$mirrorRevision,
            'canonicalContentSha256'=>$contentSha===null?null:(string)$contentSha,'canonicalObservedAt'=>$observed===null?null:(string)$observed,
            'canonicalVaultRevisionId'=>$canonicalVault===null?null:(string)$canonicalVault,'canonicalVaultReady'=>$canonicalVaultReady,
            'localRevision'=>$local===null?null:(string)$local,'localObservedAt'=>(string)$row['observed_at'],'state'=>$state,
            'workflowCompatible'=>$workflowCompatible,
            'vault'=>is_array($vaultRow)?['activeRevisionId'=>$vaultRow['active_revision_id']===null?null:(string)$vaultRow['active_revision_id'],'syncState'=>(string)$vaultRow['sync_state'],'updatedAt'=>(string)$vaultRow['updated_at']]:['activeRevisionId'=>null,'syncState'=>'EMPTY','updatedAt'=>null],
        ];
    }

    /** GitHub remains a supported canonical authority, but is no longer the only one. */
    public function bindGitHub(string $projectId, string $repository, ?string $ref, ?string $now = null, bool $refresh = true): array
    {
        $this->assertReady(); $projectId=self::uuid($projectId); $this->row($projectId); $repository=self::repository($repository); $ref=$ref===null||trim($ref)===''?null:self::ref($ref); $at=self::timestamp($now ?? gmdate('c'));
        $this->pdo->prepare("UPDATE projects SET canonical_source_authority='GITHUB',canonical_source_provider='GITHUB',canonical_source_repository=:repository,canonical_source_ref=:ref,canonical_source_revision=NULL,canonical_source_content_sha256=NULL,canonical_source_observed_at=:at,canonical_source_vault_revision_id=NULL WHERE project_id=:project")->execute(['repository'=>$repository,'ref'=>$ref,'at'=>$at,'project'=>$projectId]);
        return $this->state($projectId,$refresh,$at);
    }

    /** Promote the already-active immutable Vault revision to canonical source authority. */
    public function bindVault(string $projectId, string $vaultRevisionId, ?string $now = null): array
    {
        $this->assertReady(); $projectId=self::uuid($projectId); $vaultRevisionId=self::uuid($vaultRevisionId); $this->row($projectId); $at=self::timestamp($now ?? gmdate('c'));
        $q=$this->pdo->prepare("SELECT r.content_sha256,r.state,v.active_revision_id FROM control_project_vault_revisions r JOIN control_project_vaults v ON v.project_id=r.project_id WHERE r.project_id=:project AND r.revision_id=:revision");$q->execute(['project'=>$projectId,'revision'=>$vaultRevisionId]);$revision=$q->fetch();
        if(!is_array($revision) || (string)$revision['state']!=='ACTIVE' || !is_string($revision['active_revision_id']) || !hash_equals(strtolower((string)$revision['active_revision_id']),$vaultRevisionId)) throw new HubProjectSourceAuthorityException('Only the active Vault revision can become canonical source','PROJECT_SOURCE_VAULT_INVALID');
        $content=self::sha256((string)$revision['content_sha256']);
        $update=$this->pdo->prepare("UPDATE projects SET canonical_source_authority='AWH_VAULT',canonical_source_vault_revision_id=:vault,canonical_source_content_sha256=:content,canonical_source_observed_at=:at WHERE project_id=:project");
        $update->execute(['vault'=>$vaultRevisionId,'content'=>$content,'at'=>$at,'project'=>$projectId]);
        if($update->rowCount()!==1) throw new HubProjectSourceAuthorityException('Vault source authority could not be bound','PROJECT_SOURCE_FAILED');
        return $this->state($projectId,false,$at);
    }

    /** Worker-observed GitHub provenance may initialize an unbound project or update mirror metadata, but never overrides AWH Vault authority. */
    public function observeGitHub(string $projectId, string $repository, ?string $ref, ?string $now = null): array
    {
        $this->assertReady(); $projectId=self::uuid($projectId); $repository=self::repository($repository); $ref=$ref===null||trim($ref)===''?null:self::ref($ref); $row=$this->row($projectId); $at=self::timestamp($now ?? gmdate('c'));
        $boundProvider=$row['canonical_source_provider']; $boundRepo=$row['canonical_source_repository'];
        if ($boundProvider === null && $boundRepo === null) {
            $this->pdo->prepare("UPDATE projects SET canonical_source_authority=COALESCE(canonical_source_authority,'GITHUB'),canonical_source_provider='GITHUB',canonical_source_repository=:repository,canonical_source_ref=:ref,canonical_source_revision=CASE WHEN canonical_source_authority='AWH_VAULT' THEN canonical_source_revision ELSE NULL END,canonical_source_observed_at=:at,canonical_source_vault_revision_id=CASE WHEN canonical_source_authority='AWH_VAULT' THEN canonical_source_vault_revision_id ELSE NULL END,canonical_source_content_sha256=CASE WHEN canonical_source_authority='AWH_VAULT' THEN canonical_source_content_sha256 ELSE NULL END WHERE project_id=:project AND canonical_source_provider IS NULL AND canonical_source_repository IS NULL")->execute(['repository'=>$repository,'ref'=>$ref,'at'=>$at,'project'=>$projectId]);
        } elseif ($boundProvider !== 'GITHUB' || !is_string($boundRepo) || strcasecmp($boundRepo,$repository)!==0) {
            throw new HubProjectSourceAuthorityException('Observed repository conflicts with project mirror provenance','PROJECT_SOURCE_CONFLICT');
        } elseif (($row['canonical_source_ref'] === null || $row['canonical_source_ref'] === '') && $ref !== null) {
            $this->pdo->prepare("UPDATE projects SET canonical_source_ref=:ref,canonical_source_observed_at=:at WHERE project_id=:project AND canonical_source_provider='GITHUB' AND canonical_source_repository=:repository AND canonical_source_ref IS NULL")->execute(['ref'=>$ref,'at'=>$at,'project'=>$projectId,'repository'=>$boundRepo]);
        }
        return $this->state($projectId,false,$at);
    }

    /** Bind an immutable Vault cache to the exact canonical Git SHA already resolved. */
    public function bindCanonicalVaultRevision(string $projectId, string $canonicalRevision, string $vaultRevisionId, ?string $now = null): array
    {
        $this->assertReady(); $projectId=self::uuid($projectId); $canonicalRevision=self::gitSha($canonicalRevision); $vaultRevisionId=self::uuid($vaultRevisionId); $at=self::timestamp($now ?? gmdate('c')); $row=$this->row($projectId);
        if (($row['canonical_source_authority'] ?? null)!=='GITHUB' || ($row['canonical_source_provider'] ?? null)!=='GITHUB' || !is_string($row['canonical_source_revision']) || !hash_equals(strtolower((string)$row['canonical_source_revision']),$canonicalRevision)) throw new HubProjectSourceAuthorityException('Canonical source changed before Vault binding','PROJECT_SOURCE_REVISION_CONFLICT');
        $q=$this->pdo->prepare('SELECT content_sha256 FROM control_project_vault_revisions WHERE project_id=:project AND revision_id=:revision');$q->execute(['project'=>$projectId,'revision'=>$vaultRevisionId]);$content=$q->fetchColumn();if(!is_string($content)) throw new HubProjectSourceAuthorityException('Canonical Vault revision is unavailable','PROJECT_SOURCE_VAULT_INVALID');$content=self::sha256($content);
        $update=$this->pdo->prepare("UPDATE projects SET canonical_source_vault_revision_id=:vault,canonical_source_content_sha256=:content,canonical_source_observed_at=:at WHERE project_id=:project AND canonical_source_authority='GITHUB' AND canonical_source_revision=:revision");$update->execute(['vault'=>$vaultRevisionId,'content'=>$content,'at'=>$at,'project'=>$projectId,'revision'=>$canonicalRevision]);
        if($update->rowCount()!==1) throw new HubProjectSourceAuthorityException('Canonical source changed before Vault binding','PROJECT_SOURCE_REVISION_CONFLICT');
        return $this->state($projectId,false,$at);
    }

    public function clear(string $projectId, ?string $now = null): array
    {
        $this->assertReady(); $projectId=self::uuid($projectId); $this->row($projectId); $at=self::timestamp($now ?? gmdate('c'));
        $this->pdo->prepare('UPDATE projects SET canonical_source_authority=NULL,canonical_source_provider=NULL,canonical_source_repository=NULL,canonical_source_ref=NULL,canonical_source_revision=NULL,canonical_source_content_sha256=NULL,canonical_source_observed_at=:at,canonical_source_vault_revision_id=NULL WHERE project_id=:project')->execute(['at'=>$at,'project'=>$projectId]);
        return $this->state($projectId,false,$at);
    }

    private function assertReady(): void
    {
        try {
            HubProjectSourceAuthorityMigration::assertCapabilityReady($this->pdo, dirname(__DIR__) . '/migrations/019_project_source_authority.sql');
            HubVaultSourceAuthorityMigration::assertCapabilityReady($this->pdo, dirname(__DIR__) . '/migrations/020_vault_source_authority.sql');
        } catch (HubProjectSourceAuthorityMigrationException|HubVaultSourceAuthorityMigrationException $error) { throw new HubProjectSourceAuthorityException('Project Source Authority is not ready', property_exists($error,'codeName')?$error->codeName:'PROJECT_SOURCE_SCHEMA_NOT_READY'); }
    }

    private function row(string $projectId): array
    {
        $q=$this->pdo->prepare('SELECT project_id,name,type,source_revision,observed_at,canonical_source_authority,canonical_source_provider,canonical_source_repository,canonical_source_ref,canonical_source_revision,canonical_source_content_sha256,canonical_source_observed_at,canonical_source_vault_revision_id FROM projects WHERE project_id=:project');$q->execute(['project'=>$projectId]);$row=$q->fetch();if(!is_array($row))throw new HubProjectSourceAuthorityException('Project was not found','PROJECT_NOT_FOUND');return $row;
    }

    private static function repository(string $value): string { $value=trim($value);if(preg_match('#^[A-Za-z0-9_.-]{1,100}/[A-Za-z0-9_.-]{1,100}$#',$value)!==1)throw new HubProjectSourceAuthorityException('GitHub repository identity is invalid','PROJECT_SOURCE_INVALID');return $value; }
    private static function ref(string $value): string { $value=trim($value);if(preg_match('/^[A-Za-z0-9._\/-]{1,160}$/',$value)!==1||str_contains($value,'..'))throw new HubProjectSourceAuthorityException('Git source ref is invalid','PROJECT_SOURCE_INVALID');return $value; }
    private static function uuid(string $value): string { $value=strtolower(trim($value));if(preg_match('/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/',$value)!==1)throw new HubProjectSourceAuthorityException('Project identity is invalid','PROJECT_SOURCE_INVALID');return $value; }
    private static function gitSha(string $value): string { $value=strtolower(trim($value));if(preg_match('/^[0-9a-f]{40}$/',$value)!==1)throw new HubProjectSourceAuthorityException('Git revision is invalid','PROJECT_SOURCE_INVALID');return $value; }
    private static function sha256(string $value): string { $value=strtolower(trim($value));if(!self::isSha256($value))throw new HubProjectSourceAuthorityException('Vault content identity is invalid','PROJECT_SOURCE_VAULT_INVALID');return $value; }
    private static function isSha256(string $value): bool { return preg_match('/^[0-9a-f]{64}$/',strtolower(trim($value)))===1; }
    private static function timestamp(string $value): string { if(strtotime($value)===false)throw new HubProjectSourceAuthorityException('Project source time is invalid','PROJECT_SOURCE_INVALID');return gmdate('c',strtotime($value)); }
}
