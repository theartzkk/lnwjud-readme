<?php
declare(strict_types=1);

require_once __DIR__.'/HubPlatformHardeningMigration.php';

final class HubConversationDelegateMigrationException extends RuntimeException
{
    public function __construct(string $message,public readonly string $codeName='MIGRATION_FAILED'){parent::__construct($message);}
}

final class HubConversationDelegateMigration
{
    public const TARGET_USER_VERSION=24;
    public const MIGRATION_ID='m24-conversation-delegates';

    public static function apply(string $databasePath,string $sqlPath,?string $now=null): string
    {
        $pdo=self::open($databasePath);
        $sql=@file_get_contents($sqlPath);
        if(!is_string($sql)||$sql==='')throw new HubConversationDelegateMigrationException('M24 migration unavailable','MIGRATION_FILE_INVALID');
        $checksum=hash('sha256',$sql);
        $version=(int)$pdo->query('PRAGMA user_version')->fetchColumn();
        if($version<23)throw new HubConversationDelegateMigrationException('M23 platform hardening unavailable','BASE_SCHEMA_INVALID');
        HubPlatformHardeningMigration::assertCapabilityReady($pdo,dirname(__DIR__).'/migrations/022_platform_hardening.sql');
        $ledger=self::ledger($pdo);
        if(is_array($ledger)){
            if((int)$ledger['schema_version']!==24||!hash_equals((string)$ledger['checksum'],$checksum)||$version<24)throw new HubConversationDelegateMigrationException('M24 migration record invalid','MIGRATION_RECORD_INVALID');
            self::assertReady($pdo,$checksum);return 'already-applied';
        }
        if($version!==23)throw new HubConversationDelegateMigrationException('M24 migration order uncertain','MIGRATION_ORDER_UNCERTAIN');
        $at=gmdate('c',strtotime($now??gmdate('c'))?:time());
        try{
            $pdo->beginTransaction();
            $pdo->exec($sql);
            $pdo->prepare('INSERT INTO awh_schema_migrations(migration_id,schema_version,checksum,applied_at) VALUES(:id,24,:checksum,:at)')
                ->execute(['id'=>self::MIGRATION_ID,'checksum'=>$checksum,'at'=>$at]);
            $pdo->exec('PRAGMA user_version = 24');
            self::assertReady($pdo,$checksum);
            $pdo->commit();
            return 'applied';
        }catch(Throwable $e){
            if($pdo->inTransaction())$pdo->rollBack();
            if($e instanceof HubConversationDelegateMigrationException)throw $e;
            throw new HubConversationDelegateMigrationException('M24 migration rolled back','MIGRATION_ROLLED_BACK');
        }
    }

    public static function assertCapabilityReady(PDO $pdo,string $sqlPath): void
    {
        $checksum=hash_file('sha256',$sqlPath);
        if(!is_string($checksum)||$checksum==='')throw new HubConversationDelegateMigrationException('M24 authority unavailable','MIGRATION_FILE_INVALID');
        self::assertReady($pdo,$checksum);
    }

    private static function assertReady(PDO $pdo,string $checksum): void
    {
        $ledger=self::ledger($pdo);
        $table=(int)$pdo->query("SELECT count(*) FROM sqlite_master WHERE type='table' AND name='control_ai_delegates'")->fetchColumn()===1;
        $index=(int)$pdo->query("SELECT count(*) FROM sqlite_master WHERE type='index' AND name='idx_control_ai_delegates_lookup'")->fetchColumn()===1;
        if((int)$pdo->query('PRAGMA user_version')->fetchColumn()<24||!$table||!$index||!is_array($ledger)||(int)$ledger['schema_version']!==24||!hash_equals($checksum,(string)$ledger['checksum'])||$pdo->query('PRAGMA foreign_key_check')->fetchAll()!==[])
            throw new HubConversationDelegateMigrationException('M24 conversation delegates not ready','CONVERSATION_DELEGATE_SCHEMA_NOT_READY');
    }

    private static function ledger(PDO $pdo): array|false
    {
        $q=$pdo->prepare('SELECT schema_version,checksum FROM awh_schema_migrations WHERE migration_id=:id');
        $q->execute(['id'=>self::MIGRATION_ID]);
        return $q->fetch();
    }

    private static function open(string $path): PDO
    {
        if($path===''||str_contains($path,"\0"))throw new HubConversationDelegateMigrationException('Database path invalid','DATABASE_CONFIG_INVALID');
        $pdo=new PDO('sqlite:'.$path,null,null,[PDO::ATTR_ERRMODE=>PDO::ERRMODE_EXCEPTION,PDO::ATTR_DEFAULT_FETCH_MODE=>PDO::FETCH_ASSOC]);
        $pdo->exec('PRAGMA foreign_keys=ON');$pdo->exec('PRAGMA busy_timeout=5000');return $pdo;
    }
}
