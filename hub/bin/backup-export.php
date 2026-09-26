<?php
declare(strict_types=1);
require_once dirname(__DIR__).'/src/HubBackupService.php';

$root=getenv('AWH_HUB_BACKUP_ROOT')?:'/var/backups/awh-hub';
$mode=$argv[1]??'';
try{
    $meta=HubBackupService::latestMetadata($root);
    $latest=is_array($meta['latest']??null)?$meta['latest']:null;
    if(!is_array($latest)||($latest['status']??null)!=='VERIFIED')throw new RuntimeException('No verified backup is available');
    $file=(string)($latest['name']??'');
    if(preg_match('/^awh-[0-9]{8}T[0-9]{6}Z\.sqlite$/D',$file)!==1)throw new RuntimeException('Backup identity is invalid');
    $payload=rtrim($root,DIRECTORY_SEPARATOR).DIRECTORY_SEPARATOR.$file;
    $manifest=$payload.'.json';
    $verified=HubBackupService::verify($payload,$manifest);
    if($mode==='metadata'){
        fwrite(STDOUT,json_encode(['schemaVersion'=>1,'file'=>$file,'sha256'=>$verified['sha256'],'bytes'=>$verified['bytes'],'databaseUserVersion'=>$verified['databaseUserVersion'],'modifiedAt'=>$latest['modifiedAt']??null],JSON_UNESCAPED_SLASHES|JSON_THROW_ON_ERROR)."\n");exit(0);
    }
    if($mode==='payload'){
        if(($argv[2]??'')!==$file)throw new RuntimeException('Requested backup is not the current verified snapshot');
        $h=@fopen($payload,'rb');if(!is_resource($h))throw new RuntimeException('Backup payload is unavailable');
        while(!feof($h)){ $chunk=fread($h,1048576); if($chunk===false){fclose($h);throw new RuntimeException('Backup read failed');} if($chunk!==''&&fwrite(STDOUT,$chunk)!==strlen($chunk)){fclose($h);throw new RuntimeException('Backup stream failed');}}
        fclose($h);exit(0);
    }
    fwrite(STDERR,"Usage: backup-export.php metadata | payload <file>\n");exit(2);
}catch(Throwable){fwrite(STDERR,"AWH_BACKUP_EXPORT=FAIL\n");exit(1);}
