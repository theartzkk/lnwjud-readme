<?php

declare(strict_types=1);

require_once dirname(__DIR__) . '/src/HubSchemaMigration.php';
require_once dirname(__DIR__) . '/src/HubEnrollmentApiMigration.php';
require_once dirname(__DIR__) . '/src/HubControlPlaneMigration.php';
require_once dirname(__DIR__) . '/src/HubOwnerAuthMigration.php';
require_once dirname(__DIR__) . '/src/HubAssistantWorkstreamMigration.php';
require_once dirname(__DIR__) . '/src/HubWorkspaceContinuityMigration.php';
require_once dirname(__DIR__) . '/src/HubUnifiedWorkspaceMigration.php';
require_once dirname(__DIR__) . '/src/HubFinalProductMigration.php';
require_once dirname(__DIR__) . '/src/HubFoundingMemoryMigration.php';
require_once dirname(__DIR__) . '/src/HubSelfServiceMigration.php';
require_once dirname(__DIR__) . '/src/HubCentralProjectAuthorityMigration.php';
require_once dirname(__DIR__) . '/src/HubAnywhereExecutionMigration.php';
require_once dirname(__DIR__) . '/src/HubEnrollmentService.php';
require_once dirname(__DIR__) . '/src/HubOwnerAuthService.php';
require_once dirname(__DIR__) . '/src/HubControlPlaneService.php';
require_once dirname(__DIR__) . '/src/HubControlPlaneRouter.php';

function m16_assert(bool $ok, string $message): void { if (!$ok) throw new RuntimeException($message); }
function m16_json(array $value): string { return json_encode($value, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR); }
function m16_browser(string $session, string $csrf, string $type = 'application/json'): array { return ['CONTENT_TYPE'=>$type,'HTTP_ORIGIN'=>'https://awh.test','HTTP_COOKIE'=>'__Host-awh_control_session='.$session.'; awh_csrf='.$csrf,'HTTP_X_AWH_CSRF'=>$csrf,'HTTP_SEC_FETCH_SITE'=>'same-origin']; }
function m16_worker(string $token, string $device, string $type = 'application/json'): array { return ['CONTENT_TYPE'=>$type,'HTTP_AUTHORIZATION'=>'Bearer '.$token,'HTTP_X_AWH_DEVICE'=>$device]; }
function m16_control(HubControlPlaneService $service, string $method, string $uri, array $server, array $payload = [], array $files = []): array { return HubControlPlaneRouter::dispatch($method, $uri, $server, $service, m16_json($payload), $files); }
function m16_clean(string $root): void { if (!is_dir($root)) return; $it = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($root, FilesystemIterator::SKIP_DOTS), RecursiveIteratorIterator::CHILD_FIRST); foreach ($it as $file) { $path=$file->getPathname(); $file->isDir() && !$file->isLink() ? @rmdir($path) : @unlink($path); } @rmdir($root); }

if (!in_array('sqlite', PDO::getAvailableDrivers(), true) || !class_exists('ZipArchive')) { fwrite(STDOUT, "AWH M16 Office provider: SKIP required PHP extension unavailable\n"); exit(77); }
$root = sys_get_temp_dir() . '/awh-m16-' . bin2hex(random_bytes(6));
$base = dirname(__DIR__); $now = gmdate('c');
$db = $root . '/awh.sqlite'; $attachmentRoot = $root . '/attachments'; $artifactRoot = $root . '/artifacts'; $vaultRoot = $root . '/vault'; $workspaceRoot = $root . '/workspaces';
$owner = '223b45c0-23e1-408d-ae0f-ac5eca7f6900'; $project = '113b45c0-23e1-408d-ae0f-ac5eca7f6900';
$device = '423b45c0-23e1-408d-ae0f-ac5eca7f6900'; $otherDevice = '523b45c0-23e1-408d-ae0f-ac5eca7f6900';
$ownerPassword = 'owner-m16-' . bin2hex(random_bytes(12));
putenv('AWH_CONTROL_ORIGIN=https://awh.test'); putenv('AWH_ATTACHMENT_ROOT='.$attachmentRoot); putenv('AWH_ARTIFACT_ROOT='.$artifactRoot); putenv('AWH_PROJECT_VAULT_ROOT='.$vaultRoot); putenv('AWH_TASK_WORKSPACE_ROOT='.$workspaceRoot);
try {
    mkdir($root, 0700, true); foreach ([$attachmentRoot,$artifactRoot,$vaultRoot,$workspaceRoot] as $dir) mkdir($dir, 0700, true);
    $pdo = new PDO('sqlite:'.$db, null, null, [PDO::ATTR_ERRMODE=>PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE=>PDO::FETCH_ASSOC]);
    $pdo->exec('PRAGMA foreign_keys = ON'); $pdo->exec(file_get_contents($base.'/schema.sql'));
    foreach (['enrollment_rate_limits','device_project_memberships','device_tokens','pairing_projects','pairing_codes','user_project_memberships','device_enrollments','owner_bootstrap','hub_users'] as $table) $pdo->exec('DROP TABLE IF EXISTS '.$table);
    $pdo->prepare('INSERT INTO projects(project_id,name,type,created_at,source_revision,observed_at,provenance) VALUES(:id,:name,:type,:at,NULL,:at,:source)')->execute(['id'=>$project,'name'=>'Office Fixture','type'=>'documents','at'=>$now,'source'=>'m16-fixture']);
    m16_assert(HubSchemaMigration::apply($db,$base.'/migrations/001_m3e_enrollment.sql',$now,false,$base.'/schema.sql') === 'applied','M3E');
    m16_assert(HubEnrollmentApiMigration::apply($db,$base.'/migrations/002_m3e2_enrollment_api.sql',$now) === 'applied','M3E2');
    $enrollment = HubEnrollmentService::openExisting($db); $initial = $enrollment->initializeOwner($owner,'Art Owner',[$project],$now);
    $worker = $enrollment->enrollDevice(['schemaVersion'=>1,'pairingCode'=>$initial['initialPairingCode'],'deviceId'=>$device,'displayName'=>'Office Windows','platform'=>'win32','arch'=>'x64','appVersion'=>'1.0.0'],$now);
    $otherPair = $enrollment->issuePairingCode($owner,[$project]);
    $other = $enrollment->enrollDevice(['schemaVersion'=>1,'pairingCode'=>$otherPair['pairingCode'],'deviceId'=>$otherDevice,'displayName'=>'Other Windows','platform'=>'win32','arch'=>'x64','appVersion'=>'1.0.0'],$now);
    foreach ([[HubControlPlaneMigration::class,'003_m4_control_plane.sql'],[HubOwnerAuthMigration::class,'004_owner_auth.sql'],[HubAssistantWorkstreamMigration::class,'005_assistant_workstream.sql'],[HubWorkspaceContinuityMigration::class,'006_workspace_continuity.sql'],[HubUnifiedWorkspaceMigration::class,'007_unified_workspace.sql']] as [$migration,$sql]) m16_assert($migration::apply($db,$base.'/migrations/'.$sql,$now) === 'applied',$sql);
    m16_assert(HubFinalProductMigration::apply($db,$base.'/migrations/008_final_product.sql',$now) === 'applied','M9');
    m16_assert(HubFoundingMemoryMigration::apply($db,$base.'/migrations/009_founding_memory.sql',$now) === 'applied','M10');
    m16_assert(HubSelfServiceMigration::apply($db,$base.'/migrations/010_self_service.sql',$now) === 'applied','M11');
    m16_assert(HubCentralProjectAuthorityMigration::apply($db,$base.'/migrations/011_central_project_authority.sql',$now) === 'applied','M12');
    m16_assert(HubAnywhereExecutionMigration::apply($db,$base.'/migrations/012_anywhere_execution_fabric.sql',$now) === 'applied','M13');
    $auth = HubOwnerAuthService::openExisting($db); $auth->provisionInitial('art',$ownerPassword,$now); $session = $auth->login('art',$ownerPassword,true,'m16-owner',$now);
    $control = HubControlPlaneService::openExisting($db); $browser = m16_browser($session['sessionToken'],$session['csrfToken']);
    $created = m16_control($control,'POST','/api/v1/control/conversations/new',$browser,['schemaVersion'=>2,'projectId'=>$project,'title'=>'Office PDF']);
    m16_assert($created['status'] === 201,'owner creates Office conversation'); $conversation = json_decode($created['body'],true,32,JSON_THROW_ON_ERROR)['conversation']['conversationId'];

    $docx = $root.'/fixture.docx'; $zip = new ZipArchive(); m16_assert($zip->open($docx,ZipArchive::CREATE) === true,'docx fixture create');
    $zip->addFromString('[Content_Types].xml','<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
    $zip->addFromString('word/document.xml','<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>AWH M16</w:t></w:r></w:p></w:body></w:document>'); $zip->close();
    $upload = HubControlPlaneRouter::dispatch('POST','/api/v1/control/conversations/thread/'.$conversation.'/attachments',m16_browser($session['sessionToken'],$session['csrfToken'],'multipart/form-data; boundary=fixture'),$control,'',['attachments'=>['name'=>['fixture.docx'],'tmp_name'=>[$docx],'error'=>[UPLOAD_ERR_OK],'size'=>[filesize($docx)]]]);
    $uploadBody = json_decode($upload['body'],true,32,JSON_THROW_ON_ERROR); m16_assert($upload['status'] === 201 && count($uploadBody['attachments'] ?? []) === 1,'DOCX upload accepted');
    $attachmentId = $uploadBody['attachments'][0]['attachmentId']; $attachmentKey = $pdo->query("SELECT storage_key FROM control_conversation_attachments WHERE attachment_id='".$attachmentId."'")->fetchColumn();
    $attachmentPath = (new HubAttachmentStore($attachmentRoot))->read((string)$attachmentKey); $sourceHash = hash_file('sha256',$attachmentPath);
    $submitted = m16_control($control,'POST','/api/v1/control/conversations',$browser,['schemaVersion'=>3,'projectId'=>$project,'conversationId'=>$conversation,'message'=>'แปลงไฟล์นี้เป็น PDF','attachmentIds'=>[$attachmentId],'idempotencyKey'=>'m16-office-0001']);
    m16_assert($submitted['status'] === 201,'Office conversion request is accepted');
    $job = $pdo->query("SELECT t.task_id,t.state,e.execution_id,e.required_capability,e.state AS execution_state,e.checkpoint_json FROM control_tasks t JOIN control_task_executions e ON e.task_id=t.task_id WHERE t.conversation_id='".$conversation."' ORDER BY t.created_at DESC LIMIT 1")->fetch();
    m16_assert(is_array($job) && $job['state']==='WAITING_FOR_WORKER' && $job['execution_state']==='WAITING_FOR_CAPABILITY' && $job['required_capability']==='office.word.pdf','DOCX request creates one granular DEVICE execution');
    $checkpoint = json_decode((string)$job['checkpoint_json'],true,16,JSON_THROW_ON_ERROR); m16_assert(($checkpoint['mode']??null)==='OFFICE_TO_PDF' && ($checkpoint['attachmentId']??null)===$attachmentId,'Office execution binds the exact attachment');
    $registry = new HubCapabilityRegistryService($pdo);
    $control->heartbeat($worker['accessToken'],['schemaVersion'=>1,'deviceId'=>$device,'state'=>'READY','capabilities'=>['tool.office.word']],$now);
    m16_assert($registry->route('document.office',$now) === null,'detected Office inventory alone never becomes executable');
    $toolOnlyClaim = $control->claim($worker['accessToken'],['schemaVersion'=>1,'deviceId'=>$device],$now);
    m16_assert(($toolOnlyClaim['task'] ?? null) === null,'inventory-only worker cannot claim Office work');

    $control->heartbeat($worker['accessToken'],['schemaVersion'=>1,'deviceId'=>$device,'state'=>'READY','capabilities'=>['tool.office.word','office.word.pdf']],$now);
    $officeRoute = $registry->route('document.office',$now); m16_assert(($officeRoute['providerId'] ?? null) === 'device:'.$device,'real Office handler advertises document.office through registry');
    $claimed = $control->claim($worker['accessToken'],['schemaVersion'=>1,'deviceId'=>$device],$now);
    m16_assert(($claimed['task']['taskId'] ?? null) === $job['task_id'],'exact Office capability claims the durable task');
    $leased = $pdo->query("SELECT e.state,e.lease_owner,v.state AS envelope_state FROM control_task_executions e JOIN control_execution_envelopes v ON v.execution_id=e.execution_id WHERE e.execution_id='".$job['execution_id']."'")->fetch();
    m16_assert(is_array($leased) && $leased['state']==='RUNNING' && $leased['lease_owner']===$device && $leased['envelope_state']==='ACTIVE','Office claim activates the existing execution envelope');

    $otherDenied = HubControlPlaneRouter::dispatch('GET','/api/v1/control/worker/executions/'.$job['execution_id'].'/office-packet',m16_worker($other['accessToken'],$otherDevice),$control,'');
    m16_assert($otherDenied['status'] === 403,'another enrolled device cannot read the leased Office packet');
    $packet = HubControlPlaneRouter::dispatch('GET','/api/v1/control/worker/executions/'.$job['execution_id'].'/office-packet',m16_worker($worker['accessToken'],$device),$control,'');
    $packetBody = json_decode($packet['body'],true,32,JSON_THROW_ON_ERROR); m16_assert($packet['status']===200 && ($packetBody['execution']['inputName']??null)==='fixture.docx','leased worker receives only bounded Office metadata');
    $input = HubControlPlaneRouter::dispatch('GET','/api/v1/control/worker/executions/'.$job['execution_id'].'/office-input',m16_worker($worker['accessToken'],$device),$control,'');
    m16_assert($input['status']===200 && isset($input['streamPath']) && hash_file('sha256',$input['streamPath'])===$sourceHash,'leased worker receives the immutable source bytes');

    $bad = $root.'/bad.pdf'; file_put_contents($bad,'not-a-pdf');
    $badResponse = HubControlPlaneRouter::dispatch('POST','/api/v1/control/worker/executions/'.$job['execution_id'].'/office-artifact',m16_worker($worker['accessToken'],$device,'application/pdf'),$control,'',['officeArtifact'=>['tmp_name'=>$bad,'size'=>filesize($bad)]]);
    m16_assert($badResponse['status']===400 && str_contains($badResponse['body'],'ARTIFACT_INVALID'),'wrong PDF magic is rejected before artifact storage');
    m16_assert($pdo->query("SELECT state FROM control_task_executions WHERE execution_id='".$job['execution_id']."'")->fetchColumn()==='RUNNING','invalid artifact does not consume the active lease');

    $pdf = $root.'/result.pdf'; file_put_contents($pdf,"%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF\n");
    $done = HubControlPlaneRouter::dispatch('POST','/api/v1/control/worker/executions/'.$job['execution_id'].'/office-artifact',m16_worker($worker['accessToken'],$device,'application/pdf'),$control,'',['officeArtifact'=>['tmp_name'=>$pdf,'size'=>filesize($pdf)]]);
    m16_assert($done['status']===201,'valid Office PDF is stored through the leased worker route');
    $finished = $pdo->query("SELECT t.state AS task_state,e.state AS execution_state,v.state AS envelope_state,w.state AS worker_state,w.busy_task_id FROM control_tasks t JOIN control_task_executions e ON e.task_id=t.task_id JOIN control_execution_envelopes v ON v.execution_id=e.execution_id JOIN control_workers w ON w.device_id='".$device."' WHERE t.task_id='".$job['task_id']."'")->fetch();
    m16_assert(is_array($finished) && $finished['task_state']==='COMPLETED' && $finished['execution_state']==='COMPLETED' && $finished['envelope_state']==='RELEASED' && $finished['worker_state']==='READY' && $finished['busy_task_id']===null,'Office artifact releases task, execution, envelope, and worker');
    $artifact = $pdo->query("SELECT a.artifact_id,a.name,a.sha256,a.size_bytes,o.storage_key,o.mime_type FROM control_artifacts a JOIN control_artifact_objects o ON o.artifact_id=a.artifact_id WHERE a.task_id='".$job['task_id']."'")->fetch();
    m16_assert(is_array($artifact) && $artifact['name']==='fixture.pdf' && $artifact['mime_type']==='application/pdf','PDF is registered in the canonical Cloud artifact authority');
    $download = HubControlPlaneRouter::dispatch('GET','/api/v1/control/artifacts/'.$artifact['artifact_id'].'/download',['HTTP_COOKIE'=>'__Host-awh_control_session='.$session['sessionToken'],'HTTP_SEC_FETCH_SITE'=>'same-origin'],$control,'');
    m16_assert($download['status']===200 && isset($download['streamPath']) && str_starts_with((string)file_get_contents($download['streamPath']),'%PDF-'),'owner can open the resulting PDF from Cloud storage');
    m16_assert(hash_file('sha256',$attachmentPath)===$sourceHash,'Office conversion never overwrites the original attachment');
    $afterDone = HubControlPlaneRouter::dispatch('GET','/api/v1/control/worker/executions/'.$job['execution_id'].'/office-packet',m16_worker($worker['accessToken'],$device),$control,'');
    m16_assert($afterDone['status']===403,'released Office execution cannot be read again');
    m16_assert((int)$pdo->query("SELECT COUNT(*) FROM control_approvals WHERE task_id='".$job['task_id']."'")->fetchColumn()===0,'non-mutating Office conversion never creates source-promotion approval');
    m16_assert($pdo->query('PRAGMA integrity_check')->fetchColumn()==='ok' && $pdo->query('PRAGMA foreign_key_check')->fetchAll()===[],'M16 preserves database integrity and foreign keys');
    fwrite(STDOUT,"AWH M16 Office provider: PASS\n");
} finally {
    putenv('AWH_CONTROL_ORIGIN'); putenv('AWH_ATTACHMENT_ROOT'); putenv('AWH_ARTIFACT_ROOT'); putenv('AWH_PROJECT_VAULT_ROOT'); putenv('AWH_TASK_WORKSPACE_ROOT'); m16_clean($root);
}
