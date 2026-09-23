<?php

declare(strict_types=1);

require_once dirname(__DIR__) . '/src/HubControlPlaneProjectRegistration.php';

$db=getenv('AWH_HUB_DB_PATH');
if(!is_string($db)||$db===''||str_contains($db,"\0")){fwrite(STDERR,"DATABASE_CONFIG_INVALID\n");exit(2);}
try{
    $pdo=new PDO('sqlite:'.$db,null,null,[PDO::ATTR_ERRMODE=>PDO::ERRMODE_EXCEPTION,PDO::ATTR_DEFAULT_FETCH_MODE=>PDO::FETCH_ASSOC]);
    $pdo->exec('PRAGMA foreign_keys=ON');
    $pdo->exec('PRAGMA busy_timeout=7500');
    $projectId='6f4920ab-3ca5-4f1e-8e91-8833c68c2d1a';
    HubControlPlaneProjectRegistration::register($pdo,[['projectId'=>$projectId,'name'=>'BAY Assessment','type'=>'system']]);
    $owner=$pdo->query("SELECT owner_user_id FROM owner_bootstrap WHERE singleton_id=1 AND bootstrap_closed=1")->fetchColumn();
    if(!is_string($owner)||preg_match('/^[0-9a-f-]{36}$/i',$owner)!==1)throw new RuntimeException('OWNER_NOT_READY');
    $at=gmdate('c');
    foreach(['project.read','conversation.write','attachment.upload','approval.decide','deployment.approve'] as $capability){
        $q=$pdo->prepare("INSERT INTO control_project_capabilities(user_id,project_id,capability,granted_by_user_id,created_at,revoked_at)
            VALUES(:user,:project,:capability,:owner,:at,NULL)
            ON CONFLICT(user_id,project_id,capability) DO UPDATE SET revoked_at=NULL");
        $q->execute(['user'=>$owner,'project'=>$projectId,'capability'=>$capability,'owner'=>$owner,'at'=>$at]);
    }
    fwrite(STDOUT,json_encode(['ok'=>true,'projectId'=>$projectId,'name'=>'BAY Assessment'],JSON_UNESCAPED_UNICODE|JSON_UNESCAPED_SLASHES)."\n");
}catch(Throwable $e){fwrite(STDERR,"MANAGED_PRODUCT_REGISTRATION_FAILED\n");exit(1);}
