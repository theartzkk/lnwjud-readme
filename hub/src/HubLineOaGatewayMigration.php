<?php
declare(strict_types=1);

require_once __DIR__.'/HubPlatformHardeningMigration.php';

final class HubLineOaGatewayMigrationException extends RuntimeException
{
    public function __construct(string $message, public readonly string $codeName='MIGRATION_FAILED')
    {
        parent::__construct($message);
    }
}

final class HubLineOaGatewayMigration
{
    public const TARGET_USER_VERSION=24;
    public const MIGRATION_ID='m24-line-oa-gateway';
    private const TABLES=['control_external_channel_bindings','control_external_channel_pairings'];
    private const INDEXES=['idx_external_channel_binding_state','idx_external_channel_pairing_lookup'];

    public static function apply(string $databasePath,string $sqlPath,?string $now=null): string
    {
        $pdo=self::open($databasePath);
        $sql=@file_get_contents($sqlPath);
        if(!is_string($sql)||$sql==='') throw new HubLineOaGatewayMigrationException('M24 migration unavailable','MIGRATION_FILE_INVALID');
        $checksum=hash('sha256',$sql);
        $version=(int)$pdo->query('PRAGMA user_version')->fetchColumn();
        if($version<23) throw new HubLineOaGatewayMigrationException('M23 platform hardening unavailable','BASE_SCHEMA_INVALID');
        HubPlatformHardeningMigration::assertCapabilityReady($pdo,dirname(__DIR__).'/migrations/022_platform_hardening.sql');
        $ledger=self::ledger($pdo);
        if(is_array($ledger)){
            if((int)$ledger['schema_version']!==24||!hash_equals((string)$ledger['checksum'],$checksum)||$version<24)
                throw new HubLineOaGatewayMigrationException('M24 migration record invalid','MIGRATION_RECORD_INVALID');
            self::assertReady($pdo,$checksum);
            return 'already-applied';
        }
        if($version!==23) throw new HubLineOaGatewayMigrationException('M24 migration order uncertain','MIGRATION_ORDER_UNCERTAIN');
        $at=self::timestamp($now??gmdate('c'));
        try{
            $pdo->beginTransaction();
            $pdo->exec($sql);
            $pdo->prepare('INSERT INTO awh_schema_migrations(migration_id,schema_version,checksum,applied_at) VALUES(:id,24,:checksum,:at)')
                ->execute(['id'=>self::MIGRATION_ID,'checksum'=>$checksum,'at'=>$at]);
            $pdo->exec('PRAGMA user_version = 24');
            self::assertReady($pdo,$checksum);
            $pdo->commit();
            return 'applied';
        }catch(Throwable $error){
            if($pdo->inTransaction())$pdo->rollBack();
            if($error instanceof HubLineOaGatewayMigrationException) throw $error;
            throw new HubLineOaGatewayMigrationException('M24 migration rolled back','MIGRATION_ROLLED_BACK');
        }
    }

    public static function schemaPresent(PDO $pdo): bool
    {
        foreach(self::TABLES as $table){
            $q=$pdo->prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=:name");
            $q->execute(['name'=>$table]);
            if($q->fetchColumn()===false) return false;
        }
        return true;
    }

    public static function assertCapabilityReady(PDO $pdo,string $sqlPath): void
    {
        $checksum=hash_file('sha256',$sqlPath);
        if(!is_string($checksum)||$checksum==='') throw new HubLineOaGatewayMigrationException('M24 authority unavailable','MIGRATION_FILE_INVALID');
        self::assertReady($pdo,$checksum);
    }

    private static function assertReady(PDO $pdo,string $checksum): void
    {
        $ledger=self::ledger($pdo);
        foreach(self::TABLES as $table){
            $q=$pdo->prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=:name");
            $q->execute(['name'=>$table]);
            if($q->fetchColumn()===false) throw new HubLineOaGatewayMigrationException('M24 LINE gateway not ready','LINE_GATEWAY_SCHEMA_NOT_READY');
        }
        foreach(self::INDEXES as $index){
            $q=$pdo->prepare("SELECT 1 FROM sqlite_master WHERE type='index' AND name=:name");
            $q->execute(['name'=>$index]);
            if($q->fetchColumn()===false) throw new HubLineOaGatewayMigrationException('M24 LINE gateway not ready','LINE_GATEWAY_SCHEMA_NOT_READY');
        }
        if((int)$pdo->query('PRAGMA user_version')->fetchColumn()<24
            ||!is_array($ledger)
            ||(int)$ledger['schema_version']!==24
            ||!hash_equals($checksum,(string)$ledger['checksum'])
            ||$pdo->query('PRAGMA foreign_key_check')->fetchAll()!==[])
            throw new HubLineOaGatewayMigrationException('M24 LINE gateway not ready','LINE_GATEWAY_SCHEMA_NOT_READY');
    }

    private static function ledger(PDO $pdo): array|false
    {
        $q=$pdo->prepare('SELECT schema_version,checksum FROM awh_schema_migrations WHERE migration_id=:id');
        $q->execute(['id'=>self::MIGRATION_ID]);
        return $q->fetch();
    }

    private static function open(string $path): PDO
    {
        if($path===''||str_contains($path,"\0")) throw new HubLineOaGatewayMigrationException('Database path invalid','DATABASE_CONFIG_INVALID');
        $pdo=new PDO('sqlite:'.$path,null,null,[PDO::ATTR_ERRMODE=>PDO::ERRMODE_EXCEPTION,PDO::ATTR_DEFAULT_FETCH_MODE=>PDO::FETCH_ASSOC]);
        $pdo->exec('PRAGMA foreign_keys=ON');
        $pdo->exec('PRAGMA busy_timeout=5000');
        return $pdo;
    }

    private static function timestamp(string $value): string
    {
        if(strtotime($value)===false) throw new HubLineOaGatewayMigrationException('Migration time invalid','MIGRATION_FAILED');
        return gmdate('c',strtotime($value));
    }
}
