<?php
declare(strict_types=1);

final class HubPlatformMaintenanceException extends RuntimeException
{
    public function __construct(string $message, public readonly string $codeName='PLATFORM_MAINTENANCE_FAILED'){parent::__construct($message);}
}

final class HubPlatformMaintenanceService
{
    public function __construct(private readonly PDO $pdo) {}

    public static function schemaPresent(PDO $pdo): bool
    {
        try { return (int)$pdo->query("SELECT count(*) FROM sqlite_master WHERE type='table' AND name='control_platform_maintenance'")->fetchColumn()===1; }
        catch(Throwable){ return false; }
    }

    public function state(): array
    {
        if(!self::schemaPresent($this->pdo))return ['mode'=>'NORMAL','active'=>false,'platformProjectId'=>null,'reason'=>'Schema not installed','enabledAt'=>null,'updatedAt'=>'','updatedBy'=>''];
        $row=$this->pdo->query("SELECT mode,platform_project_id,reason,enabled_at,updated_at,updated_by FROM control_platform_maintenance WHERE singleton_id=1")->fetch();
        if(!is_array($row))throw new HubPlatformMaintenanceException('Platform maintenance state is missing','PLATFORM_MAINTENANCE_STATE_INVALID');
        $mode=(string)$row['mode'];
        if(!in_array($mode,['NORMAL','PLATFORM_ONLY'],true))throw new HubPlatformMaintenanceException('Platform maintenance state is invalid','PLATFORM_MAINTENANCE_STATE_INVALID');
        return ['mode'=>$mode,'active'=>$mode==='PLATFORM_ONLY','platformProjectId'=>$row['platform_project_id']===null?null:(string)$row['platform_project_id'],'reason'=>(string)$row['reason'],'enabledAt'=>$row['enabled_at']===null?null:(string)$row['enabled_at'],'updatedAt'=>(string)$row['updated_at'],'updatedBy'=>(string)$row['updated_by']];
    }

    public function mutationAllowed(string $projectId,string $resource,?string $releaseTrack=null): bool
    {
        $resource=strtoupper(trim($resource));
        if($resource==='READ')return true;
        $state=$this->state();
        if(($state['active']??false)!==true)return true;
        // Source promotion is fast-forward only and every release request is
        // bound to one immutable exact SHA before dispatch. PLATFORM_ONLY must
        // therefore freeze shared host deploy/stage mutations, not unrelated
        // source progress that cannot alter the already-approved snapshot.
        if($resource==='CANONICAL:SOURCE'||str_starts_with($resource,'CANONICAL:SOURCE:'))return true;
        $platform=$state['platformProjectId']??null;
        if(!is_string($platform)||$platform===''||!hash_equals(strtolower($platform),strtolower(trim($projectId))))return false;

        // PLATFORM_ONLY is a release-track freeze, not merely a project-id allowlist.
        // AWH Core and VPS Platform intentionally share one project/repository.
        if(in_array($resource,['CANDIDATE','WORKSPACE','RESOURCE:HOSTING'],true))return true;
        if($resource==='CANONICAL:DEPLOY:VPS_PLATFORM')return true;
        return false;
    }

    public function enable(string $platformProjectId,string $reason,string $actor,string $at): array
    {
        $reason=trim($reason);$actor=trim($actor);
        if(!preg_match('/^[0-9a-f-]{36}$/i',$platformProjectId)||$reason===''||strlen($reason)>500||$actor===''||strlen($actor)>80)
            throw new HubPlatformMaintenanceException('Platform maintenance request is invalid','PLATFORM_MAINTENANCE_INVALID');
        $q=$this->pdo->prepare('SELECT 1 FROM projects WHERE project_id=:id');$q->execute(['id'=>$platformProjectId]);
        if($q->fetchColumn()===false)throw new HubPlatformMaintenanceException('Platform project does not exist','PLATFORM_MAINTENANCE_INVALID');
        $this->pdo->prepare("UPDATE control_platform_maintenance SET mode='PLATFORM_ONLY',platform_project_id=:project,reason=:reason,enabled_at=:at,updated_at=:at,updated_by=:actor WHERE singleton_id=1")
            ->execute(['project'=>$platformProjectId,'reason'=>$reason,'at'=>$at,'actor'=>$actor]);
        return $this->state();
    }

    public function disable(string $reason,string $actor,string $at): array
    {
        $reason=trim($reason);$actor=trim($actor);
        if($reason===''||strlen($reason)>500||$actor===''||strlen($actor)>80)
            throw new HubPlatformMaintenanceException('Platform maintenance request is invalid','PLATFORM_MAINTENANCE_INVALID');
        $this->pdo->prepare("UPDATE control_platform_maintenance SET mode='NORMAL',platform_project_id=NULL,reason=:reason,enabled_at=NULL,updated_at=:at,updated_by=:actor WHERE singleton_id=1")
            ->execute(['reason'=>$reason,'at'=>$at,'actor'=>$actor]);
        return $this->state();
    }
}
