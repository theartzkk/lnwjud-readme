<?php

declare(strict_types=1);

$database=getenv('AWH_HUB_DB_PATH');
$site=strtolower(trim((string)($argv[1]??'')));
if(!is_string($database)||$database===''||str_contains($database,"\0")||preg_match('/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/',$site)!==1){
    fwrite(STDERR,"HOSTING_IDENTITY_REQUEST_INVALID\n"); exit(2);
}
try{
    $pdo=new PDO('sqlite:'.$database,null,null,[PDO::ATTR_ERRMODE=>PDO::ERRMODE_EXCEPTION,PDO::ATTR_DEFAULT_FETCH_MODE=>PDO::FETCH_ASSOC]);
    $pdo->exec('PRAGMA busy_timeout=5000');
    $q=$pdo->prepare('SELECT site_id FROM control_managed_sites WHERE site_id=:site LIMIT 1');
    $q->execute(['site'=>$site]);
    if($q->fetchColumn()===false){fwrite(STDERR,"HOSTING_IDENTITY_SITE_NOT_FOUND\n");exit(3);}
    $user='awhsite-'.substr(str_replace('-','',$site),0,10);
    $home='/srv/awh-sites/'.$site;
    $existing=function_exists('posix_getpwnam')?posix_getpwnam($user):false;
    if(is_array($existing)){
        if((string)($existing['dir']??'')!==$home||(string)($existing['shell']??'')!=='/usr/sbin/nologin'){
            fwrite(STDERR,"HOSTING_IDENTITY_MISMATCH\n");exit(4);
        }
        fwrite(STDOUT,"HOSTING_IDENTITY=EXISTING\n");exit(0);
    }
    $run=static function(array $command): ?int {
        $pipes=[];
        $process=@proc_open($command,[0=>['file','/dev/null','r'],1=>['pipe','w'],2=>['pipe','w']],$pipes,null,['PATH'=>'/usr/sbin:/usr/bin:/sbin:/bin'],['bypass_shell'=>true]);
        if(!is_resource($process))return null;
        foreach([1,2] as $index)if(is_resource($pipes[$index]??null))stream_get_contents($pipes[$index],65537);
        foreach($pipes as $pipe)if(is_resource($pipe))fclose($pipe);
        return proc_close($process);
    };
    $group=function_exists('posix_getgrnam')?posix_getgrnam($user):false;
    if(!is_array($group)){
        $groupCode=$run(['/usr/sbin/groupadd','--system',$user]);
        if($groupCode===null){fwrite(STDERR,"HOSTING_IDENTITY_GROUPADD_UNAVAILABLE\n");exit(5);}
        $group=function_exists('posix_getgrnam')?posix_getgrnam($user):false;
        if($groupCode!==0&&!is_array($group)){fwrite(STDERR,"HOSTING_IDENTITY_GROUPADD_FAILED\n");exit(6);}
        if(!is_array($group)){fwrite(STDERR,"HOSTING_IDENTITY_GROUP_VERIFY_FAILED\n");exit(7);}
    }
    $userCode=$run(['/usr/sbin/useradd','--system','--no-log-init','--no-create-home','--home-dir',$home,'--shell','/usr/sbin/nologin','--gid',$user,'--no-user-group',$user]);
    if($userCode===null){fwrite(STDERR,"HOSTING_IDENTITY_USERADD_UNAVAILABLE\n");exit(8);}
    if($userCode!==0){fwrite(STDERR,"HOSTING_IDENTITY_USERADD_FAILED\n");exit(9);}
    $created=function_exists('posix_getpwnam')?posix_getpwnam($user):false;
    if(!is_array($created)||(string)($created['dir']??'')!==$home||(string)($created['shell']??'')!=='/usr/sbin/nologin'||(int)($created['gid']??-1)!==(int)($group['gid']??-2)){
        fwrite(STDERR,"HOSTING_IDENTITY_VERIFY_FAILED\n");exit(10);
    }
    fwrite(STDOUT,"HOSTING_IDENTITY=CREATED\n");
}catch(Throwable){
    fwrite(STDERR,"HOSTING_IDENTITY_FAILED\n");exit(11);
}
