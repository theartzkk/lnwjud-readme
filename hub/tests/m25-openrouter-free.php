<?php
declare(strict_types=1);

require_once dirname(__DIR__).'/src/HubConversationDelegateMigration.php';
require_once dirname(__DIR__).'/src/HubOpenRouterFreeMigration.php';
require_once dirname(__DIR__).'/src/HubOpenRouterProviderAdapter.php';
require_once dirname(__DIR__).'/src/HubNativeAgentService.php';

function m25_assert(bool $ok,string $message): void { if(!$ok) throw new RuntimeException($message); echo "PASS: {$message}\n"; }
function m25_expect(string $code,callable $fn,string $message): void {
    try{$fn();}catch(Throwable $error){$actual=property_exists($error,'codeName')?$error->codeName:'';m25_assert($actual===$code,$message);return;}
    throw new RuntimeException($message.': accepted');
}
if(!in_array('sqlite',PDO::getAvailableDrivers(),true)){echo "AWH M25 OpenRouter Free: SKIP\n";exit(77);}
$root=rtrim(sys_get_temp_dir(),'/').'/awh-m25-'.bin2hex(random_bytes(6));$db=$root.'/awh.sqlite';
try{
    mkdir($root,0700,true);
    $pdo=new PDO('sqlite:'.$db,null,null,[PDO::ATTR_ERRMODE=>PDO::ERRMODE_EXCEPTION,PDO::ATTR_DEFAULT_FETCH_MODE=>PDO::FETCH_ASSOC]);
    $pdo->exec('PRAGMA foreign_keys=ON');
    $pdo->exec("CREATE TABLE awh_schema_migrations(migration_id TEXT PRIMARY KEY,schema_version INTEGER NOT NULL,checksum TEXT NOT NULL,applied_at TEXT NOT NULL)");
    $pdo->exec("CREATE TABLE hub_users(user_id TEXT PRIMARY KEY)");
    $pdo->exec("CREATE TABLE projects(project_id TEXT PRIMARY KEY,name TEXT NOT NULL)");
    $pdo->exec("CREATE TABLE control_ai_delegates(user_id TEXT NOT NULL,project_id TEXT NOT NULL,delegate_mode TEXT NOT NULL,granted_by_user_id TEXT NOT NULL,created_at TEXT NOT NULL,revoked_at TEXT,PRIMARY KEY(user_id,project_id,delegate_mode))");
    $pdo->exec("CREATE INDEX idx_control_ai_delegates_lookup ON control_ai_delegates(user_id,project_id,delegate_mode,revoked_at)");
    $m24=dirname(__DIR__).'/migrations/023_conversation_delegate.sql';
    $pdo->prepare("INSERT INTO awh_schema_migrations VALUES('m24-conversation-delegates',24,?,'2026-09-28T00:00:00Z')")->execute([hash_file('sha256',$m24)]);
    $m16=dirname(__DIR__).'/migrations/015_self_sufficient_ai.sql';
    $pdo->prepare("INSERT INTO awh_schema_migrations VALUES('m16-self-sufficient-ai',16,?,'2026-09-28T00:00:00Z')")->execute([hash_file('sha256',$m16)]);
    $pdo->exec('PRAGMA user_version=24');

    $pdo->exec("CREATE TABLE control_execution_providers(provider_id TEXT PRIMARY KEY,provider_kind TEXT NOT NULL,display_name TEXT NOT NULL,availability_mode TEXT NOT NULL,cost_class TEXT NOT NULL,priority INTEGER NOT NULL,enabled INTEGER NOT NULL,observed_at TEXT NOT NULL,expires_at TEXT,metadata_json TEXT NOT NULL)");
    $pdo->exec("CREATE TABLE control_ai_provider_profiles(provider_id TEXT PRIMARY KEY,lifecycle TEXT NOT NULL,privacy_policy_uri TEXT,region TEXT,max_data_classification TEXT NOT NULL,current_availability TEXT NOT NULL,free_quota_json TEXT NOT NULL,paid_quota_json TEXT NOT NULL,policy_version TEXT NOT NULL,observed_at TEXT NOT NULL,updated_at TEXT NOT NULL,metadata_json TEXT NOT NULL,FOREIGN KEY(provider_id) REFERENCES control_execution_providers(provider_id) ON DELETE CASCADE)");
    $pdo->exec("CREATE TABLE control_ai_models(provider_id TEXT NOT NULL,model_id TEXT NOT NULL,display_name TEXT NOT NULL,lifecycle TEXT NOT NULL,context_window_tokens INTEGER,max_output_tokens INTEGER,tool_calling INTEGER NOT NULL,structured_output INTEGER NOT NULL,vision INTEGER NOT NULL,audio INTEGER NOT NULL,file_support INTEGER NOT NULL,coding_rank INTEGER NOT NULL,reasoning_rank INTEGER NOT NULL,latency_rank INTEGER NOT NULL,max_data_classification TEXT NOT NULL,capabilities_json TEXT NOT NULL,observed_at TEXT NOT NULL,updated_at TEXT NOT NULL,enabled INTEGER NOT NULL,metadata_json TEXT NOT NULL,PRIMARY KEY(provider_id,model_id),FOREIGN KEY(provider_id) REFERENCES control_ai_provider_profiles(provider_id) ON DELETE CASCADE)");
    $pdo->exec("CREATE TABLE control_capability_catalog(capability TEXT PRIMARY KEY)");
    $pdo->exec("INSERT INTO control_capability_catalog VALUES('agent.conversation')");
    $pdo->exec("CREATE TABLE control_execution_provider_capabilities(provider_id TEXT NOT NULL,capability TEXT NOT NULL,version TEXT,cost_rank INTEGER NOT NULL,quality_rank INTEGER NOT NULL,latency_rank INTEGER NOT NULL,enabled INTEGER NOT NULL,observed_at TEXT NOT NULL,expires_at TEXT,metadata_json TEXT NOT NULL,PRIMARY KEY(provider_id,capability),FOREIGN KEY(provider_id) REFERENCES control_execution_providers(provider_id) ON DELETE CASCADE,FOREIGN KEY(capability) REFERENCES control_capability_catalog(capability) ON DELETE CASCADE)");
    $pdo->exec("CREATE TABLE control_provider_model_rates(rate_id TEXT PRIMARY KEY,provider_id TEXT NOT NULL,model TEXT NOT NULL,service_tier TEXT NOT NULL,accounting_currency TEXT NOT NULL,input_microunits_per_million INTEGER NOT NULL,cached_input_microunits_per_million INTEGER NOT NULL,cache_write_microunits_per_million INTEGER NOT NULL,output_microunits_per_million INTEGER NOT NULL,provider_currency TEXT NOT NULL,provider_input_microunits_per_million INTEGER NOT NULL,provider_cached_input_microunits_per_million INTEGER NOT NULL,provider_cache_write_microunits_per_million INTEGER NOT NULL,provider_output_microunits_per_million INTEGER NOT NULL,fx_microunits_thb_per_usd INTEGER NOT NULL,effective_at TEXT NOT NULL,observed_at TEXT NOT NULL,source_uri TEXT NOT NULL,source_label TEXT NOT NULL,active INTEGER NOT NULL,metadata_json TEXT NOT NULL)");
    $pdo->exec("CREATE TABLE control_provider_policies(provider_id TEXT PRIMARY KEY,enabled INTEGER NOT NULL,model_fast TEXT NOT NULL,model_balanced TEXT NOT NULL,model_strong TEXT NOT NULL,monthly_budget_microunits INTEGER NOT NULL,warning_microunits INTEGER NOT NULL,input_microunits_per_million INTEGER NOT NULL,output_microunits_per_million INTEGER NOT NULL,routing_strategy TEXT NOT NULL DEFAULT 'BALANCED',pricing_mode TEXT NOT NULL DEFAULT 'CATALOG',service_tier TEXT NOT NULL DEFAULT 'DEFAULT',updated_by_user_id TEXT NOT NULL,updated_at TEXT NOT NULL)");
    $pdo->exec("CREATE TABLE control_provider_credentials(provider_id TEXT PRIMARY KEY,configured INTEGER NOT NULL,storage_version INTEGER NOT NULL,updated_by_user_id TEXT NOT NULL,updated_at TEXT NOT NULL,last_tested_at TEXT,last_test_status TEXT NOT NULL)");
    $pdo->exec("CREATE TABLE control_provider_usage(usage_id TEXT PRIMARY KEY,provider_id TEXT NOT NULL,user_id TEXT NOT NULL,project_id TEXT NOT NULL,conversation_id TEXT,message_id TEXT,model TEXT NOT NULL,route TEXT NOT NULL,input_tokens INTEGER NOT NULL,cached_input_tokens INTEGER NOT NULL,cache_write_tokens INTEGER NOT NULL DEFAULT 0,output_tokens INTEGER NOT NULL,estimated_microunits INTEGER NOT NULL,status TEXT NOT NULL,created_at TEXT NOT NULL,pricing_rate_id TEXT,pricing_currency TEXT NOT NULL DEFAULT 'THB',input_rate_microunits_per_million INTEGER NOT NULL DEFAULT 0,cached_input_rate_microunits_per_million INTEGER NOT NULL DEFAULT 0,cache_write_rate_microunits_per_million INTEGER NOT NULL DEFAULT 0,output_rate_microunits_per_million INTEGER NOT NULL DEFAULT 0,pricing_effective_at TEXT,pricing_source_uri TEXT,long_context_multiplier_applied INTEGER NOT NULL DEFAULT 0,pricing_snapshot_json TEXT)");

    $pdo->exec("CREATE TABLE control_tasks(task_id TEXT PRIMARY KEY,user_id TEXT,project_id TEXT)");
    $pdo->exec("CREATE TABLE control_task_executions(execution_id TEXT PRIMARY KEY,task_id TEXT,project_id TEXT)");
    $pdo->exec("CREATE TABLE control_ai_model_qualifications(qualification_id TEXT PRIMARY KEY,provider_id TEXT NOT NULL,model_id TEXT NOT NULL,suite_id TEXT NOT NULL,suite_version TEXT NOT NULL,task_type TEXT NOT NULL,score_basis_points INTEGER NOT NULL,pass INTEGER NOT NULL,latency_ms INTEGER NOT NULL,estimated_microunits INTEGER NOT NULL,hallucination_basis_points INTEGER,tool_success_basis_points INTEGER,evidence_sha256 TEXT,observed_at TEXT NOT NULL,metadata_json TEXT NOT NULL DEFAULT '{}',FOREIGN KEY(provider_id,model_id) REFERENCES control_ai_models(provider_id,model_id) ON DELETE CASCADE)");
    $pdo->exec("CREATE TABLE control_ai_model_health(provider_id TEXT NOT NULL,model_id TEXT NOT NULL,window_started_at TEXT NOT NULL,attempts INTEGER NOT NULL DEFAULT 0,successes INTEGER NOT NULL DEFAULT 0,timeouts INTEGER NOT NULL DEFAULT 0,rate_limits INTEGER NOT NULL DEFAULT 0,malformed_responses INTEGER NOT NULL DEFAULT 0,tool_failures INTEGER NOT NULL DEFAULT 0,total_latency_ms INTEGER NOT NULL DEFAULT 0,total_cost_microunits INTEGER NOT NULL DEFAULT 0,circuit_state TEXT NOT NULL DEFAULT 'CLOSED',circuit_until TEXT,updated_at TEXT NOT NULL,PRIMARY KEY(provider_id,model_id),FOREIGN KEY(provider_id,model_id) REFERENCES control_ai_models(provider_id,model_id) ON DELETE CASCADE)");
    $pdo->exec("CREATE TABLE control_ai_route_decisions(route_id TEXT PRIMARY KEY,execution_id TEXT NOT NULL,task_id TEXT NOT NULL,project_id TEXT NOT NULL,user_id TEXT NOT NULL,route_kind TEXT NOT NULL,required_capability TEXT NOT NULL,data_classification TEXT NOT NULL,provider_id TEXT,model_id TEXT,routing_strategy TEXT NOT NULL,reason_code TEXT NOT NULL,estimated_microunits INTEGER NOT NULL,premium_baseline_microunits INTEGER NOT NULL,routing_policy_version TEXT NOT NULL,prompt_policy_version TEXT NOT NULL,tool_policy_version TEXT NOT NULL,decision_state TEXT NOT NULL,created_at TEXT NOT NULL,metadata_json TEXT NOT NULL DEFAULT '{}')");
    $pdo->exec("CREATE TABLE control_ai_outcomes(outcome_id TEXT PRIMARY KEY,route_id TEXT NOT NULL UNIQUE,execution_id TEXT NOT NULL,status TEXT NOT NULL,qa_status TEXT NOT NULL,retry_count INTEGER NOT NULL DEFAULT 0,latency_ms INTEGER NOT NULL DEFAULT 0,actual_microunits INTEGER NOT NULL DEFAULT 0,human_correction INTEGER NOT NULL DEFAULT 0,rework_required INTEGER NOT NULL DEFAULT 0,completed_at TEXT NOT NULL,metadata_json TEXT NOT NULL DEFAULT '{}')");
    $pdo->exec("CREATE TABLE control_ai_budget_policies(policy_id TEXT PRIMARY KEY,scope_kind TEXT NOT NULL,scope_ref TEXT NOT NULL,mode TEXT NOT NULL,daily_microunits INTEGER NOT NULL DEFAULT 0,monthly_microunits INTEGER NOT NULL DEFAULT 0,max_task_microunits INTEGER NOT NULL DEFAULT 0,max_retry_microunits INTEGER NOT NULL DEFAULT 0,max_retries INTEGER NOT NULL DEFAULT 2,hard_limit INTEGER NOT NULL DEFAULT 1,enabled INTEGER NOT NULL DEFAULT 1,updated_by_user_id TEXT NOT NULL,updated_at TEXT NOT NULL,metadata_json TEXT NOT NULL DEFAULT '{}',UNIQUE(scope_kind,scope_ref))");
    $pdo->exec("CREATE INDEX idx_control_ai_models_route ON control_ai_models(lifecycle,enabled,provider_id,latency_rank,reasoning_rank DESC)");
    $pdo->exec("CREATE INDEX idx_control_ai_qualifications_lookup ON control_ai_model_qualifications(provider_id,model_id,task_type,pass,observed_at DESC)");
    $pdo->exec("CREATE INDEX idx_control_ai_routes_execution ON control_ai_route_decisions(execution_id,created_at DESC)");
    $pdo->exec("CREATE INDEX idx_control_ai_routes_cost ON control_ai_route_decisions(project_id,created_at DESC,estimated_microunits)");
    $pdo->exec("CREATE INDEX idx_control_ai_outcomes_execution ON control_ai_outcomes(execution_id,completed_at DESC)");
    $pdo->exec("CREATE INDEX idx_control_ai_budget_scope ON control_ai_budget_policies(scope_kind,scope_ref,enabled)");

    $pdo->exec("INSERT INTO control_execution_providers(provider_id,provider_kind,display_name,availability_mode,cost_class,priority,enabled,observed_at,expires_at,metadata_json) VALUES('openai','API','OpenAI','ON_DEMAND','METERED',80,1,'2026-09-28T00:00:00Z',NULL,'{}')");
    $pdo->exec("INSERT INTO control_ai_provider_profiles(provider_id,lifecycle,privacy_policy_uri,region,max_data_classification,current_availability,free_quota_json,paid_quota_json,policy_version,observed_at,updated_at,metadata_json) VALUES('openai','PRODUCTION',NULL,NULL,'INTERNAL','UNKNOWN','{}','{}','fixture','2026-09-28T00:00:00Z','2026-09-28T00:00:00Z','{}')");
    $openAiModel=$pdo->prepare("INSERT INTO control_ai_models(provider_id,model_id,display_name,lifecycle,context_window_tokens,max_output_tokens,tool_calling,structured_output,vision,audio,file_support,coding_rank,reasoning_rank,latency_rank,max_data_classification,capabilities_json,observed_at,updated_at,enabled,metadata_json) VALUES('openai','fixture-openai','Fixture OpenAI','PRODUCTION',NULL,NULL,1,1,1,0,1,50,50,50,'INTERNAL',:capabilities,'2026-09-28T00:00:00Z','2026-09-28T00:00:00Z',1,'{}')"); $openAiModel->execute(['capabilities'=>'["text"]']);

    $sql=dirname(__DIR__).'/migrations/024_openrouter_free.sql';
    m25_assert(HubOpenRouterFreeMigration::apply($db,$sql,'2026-09-28T01:00:00Z')==='applied','M25 applies after M24');
    m25_assert(HubOpenRouterFreeMigration::apply($db,$sql,'2026-09-28T01:01:00Z')==='already-applied','M25 is idempotent');
    $pdo=null;$pdo=new PDO('sqlite:'.$db,null,null,[PDO::ATTR_ERRMODE=>PDO::ERRMODE_EXCEPTION,PDO::ATTR_DEFAULT_FETCH_MODE=>PDO::FETCH_ASSOC]);$pdo->exec('PRAGMA foreign_keys=ON');
    m25_assert((int)$pdo->query('PRAGMA user_version')->fetchColumn()===25,'M25 advances user_version to 25');
    m25_assert($pdo->query("SELECT lifecycle FROM control_ai_provider_profiles WHERE provider_id='openrouter'")->fetchColumn()==='SANDBOX','OpenRouter starts in SANDBOX');
    m25_assert($pdo->query("SELECT max_data_classification FROM control_ai_provider_profiles WHERE provider_id='openrouter'")->fetchColumn()==='PUBLIC','free provider defaults to PUBLIC data only');
    m25_assert((int)$pdo->query("SELECT input_microunits_per_million+output_microunits_per_million FROM control_provider_model_rates WHERE provider_id='openrouter'")->fetchColumn()===0,'OpenRouter free route is zero token price');
    m25_assert((int)$pdo->query("SELECT COUNT(*) FROM control_provider_policies WHERE provider_id='openrouter'")->fetchColumn()===0,'M25 never auto-enables an owner policy');
    m25_assert((int)$pdo->query("SELECT COUNT(*) FROM control_provider_credentials WHERE provider_id='openrouter'")->fetchColumn()===0,'M25 never creates a credential');

    $owner='11111111-1111-4111-8111-111111111111'; $project='22222222-2222-4222-8222-222222222222';
    $pdo->prepare('INSERT INTO hub_users(user_id) VALUES(?)')->execute([$owner]);
    $pdo->prepare('INSERT INTO projects(project_id,name) VALUES(?,?)')->execute([$project,'M25 Fixture']);

    $captured=null;
    $adapter=new HubOpenRouterProviderAdapter(static function(array $request,string $credential) use (&$captured): array {
        $captured=['request'=>$request,'credential'=>$credential];
        return ['id'=>'gen-12345','choices'=>[['message'=>['role'=>'assistant','content'=>'สวัสดีจากฟรีโมเดล']]],'usage'=>['prompt_tokens'=>12,'completion_tokens'=>4]];
    });
    $response=$adapter->call(['model'=>'openrouter-free','instructions'=>'ตอบสั้น','input'=>[['role'=>'user','content'=>[['type'=>'input_text','text'=>'สวัสดี'],['type'=>'input_image','image_url'=>'data:image/png;base64,AAAA']]]],'max_output_tokens'=>1200],'openrouter-test-key-123456789');
    m25_assert(($captured['request']['model']??null)==='openrouter/free','AWH alias maps only to upstream free router');
    m25_assert(($captured['credential']??null)==='openrouter-test-key-123456789','credential stays adapter-local');
    m25_assert(($response['output_text']??null)==='สวัสดีจากฟรีโมเดล','chat completion normalizes to AWH response text');
    m25_assert(($response['usage']['input_tokens']??null)===12&&($response['usage']['output_tokens']??null)===4,'usage normalizes for AWH accounting');

    $toolRequest=null;
    $toolAdapter=new HubOpenRouterProviderAdapter(static function(array $request,string $_credential) use (&$toolRequest): array {
        $toolRequest=$request;
        return ['id'=>'gen-tools','choices'=>[['message'=>['role'=>'assistant','content'=>null,'tool_calls'=>[['id'=>'call_1234','type'=>'function','function'=>['name'=>'project_read_text','arguments'=>'{"path":"README.md"}']]]]]],'usage'=>['prompt_tokens'=>5,'completion_tokens'=>2]];
    });
    $toolResponse=$toolAdapter->call(['model'=>'openrouter-free','input'=>'read README','tools'=>[['type'=>'function','name'=>'project_read_text','description'=>'Read text','parameters'=>['type'=>'object','properties'=>['path'=>['type'=>'string']],'required'=>['path']]]]],'openrouter-test-key-123456789');
    m25_assert(($toolRequest['tools'][0]['function']['name']??null)==='project_read_text','AWH tool schema translates to chat-completions');
    m25_assert(($toolResponse['output'][0]['type']??null)==='function_call'&&($toolResponse['output'][0]['call_id']??null)==='call_1234','tool call normalizes to AWH continuation');

    m25_expect('PROVIDER_MODEL_UNAVAILABLE',fn()=>$adapter->call(['model'=>'paid-model','input'=>'x'],'openrouter-test-key-123456789'),'paid/non-approved model is rejected before transport');
    m25_expect('PROVIDER_UNAVAILABLE',fn()=>$adapter->call(['model'=>'openrouter-free','input'=>[['role'=>'user','content'=>[['type'=>'input_file','filename'=>'secret.pdf','file_data'=>'AAAA']]]]],'openrouter-test-key-123456789'),'file attachment fails over instead of leaking to free route');

    $credRoot=$root.'/credentials'; mkdir($credRoot,0700,true);
    $primaryStore=new HubProviderCredentialStore($credRoot,'openai');
    $openRouterStore=new HubProviderCredentialStore($credRoot,'openrouter');
    $runtimeAdapter=new HubOpenRouterProviderAdapter(static fn(array $_request,string $_credential):array=>['id'=>'gen-test','choices'=>[['message'=>['role'=>'assistant','content'=>'OK']]],'usage'=>['prompt_tokens'=>1,'completion_tokens'=>1]]);
    $agent=new HubNativeAgentService($pdo,null,null,$primaryStore,null,[$runtimeAdapter],['openrouter'=>$openRouterStore]);
    $policy=$agent->updatePolicyForProvider($owner,'openrouter',['enabled'=>true,'modelFast'=>'openrouter-free','modelBalanced'=>'openrouter-free','modelStrong'=>'openrouter-free','monthlyBudgetMicrounits'=>0,'warningMicrounits'=>0,'routingStrategy'=>'SAVER','pricingMode'=>'CATALOG','serviceTier'=>'DEFAULT'],'2026-09-28T01:02:00Z');
    m25_assert(($policy['enabled']??false)===true&&($policy['zeroCost']??false)===true&&($policy['budget']['hardStop']??true)===false,'zero-price provider accepts zero budget without hard-stop');
    $secret='sk-or-v1-'.str_repeat('A',32);
    $saved=$agent->saveCredentialForProvider($owner,'openrouter',$secret,'2026-09-28T01:03:00Z');
    m25_assert(($saved['keyConfigured']??false)===true&&$openRouterStore->read()===$secret,'OpenRouter key stays in server credential store');
    $connection=$agent->testConnectionForProvider($owner,'openrouter','2026-09-28T01:04:00Z');
    m25_assert(($connection['status']??null)==='PASS'&&($connection['path']??null)==='chat-completions'&&($connection['model']??null)==='openrouter-free','provider-specific connection test uses free adapter');
    m25_assert((int)$pdo->query("SELECT COUNT(*) FROM control_provider_credentials WHERE provider_id='openrouter' AND configured=1 AND last_test_status='PASS'")->fetchColumn()===1,'credential metadata records status without storing secret');

    m25_assert($pdo->query('PRAGMA integrity_check')->fetchColumn()==='ok'&&$pdo->query('PRAGMA foreign_key_check')->fetchAll()===[],'M25 database integrity remains clean');
    echo "AWH M25 OpenRouter Free: PASS\n";
} finally {
    if(is_dir($root)){foreach(new RecursiveIteratorIterator(new RecursiveDirectoryIterator($root,FilesystemIterator::SKIP_DOTS),RecursiveIteratorIterator::CHILD_FIRST) as $f){$p=$f->getPathname();$f->isDir()&&!$f->isLink()?@rmdir($p):@unlink($p);}@rmdir($root);}
}
