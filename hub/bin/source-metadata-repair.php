<?php

declare(strict_types=1);

require_once dirname(__DIR__) . '/src/HubOperatorBridgeService.php';

if ($argc !== 6) {
    fwrite(STDERR,"usage: source-metadata-repair.php <database> <repository> <base-sha> <target-sha> <mission-execution-id>\n");
    exit(64);
}
[$script,$database,$repository,$base,$target,$mission]=$argv;
try {
    if($database===''||str_contains($database,"\0")||!is_file($database)||is_link($database)) throw new HubOperatorBridgeException('Database configuration is invalid','OPERATOR_CONFIG_INVALID');
    $pdo=new PDO('sqlite:'.$database,null,null,[PDO::ATTR_ERRMODE=>PDO::ERRMODE_EXCEPTION,PDO::ATTR_DEFAULT_FETCH_MODE=>PDO::FETCH_ASSOC,PDO::ATTR_EMULATE_PREPARES=>false]);
    $result=(new HubOperatorBridgeService($pdo))->handle([
        'schemaVersion'=>1,'action'=>'source.metadata-repair','repository'=>$repository,
        'baseSha'=>strtolower($base),'targetSha'=>strtolower($target),'missionExecutionId'=>strtolower($mission),
        'confirmation'=>'REPAIR_SOURCE_PROMOTION_METADATA',
    ]);
    fwrite(STDOUT,json_encode($result,JSON_UNESCAPED_UNICODE|JSON_UNESCAPED_SLASHES|JSON_PRETTY_PRINT|JSON_THROW_ON_ERROR)."\n");
} catch(HubOperatorBridgeException $error) {
    fwrite(STDERR,$error->codeName."\n");exit(1);
} catch(Throwable) {
    fwrite(STDERR,"SOURCE_METADATA_REPAIR_FAILED\n");exit(70);
}
