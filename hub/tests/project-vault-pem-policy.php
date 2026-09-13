<?php
declare(strict_types=1);
require_once dirname(__DIR__).'/src/HubProjectVault.php';
function ok(bool $v,string $m):void{if(!$v)throw new RuntimeException($m);}
if(!class_exists('ZipArchive')){fwrite(STDOUT,"AWH Project Vault PEM Policy: SKIP ZipArchive unavailable\n");exit(77);}
$root=sys_get_temp_dir().'/awh-pem-'.bin2hex(random_bytes(5));mkdir($root,0700,true);$vaultRoot=$root.'/vault';mkdir($vaultRoot,0700,true);$vault=new HubProjectVault($vaultRoot);$project='123b45c0-23e1-408d-ae0f-ac5eca7f6900';
$make=function(string $name,string $content)use($root){$p=$root.'/'.$name.'.zip';$z=new ZipArchive();$z->open($p,ZipArchive::CREATE|ZipArchive::OVERWRITE);$z->addFromString('keys/test.pem',$content);$z->close();return $p;};
try{
 $pub=$make('public',"-----BEGIN PUBLIC KEY-----\nQUJDRA==\n-----END PUBLIC KEY-----\n");
 $r=$vault->ingestZip($project,$pub,'223b45c0-23e1-408d-ae0f-ac5eca7f6900');ok($r['fileCount']===1,'public pem accepted');
 $priv=$make('private',"-----BEGIN PRIVATE KEY-----\nQUJDRA==\n-----END PRIVATE KEY-----\n");
 $blocked=false;try{$vault->ingestZip($project,$priv,'323b45c0-23e1-408d-ae0f-ac5eca7f6900');}catch(HubProjectVaultException $e){$blocked=$e->codeName==='PROJECT_ARCHIVE_UNSAFE';}ok($blocked,'private pem rejected');
 $random=$make('random',"not a pem\n");$blocked=false;try{$vault->ingestZip($project,$random,'423b45c0-23e1-408d-ae0f-ac5eca7f6900');}catch(HubProjectVaultException $e){$blocked=$e->codeName==='PROJECT_ARCHIVE_UNSAFE';}ok($blocked,'arbitrary pem rejected');
 fwrite(STDOUT,"AWH Project Vault PEM Policy: PASS\n");
}finally{exec('rm -rf '.escapeshellarg($root));}
