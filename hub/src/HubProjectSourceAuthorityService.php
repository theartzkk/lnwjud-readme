<?php

declare(strict_types=1);

require_once __DIR__ . '/HubProjectSourceAuthorityMigration.php';
require_once __DIR__ . '/HubCloudWorkflowService.php';

final class HubProjectSourceAuthorityException extends RuntimeException
{
    public function __construct(string $message, public readonly string $codeName = 'PROJECT_SOURCE_FAILED') { parent::__construct($message); }
}

/**
 * One projection over the canonical `projects` authority. Device-local
 * `source_revision` stays observational. Canonical GitHub provenance is
 * resolved independently so stale local WIP can never impersonate Source of Truth.
 */
final class HubProjectSourceAuthorityService
{
    public function __construct(private readonly PDO $pdo, private readonly ?HubCloudWorkflowService $cloud) {}

    /** @return array<string,mixed> */
    public function state(string $projectId, bool $refresh = false, ?string $now = null): array
    {
        $this->assertReady(); $projectId=self::uuid($projectId); $row=$this->row($projectId);
        $provider=$row['canonical_source_provider']; $repository=$row['canonical_source_repository']; $ref=$row['canonical_source_ref'];
        $canonical=$row['canonical_source_revision']; $observed=$row['canonical_source_observed_at']; $canonicalVault=$row['canonical_source_vault_revision_id'];

        if ($refresh && $provider === 'GITHUB' && is_string($repository) && $repository !== '') {
            if ($this->cloud === null) throw new HubProjectSourceAuthorityException('Canonical GitHub source cannot be refreshed because AWH Cloud is unavailable','PROJECT_SOURCE_PROVIDER_UNAVAILABLE');
            try {
                if (!is_string($ref) || $ref === '') $ref=$this->cloud->repositoryDefaultRef($repository);
                $canonical=$this->cloud->canonicalRepositoryRevision($repository,$ref); $observed=self::timestamp($now ?? gmdate('c'));
            } catch (HubCloudWorkflowException $error) { throw new HubProjectSourceAuthorityException('Canonical project source could not be resolved',$error->codeName); }
            $this->pdo->prepare("UPDATE projects SET canonical_source_ref=:ref,canonical_source_revision=:revision,canonical_source_observed_at=:at,canonical_source_vault_revision_id=CASE WHEN canonical_source_revision=:revision THEN canonical_source_vault_revision_id ELSE NULL END WHERE project_id=:project AND canonical_source_provider='GITHUB' AND canonical_source_repository=:repository")->execute(['ref'=>$ref,'revision'=>$canonical,'at'=>$observed,'project'=>$projectId,'repository'=>$repository]);
            $row=$this->row($projectId); $canonicalVault=$row['canonical_source_vault_revision_id'];
        }

        $local=$row['source_revision']; $state='NOT_CONFIGURED';
        if ($provider === 'GITHUB' && is_string($repository) && $repository !== '') $state=is_string($canonical) && $canonical!=='' ? (is_string($local) && strtolower($local)===strtolower($canonical) ? 'CURRENT' : 'REMOTE_AHEAD_OR_DIFFERENT') : 'UNRESOLVED';
        $workflowCompatible=false;
        if ($this->cloud !== null && $provider === 'GITHUB' && is_string($repository) && is_string($ref)) {
            try { $workflow=$this->cloud->sourceIdentity(); $workflowCompatible=strcasecmp((string)$workflow['repository'],$repository)===0 && (string)$workflow['ref']===$ref; } catch (Throwable) { $workflowCompatible=false; }
        }
        $vault=$this->pdo->prepare('SELECT active_revision_id,sync_state,updated_at FROM control_project_vaults WHERE project_id=:project');$vault->execute(['project'=>$projectId]);$vaultRow=$vault->fetch();
        $canonicalVaultReady=false;
        if (is_string($canonicalVault)) { $q=$this->pdo->prepare('SELECT 1 FROM control_project_vault_revisions WHERE project_id=:project AND revision_id=:revision');$q->execute(['project'=>$projectId,'revision'=>$canonicalVault]);$canonicalVaultReady=$q->fetchColumn()!==false; }

        return [
            'schemaVersion'=>1,'projectId'=>$projectId,'projectName'=>(string)$row['name'],'projectType'=>(string)$row['type'],
            'provider'=>$provider===null?null:(string)$provider,'repository'=>$repository===null?null:(string)$repository,'ref'=>$ref===null?null:(string)$ref,
            'canonicalRevision'=>$canonical===null?null:(string)$canonical,'canonicalObservedAt'=>$observed===null?null:(string)$observed,
            'canonicalVaultRevisionId'=>$canonicalVault===null?null:(string)$canonicalVault,'canonicalVaultReady'=>$canonicalVaultReady,
            'localRevision'=>$local===null?null:(string)$local,'localObservedAt'=>(string)$row['observed_at'],'state'=>$state,
            'workflowCompatible'=>$workflowCompatible,
            'vault'=>is_array($vaultRow)?['activeRevisionId'=>$vaultRow['active_revision_id']===null?null:(string)$vaultRow['active_revision_id'],'syncState'=>(string)$vaultRow['sync_state'],'updatedAt'=>(string)$vaultRow['updated_at']]:['activeRevisionId'=>null,'syncState'=>'EMPTY','updatedAt'=>null],
        ];
    }

    /** @return array<string,mixed> */
    public function bindGitHub(string $projectId, string $repository, ?string $ref, ?string $now = null, bool $refresh = true): array
    {
        $this->assertReady(); $projectId=self::uuid($projectId); $this->row($projectId); $repository=self::repository($repository); $ref=$ref===null||trim($ref)===''?null:self::ref($ref); $at=self::timestamp($now ?? gmdate('c'));
        $this->pdo->prepare("UPDATE projects SET canonical_source_provider='GITHUB',canonical_source_repository=:repository,canonical_source_ref=:ref,canonical_source_revision=NULL,canonical_source_observed_at=:at,canonical_source_vault_revision_id=NULL WHERE project_id=:project")->execute(['repository'=>$repository,'ref'=>$ref,'at'=>$at,'project'=>$projectId]);
        return $this->state($projectId,$refresh,$at);
    }

    /** Worker-observed provenance may initialize an unbound project but can never overwrite Owner authority. */
    public function observeGitHub(string $projectId, string $repository, ?string $ref, ?string $now = null): array
    {
        $this->assertReady(); $projectId=self::uuid($projectId); $repository=self::repository($repository); $ref=$ref===null||trim($ref)===''?null:self::ref($ref); $row=$this->row($projectId); $at=self::timestamp($now ?? gmdate('c'));
        $boundProvider=$row['canonical_source_provider']; $boundRepo=$row['canonical_source_repository'];
        if ($boundProvider === null && $boundRepo === null) {
            $this->pdo->prepare("UPDATE projects SET canonical_source_provider='GITHUB',canonical_source_repository=:repository,canonical_source_ref=:ref,canonical_source_revision=NULL,canonical_source_observed_at=:at,canonical_source_vault_revision_id=NULL WHERE project_id=:project AND canonical_source_provider IS NULL AND canonical_source_repository IS NULL")->execute(['repository'=>$repository,'ref'=>$ref,'at'=>$at,'project'=>$projectId]);
        } elseif ($boundProvider !== 'GITHUB' || !is_string($boundRepo) || strcasecmp($boundRepo,$repository)!==0) {
            throw new HubProjectSourceAuthorityException('Observed repository conflicts with canonical project source','PROJECT_SOURCE_CONFLICT');
        } elseif (($row['canonical_source_ref'] === null || $row['canonical_source_ref'] === '') && $ref !== null) {
            $this->pdo->prepare("UPDATE projects SET canonical_source_ref=:ref,canonical_source_observed_at=:at WHERE project_id=:project AND canonical_source_provider='GITHUB' AND canonical_source_repository=:repository AND canonical_source_ref IS NULL")->execute(['ref'=>$ref,'at'=>$at,'project'=>$projectId,'repository'=>$boundRepo]);
        }
        return $this->state($projectId,false,$at);
    }

    /** Bind an immutable Vault revision to the exact canonical Git SHA already resolved. */
    public function bindCanonicalVaultRevision(string $projectId, string $canonicalRevision, string $vaultRevisionId, ?string $now = null): array
    {
        $this->assertReady(); $projectId=self::uuid($projectId); $canonicalRevision=self::gitSha($canonicalRevision); $vaultRevisionId=self::uuid($vaultRevisionId); $at=self::timestamp($now ?? gmdate('c')); $row=$this->row($projectId);
        if (($row['canonical_source_provider'] ?? null)!=='GITHUB' || !is_string($row['canonical_source_revision']) || !hash_equals(strtolower((string)$row['canonical_source_revision']),$canonicalRevision)) throw new HubProjectSourceAuthorityException('Canonical source changed before Vault binding','PROJECT_SOURCE_REVISION_CONFLICT');
        $q=$this->pdo->prepare('SELECT 1 FROM control_project_vault_revisions WHERE project_id=:project AND revision_id=:revision');$q->execute(['project'=>$projectId,'revision'=>$vaultRevisionId]);if($q->fetchColumn()===false) throw new HubProjectSourceAuthorityException('Canonical Vault revision is unavailable','PROJECT_SOURCE_VAULT_INVALID');
        $update=$this->pdo->prepare('UPDATE projects SET canonical_source_vault_revision_id=:vault,canonical_source_observed_at=:at WHERE project_id=:project AND canonical_source_revision=:revision');$update->execute(['vault'=>$vaultRevisionId,'at'=>$at,'project'=>$projectId,'revision'=>$canonicalRevision]);
        if($update->rowCount()!==1) throw new HubProjectSourceAuthorityException('Canonical source changed before Vault binding','PROJECT_SOURCE_REVISION_CONFLICT');
        return $this->state($projectId,false,$at);
    }

    public function clear(string $projectId, ?string $now = null): array
    {
        $this->assertReady(); $projectId=self::uuid($projectId); $this->row($projectId); $at=self::timestamp($now ?? gmdate('c'));
        $this->pdo->prepare('UPDATE projects SET canonical_source_provider=NULL,canonical_source_repository=NULL,canonical_source_ref=NULL,canonical_source_revision=NULL,canonical_source_observed_at=:at,canonical_source_vault_revision_id=NULL WHERE project_id=:project')->execute(['at'=>$at,'project'=>$projectId]);
        return $this->state($projectId,false,$at);
    }

    private function assertReady(): void
    {
        try { HubProjectSourceAuthorityMigration::assertCapabilityReady($this->pdo, dirname(__DIR__) . '/migrations/019_project_source_authority.sql'); }
        catch (HubProjectSourceAuthorityMigrationException $error) { throw new HubProjectSourceAuthorityException('Project Source Authority is not ready',$error->codeName); }
    }

    private function row(string $projectId): array
    {
        $q=$this->pdo->prepare('SELECT project_id,name,type,source_revision,observed_at,canonical_source_provider,canonical_source_repository,canonical_source_ref,canonical_source_revision,canonical_source_observed_at,canonical_source_vault_revision_id FROM projects WHERE project_id=:project');$q->execute(['project'=>$projectId]);$row=$q->fetch();if(!is_array($row))throw new HubProjectSourceAuthorityException('Project was not found','PROJECT_NOT_FOUND');return $row;
    }

    private static function repository(string $value): string { $value=trim($value);if(preg_match('#^[A-Za-z0-9_.-]{1,100}/[A-Za-z0-9_.-]{1,100}$#',$value)!==1)throw new HubProjectSourceAuthorityException('GitHub repository identity is invalid','PROJECT_SOURCE_INVALID');return $value; }
    private static function ref(string $value): string { $value=trim($value);if(preg_match('/^[A-Za-z0-9._\/-]{1,160}$/',$value)!==1||str_contains($value,'..'))throw new HubProjectSourceAuthorityException('Git source ref is invalid','PROJECT_SOURCE_INVALID');return $value; }
    private static function uuid(string $value): string { if(preg_match('/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i',$value)!==1)throw new HubProjectSourceAuthorityException('Project identity is invalid','PROJECT_SOURCE_INVALID');return strtolower($value); }
    private static function gitSha(string $value): string { $value=strtolower(trim($value));if(preg_match('/^[0-9a-f]{40}$/',$value)!==1)throw new HubProjectSourceAuthorityException('Git revision is invalid','PROJECT_SOURCE_INVALID');return $value; }
    private static function timestamp(string $value): string { if(strtotime($value)===false)throw new HubProjectSourceAuthorityException('Project source time is invalid','PROJECT_SOURCE_INVALID');return gmdate('c',strtotime($value)); }
}
