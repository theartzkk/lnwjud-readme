<?php

declare(strict_types=1);

require_once __DIR__ . '/HubVaultSourceAuthorityMigration.php';

final class HubIdentityConvergenceMigrationException extends RuntimeException
{
    public function __construct(string $message, public readonly string $codeName = 'MIGRATION_FAILED') { parent::__construct($message); }
}

/** M22 keeps platform login in KRUART/AWH while BAY remains school identity authority. */
final class HubIdentityConvergenceMigration
{
    public const TARGET_USER_VERSION = 22;
    public const MIGRATION_ID = 'm22-identity-convergence';
    private const TABLES = ['control_identity_authority_policy','control_school_identity_bindings'];
    private const INDEXES = ['idx_school_identity_user','idx_school_identity_external','idx_school_identity_state'];

    public static function apply(string $databasePath, string $sqlPath, ?string $now = null): string
    {
        $pdo=self::open($databasePath);$sql=@file_get_contents($sqlPath);
        if(!is_string($sql)||$sql==='')throw new HubIdentityConvergenceMigrationException('M22 migration is unavailable','MIGRATION_FILE_INVALID');
        $checksum=hash('sha256',$sql);$version=(int)$pdo->query('PRAGMA user_version')->fetchColumn();
        if($version<21)throw new HubIdentityConvergenceMigrationException('M21 Vault source authority is unavailable','BASE_SCHEMA_INVALID');
        try{HubVaultSourceAuthorityMigration::assertCapabilityReady($pdo,dirname(__DIR__).'/migrations/020_vault_source_authority.sql');}
        catch(Throwable){throw new HubIdentityConvergenceMigrationException('M21 Vault source authority is unavailable','BASE_SCHEMA_INVALID');}
        $ledger=self::ledger($pdo);
        if(is_array($ledger)){
            if((int)$ledger['schema_version']!==self::TARGET_USER_VERSION||!hash_equals((string)$ledger['checksum'],$checksum)||$version<self::TARGET_USER_VERSION)throw new HubIdentityConvergenceMigrationException('M22 migration record is invalid','MIGRATION_RECORD_INVALID');
            self::assertReady($pdo,$checksum);return 'already-applied';
        }
        if($version!==21)throw new HubIdentityConvergenceMigrationException('M22 migration order is not provable','MIGRATION_ORDER_UNCERTAIN');
        foreach(self::TABLES as $table)if(self::tablePresent($pdo,$table))throw new HubIdentityConvergenceMigrationException('M22 migration order is not provable','MIGRATION_ORDER_UNCERTAIN');
        $at=self::timestamp($now??gmdate('c'));
        try{
            $pdo->beginTransaction();$pdo->exec($sql);
            $pdo->prepare('INSERT INTO awh_schema_migrations(migration_id,schema_version,checksum,applied_at) VALUES(:id,22,:checksum,:at)')->execute(['id'=>self::MIGRATION_ID,'checksum'=>$checksum,'at'=>$at]);
            $pdo->exec('PRAGMA user_version = 22');self::assertReady($pdo,$checksum);$pdo->commit();
        }catch(Throwable $error){
            if($pdo->inTransaction())$pdo->rollBack();
            if($error instanceof HubIdentityConvergenceMigrationException)throw $error;
            throw new HubIdentityConvergenceMigrationException('M22 migration rolled back','MIGRATION_ROLLED_BACK');
        }
        return 'applied';
    }

    public static function assertCapabilityReady(PDO $pdo,string $sqlPath): void
    {
        if(!is_file($sqlPath))throw new HubIdentityConvergenceMigrationException('M22 migration authority is unavailable','MIGRATION_FILE_INVALID');
        $checksum=hash_file('sha256',$sqlPath);
        if(!is_string($checksum)||$checksum==='')throw new HubIdentityConvergenceMigrationException('M22 migration authority is unavailable','MIGRATION_FILE_INVALID');
        self::assertReady($pdo,$checksum);
    }
    private static function assertReady(PDO $pdo,string $checksum): void
    {
        $ledger=self::ledger($pdo);
        foreach(self::TABLES as $table)if(!self::tablePresent($pdo,$table))throw new HubIdentityConvergenceMigrationException('M22 identity convergence is not ready','IDENTITY_CONVERGENCE_SCHEMA_NOT_READY');
        foreach(self::INDEXES as $index){$q=$pdo->prepare("SELECT 1 FROM sqlite_master WHERE type='index' AND name=:name");$q->execute(['name'=>$index]);if($q->fetchColumn()===false)throw new HubIdentityConvergenceMigrationException('M22 identity convergence is not ready','IDENTITY_CONVERGENCE_SCHEMA_NOT_READY');}
        $policy=$pdo->query('SELECT platform_authority,school_authority,local_school_roles_enabled,break_glass_owner_auth_enabled FROM control_identity_authority_policy WHERE singleton_id=1')->fetch();
        $policyOk=is_array($policy)&&$policy['platform_authority']==='KRUART'&&$policy['school_authority']==='BAY_EXCUSE_X'&&(int)$policy['local_school_roles_enabled']===0&&(int)$policy['break_glass_owner_auth_enabled']===1;
        if((int)$pdo->query('PRAGMA user_version')->fetchColumn()<self::TARGET_USER_VERSION||!is_array($ledger)||(int)$ledger['schema_version']!==self::TARGET_USER_VERSION||!hash_equals(strtolower($checksum),strtolower((string)($ledger['checksum']??'')))||!$policyOk||$pdo->query('PRAGMA foreign_key_check')->fetchAll()!==[])throw new HubIdentityConvergenceMigrationException('M22 identity convergence is not ready','IDENTITY_CONVERGENCE_SCHEMA_NOT_READY');
    }

    private static function ledger(PDO $pdo): array|false
    {
        $q=$pdo->prepare('SELECT schema_version,checksum FROM awh_schema_migrations WHERE migration_id=:id');$q->execute(['id'=>self::MIGRATION_ID]);return $q->fetch();
    }

    private static function tablePresent(PDO $pdo,string $table): bool
    {
        $q=$pdo->prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=:name");$q->execute(['name'=>$table]);return $q->fetchColumn()!==false;
    }
    private static function open(string $path): PDO
    {
        if($path===''||str_contains($path,"\0"))throw new HubIdentityConvergenceMigrationException('Database path is invalid','DATABASE_CONFIG_INVALID');
        try{$pdo=new PDO('sqlite:'.$path,null,null,[PDO::ATTR_ERRMODE=>PDO::ERRMODE_EXCEPTION,PDO::ATTR_DEFAULT_FETCH_MODE=>PDO::FETCH_ASSOC]);$pdo->exec('PRAGMA foreign_keys = ON');$pdo->exec('PRAGMA busy_timeout = 2500');return $pdo;}
        catch(Throwable){throw new HubIdentityConvergenceMigrationException('Database is unavailable','DATABASE_UNAVAILABLE');}
    }

    private static function timestamp(string $value): string
    {
        if(strtotime($value)===false)throw new HubIdentityConvergenceMigrationException('M22 migration time is invalid','MIGRATION_FAILED');return gmdate('c',strtotime($value));
    }
}
