<?php

declare(strict_types=1);

require_once dirname(__DIR__) . '/src/HubSchemaMigration.php';
require_once dirname(__DIR__) . '/src/HubEnrollmentApiMigration.php';
require_once dirname(__DIR__) . '/src/HubControlPlaneMigration.php';
require_once dirname(__DIR__) . '/src/HubOwnerAuthMigration.php';
require_once dirname(__DIR__) . '/src/HubAssistantWorkstreamMigration.php';
require_once dirname(__DIR__) . '/src/HubEnrollmentService.php';
require_once dirname(__DIR__) . '/src/HubControlPlaneService.php';
require_once dirname(__DIR__) . '/src/HubControlPlaneRouter.php';

function m6_assert(bool $condition, string $message): void { if (!$condition) throw new RuntimeException($message); }
function m6_json(array $value): string { return json_encode($value, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR); }
function m6_response(HubControlPlaneService $service, string $method, string $uri, array $server, array $body = []): array { return HubControlPlaneRouter::dispatch($method, $uri, $server, $service, m6_json($body)); }
function m6_cookie(array $response, string $name): string { foreach (($response['headers']['Set-Cookie'] ?? []) as $line) if (str_starts_with($line, $name . '=')) return explode(';', substr($line, strlen($name) + 1), 2)[0]; throw new RuntimeException('missing cookie'); }
function m6_server(array $extra = []): array { return array_merge(['CONTENT_TYPE' => 'application/json', 'HTTP_ORIGIN' => 'https://awh.test'], $extra); }

if (!in_array('sqlite', PDO::getAvailableDrivers(), true)) { fwrite(STDOUT, "AWH M6 assistant workstream: SKIP pdo_sqlite extension unavailable\n"); exit(77); }

$root = sys_get_temp_dir() . '/awh-m6-' . bin2hex(random_bytes(6)); mkdir($root, 0700, true);
$db = $root . '/awh.sqlite'; $base = dirname(__DIR__);
$project = '113b45c0-23e1-408d-ae0f-ac5eca7f6900'; $owner = '223b45c0-23e1-408d-ae0f-ac5eca7f6900'; $mac = '423b45c0-23e1-408d-ae0f-ac5eca7f6900'; $now = gmdate('c');
putenv('AWH_CONTROL_ORIGIN=https://awh.test');
try {
    $pdo = new PDO('sqlite:' . $db, null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC]);
    $pdo->exec(file_get_contents($base . '/schema.sql'));
    foreach (['enrollment_rate_limits', 'device_project_memberships', 'device_tokens', 'pairing_projects', 'pairing_codes', 'user_project_memberships', 'device_enrollments', 'owner_bootstrap', 'hub_users'] as $table) $pdo->exec('DROP TABLE IF EXISTS ' . $table);
    $pdo->exec("INSERT INTO projects VALUES('$project', 'Assistant Project', 'node', '$now', NULL, '$now', 'm6-test')");
    m6_assert(HubSchemaMigration::apply($db, $base . '/migrations/001_m3e_enrollment.sql', $now, false, $base . '/schema.sql') === 'applied', 'M3E.1 migration');
    m6_assert(HubEnrollmentApiMigration::apply($db, $base . '/migrations/002_m3e2_enrollment_api.sql', $now) === 'applied', 'M3E.2 migration');
    $enrollment = HubEnrollmentService::openExisting($db); $initial = $enrollment->initializeOwner($owner, 'Art Owner', [$project], $now);
    $firstWorker = $enrollment->enrollDevice(['schemaVersion' => 1, 'pairingCode' => $initial['initialPairingCode'], 'deviceId' => $mac, 'displayName' => 'Mac Worker', 'platform' => 'darwin', 'arch' => 'arm64', 'appVersion' => '1.0.0'], $now);
    m6_assert(HubControlPlaneMigration::apply($db, $base . '/migrations/003_m4_control_plane.sql', $now) === 'applied', 'M4 migration');
    m6_assert(HubOwnerAuthMigration::apply($db, $base . '/migrations/004_owner_auth.sql', $now) === 'applied', 'M5 migration');
    m6_assert(HubAssistantWorkstreamMigration::apply($db, $base . '/migrations/005_assistant_workstream.sql', $now) === 'applied', 'M6 migration');
    m6_assert(HubAssistantWorkstreamMigration::apply($db, $base . '/migrations/005_assistant_workstream.sql', $now) === 'already-applied', 'M6 migration must be idempotent');
    m6_assert((int) $pdo->query('PRAGMA user_version')->fetchColumn() === 6, 'M6 user version must be monotonic');
    m6_assert((int) $pdo->query("SELECT COUNT(*) FROM awh_schema_migrations WHERE migration_id IN ('m3e.1-enrollment', 'm3e.2-enrollment-api', 'm4-control-plane', 'm5-owner-auth', 'm6-assistant-workstream')")->fetchColumn() === 5, 'migration ledger must preserve prior capabilities');
    m6_assert($pdo->query('PRAGMA integrity_check')->fetchColumn() === 'ok' && $pdo->query('PRAGMA foreign_key_check')->fetchAll() === [], 'M6 database integrity');

    $pairing = $enrollment->issuePairingCode($owner, [$project], $now);
    $control = HubControlPlaneService::openExisting($db);
    $session = m6_response($control, 'POST', '/api/v1/control/session', m6_server(), ['schemaVersion' => 1, 'pairingCode' => $pairing['pairingCode'], 'displayName' => 'iPhone', 'appVersion' => '1.0.0']);
    $sessionDiagnostic = json_decode($session['body'], true, 32, JSON_THROW_ON_ERROR);
    m6_assert($session['status'] === 200, 'control session must open through the browser boundary status=' . (int) $session['status'] . ' code=' . (string) ($sessionDiagnostic['code'] ?? 'none'));
    m6_assert(!preg_match('/pairingCode|accessToken|sessionToken|workspacePath/i', $session['body']), 'control session must stay sanitized');
    $cookie = m6_cookie($session, '__Host-awh_control_session'); $csrf = m6_cookie($session, 'awh_csrf');
    $browser = m6_server(['HTTP_COOKIE' => '__Host-awh_control_session=' . $cookie, 'HTTP_X_AWH_CSRF' => $csrf]);
    $readOnly = m6_response($control, 'POST', '/api/v1/control/conversations', $browser, ['schemaVersion' => 1, 'projectId' => $project, 'message' => 'สรุปสถานะล่าสุด', 'idempotencyKey' => 'm6-summary-0001']);
    $readOnlyBody = json_decode($readOnly['body'], true, 32, JSON_THROW_ON_ERROR);
    m6_assert($readOnly['status'] === 201 && count($readOnlyBody['tasks']) === 0 && count($readOnlyBody['messages']) === 2, 'conversation-only question must not create execution');
    $work = m6_response($control, 'POST', '/api/v1/control/conversations', $browser, ['schemaVersion' => 1, 'projectId' => $project, 'message' => 'ตรวจ source ปัจจุบันอย่างเดียว ห้ามแก้', 'idempotencyKey' => 'm6-work-0001']);
    $workBody = json_decode($work['body'], true, 32, JSON_THROW_ON_ERROR);
    m6_assert($work['status'] === 201 && count($workBody['tasks']) === 1 && $workBody['tasks'][0]['state'] === 'WAITING_FOR_WORKER', 'work message must create one truthful canonical task');
    $taskId = $workBody['tasks'][0]['taskId']; $conversationId = $workBody['conversation']['conversationId'];
    $duplicate = m6_response($control, 'POST', '/api/v1/control/conversations', $browser, ['schemaVersion' => 1, 'projectId' => $project, 'message' => 'this must not create another task', 'idempotencyKey' => 'm6-work-0001']);
    $duplicateBody = json_decode($duplicate['body'], true, 32, JSON_THROW_ON_ERROR);
    m6_assert($duplicate['status'] === 201 && count($duplicateBody['tasks']) === 1 && $duplicateBody['tasks'][0]['taskId'] === $taskId, 'double submit must retain one logical task');

    $workerPair = $enrollment->issuePairingCode($owner, [$project], $now);
    $worker = $enrollment->enrollDevice(['schemaVersion' => 1, 'pairingCode' => $workerPair['pairingCode'], 'deviceId' => '523b45c0-23e1-408d-ae0f-ac5eca7f6900', 'displayName' => 'Second Mac', 'platform' => 'darwin', 'arch' => 'arm64', 'appVersion' => '1.0.0'], $now);
    $workerId = '523b45c0-23e1-408d-ae0f-ac5eca7f6900'; $auth = ['HTTP_AUTHORIZATION' => 'Bearer ' . $worker['accessToken'], 'CONTENT_TYPE' => 'application/json'];
    m6_assert(m6_response($control, 'POST', '/api/v1/control/workers/heartbeat', $auth, ['schemaVersion' => 1, 'deviceId' => $workerId, 'state' => 'READY', 'capabilities' => ['project:context', 'qa:bounded']])['status'] === 200, 'worker heartbeat');
    $workerConversationBefore = json_decode(m6_response($control, 'GET', '/api/v1/control/worker/conversations/' . $workerId . '/' . $project, $auth)['body'], true, 32, JSON_THROW_ON_ERROR);
    $workerConversation = m6_response($control, 'POST', '/api/v1/control/worker/conversations', $auth, ['schemaVersion' => 1, 'deviceId' => $workerId, 'projectId' => $project, 'message' => 'สรุปสถานะล่าสุด', 'idempotencyKey' => 'm6-worker-chat-0001']);
    $workerConversationBody = json_decode($workerConversation['body'], true, 32, JSON_THROW_ON_ERROR);
    m6_assert($workerConversation['status'] === 201 && count($workerConversationBody['tasks']) === count($workerConversationBefore['tasks']) && count($workerConversationBody['messages']) === count($workerConversationBefore['messages']) + 2, 'worker conversation submit must accept the authenticated device envelope without leaking deviceId into the user schema status=' . (int) $workerConversation['status'] . ' code=' . (string) ($workerConversationBody['code'] ?? 'none') . ' tasks=' . count($workerConversationBody['tasks'] ?? []) . ' messages=' . count($workerConversationBody['messages'] ?? []));
    $claim = m6_response($control, 'POST', '/api/v1/control/workers/claim', $auth, ['schemaVersion' => 1, 'deviceId' => $workerId]); $claimBody = json_decode($claim['body'], true, 32, JSON_THROW_ON_ERROR);
    m6_assert($claim['status'] === 200 && ($claimBody['task']['taskId'] ?? null) === $taskId && ($claimBody['task']['conversationId'] ?? null) === $conversationId, 'worker must claim the conversation-bound task');
    $reclaim = m6_response($control, 'POST', '/api/v1/control/workers/claim', $auth, ['schemaVersion' => 1, 'deviceId' => $workerId]);
    m6_assert(json_decode($reclaim['body'], true, 32, JSON_THROW_ON_ERROR)['task']['taskId'] === $taskId, 'worker restart claim must resume the same leased task');
    $pdo->prepare("UPDATE control_tasks SET lease_expires_at = '2000-01-01T00:00:00Z' WHERE task_id = :task")->execute(['task' => $taskId]);
    $firstAuth = ['HTTP_AUTHORIZATION' => 'Bearer ' . $firstWorker['accessToken'], 'CONTENT_TYPE' => 'application/json'];
    m6_assert(m6_response($control, 'POST', '/api/v1/control/workers/heartbeat', $firstAuth, ['schemaVersion' => 1, 'deviceId' => $mac, 'state' => 'READY', 'capabilities' => ['project:context', 'qa:bounded']])['status'] === 200, 'recovery worker heartbeat');
    $recovered = m6_response($control, 'POST', '/api/v1/control/workers/claim', $firstAuth, ['schemaVersion' => 1, 'deviceId' => $mac]);
    m6_assert(json_decode($recovered['body'], true, 32, JSON_THROW_ON_ERROR)['task']['taskId'] === $taskId, 'expired lease must be requeued to one compatible worker without a duplicate task');
    m6_assert(m6_response($control, 'POST', '/api/v1/control/tasks/' . $taskId . '/artifact', $firstAuth, ['schemaVersion' => 1, 'deviceId' => $mac, 'kind' => 'qa-report', 'name' => 'source-review.json', 'relativeRef' => 'artifacts/source-review.json', 'sha256' => str_repeat('a', 64), 'sizeBytes' => 42])['status'] === 201, 'artifact attach');
    m6_assert(m6_response($control, 'POST', '/api/v1/control/tasks/' . $taskId . '/update', $firstAuth, ['schemaVersion' => 1, 'deviceId' => $mac, 'state' => 'COMPLETED', 'progress' => 100, 'message' => 'ตรวจ source และ QA เสร็จแล้ว', 'resultSummary' => 'ไม่พบการแก้ไข source'])['status'] === 200, 'worker completion');
    $thread = m6_response($control, 'GET', '/api/v1/control/conversations/' . $project, ['HTTP_COOKIE' => '__Host-awh_control_session=' . $cookie, 'HTTP_SEC_FETCH_SITE' => 'same-origin']); $threadBody = json_decode($thread['body'], true, 32, JSON_THROW_ON_ERROR);
    m6_assert($thread['status'] === 200 && ($threadBody['messages'][count($threadBody['messages']) - 1]['kind'] ?? null) === 'result' && count($threadBody['artifacts']) === 1, 'browser sees the same ordered result and artifact');
    $sequence = (int) $pdo->query("SELECT COALESCE(MAX(sequence_no), 0) + 1 FROM control_conversation_messages WHERE conversation_id = '$conversationId'")->fetchColumn();
    $filler = $pdo->prepare('INSERT INTO control_conversation_messages(message_id, conversation_id, task_id, message_kind, sequence_no, body, idempotency_key, source_event_id, metadata_json, created_at) VALUES(:id, :conversation, NULL, \'PROGRESS\', :sequence, :body, NULL, NULL, NULL, :at)');
    for ($i = 0; $i < 120; $i++) {
        $hex = bin2hex(random_bytes(16)); $messageId = substr($hex, 0, 8) . '-' . substr($hex, 8, 4) . '-4' . substr($hex, 13, 3) . '-8' . substr($hex, 17, 3) . '-' . substr($hex, 20, 12);
        $filler->execute(['id' => $messageId, 'conversation' => $conversationId, 'sequence' => $sequence++, 'body' => str_repeat('x', 780), 'at' => $now]);
    }
    $workerThread = m6_response($control, 'GET', '/api/v1/control/worker/conversations/' . $mac . '/' . $project, ['HTTP_AUTHORIZATION' => 'Bearer ' . $firstWorker['accessToken']]);
    m6_assert($workerThread['status'] === 200 && strlen($workerThread['body']) <= 64 * 1024 && str_contains($workerThread['body'], $taskId), 'worker conversation remains bounded after history grows');
    $workerThreadResubmitted = m6_response($control, 'POST', '/api/v1/control/worker/conversations', $firstAuth, ['schemaVersion' => 1, 'deviceId' => $mac, 'projectId' => $project, 'message' => 'สรุปสถานะล่าสุด', 'idempotencyKey' => 'm6-worker-chat-0001']);
    m6_assert($workerThreadResubmitted['status'] === 201 && strlen($workerThreadResubmitted['body']) <= 64 * 1024, 'worker conversation submit remains bounded after history grows');
    $followUp = m6_response($control, 'POST', '/api/v1/control/conversations', $browser, ['schemaVersion' => 1, 'projectId' => $project, 'message' => 'ทำต่อ', 'idempotencyKey' => 'm6-follow-up-0001']);
    $followUpBody = json_decode($followUp['body'], true, 32, JSON_THROW_ON_ERROR);
    $followUpTask = []; foreach ($followUpBody['tasks'] as $candidate) if (($candidate['taskId'] ?? null) === ($followUpBody['conversation']['lastTaskId'] ?? null)) { $followUpTask = $candidate; break; }
    m6_assert($followUp['status'] === 201 && str_contains((string) ($followUpTask['goal'] ?? ''), 'ต่อเนื่องจากงานล่าสุด') && str_contains((string) ($followUpTask['goal'] ?? ''), 'ตรวจ source ปัจจุบันอย่างเดียว ห้ามแก้'), 'follow-up must retain prior canonical context without a second project authority');
    $cancel = m6_response($control, 'POST', '/api/v1/control/tasks/' . $followUpTask['taskId'] . '/cancel', $browser, ['schemaVersion' => 1]);
    m6_assert($cancel['status'] === 200 && json_decode($cancel['body'], true, 32, JSON_THROW_ON_ERROR)['state'] === 'CANCELLED', 'an unclaimed work request must be cancellable without terminating a worker process');
    $afterCancel = m6_response($control, 'GET', '/api/v1/control/conversations/' . $project, ['HTTP_COOKIE' => '__Host-awh_control_session=' . $cookie, 'HTTP_SEC_FETCH_SITE' => 'same-origin']);
    m6_assert(str_contains($afterCancel['body'], 'ยกเลิกงานนี้แล้ว'), 'cancellation must remain in the same durable conversation');
    m6_assert((int) $pdo->query('SELECT COUNT(*) FROM control_conversations')->fetchColumn() === 1 && (int) $pdo->query('SELECT COUNT(*) FROM control_conversation_messages WHERE idempotency_key = "m6-work-0001"')->fetchColumn() === 1, 'one project work stream with durable ordering');
    m6_assert($pdo->query('PRAGMA foreign_key_check')->fetchAll() === [], 'conversation foreign keys');
    fwrite(STDOUT, "AWH M6 assistant workstream: PASS\n");
} finally { putenv('AWH_CONTROL_ORIGIN'); @unlink($db); @rmdir($root); }
