#!/usr/bin/php
<?php

declare(strict_types=1);

$args=array_slice($argv,1);
if(count($args)!==8){
    fwrite(STDERR,"HOSTING_USERADD_PROXY_REQUEST_INVALID\n");exit(2);
}
$expected=['--system','--no-log-init','--home-dir',null,'--shell','/usr/sbin/nologin','--user-group',null];
if($args[0]!==$expected[0]||$args[1]!==$expected[1]||$args[2]!==$expected[2]||$args[4]!==$expected[4]||$args[5]!==$expected[5]||$args[6]!==$expected[6]){
    fwrite(STDERR,"HOSTING_USERADD_PROXY_REQUEST_INVALID\n");exit(2);
}
$home=(string)$args[3];
$user=(string)$args[7];
if(preg_match('#^/srv/awh-sites/([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$#',$home,$match)!==1){
    fwrite(STDERR,"HOSTING_USERADD_PROXY_HOME_INVALID\n");exit(3);
}
$site=strtolower($match[1]);
$expectedUser='awhsite-'.substr(str_replace('-','',$site),0,10);
if(!hash_equals($expectedUser,$user)){
    fwrite(STDERR,"HOSTING_USERADD_PROXY_USER_INVALID\n");exit(4);
}
$unit='awh-hosting-identity@'.$site.'.service';
$pipes=[];
$process=@proc_open(['/bin/systemctl','start',$unit],[0=>['file','/dev/null','r'],1=>['pipe','w'],2=>['pipe','w']],$pipes,null,['PATH'=>'/usr/sbin:/usr/bin:/sbin:/bin'],['bypass_shell'=>true]);
if(!is_resource($process)){fwrite(STDERR,"HOSTING_USERADD_PROXY_UNAVAILABLE\n");exit(5);}
foreach([1,2] as $index)if(is_resource($pipes[$index]??null))stream_get_contents($pipes[$index],65537);
foreach($pipes as $pipe)if(is_resource($pipe))fclose($pipe);
$code=proc_close($process);
if($code!==0){fwrite(STDERR,"HOSTING_USERADD_PROXY_FAILED\n");exit(6);}
$existing=function_exists('posix_getpwnam')?posix_getpwnam($user):false;
if(!is_array($existing)||(string)($existing['dir']??'')!==$home||(string)($existing['shell']??'')!=='/usr/sbin/nologin'){
    fwrite(STDERR,"HOSTING_USERADD_PROXY_VERIFY_FAILED\n");exit(7);
}
fwrite(STDOUT,"HOSTING_USERADD_PROXY=READY\n");
