<?php

declare(strict_types=1);

require_once __DIR__.'/HubBaySchoolAuthorityConnector.php';

final class HubSchoolIdentityException extends RuntimeException
{
    public function __construct(string $message,public readonly string $codeName='SCHOOL_IDENTITY_FAILED'){parent::__construct($message);}
}

/** KRUART↔BAY binding metadata. BAY stays authoritative for school roles and permissions. */
final class HubSchoolIdentityService
{
    public function __construct(private readonly PDO $pdo,private readonly HubBaySchoolAuthorityConnector $bay){}

    public static function fromEnvironment(PDO $pdo): self{return new self($pdo,HubBaySchoolAuthorityConnector::fromControlPlane($pdo));}

    public static function schemaPresent(PDO $pdo): bool
    {
        foreach(['control_identity_authority_policy','control_school_identity_bindings'] as $table){$q=$pdo->prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=:name");$q->execute(['name'=>$table]);if($q->fetchColumn()===false)return false;}return true;
    }

    /** @return array<string,mixed> */
    public function policy(): array
    {
        $this->assertSchema();$row=$this->pdo->query('SELECT * FROM control_identity_authority_policy WHERE singleton_id=1')->fetch();
        if(!is_array($row)||(int)$row['local_school_roles_enabled']!==0)throw new HubSchoolIdentityException('Identity authority policy is invalid','IDENTITY_AUTHORITY_INVALID');
        return ['platformAuthority'=>(string)$row['platform_authority'],'schoolAuthority'=>(string)$row['school_authority'],'localSchoolRolesEnabled'=>false,'breakGlassOwnerAuthEnabled'=>(bool)$row['break_glass_owner_auth_enabled']];
    }

    /** @return array<string,mixed> */
    public function forUser(string $userId): array
    {
        $this->assertSchema();$q=$this->pdo->prepare("SELECT * FROM control_school_identity_bindings WHERE user_id=:user AND provider='BAY_EXCUSE_X' AND school_key='primary' LIMIT 1");$q->execute(['user'=>$userId]);$binding=$q->fetch();
        if(!is_array($binding)||($binding['state']??null)!=='ACTIVE')return ['state'=>'UNLINKED','verified'=>false,'provider'=>'BAY_EXCUSE_X','identity'=>null];
        try{$identity=$this->bay->resolve((int)$binding['external_user_id']);$personnel=(string)($identity['personnelId']??'');$stored=(string)($binding['external_personnel_id']??'');$verified=$personnel!==''&&($stored===''||hash_equals($stored,$personnel));return ['state'=>$verified?'LINKED':'MISMATCH','verified'=>$verified,'provider'=>'BAY_EXCUSE_X','bindingId'=>(string)$binding['binding_id'],'identity'=>$identity];}
        catch(HubBaySchoolAuthorityException $e){return ['state'=>'UNAVAILABLE','verified'=>false,'provider'=>'BAY_EXCUSE_X','identity'=>null,'code'=>$e->codeName];}
    }
    /** @return list<array<string,mixed>> */
    public function candidates(): array
    {
        $this->assertSchema();try{return $this->bay->people();}catch(HubBaySchoolAuthorityException $e){throw new HubSchoolIdentityException('BAY school directory is unavailable',$e->codeName);}
    }

    /** @return list<array<string,mixed>> */
    public function bindings(): array
    {
        $this->assertSchema();$rows=$this->pdo->query("SELECT user_id,display_name,system_role,status FROM control_user_profiles ORDER BY CASE WHEN system_role='OWNER' THEN 0 ELSE 1 END,display_name LIMIT 200")->fetchAll(PDO::FETCH_ASSOC)?:[];$out=[];
        foreach($rows as $row){$userId=(string)$row['user_id'];$out[]=['userId'=>$userId,'displayName'=>(string)$row['display_name'],'platformRole'=>(string)$row['system_role'],'status'=>(string)$row['status'],'school'=>$this->forUser($userId)];}
        return $out;
    }

    /** @return array<string,mixed> */
    public function bind(string $actorUserId,string $targetUserId,int $bayUserId,?string $now=null): array
    {
        $this->assertSchema();$this->assertKruartUser($targetUserId);try{$identity=$this->bay->resolve($bayUserId);}catch(HubBaySchoolAuthorityException $e){throw new HubSchoolIdentityException('BAY identity is unavailable',$e->codeName);}$at=self::timestamp($now??gmdate('c'));
        $existing=$this->pdo->prepare("SELECT user_id FROM control_school_identity_bindings WHERE provider='BAY_EXCUSE_X' AND school_key='primary' AND external_user_id=:external AND user_id<>:user");$existing->execute(['external'=>(string)$bayUserId,'user'=>$targetUserId]);if($existing->fetchColumn()!==false)throw new HubSchoolIdentityException('BAY identity is already linked','SCHOOL_IDENTITY_CONFLICT');
        $id=self::uuid();
        try{$this->pdo->beginTransaction();$q=$this->pdo->prepare("INSERT INTO control_school_identity_bindings(binding_id,user_id,provider,school_key,external_user_id,external_personnel_id,state,linked_by_user_id,linked_at,last_verified_at,revoked_at) VALUES(:id,:user,'BAY_EXCUSE_X','primary',:external,:personnel,'ACTIVE',:actor,:at,:at,NULL) ON CONFLICT(user_id,provider,school_key) DO UPDATE SET external_user_id=excluded.external_user_id,external_personnel_id=excluded.external_personnel_id,state='ACTIVE',linked_by_user_id=excluded.linked_by_user_id,linked_at=excluded.linked_at,last_verified_at=excluded.last_verified_at,revoked_at=NULL");$q->execute(['id'=>$id,'user'=>$targetUserId,'external'=>(string)$bayUserId,'personnel'=>(string)($identity['personnelId']??''),'actor'=>$actorUserId,'at'=>$at]);$this->pdo->commit();}
        catch(PDOException $e){if($this->pdo->inTransaction())$this->pdo->rollBack();throw new HubSchoolIdentityException('School identity binding conflicts with an existing link','SCHOOL_IDENTITY_CONFLICT');}
        catch(Throwable $e){if($this->pdo->inTransaction())$this->pdo->rollBack();if($e instanceof HubSchoolIdentityException)throw $e;throw new HubSchoolIdentityException('School identity could not be linked');}
        return $this->forUser($targetUserId);
    }

    public function revoke(string $targetUserId,?string $now=null): void
    {
        $this->assertSchema();$at=self::timestamp($now??gmdate('c'));$q=$this->pdo->prepare("UPDATE control_school_identity_bindings SET state='REVOKED',revoked_at=:at WHERE user_id=:user AND provider='BAY_EXCUSE_X' AND school_key='primary' AND state='ACTIVE'");$q->execute(['at'=>$at,'user'=>$targetUserId]);if($q->rowCount()!==1)throw new HubSchoolIdentityException('School identity binding was not found','SCHOOL_IDENTITY_NOT_FOUND');
    }
    public function assertPermission(string $userId,string $permission): array
    {
        if(!preg_match('/^[a-z][a-z0-9_.-]{2,100}$/',$permission))throw new HubSchoolIdentityException('School permission is invalid','SCHOOL_PERMISSION_INVALID');
        $state=$this->forUser($userId);if(($state['verified']??false)!==true||!is_array($state['identity']??null))throw new HubSchoolIdentityException('Verified BAY identity is required','SCHOOL_IDENTITY_REQUIRED');
        $permissions=array_map('strval',(array)($state['identity']['permissions']??[]));if(!in_array($permission,$permissions,true))throw new HubSchoolIdentityException('BAY permission is required','SCHOOL_PERMISSION_FORBIDDEN');return $state;
    }

    /** @return array<string,mixed> */
    public function communicationSummary(): array
    {
        $this->assertSchema();try{return $this->bay->communicationSummary();}catch(HubBaySchoolAuthorityException $e){throw new HubSchoolIdentityException('BAY communication authority is unavailable',$e->codeName);}
    }

    private function assertKruartUser(string $userId): void
    {
        $q=$this->pdo->prepare("SELECT 1 FROM hub_users u JOIN control_user_profiles p ON p.user_id=u.user_id WHERE u.user_id=:user AND u.revoked_at IS NULL AND p.status='ACTIVE'");$q->execute(['user'=>$userId]);if($q->fetchColumn()===false)throw new HubSchoolIdentityException('KRUART account is unavailable','KRUART_IDENTITY_NOT_FOUND');
    }

    private function assertSchema(): void{if(!self::schemaPresent($this->pdo))throw new HubSchoolIdentityException('Identity convergence is not activated','IDENTITY_CONVERGENCE_NOT_READY');}
    private static function timestamp(string $value): string{if(strtotime($value)===false)throw new HubSchoolIdentityException('Timestamp is invalid','SCHOOL_IDENTITY_INVALID');return gmdate('c',strtotime($value));}
    private static function uuid(): string{$b=random_bytes(16);$b[6]=chr((ord($b[6])&0x0f)|0x40);$b[8]=chr((ord($b[8])&0x3f)|0x80);return vsprintf('%s%s-%s-%s-%s-%s%s%s',str_split(bin2hex($b),4));}
}
