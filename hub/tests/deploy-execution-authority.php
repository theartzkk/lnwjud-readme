<?php

declare(strict_types=1);

require_once dirname(__DIR__) . '/src/HubDeployExecutionAuthorityService.php';

function dea_assert(bool $condition, string $message): void
{
    if (!$condition) throw new RuntimeException($message);
}

if (!in_array('sqlite', PDO::getAvailableDrivers(), true)) {
    fwrite(STDOUT, "AWH Deploy Execution Authority: SKIP pdo_sqlite unavailable\n");
    exit(77);
}

$root = rtrim(sys_get_temp_dir(), '/') . '/awh-deploy-authority-' . bin2hex(random_bytes(6));
$project = '113b45c0-23e1-408d-ae0f-ac5eca7f6900';
$owner = 'c5962997-ca8d-4d17-a9db-ebdcfc6d39f2';
$revision = '1943ea53-26f6-41db-a957-8913e4eebada';
$now = '2026-09-15T00:30:00+00:00';

try {
    mkdir($root, 0700, true);
    $pdo = new PDO('sqlite:' . $root . '/awh.sqlite', null, null, [
        PDO::ATTR_ERRMODE=>PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE=>PDO::FETCH_ASSOC,
    ]);
    $pdo->exec('PRAGMA foreign_keys=ON');
    $pdo->exec("CREATE TABLE hub_users(user_id TEXT PRIMARY KEY)");
    $pdo->exec("CREATE TABLE owner_bootstrap(singleton_id INTEGER PRIMARY KEY,owner_user_id TEXT NOT NULL,bootstrap_closed INTEGER NOT NULL)");
    $pdo->exec("CREATE TABLE projects(project_id TEXT PRIMARY KEY,name TEXT NOT NULL,type TEXT NOT NULL)");
    $pdo->exec("CREATE TABLE control_project_vaults(project_id TEXT PRIMARY KEY,active_revision_id TEXT)");
    $pdo->exec("CREATE TABLE control_tasks(
        task_id TEXT PRIMARY KEY,user_id TEXT NOT NULL,project_id TEXT NOT NULL,goal TEXT NOT NULL,
        state TEXT NOT NULL,assigned_device_id TEXT,lease_expires_at TEXT,progress INTEGER NOT NULL,
        result_summary TEXT,failure_code TEXT,idempotency_key TEXT NOT NULL,conversation_id TEXT,
        created_at TEXT NOT NULL,updated_at TEXT NOT NULL,cancelled_at TEXT
    )");
    $pdo->exec("CREATE TABLE control_task_executions(
        execution_id TEXT PRIMARY KEY,task_id TEXT NOT NULL UNIQUE,project_id TEXT NOT NULL,vault_revision_id TEXT,
        executor_kind TEXT NOT NULL,required_capability TEXT NOT NULL,state TEXT NOT NULL,lease_owner TEXT,
        lease_expires_at TEXT,attempt_count INTEGER NOT NULL,cancellation_requested_at TEXT,checkpoint_json TEXT NOT NULL,
        last_error_code TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL
    )");
    $pdo->exec("CREATE TABLE control_execution_envelopes(
        envelope_id TEXT PRIMARY KEY,execution_id TEXT NOT NULL UNIQUE,task_id TEXT NOT NULL,project_id TEXT NOT NULL,
        conversation_id TEXT,base_revision_id TEXT,session_key TEXT NOT NULL,mutation_scope TEXT NOT NULL,state TEXT NOT NULL,
        provider_id TEXT,lease_expires_at TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL
    )");
    $pdo->exec("CREATE TABLE control_capability_sources(source_id TEXT PRIMARY KEY)");
    $pdo->exec("CREATE TABLE control_capability_catalog(capability TEXT PRIMARY KEY,source_id TEXT,category TEXT,display_name TEXT,description TEXT,mutation_kind TEXT,risk_class TEXT,maturity TEXT,user_visible INTEGER,enabled INTEGER,created_at TEXT,updated_at TEXT)");
    $pdo->exec("CREATE TABLE control_execution_providers(provider_id TEXT PRIMARY KEY,provider_kind TEXT,display_name TEXT,availability_mode TEXT,cost_class TEXT,priority INTEGER,enabled INTEGER,observed_at TEXT,expires_at TEXT,metadata_json TEXT)");
    $pdo->exec("CREATE TABLE control_execution_provider_capabilities(provider_id TEXT,capability TEXT,version TEXT,cost_rank INTEGER,quality_rank INTEGER,latency_rank INTEGER,enabled INTEGER,observed_at TEXT,expires_at TEXT,metadata_json TEXT)");
    $pdo->exec("CREATE TABLE control_task_events(
        event_id TEXT PRIMARY KEY,task_id TEXT NOT NULL,state TEXT NOT NULL,progress INTEGER NOT NULL,
        message TEXT,occurred_at TEXT NOT NULL
    )");
    $pdo->prepare("INSERT INTO hub_users(user_id) VALUES(?)")->execute([$owner]);
    $pdo->prepare("INSERT INTO owner_bootstrap(singleton_id,owner_user_id,bootstrap_closed) VALUES(1,?,1)")->execute([$owner]);
    $pdo->prepare("INSERT INTO projects(project_id,name,type) VALUES(?,?,?)")->execute([$project,'Art’s Workspace Hub','node']);
    $pdo->prepare("INSERT INTO control_project_vaults(project_id,active_revision_id) VALUES(?,?)")->execute([$project,$revision]);


    $parentTask = '11111111-1111-4111-8111-111111111111';
    $parentExecution = '22222222-2222-4222-8222-222222222222';
    $parentCheckpoint = json_encode(['schemaVersion'=>1,'mode'=>'CORE_RELEASE','releaseSha'=>str_repeat('a',40),'releaseMode'=>'IDENTITY_CONVERGENCE','cleanupTopology'=>false,'transport'=>'LOCAL'], JSON_THROW_ON_ERROR);
    $pdo->prepare("INSERT INTO control_tasks(task_id,user_id,project_id,goal,state,assigned_device_id,lease_expires_at,progress,result_summary,failure_code,idempotency_key,conversation_id,created_at,updated_at,cancelled_at) VALUES(?,?,?,?, 'WAITING_FOR_WORKER',NULL,NULL,35,NULL,NULL,?,NULL,?,?,NULL)")
        ->execute([$parentTask,$owner,$project,'Core Release parent','core-release-parent',$now,$now]);
    $pdo->prepare("INSERT INTO control_task_executions(execution_id,task_id,project_id,vault_revision_id,executor_kind,required_capability,state,lease_owner,lease_expires_at,attempt_count,cancellation_requested_at,checkpoint_json,last_error_code,created_at,updated_at) VALUES(?,?,?,?,'VPS','system.core.release','RUNNING','vps-core-release','2026-09-15T01:00:00+00:00',1,NULL,?,NULL,?,?)")
        ->execute([$parentExecution,$parentTask,$project,$revision,$parentCheckpoint,$now,$now]);

    $service = new HubDeployExecutionAuthorityService($pdo);
    $borrowed = $service->acquire('m21-aaaaaaaaaaaa', 600, $now);
    dea_assert($borrowed['borrowed'] === true && $borrowed['executionId'] === $parentExecution, 'Core Release authority is borrowed instead of duplicated');
    $revived=$pdo->prepare("SELECT state,lease_expires_at,assigned_device_id FROM control_tasks WHERE task_id=?");$revived->execute([$parentTask]);$revivedRow=$revived->fetch();
    dea_assert($revivedRow['state']==='RUNNING' && is_string($revivedRow['lease_expires_at']) && $revivedRow['assigned_device_id']===null, 'legacy WAITING_FOR_WORKER parent is revived with a bounded VPS lease');
    $verified = $service->verify($parentExecution, 600, '2026-09-15T00:30:10+00:00');
    dea_assert($verified['executionId'] === $parentExecution, 'borrowed authority can be reverified after quiesce');
    $service->release($parentExecution, false, '2026-09-15T00:30:20+00:00');
    $parentState = $pdo->prepare("SELECT e.state AS execution,t.state AS task,x.state AS envelope FROM control_task_executions e JOIN control_tasks t USING(task_id) JOIN control_execution_envelopes x USING(execution_id) WHERE e.execution_id=?");
    $parentState->execute([$parentExecution]);
    $parentRow=$parentState->fetch();
    dea_assert($parentRow['execution']==='RUNNING' && $parentRow['task']==='RUNNING' && $parentRow['envelope']==='ACTIVE', 'guarded deploy release cannot terminate borrowed Core Release authority');
    $pdo->prepare("UPDATE control_task_executions SET state='COMPLETED',lease_owner=NULL,lease_expires_at=NULL WHERE execution_id=?")->execute([$parentExecution]);
    $pdo->prepare("UPDATE control_tasks SET state='COMPLETED',lease_expires_at=NULL WHERE task_id=?")->execute([$parentTask]);
    $service->reconcile('2026-09-15T00:30:30+00:00');

    $first = $service->acquire('m21-aaaaaaaaaaaa', 600, $now);
    dea_assert($first['borrowed'] === false && is_string($first['executionId']) && $first['projectId'] === $project, 'first standalone deploy authority acquired');
    $activeQuery=$pdo->prepare("SELECT state FROM control_execution_envelopes WHERE execution_id=?");
    $activeQuery->execute([$first['executionId']]);
    $active = $activeQuery->fetchColumn();
    dea_assert($active === 'ACTIVE', 'first deploy envelope active');

    try {
        $service->acquire('m21-bbbbbbbbbbbb', 600, $now);
        throw new RuntimeException('second deploy must be blocked');
    } catch (HubDeployExecutionAuthorityException $error) {
        dea_assert($error->codeName === 'DEPLOY_AUTHORITY_CONFLICT', 'live writer blocks second deploy');
    }
    $service->release($first['executionId'], true, '2026-09-15T00:31:00+00:00');
    $row = $pdo->query("SELECT x.state AS envelope,e.state AS execution,t.state AS task
        FROM control_execution_envelopes x JOIN control_task_executions e USING(execution_id)
        JOIN control_tasks t USING(task_id) ORDER BY x.created_at LIMIT 1")->fetch();
    dea_assert($row['envelope']==='RELEASED' && $row['execution']==='COMPLETED' && $row['task']==='COMPLETED', 'success releases all authority states');

    $second = $service->acquire('m21-bbbbbbbbbbbb', 600, '2026-09-15T00:32:00+00:00');
    $pdo->prepare("UPDATE control_task_executions SET state='COMPLETED' WHERE execution_id=?")->execute([$second['executionId']]);
    $reconciled = $service->reconcile('2026-09-15T00:33:00+00:00');
    dea_assert($reconciled['releasedTerminal'] === 1, 'terminal execution envelope is reconciled');
    $state = $pdo->prepare("SELECT state FROM control_execution_envelopes WHERE execution_id=?");
    $state->execute([$second['executionId']]);
    dea_assert($state->fetchColumn()==='RELEASED', 'terminal envelope no longer remains active');

    $third = $service->acquire('m21-cccccccccccc', 300, '2026-09-15T00:34:00+00:00');
    $pdo->prepare("UPDATE control_execution_envelopes SET lease_expires_at=? WHERE execution_id=?")
        ->execute(['2026-09-15T00:33:59+00:00',$third['executionId']]);
    $expired = $service->reconcile('2026-09-15T00:34:30+00:00');
    dea_assert($expired['releasedExpired'] === 1, 'expired authority is demoted to waiting');
    $state->execute([$third['executionId']]);
    dea_assert($state->fetchColumn()==='WAITING', 'expired authority is no longer active');
    $service->release($third['executionId'], false, '2026-09-15T00:35:00+00:00');
    $failed = $pdo->prepare("SELECT e.state AS execution,t.state AS task,x.state AS envelope
        FROM control_task_executions e JOIN control_tasks t USING(task_id)
        JOIN control_execution_envelopes x USING(execution_id) WHERE e.execution_id=?");
    $failed->execute([$third['executionId']]);
    $failedRow = $failed->fetch();
    dea_assert($failedRow['execution']==='FAILED' && $failedRow['task']==='FAILED' && $failedRow['envelope']==='RELEASED', 'failure releases authority and records terminal outcome');

    dea_assert($pdo->query('PRAGMA integrity_check')->fetchColumn()==='ok', 'fixture database integrity');
    fwrite(STDOUT, "AWH Deploy Execution Authority: PASS\n");
} finally {
    if (is_dir($root)) {
        foreach (new RecursiveIteratorIterator(new RecursiveDirectoryIterator($root, FilesystemIterator::SKIP_DOTS), RecursiveIteratorIterator::CHILD_FIRST) as $file) {
            $target=$file->getPathname();
            $file->isDir()&&!$file->isLink()?@rmdir($target):@unlink($target);
        }
        @rmdir($root);
    }
}
