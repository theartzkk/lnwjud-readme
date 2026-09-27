<?php
declare(strict_types=1);
require_once dirname(__DIR__).'/src/HubConversationDelegateMigration.php';
if($argc!==2){fwrite(STDERR,"Usage: php migrate-conversation-delegate.php <database-path>\n");exit(2);}
try{
    $r=HubConversationDelegateMigration::apply($argv[1],dirname(__DIR__).'/migrations/023_conversation_delegate.sql');
    fwrite(STDOUT,$r."\n");
}catch(Throwable $e){
    fwrite(STDERR,(property_exists($e,'codeName')?$e->codeName:'MIGRATION_FAILED').": ".$e->getMessage()."\n");
    exit(1);
}
