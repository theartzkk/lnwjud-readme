<?php
declare(strict_types=1);

require_once __DIR__.'/HubConversationDelegateMigration.php';

final class HubOpenRouterFreeMigrationException extends RuntimeException
{
    public function __construct(string $message, public readonly string $codeName='MIGRATION_FAILED') { parent::__construct($message); }
}

final class HubOpenRouterFreeMigration
{
    public const TARGET_USER_VERSION=25;
    public const MIGRATION_ID='m25-openrouter-free';

    public static function apply(string $databasePath,string $sqlPath,?string $now=null): string
    {
        $pdo=self::open($databasePath);
        $sql=@file_get_contents($sqlPath);
        if(!is_string($sql)||$sql==='') throw new HubOpenRouterFreeMigrationException('M25 migration unavailable','MIGRATION_FILE_INVALID');
        $checksum=hash('sha256',$sql);
        $version=(int)$pdo->query('PRAGMA user_version')->fetchColumn();
        if($version<24) throw new HubOpenRouterFreeMigrationException('M24 conversation delegates unavailable','BASE_SCHEMA_INVALID');
        HubConversationDelegateMigration::assertCapabilityReady($pdo,dirname(__DIR__).'/migrations/023_conversation_delegate.sql');
        $ledger=self::ledger($pdo);
        if(is_array($ledger)){
            if((int)$ledger['schema_version']!==25||!hash_equals((string)$ledger['checksum'],$checksum)||$version<25) throw new HubOpenRouterFreeMigrationException('M25 migration record invalid','MIGRATION_RECORD_INVALID');
            self::assertReady($pdo,$checksum);
            return 'already-applied';
        }
        if($version!==24) throw new HubOpenRouterFreeMigrationException('M25 migration order uncertain','MIGRATION_ORDER_UNCERTAIN');
        $at=self::timestamp($now??gmdate('c'));
        try{
            $pdo->beginTransaction();
            $pdo->exec($sql);
            $pdo->prepare('INSERT INTO awh_schema_migrations(migration_id,schema_version,checksum,applied_at) VALUES(:id,25,:checksum,:at)')
                ->execute(['id'=>self::MIGRATION_ID,'checksum'=>$checksum,'at'=>$at]);
            $pdo->exec('PRAGMA user_version = 25');
            self::assertReady($pdo,$checksum);
            $pdo->commit();
            return 'applied';
        }catch(Throwable $error){
            if($pdo->inTransaction()) $pdo->rollBack();
            if($error instanceof HubOpenRouterFreeMigrationException) throw $error;
            throw new HubOpenRouterFreeMigrationException('M25 migration rolled back','MIGRATION_ROLLED_BACK');
        }
    }

    public static function assertCapabilityReady(PDO $pdo,string $sqlPath): void
    {
        $checksum=hash_file('sha256',$sqlPath);
        if(!is_string($checksum)||$checksum==='') throw new HubOpenRouterFreeMigrationException('M25 authority unavailable','MIGRATION_FILE_INVALID');
        self::assertReady($pdo,$checksum);
    }

    private static function assertReady(PDO $pdo,string $checksum): void
    {
        $ledger=self::ledger($pdo);
        $profile=(int)$pdo->query("SELECT COUNT(*) FROM control_ai_provider_profiles WHERE provider_id='openrouter' AND lifecycle='SANDBOX' AND max_data_classification='PUBLIC'")->fetchColumn()===1;
        $model=(int)$pdo->query("SELECT COUNT(*) FROM control_ai_models WHERE provider_id='openrouter' AND model_id='openrouter-free' AND lifecycle='SANDBOX' AND enabled=1 AND max_data_classification='PUBLIC'")->fetchColumn()===1;
        $capability=(int)$pdo->query("SELECT COUNT(*) FROM control_execution_provider_capabilities WHERE provider_id='openrouter' AND capability='agent.conversation' AND enabled=1")->fetchColumn()===1;
        $rate=(int)$pdo->query("SELECT COUNT(*) FROM control_provider_model_rates WHERE provider_id='openrouter' AND model='openrouter-free' AND active=1 AND input_microunits_per_million=0 AND cached_input_microunits_per_million=0 AND cache_write_microunits_per_million=0 AND output_microunits_per_million=0")->fetchColumn()===1;
        $policy=(int)$pdo->query("SELECT COUNT(*) FROM control_provider_policies WHERE provider_id='openrouter'")->fetchColumn()===0;
        $credential=(int)$pdo->query("SELECT COUNT(*) FROM control_provider_credentials WHERE provider_id='openrouter'")->fetchColumn()===0;
        if((int)$pdo->query('PRAGMA user_version')->fetchColumn()<25||!is_array($ledger)||(int)$ledger['schema_version']!==25||!hash_equals($checksum,(string)$ledger['checksum'])||!$profile||!$model||!$capability||!$rate||!$policy||!$credential||$pdo->query('PRAGMA foreign_key_check')->fetchAll()!==[])
            throw new HubOpenRouterFreeMigrationException('M25 OpenRouter free provider not ready','OPENROUTER_FREE_SCHEMA_NOT_READY');
    }

    private static function ledger(PDO $pdo): array|false
    {
        $q=$pdo->prepare('SELECT schema_version,checksum FROM awh_schema_migrations WHERE migration_id=:id');
        $q->execute(['id'=>self::MIGRATION_ID]);
        return $q->fetch();
    }

    private static function open(string $path): PDO
    {
        if($path===''||str_contains($path,"\0")) throw new HubOpenRouterFreeMigrationException('Database path invalid','DATABASE_CONFIG_INVALID');
        $pdo=new PDO('sqlite:'.$path,null,null,[PDO::ATTR_ERRMODE=>PDO::ERRMODE_EXCEPTION,PDO::ATTR_DEFAULT_FETCH_MODE=>PDO::FETCH_ASSOC]);
        $pdo->exec('PRAGMA foreign_keys=ON');
        $pdo->exec('PRAGMA busy_timeout=5000');
        return $pdo;
    }

    private static function timestamp(string $value): string
    {
        if(strtotime($value)===false) throw new HubOpenRouterFreeMigrationException('Migration time invalid','MIGRATION_FAILED');
        return gmdate('c',strtotime($value));
    }
}
