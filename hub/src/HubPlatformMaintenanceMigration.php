<?php
declare(strict_types=1);

require_once __DIR__.'/HubConversationDelegateMigration.php';

final class HubPlatformMaintenanceMigrationException extends RuntimeException
{
    public function __construct(string $message, public readonly string $codeName='MIGRATION_FAILED'){parent::__construct($message);}
}

final class HubPlatformMaintenanceMigration
{
    public const TARGET_USER_VERSION=25;
    public const MIGRATION_ID='m25-platform-maintenance-authority';

    public static function apply(string $databasePath,string $sqlPath,?string $now=null): string
    {
        $pdo=self::open($databasePath);
        $sql=@file_get_contents($sqlPath);
        if(!is_string($sql)||$sql==='')throw new HubPlatformMaintenanceMigrationException('M25 migration unavailable','MIGRATION_FILE_INVALID');
        $checksum=hash('sha256',$sql);
        $version=(int)$pdo->query('PRAGMA user_version')->fetchColumn();
        if($version<24)throw new HubPlatformMaintenanceMigrationException('M24 conversation delegate authority unavailable','BASE_SCHEMA_INVALID');
        HubConversationDelegateMigration::assertCapabilityReady($pdo,dirname(__DIR__).'/migrations/023_conversation_delegate.sql');
        $ledger=self::ledger($pdo);
        if(is_array($ledger)){
            if((int)$ledger['schema_version']!==25||!hash_equals((string)$ledger['checksum'],$checksum)||$version<25)
                throw new HubPlatformMaintenanceMigrationException('M25 migration record invalid','MIGRATION_RECORD_INVALID');
            self::assertReady($pdo,$checksum);
            return 'already-applied';
        }
        if($version!==24)throw new HubPlatformMaintenanceMigrationException('M25 migration order uncertain','MIGRATION_ORDER_UNCERTAIN');
        $at=gmdate('c',strtotime($now??gmdate('c'))?:time());
        try{
            $pdo->beginTransaction();
            $pdo->exec($sql);
            $pdo->prepare("UPDATE control_platform_maintenance SET updated_at=:at WHERE singleton_id=1 AND updated_by='migration'")->execute(['at'=>$at]);
            $pdo->prepare('INSERT INTO awh_schema_migrations(migration_id,schema_version,checksum,applied_at) VALUES(:id,25,:checksum,:at)')
                ->execute(['id'=>self::MIGRATION_ID,'checksum'=>$checksum,'at'=>$at]);
            $pdo->exec('PRAGMA user_version = 25');
            self::assertReady($pdo,$checksum);
            $pdo->commit();
            return 'applied';
        }catch(Throwable $e){
            if($pdo->inTransaction())$pdo->rollBack();
            if($e instanceof HubPlatformMaintenanceMigrationException)throw $e;
            throw new HubPlatformMaintenanceMigrationException('M25 migration rolled back','MIGRATION_ROLLED_BACK');
        }
    }

    public static function assertCapabilityReady(PDO $pdo,string $sqlPath): void
    {
        $checksum=hash_file('sha256',$sqlPath);
        if(!is_string($checksum)||$checksum==='')throw new HubPlatformMaintenanceMigrationException('M25 authority unavailable','MIGRATION_FILE_INVALID');
        self::assertReady($pdo,$checksum);
    }

    private static function assertReady(PDO $pdo,string $checksum): void
    {
        $ledger=self::ledger($pdo);
        $table=(int)$pdo->query("SELECT count(*) FROM sqlite_master WHERE type='table' AND name='control_platform_maintenance'")->fetchColumn()===1;
        $row=$table?$pdo->query("SELECT mode,platform_project_id,reason,updated_at,updated_by FROM control_platform_maintenance WHERE singleton_id=1")->fetch():false;
        $valid=is_array($row)&&in_array((string)$row['mode'],['NORMAL','PLATFORM_ONLY'],true)
            &&trim((string)$row['reason'])!==''&&trim((string)$row['updated_at'])!==''&&trim((string)$row['updated_by'])!=='';
        if((int)$pdo->query('PRAGMA user_version')->fetchColumn()<25||!$table||!$valid||!is_array($ledger)
            ||(int)$ledger['schema_version']!==25||!hash_equals($checksum,(string)$ledger['checksum'])
            ||$pdo->query('PRAGMA foreign_key_check')->fetchAll()!==[])
            throw new HubPlatformMaintenanceMigrationException('M25 platform maintenance authority not ready','PLATFORM_MAINTENANCE_SCHEMA_NOT_READY');
    }

    private static function ledger(PDO $pdo): array|false
    {
        $q=$pdo->prepare('SELECT schema_version,checksum FROM awh_schema_migrations WHERE migration_id=:id');
        $q->execute(['id'=>self::MIGRATION_ID]);
        return $q->fetch();
    }

    private static function open(string $path): PDO
    {
        if($path===''||str_contains($path,"\0"))throw new HubPlatformMaintenanceMigrationException('Database path invalid','DATABASE_CONFIG_INVALID');
        $pdo=new PDO('sqlite:'.$path,null,null,[PDO::ATTR_ERRMODE=>PDO::ERRMODE_EXCEPTION,PDO::ATTR_DEFAULT_FETCH_MODE=>PDO::FETCH_ASSOC]);
        $pdo->exec('PRAGMA foreign_keys=ON');
        $pdo->exec('PRAGMA busy_timeout=5000');
        return $pdo;
    }
}
