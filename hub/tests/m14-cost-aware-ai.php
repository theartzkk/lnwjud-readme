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
require_once dirname(__DIR__) . '/src/HubCapabilityRegistryService.php';
require_once dirname(__DIR__) . '/src/HubCostAwareAiMigration.php';
require_once dirname(__DIR__) . '/src/HubProviderPricingService.php';
require_once dirname(__DIR__) . '/src/HubNativeAgentService.php';
require_once dirname(__DIR__) . '/src/HubEnrollmentService.php';

function m14_assert(bool $condition, string $message): void { if (!$condition) throw new RuntimeException($message); }
function m14_uuid(): string { $bytes = random_bytes(16); $bytes[6] = chr((ord($bytes[6]) & 15) | 64); $bytes[8] = chr((ord($bytes[8]) & 63) | 128); return vsprintf('%s%s-%s-%s-%s-%s%s%s', str_split(bin2hex($bytes), 4)); }
function m14_clean(string $root): void { if (!is_dir($root)) return; $files = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($root, FilesystemIterator::SKIP_DOTS), RecursiveIteratorIterator::CHILD_FIRST); foreach ($files as $file) { $path = $file->getPathname(); $file->isDir() && !$file->isLink() ? @rmdir($path) : @unlink($path); } @rmdir($root); }

if (!in_array('sqlite', PDO::getAvailableDrivers(), true)) { fwrite(STDOUT, "AWH M14 Cost-Aware AI: SKIP pdo_sqlite unavailable\n"); exit(77); }

$root = sys_get_temp_dir() . '/awh-m14-' . bin2hex(random_bytes(6));
$base = dirname(__DIR__); $now = gmdate('c');
$owner = '223b45c0-23e1-408d-ae0f-ac5eca7f6900';
$project = '113b45c0-23e1-408d-ae0f-ac5eca7f6900';
$device = '423b45c0-23e1-408d-ae0f-ac5eca7f6900';
try {
    mkdir($root, 0700, true); $db = $root . '/awh.sqlite';
    $pdo = new PDO('sqlite:' . $db, null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC]);
    $pdo->exec('PRAGMA foreign_keys = ON'); $pdo->exec(file_get_contents($base . '/schema.sql'));
    foreach (['enrollment_rate_limits','device_project_memberships','device_tokens','pairing_projects','pairing_codes','user_project_memberships','device_enrollments','owner_bootstrap','hub_users'] as $table) $pdo->exec('DROP TABLE IF EXISTS ' . $table);
    $pdo->prepare('INSERT INTO projects(project_id,name,type,created_at,source_revision,observed_at,provenance) VALUES(:id,:name,:type,:at,NULL,:at,:provenance)')->execute(['id'=>$project,'name'=>'Anywhere Fixture','type'=>'php','at'=>$now,'provenance'=>'m13-fixture']);
    m14_assert(HubSchemaMigration::apply($db, $base . '/migrations/001_m3e_enrollment.sql', $now, false, $base . '/schema.sql') === 'applied', 'M3E');
    m14_assert(HubEnrollmentApiMigration::apply($db, $base . '/migrations/002_m3e2_enrollment_api.sql', $now) === 'applied', 'M3E2');
    HubEnrollmentService::openExisting($db)->initializeOwner($owner, 'Art', [$project], $now);
    foreach ([[HubControlPlaneMigration::class,'003_m4_control_plane.sql'],[HubOwnerAuthMigration::class,'004_owner_auth.sql'],[HubAssistantWorkstreamMigration::class,'005_assistant_workstream.sql'],[HubWorkspaceContinuityMigration::class,'006_workspace_continuity.sql'],[HubUnifiedWorkspaceMigration::class,'007_unified_workspace.sql']] as [$migration,$sql]) m14_assert($migration::apply($db, $base . '/migrations/' . $sql, $now) === 'applied', $sql);
    m14_assert(HubFinalProductMigration::apply($db, $base . '/migrations/008_final_product.sql', $now) === 'applied', 'M9');
    m14_assert(HubFoundingMemoryMigration::apply($db, $base . '/migrations/009_founding_memory.sql', $now) === 'applied', 'M10');
    m14_assert(HubSelfServiceMigration::apply($db, $base . '/migrations/010_self_service.sql', $now) === 'applied', 'M11');
    m14_assert(HubCentralProjectAuthorityMigration::apply($db, $base . '/migrations/011_central_project_authority.sql', $now) === 'applied', 'M12');
    $legacyTask = m14_uuid(); $legacyExecution = m14_uuid();
    $pdo->prepare("INSERT INTO control_tasks(task_id,user_id,project_id,goal,state,assigned_device_id,lease_expires_at,progress,result_summary,failure_code,idempotency_key,conversation_id,created_at,updated_at,cancelled_at) VALUES(:task,:user,:project,'inspect','QUEUED',NULL,NULL,0,NULL,NULL,:key,NULL,:at,:at,NULL)")->execute(['task'=>$legacyTask,'user'=>$owner,'project'=>$project,'key'=>'m13-legacy-task-0001','at'=>$now]);
    $pdo->prepare("INSERT INTO control_task_executions(execution_id,task_id,project_id,vault_revision_id,executor_kind,required_capability,state,lease_owner,lease_expires_at,attempt_count,cancellation_requested_at,checkpoint_json,last_error_code,created_at,updated_at) VALUES(:execution,:task,:project,NULL,'VPS','project.read','QUEUED',NULL,NULL,0,NULL,'{}',NULL,:at,:at)")->execute(['execution'=>$legacyExecution,'task'=>$legacyTask,'project'=>$project,'at'=>$now]);

    m14_assert(HubAnywhereExecutionMigration::apply($db, $base . '/migrations/012_anywhere_execution_fabric.sql', $now) === 'applied', 'M13 migration');
    m14_assert(HubAnywhereExecutionMigration::apply($db, $base . '/migrations/012_anywhere_execution_fabric.sql', $now) === 'already-applied', 'M13 idempotence');
    m14_assert((int) $pdo->query('PRAGMA user_version')->fetchColumn() === 13, 'M13 version');
    m14_assert((int) $pdo->query("SELECT COUNT(*) FROM awh_schema_migrations WHERE migration_id='m13-anywhere-execution-fabric'")->fetchColumn() === 1, 'M13 ledger');

    $envelope = $pdo->query("SELECT * FROM control_execution_envelopes WHERE execution_id='$legacyExecution'")->fetch();
    m14_assert(is_array($envelope) && $envelope['mutation_scope'] === 'READ' && $envelope['session_key'] === 'task:' . $legacyTask && $envelope['state'] === 'OPEN', 'legacy M12 execution is backfilled without a new task authority');

    $registry = new HubCapabilityRegistryService($pdo);
    $before = $registry->status(false, $now);
    m14_assert(($before['anywhereFirst'] ?? false) === true && ($before['deviceRequired'] ?? true) === false, 'M13 declares anywhere-first without making a device mandatory');
    m14_assert(($registry->route('project.read', $now) ?? null) === null, 'catalog alone never claims an executor is online');
    $cloudCaps = ['agent.conversation','project.read','project.search','project.mutate.text','project.mutate.assisted','artifact.object'];
    $registry->advertiseVps($cloudCaps, $now, gmdate('c', strtotime($now) + 300));
    $cloudRoute = $registry->route('project.read', $now);
    m14_assert(($cloudRoute['providerId'] ?? null) === 'vps-native' && ($cloudRoute['availabilityMode'] ?? null) === 'ALWAYS_ON', 'Cloud provider is preferred for a core read capability');

    $pdo->prepare('INSERT INTO devices(device_id,display_name,platform,arch,app_version,last_seen_at,revoked_at) VALUES(:id,:name,:platform,:arch,:version,:at,NULL)')->execute(['id'=>$device,'name'=>'Optional Mac','platform'=>'darwin','arch'=>'arm64','version'=>'1.0.0','at'=>$now]);
    $registry->syncDeviceWorker($device, ['project.read','codex:cli','git','browser_debug_context','office'], 'READY', $now);
    $stillCloud = $registry->route('project.read', $now);
    m14_assert(($stillCloud['providerId'] ?? null) === 'vps-native', 'optional device never becomes a hidden dependency for cloud-capable work');
    $specialist = $registry->route('code.specialist', $now);
    m14_assert(($specialist['providerId'] ?? null) === 'device:' . $device, 'Codex CLI is exposed only as the human-facing specialist capability');

    $specialistTask = m14_uuid(); $specialistExecution = m14_uuid();
    $pdo->prepare("INSERT INTO control_tasks(task_id,user_id,project_id,goal,state,assigned_device_id,lease_expires_at,progress,result_summary,failure_code,idempotency_key,conversation_id,created_at,updated_at,cancelled_at) VALUES(:task,:user,:project,'specialist','WAITING_FOR_WORKER',NULL,NULL,0,NULL,NULL,:key,NULL,:at,:at,NULL)")->execute(['task'=>$specialistTask,'user'=>$owner,'project'=>$project,'key'=>'m13-specialist-task-0001','at'=>$now]);
    $pdo->prepare("INSERT INTO control_task_executions(execution_id,task_id,project_id,vault_revision_id,executor_kind,required_capability,state,lease_owner,lease_expires_at,attempt_count,cancellation_requested_at,checkpoint_json,last_error_code,created_at,updated_at) VALUES(:execution,:task,:project,NULL,'CODEX','codex:cli','WAITING_FOR_CAPABILITY',NULL,NULL,0,NULL,'{}',NULL,:at,:at)")->execute(['execution'=>$specialistExecution,'task'=>$specialistTask,'project'=>$project,'at'=>$now]);
    $specialistEnvelope = $registry->ensureExecutionEnvelope($specialistExecution, $now);
    m14_assert(($specialistEnvelope['providerId'] ?? null) === 'device:' . $device && ($specialistEnvelope['mutationScope'] ?? null) === 'DEVICE_WORKSPACE', 'legacy codex:cli contract resolves through the specialist alias without changing the execution row');
    $registry->syncDeviceWorker($device, [], 'OFFLINE', gmdate('c', strtotime($now) + 30));
    m14_assert($registry->route('code.specialist', gmdate('c', strtotime($now) + 30)) === null, 'offline optional device disappears from routing truthfully');

    $after = $registry->status(false, $now);
    $visible = array_column($after['capabilities'], 'state', 'capability');
    m14_assert(($visible['project.mutate.assisted'] ?? null) === 'READY', 'Cloud-assisted source editing is visible as ready');
    m14_assert(($visible['voice.tts'] ?? null) === 'PLANNED' && ($visible['video.render'] ?? null) === 'PLANNED', 'future voice/video capabilities are truthful planned entries');
    // A pre-M14 owner policy keeps legacy accounting after the additive migration.
    $pdo->prepare("INSERT INTO control_provider_policies(provider_id,enabled,model_fast,model_balanced,model_strong,monthly_budget_microunits,warning_microunits,input_microunits_per_million,output_microunits_per_million,updated_by_user_id,updated_at) VALUES('openai',0,'gpt-5.4-mini','gpt-5.4','gpt-5.4',1000000,800000,1000000,2000000,:user,:at)")->execute(['user'=>$owner,'at'=>$now]);
    m14_assert(HubCostAwareAiMigration::apply($db, $base . '/migrations/013_cost_aware_ai.sql', $now) === 'applied', 'M14 migration');
    m14_assert(HubCostAwareAiMigration::apply($db, $base . '/migrations/013_cost_aware_ai.sql', $now) === 'already-applied', 'M14 idempotence');
    m14_assert((int)$pdo->query('PRAGMA user_version')->fetchColumn() === 14, 'M14 version');
    $legacy = $pdo->query("SELECT pricing_mode,routing_strategy,service_tier FROM control_provider_policies WHERE provider_id='openai'")->fetch();
    m14_assert(is_array($legacy) && $legacy['pricing_mode']==='LEGACY' && $legacy['routing_strategy']==='BALANCED' && $legacy['service_tier']==='DEFAULT', 'existing owner pricing remains legacy until explicitly changed');

    $pricing = new HubProviderPricingService($pdo);
    $catalogPolicy = ['pricingMode'=>'CATALOG','serviceTier'=>'DEFAULT'];
    $plain = $pricing->quoteForPolicy($catalogPolicy,'openai','gpt-5.6-luna',1000,0,0,100,$now);
    $cached = $pricing->quoteForPolicy($catalogPolicy,'openai','gpt-5.6-luna',1000,100,100,100,$now);
    m14_assert(($cached['estimatedMicrounits'] ?? 0) < ($plain['estimatedMicrounits'] ?? 0), 'cached reads reduce cost even when explicit cache writes are billed');
    m14_assert(($cached['snapshot']['cachedInputRateMicrounitsPerMillion'] ?? 0) * 10 === ($cached['snapshot']['inputRateMicrounitsPerMillion'] ?? -1), 'cached input uses the OpenAI discounted rate');
    m14_assert(($cached['snapshot']['cacheWriteRateMicrounitsPerMillion'] ?? 0) * 4 === ($cached['snapshot']['inputRateMicrounitsPerMillion'] ?? 0) * 5, 'cache writes use 1.25x input rate');
    $long = $pricing->quoteForPolicy($catalogPolicy,'openai','gpt-5.6-luna',273000,0,0,100,$now);
    m14_assert(($long['snapshot']['longContextMultiplierApplied'] ?? false) === true, 'requests above 272K input apply the GPT-5.6 long-context multiplier');
    $rates = $pricing->catalog(['gpt-5.6-luna','gpt-5.6-terra','gpt-5.6-sol'],'openai','DEFAULT',$now);
    m14_assert(count($rates)===3 && ($rates[0]['sourceUri'] ?? '') !== '', 'Luna Terra Sol pricing is versioned with provenance');

    $agent = new HubNativeAgentService($pdo, static fn(array $payload,string $key): array => ['output_text'=>'ประหยัดและพร้อมใช้งาน','usage'=>['input_tokens'=>1000,'output_tokens'=>100,'input_tokens_details'=>['cached_tokens'=>100,'cache_write_tokens'=>100]]], 'sk-'.str_repeat('x',32));
    $policy = ['enabled'=>true,'modelFast'=>'gpt-5.6-luna','modelBalanced'=>'gpt-5.6-terra','modelStrong'=>'gpt-5.6-sol','monthlyBudgetMicrounits'=>900000000,'warningMicrounits'=>700000000,'routingStrategy'=>'SAVER','pricingMode'=>'CATALOG','serviceTier'=>'DEFAULT'];
    $status = $agent->updatePolicy($owner,$policy,$now);
    m14_assert(($status['routingStrategy'] ?? null)==='SAVER' && ($status['pricing']['mode'] ?? null)==='CATALOG' && count($status['pricing']['catalog'] ?? [])===3, 'owner can choose a simple saver strategy with catalog pricing');
    $route = new ReflectionMethod(HubNativeAgentService::class,'route');
    m14_assert($route->invoke(null,'งานทั่วไป','SAVER')==='FAST' && $route->invoke(null,'production security migration','SAVER')==='STRONG', 'saver mode stays cheap for routine work but never downgrades high-risk work');

    $conversation=m14_uuid(); $message=m14_uuid();
    $pdo->prepare('INSERT INTO control_conversations(conversation_id,user_id,project_id,created_at,updated_at,last_task_id) VALUES(:id,:user,:project,:at,:at,NULL)')->execute(['id'=>$conversation,'user'=>$owner,'project'=>$project,'at'=>$now]);
    $pdo->prepare("INSERT INTO control_conversation_messages(message_id,conversation_id,task_id,message_kind,sequence_no,body,idempotency_key,source_event_id,metadata_json,created_at) VALUES(:id,:conversation,NULL,'USER',1,'ทดสอบ M14',NULL,NULL,NULL,:at)")->execute(['id'=>$message,'conversation'=>$conversation,'at'=>$now]);
    $reply=$agent->respond($owner,$project,$conversation,$message,'สรุปสั้น ๆ',[],[],$now);
    m14_assert(($reply['model'] ?? null)==='gpt-5.6-luna' && ($reply['route'] ?? null)==='fast', 'routine saver request routes to Luna');
    $usage=$pdo->query("SELECT pricing_mode,pricing_rate_id,cache_write_tokens,cached_input_rate_microunits_per_million,cache_write_rate_microunits_per_million,pricing_source_uri FROM control_provider_usage WHERE message_id='$message' ORDER BY created_at DESC LIMIT 1")->fetch();
    m14_assert(is_array($usage) && $usage['pricing_mode']==='CATALOG' && $usage['pricing_rate_id']!==null && (int)$usage['cache_write_tokens']===100 && (int)$usage['cached_input_rate_microunits_per_million']>0 && (int)$usage['cache_write_rate_microunits_per_million']>0 && $usage['pricing_source_uri']!=='', 'each billable usage stores its exact pricing snapshot');
    m14_assert($pdo->query('PRAGMA integrity_check')->fetchColumn() === 'ok' && $pdo->query('PRAGMA foreign_key_check')->fetchAll() === [], 'M14 preserves database integrity and foreign keys');
    fwrite(STDOUT, "AWH M14 Cost-Aware AI: PASS\n");
} finally {
    m14_clean($root);
}
