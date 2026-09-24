<?php

declare(strict_types=1);

require_once dirname(__DIR__) . '/src/HubIdentityConvergenceMigration.php';

function m22_assert(bool $ok,string $message): void { if(!$ok) throw new RuntimeException($message); echo "PASS: {$message}\n"; }
if(!in_array('sqlite',PDO::getAvailableDrivers(),true)){fwrite(STDOUT,"AWH M22 Identity Convergence: SKIP pdo_sqlite unavailable\n");exit(77);}

$root=rtrim(sys_get_temp_dir(),'/').'/awh-m22-'.bin2hex(random_bytes(6));$dbPath=$root.'/awh.sqlite';
try{
    mkdir($root,0700,true);
    $pdo=new PDO('sqlite:'.$dbPath,null,null,[PDO::ATTR_ERRMODE=>PDO::ERRMODE_EXCEPTION,PDO::ATTR_DEFAULT_FETCH_MODE=>PDO::FETCH_ASSOC]);
    $pdo->exec('PRAGMA foreign_keys=ON');
    $pdo->exec("CREATE TABLE awh_schema_migrations(migration_id TEXT PRIMARY KEY,schema_version INTEGER NOT NULL,checksum TEXT NOT NULL,applied_at TEXT NOT NULL)");
    $pdo->exec("CREATE TABLE hub_users(user_id TEXT PRIMARY KEY,display_name TEXT NOT NULL,revoked_at TEXT)");
    $pdo->exec("CREATE TABLE projects(project_id TEXT PRIMARY KEY,canonical_source_authority TEXT,canonical_source_content_sha256 TEXT)");
    $pdo->exec("CREATE TABLE control_user_profiles(user_id TEXT PRIMARY KEY,display_name TEXT NOT NULL,person_type TEXT NOT NULL,system_role TEXT NOT NULL,status TEXT NOT NULL,FOREIGN KEY(user_id) REFERENCES hub_users(user_id) ON DELETE CASCADE)");
    $pdo->exec("CREATE TABLE control_account_requests(request_id TEXT PRIMARY KEY,person_type TEXT NOT NULL,state TEXT NOT NULL)");
    $owner='11111111-1111-4111-8111-111111111111';$teacher='22222222-2222-4222-8222-222222222222';$director='33333333-3333-4333-8333-333333333333';
    foreach([[$owner,'Owner'],[$teacher,'Teacher'],[$director,'Director']] as [$id,$name])$pdo->prepare('INSERT INTO hub_users VALUES(?,?,NULL)')->execute([$id,$name]);
    $pdo->prepare("INSERT INTO control_user_profiles VALUES(?,?,?,'OWNER','ACTIVE')")->execute([$owner,'Owner','STAFF']);
    $pdo->prepare("INSERT INTO control_user_profiles VALUES(?,?,?,'TEACHER','ACTIVE')")->execute([$teacher,'Teacher','TEACHER']);
    $pdo->prepare("INSERT INTO control_user_profiles VALUES(?,?,?,'DIRECTOR','ACTIVE')")->execute([$director,'Director','DIRECTOR']);
    $pdo->exec("INSERT INTO control_account_requests VALUES('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','TEACHER','PENDING')");
    $m21=dirname(__DIR__).'/migrations/020_vault_source_authority.sql';$m21Checksum=hash_file('sha256',$m21);if(!is_string($m21Checksum))throw new RuntimeException('m21 checksum');
    $pdo->prepare("INSERT INTO awh_schema_migrations VALUES('m21-vault-source-authority',21,?,'2026-09-24T00:00:00+00:00')")->execute([$m21Checksum]);
    $pdo->exec('PRAGMA user_version=21');

    $sql=dirname(__DIR__).'/migrations/021_identity_convergence.sql';
    m22_assert(HubIdentityConvergenceMigration::apply($dbPath,$sql,'2026-09-24T12:00:00+00:00')==='applied','M22 applies after exact M21 authority');
    m22_assert(HubIdentityConvergenceMigration::apply($dbPath,$sql,'2026-09-24T12:01:00+00:00')==='already-applied','M22 is idempotent');
    $pdo=null;$pdo=new PDO('sqlite:'.$dbPath,null,null,[PDO::ATTR_ERRMODE=>PDO::ERRMODE_EXCEPTION,PDO::ATTR_DEFAULT_FETCH_MODE=>PDO::FETCH_ASSOC]);$pdo->exec('PRAGMA foreign_keys=ON');
    m22_assert((int)$pdo->query('PRAGMA user_version')->fetchColumn()===22,'M22 advances user_version to 22');
    $policy=$pdo->query('SELECT platform_authority,school_authority,local_school_roles_enabled,break_glass_owner_auth_enabled FROM control_identity_authority_policy WHERE singleton_id=1')->fetch();
    m22_assert(is_array($policy)&&$policy['platform_authority']==='KRUART'&&$policy['school_authority']==='BAY_EXCUSE_X'&&(int)$policy['local_school_roles_enabled']===0&&(int)$policy['break_glass_owner_auth_enabled']===1,'authority policy is KRUART login + BAY school identity with owner recovery');
    m22_assert((int)$pdo->query("SELECT COUNT(*) FROM control_user_profiles WHERE person_type IN ('TEACHER','DIRECTOR') OR system_role IN ('TEACHER','DIRECTOR')")->fetchColumn()===0,'legacy school labels are removed from AWH platform authority');
    m22_assert((int)$pdo->query("SELECT COUNT(*) FROM control_account_requests WHERE state='PENDING' AND person_type IN ('TEACHER','DIRECTOR')")->fetchColumn()===0,'pending access requests are normalized to platform identity');
    m22_assert($pdo->query('PRAGMA foreign_key_check')->fetchAll()===[],'M22 foreign keys remain clean');

    $insert=$pdo->prepare("INSERT INTO control_school_identity_bindings(binding_id,user_id,provider,school_key,external_user_id,external_personnel_id,state,linked_by_user_id,linked_at,last_verified_at,revoked_at) VALUES(?,?, 'BAY_EXCUSE_X','primary',?,?,'ACTIVE',?,'2026-09-24T12:00:00+00:00',NULL,NULL)");
    $insert->execute(['bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',$teacher,'10','20',$owner]);
    $duplicateExternal=false;try{$insert->execute(['cccccccc-cccc-4ccc-8ccc-cccccccccccc',$director,'10','30',$owner]);}catch(PDOException){$duplicateExternal=true;}
    m22_assert($duplicateExternal,'one BAY user cannot bind to two KRUART identities');
    m22_assert($pdo->query('PRAGMA integrity_check')->fetchColumn()==='ok','M22 database integrity is ok');
    echo "AWH M22 Identity Convergence: PASS\n";
} finally {
    if(is_dir($root)){foreach(new RecursiveIteratorIterator(new RecursiveDirectoryIterator($root,FilesystemIterator::SKIP_DOTS),RecursiveIteratorIterator::CHILD_FIRST) as $f){$p=$f->getPathname();$f->isDir()&&!$f->isLink()?@rmdir($p):@unlink($p);}@rmdir($root);}
}
