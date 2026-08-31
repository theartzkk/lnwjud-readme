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
require_once dirname(__DIR__) . '/src/HubEnrollmentService.php';
require_once dirname(__DIR__) . '/src/HubControlPlaneService.php';
require_once dirname(__DIR__) . '/src/HubControlPlaneRouter.php';
require_once dirname(__DIR__) . '/src/HubOwnerAuthService.php';

function m9_assert(bool $condition, string $message): void { if (!$condition) throw new RuntimeException($message); }
function m9_json(array $value): string { return json_encode($value, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR); }
function m9_control(HubControlPlaneService $service, string $method, string $uri, array $server, array $payload = [], array $files = []): array { return HubControlPlaneRouter::dispatch($method, $uri, $server, $service, m9_json($payload), $files); }
function m9_cookie(array $response, string $name): string { foreach (($response['headers']['Set-Cookie'] ?? []) as $line) if (str_starts_with($line, $name . '=')) return explode(';', substr($line, strlen($name) + 1), 2)[0]; throw new RuntimeException('missing ' . $name); }
function m9_browser(string $session, string $csrf, string $type = 'application/json'): array { return ['CONTENT_TYPE' => $type, 'HTTP_ORIGIN' => 'https://awh.test', 'HTTP_COOKIE' => '__Host-awh_control_session=' . $session . '; awh_csrf=' . $csrf, 'HTTP_X_AWH_CSRF' => $csrf]; }

if (!in_array('sqlite', PDO::getAvailableDrivers(), true)) { fwrite(STDOUT, "AWH M9 final product: SKIP pdo_sqlite extension unavailable\n"); exit(77); }

$root = sys_get_temp_dir() . '/awh-m9-' . bin2hex(random_bytes(6)); mkdir($root, 0700, true);
$db = $root . '/awh.sqlite'; $attachmentRoot = $root . '/attachments'; mkdir($attachmentRoot, 0750, true); $base = dirname(__DIR__); $now = gmdate('c');
$ownerPassword = 'owner-fixture-' . bin2hex(random_bytes(12)); $collaboratorPassword = 'collaborator-fixture-' . bin2hex(random_bytes(12));
$project = '113b45c0-23e1-408d-ae0f-ac5eca7f6900'; $otherProject = '723b45c0-23e1-408d-ae0f-ac5eca7f6900'; $owner = '223b45c0-23e1-408d-ae0f-ac5eca7f6900'; $device = '423b45c0-23e1-408d-ae0f-ac5eca7f6900';
putenv('AWH_CONTROL_ORIGIN=https://awh.test'); putenv('AWH_ATTACHMENT_ROOT=' . $attachmentRoot);
try {
    $pdo = new PDO('sqlite:' . $db, null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC]);
    $pdo->exec(file_get_contents($base . '/schema.sql'));
    foreach (['enrollment_rate_limits', 'device_project_memberships', 'device_tokens', 'pairing_projects', 'pairing_codes', 'user_project_memberships', 'device_enrollments', 'owner_bootstrap', 'hub_users'] as $table) $pdo->exec('DROP TABLE IF EXISTS ' . $table);
    $pdo->exec("INSERT INTO projects VALUES('$project', 'Final Product Project', 'node', '$now', NULL, '$now', 'm9-test')");
    $pdo->exec("INSERT INTO projects VALUES('$otherProject', 'Private Project', 'node', '$now', NULL, '$now', 'm9-test')");
    m9_assert(HubSchemaMigration::apply($db, $base . '/migrations/001_m3e_enrollment.sql', $now, false, $base . '/schema.sql') === 'applied', 'M3E.1');
    m9_assert(HubEnrollmentApiMigration::apply($db, $base . '/migrations/002_m3e2_enrollment_api.sql', $now) === 'applied', 'M3E.2');
    $enrollment = HubEnrollmentService::openExisting($db); $initial = $enrollment->initializeOwner($owner, 'Art Owner', [$project, $otherProject], $now);
    $enrollment->enrollDevice(['schemaVersion' => 1, 'pairingCode' => $initial['initialPairingCode'], 'deviceId' => $device, 'displayName' => 'Mac', 'platform' => 'darwin', 'arch' => 'arm64', 'appVersion' => '1.0.0'], $now);
    foreach ([[HubControlPlaneMigration::class, '003_m4_control_plane.sql'], [HubOwnerAuthMigration::class, '004_owner_auth.sql'], [HubAssistantWorkstreamMigration::class, '005_assistant_workstream.sql'], [HubWorkspaceContinuityMigration::class, '006_workspace_continuity.sql'], [HubUnifiedWorkspaceMigration::class, '007_unified_workspace.sql']] as [$migration, $sql]) m9_assert($migration::apply($db, $base . '/migrations/' . $sql, $now) === 'applied', $sql);
    m9_assert(HubFinalProductMigration::apply($db, $base . '/migrations/008_final_product.sql', $now) === 'applied', 'M9 migration');
    m9_assert(HubFinalProductMigration::apply($db, $base . '/migrations/008_final_product.sql', $now) === 'already-applied', 'M9 idempotence');
    m9_assert((int) $pdo->query('PRAGMA user_version')->fetchColumn() === 9, 'global version is monotonic');
    m9_assert((int) $pdo->query("SELECT COUNT(*) FROM awh_schema_migrations WHERE migration_id IN ('m3e.1-enrollment','m3e.2-enrollment-api','m4-control-plane','m5-owner-auth','m6-assistant-workstream','m7-workspace-continuity','m8-unified-workspace','m9-final-product')")->fetchColumn() === 8, 'full capability ledger remains');

    $auth = HubOwnerAuthService::openExisting($db); $auth->provisionInitial('art', $ownerPassword, $now); $ownerSession = $auth->login('art', $ownerPassword, true, 'fixture-owner', $now);
    $control = HubControlPlaneService::openExisting($db); $browser = m9_browser($ownerSession['sessionToken'], $ownerSession['csrfToken']);
    $created = m9_control($control, 'POST', '/api/v1/control/conversations/new', $browser, ['schemaVersion' => 2, 'projectId' => $project, 'title' => 'ภาพและเอกสาร']);
    m9_assert($created['status'] === 201, 'owner creates a canonical conversation'); $conversation = json_decode($created['body'], true, 32, JSON_THROW_ON_ERROR)['conversation']['conversationId'];

    $image = $root . '/fixture.png'; file_put_contents($image, base64_decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL0ywAAAABJRU5ErkJggg==', true));
    $document = $root . '/brief.txt'; file_put_contents($document, 'AWH document fixture');
    $secretFixture = $root . '/private.pem'; file_put_contents($secretFixture, 'not a private key');
    $upload = HubControlPlaneRouter::dispatch('POST', '/api/v1/control/conversations/thread/' . $conversation . '/attachments', m9_browser($ownerSession['sessionToken'], $ownerSession['csrfToken'], 'multipart/form-data; boundary=fixture'), $control, '', ['attachments' => ['name' => ["preview.png", 'brief.txt'], 'tmp_name' => [$image, $document], 'error' => [UPLOAD_ERR_OK, UPLOAD_ERR_OK], 'size' => [filesize($image), filesize($document)]]]);
    $uploaded = json_decode($upload['body'], true, 32, JSON_THROW_ON_ERROR);
    m9_assert($upload['status'] === 201 && count($uploaded['attachments'] ?? []) === 2 && !str_contains($upload['body'], $attachmentRoot), 'private image and document uploads return only safe metadata');
    $attachmentId = $uploaded['attachments'][0]['attachmentId']; $documentId = $uploaded['attachments'][1]['attachmentId'];
    $submitted = m9_control($control, 'POST', '/api/v1/control/conversations', $browser, ['schemaVersion' => 3, 'projectId' => $project, 'conversationId' => $conversation, 'message' => 'ภาพนี้เป็นอย่างไร', 'attachmentIds' => [$attachmentId, $documentId], 'idempotencyKey' => 'm9-image-0001']);
    $submittedBody = json_decode($submitted['body'], true, 32, JSON_THROW_ON_ERROR);
    m9_assert($submitted['status'] === 201 && $submittedBody['schemaVersion'] === 3 && count($submittedBody['attachments'] ?? []) === 2 && ($submittedBody['tasks'] ?? []) === [] && count($submittedBody['messages'] ?? []) >= 2 && in_array(($submittedBody['messages'][count($submittedBody['messages']) - 1]['kind'] ?? null), ['assistant', 'failure'], true), 'a visual question binds image and document inputs then returns an inline conversation response without creating a worker task');
    $conversationControl = new ReflectionMethod(HubControlPlaneService::class, 'hasUnsafeConversationControl');
    $conversationText = new ReflectionMethod(HubControlPlaneService::class, 'conversationText');
    m9_assert($conversationControl->invoke(null, "บรรทัดหนึ่ง\nบรรทัดสอง") === false && $conversationControl->invoke(null, "unsafe\0body") === true, 'conversation validator permits normal line breaks while rejecting unsafe control characters');
    m9_assert($conversationText->invoke(null, "บรรทัดหนึ่ง\r\nบรรทัดสอง") === "บรรทัดหนึ่ง\nบรรทัดสอง", 'conversation text normalizes multiline provider output');

    $again = m9_control($control, 'POST', '/api/v1/control/conversations', $browser, ['schemaVersion' => 3, 'projectId' => $project, 'conversationId' => $conversation, 'message' => 'ภาพนี้เป็นอย่างไร', 'attachmentIds' => [$attachmentId, $documentId], 'idempotencyKey' => 'm9-image-0001']);
    m9_assert($again['status'] === 201 && (int) $pdo->query("SELECT COUNT(*) FROM control_conversation_messages WHERE conversation_id = '$conversation' AND idempotency_key = 'm9-image-0001'")->fetchColumn() === 1, 'attachment submit is idempotent');
    $download = m9_control($control, 'GET', '/api/v1/control/attachments/' . $attachmentId . '/download', ['HTTP_COOKIE' => '__Host-awh_control_session=' . $ownerSession['sessionToken'], 'HTTP_SEC_FETCH_SITE' => 'same-origin']);
    m9_assert($download['status'] === 200 && isset($download['streamPath']) && is_file($download['streamPath']) && !str_contains($download['body'], $attachmentRoot), 'attachment download is authorized without exposing a storage path');
    $blockedSecret = HubControlPlaneRouter::dispatch('POST', '/api/v1/control/conversations/thread/' . $conversation . '/attachments', m9_browser($ownerSession['sessionToken'], $ownerSession['csrfToken'], 'multipart/form-data; boundary=fixture'), $control, '', ['attachments' => ['name' => ['private.pem'], 'tmp_name' => [$secretFixture], 'error' => [UPLOAD_ERR_OK], 'size' => [filesize($secretFixture)]]]);
    m9_assert($blockedSecret['status'] === 400 && str_contains($blockedSecret['body'], 'ATTACHMENT_TYPE_FORBIDDEN'), 'private-key-like files are never normal conversation attachments');

    $invitePayload = ['displayName' => 'Collaborator', 'email' => null, 'projectIds' => [$project], 'role' => 'COLLABORATOR', 'username' => 'collaborator'];
    $pdo->prepare('UPDATE control_sessions SET step_up_at = :at WHERE session_hash = :hash')->execute(['at' => gmdate('c', strtotime($now) - 901), 'hash' => hash('sha256', $ownerSession['sessionToken'])]);
    try { $auth->inviteUser($ownerSession['sessionToken'], $ownerSession['csrfToken'], $invitePayload, $now); throw new RuntimeException('stale session invited a user'); } catch (HubOwnerAuthException $error) { m9_assert($error->codeName === 'STEP_UP_REQUIRED', 'stale owner session cannot change people'); }
    $stepUp = $auth->stepUp($ownerSession['sessionToken'], $ownerSession['csrfToken'], $ownerPassword);
    m9_assert(isset($stepUp['stepUpUntil']), 'password confirmation restores a bounded step-up window');
    $invite = $auth->inviteUser($ownerSession['sessionToken'], $ownerSession['csrfToken'], $invitePayload, $now);
    m9_assert(isset($invite['invitationCode']) && !str_contains(json_encode(['id' => $invite['invitationId']], JSON_THROW_ON_ERROR), $invite['invitationCode']), 'invitation code is isolated from normal identifiers');
    $accepted = $auth->acceptInvitation(['schemaVersion' => 1, 'invitationCode' => $invite['invitationCode'], 'password' => $collaboratorPassword], $now, 'fixture-invite');
    $collaborator = $auth->login('collaborator', $collaboratorPassword, false, 'fixture-collaborator', $now); $collabServer = m9_browser($collaborator['sessionToken'], $collaborator['csrfToken']);
    m9_assert(m9_control($control, 'GET', '/api/v1/control/projects', ['HTTP_COOKIE' => '__Host-awh_control_session=' . $collaborator['sessionToken'], 'HTTP_SEC_FETCH_SITE' => 'same-origin'])['status'] === 200, 'collaborator can read its granted project');
    $private = m9_control($control, 'POST', '/api/v1/control/conversations/new', $collabServer, ['schemaVersion' => 2, 'projectId' => $otherProject, 'title' => 'not allowed']);
    m9_assert($private['status'] === 403, 'collaborator cannot access another project');
    $auth->revokeUser($ownerSession['sessionToken'], $ownerSession['csrfToken'], $accepted['userId'], $now);
    try { $auth->login('collaborator', $collaboratorPassword, false, 'fixture-revoked', $now); throw new RuntimeException('revoked collaborator logged in'); } catch (HubOwnerAuthException $error) { m9_assert($error->codeName === 'AUTH_FAILED', 'revoked collaborator fails closed'); }

    $captured = [];
    $fixtureProviderKey = 'sk-' . str_repeat('x', 32);
    $agent = new HubNativeAgentService($pdo, static function (array $payload, string $key) use (&$captured): array { $captured = $payload; m9_assert(str_starts_with($key, 'sk-'), 'provider key stays server side'); return ['output_text' => "ตรวจภาพแล้ว\nพร้อมดำเนินการต่อ", 'usage' => ['input_tokens' => 100, 'output_tokens' => 20, 'input_tokens_details' => ['cached_tokens' => 5]]]; }, $fixtureProviderKey);
    $disabledWithoutBudget = ['enabled' => true, 'modelFast' => 'gpt-5.4-mini', 'modelBalanced' => 'gpt-5.4', 'modelStrong' => 'gpt-5.4', 'monthlyBudgetMicrounits' => 0, 'warningMicrounits' => 0, 'inputMicrounitsPerMillion' => 0, 'outputMicrounitsPerMillion' => 0];
    try { $agent->updatePolicy($owner, $disabledWithoutBudget, $now); throw new RuntimeException('unbounded provider policy was accepted'); } catch (HubNativeAgentException $error) { m9_assert($error->codeName === 'PROVIDER_POLICY_INVALID', 'enabled provider always requires a positive cost budget'); }
    $policy = ['enabled' => true, 'modelFast' => 'gpt-5.4-mini', 'modelBalanced' => 'gpt-5.4', 'modelStrong' => 'gpt-5.4', 'monthlyBudgetMicrounits' => 10000, 'warningMicrounits' => 5000, 'inputMicrounitsPerMillion' => 1000000, 'outputMicrounitsPerMillion' => 1000000];
    $pdo->prepare('UPDATE control_sessions SET step_up_at = :at WHERE session_hash = :hash')->execute(['at' => gmdate('c', strtotime($now) - 901), 'hash' => hash('sha256', $ownerSession['sessionToken'])]);
    try { $control->updateProviderPolicy($ownerSession['sessionToken'], $ownerSession['csrfToken'], $policy, $now); throw new RuntimeException('stale session changed provider policy'); } catch (HubControlPlaneException $error) { m9_assert($error->codeName === 'STEP_UP_REQUIRED', 'stale owner session cannot change AI spend policy'); }
    $auth->stepUp($ownerSession['sessionToken'], $ownerSession['csrfToken'], $ownerPassword);
    m9_assert(($control->updateProviderPolicy($ownerSession['sessionToken'], $ownerSession['csrfToken'], $policy, $now)['provider']['enabled'] ?? false) === true, 'fresh step-up is required for owner AI spend policy');
    $storage = $pdo->query("SELECT storage_key FROM control_conversation_attachments WHERE attachment_id = '$attachmentId'")->fetchColumn();
    $documentStorage = $pdo->query("SELECT storage_key FROM control_conversation_attachments WHERE attachment_id = '$documentId'")->fetchColumn();
    $documentPath = (new HubAttachmentStore($attachmentRoot))->read((string) $documentStorage);
    $referentContext = (new HubConversationReferentService($pdo))->project($owner, $project, $conversation);
    $referentNames = array_map(static fn(array $item): string => (string)$item['name'], $referentContext['recentAttachments']); sort($referentNames);
    m9_assert($referentNames === ['brief.txt','preview.png'] && ($referentContext['latestAttachment'] ?? null) === ($referentContext['recentAttachments'][0] ?? null), 'SecondBrain referent projects the latest authorized attachments without storage paths');
    $nativeContext = ['project' => ['name' => 'Final Product Project', 'sourceRevision' => '0123456789abcdef0123456789abcdef01234567'], 'memoryFiles' => [['name' => 'HANDOFF.md', 'status' => 'present']], 'conversationReferent' => $referentContext];
    $reply = $agent->respond($owner, $project, $conversation, $submittedBody['messages'][0]['messageId'], 'ภาพนี้เป็นอย่างไร', [['role' => 'user', 'body' => 'ภาพนี้เป็นอย่างไร']], [['name' => 'preview.png', 'mimeType' => 'image/png', 'path' => (new HubAttachmentStore($attachmentRoot))->read((string) $storage), 'sizeBytes' => 70], ['name' => 'brief.txt', 'mimeType' => 'text/plain', 'path' => $documentPath, 'sizeBytes' => filesize($documentPath)]], $now, $nativeContext);
    $fileInput = null; foreach (($captured['input'] ?? []) as $input) foreach (($input['content'] ?? []) as $item) if (($item['type'] ?? null) === 'input_file') $fileInput = $item;
    $capturedJson = json_encode($captured, JSON_THROW_ON_ERROR);
    m9_assert($reply['summary'] === "ตรวจภาพแล้ว\nพร้อมดำเนินการต่อ" && ($captured['store'] ?? true) === false && str_contains($capturedJson, 'input_image') && str_contains($capturedJson, 'AWH canonical project context') && str_contains((string)($captured['instructions'] ?? ''), 'conversationReferent') && is_array($fileInput) && ($fileInput['file_data'] ?? null) === base64_encode('AWH document fixture') && !str_contains($capturedJson, $fixtureProviderKey) && !str_contains($capturedJson, $attachmentRoot), 'native provider receives bounded canonical context plus authorized visual and document inputs with referent-aware instructions and no persisted model state, key, or storage path');
    $hardStop = $policy; $hardStop['monthlyBudgetMicrounits'] = 120; $hardStop['warningMicrounits'] = 100;
    $control->updateProviderPolicy($ownerSession['sessionToken'], $ownerSession['csrfToken'], $hardStop, $now);
    try { $agent->respond($owner, $project, $conversation, $submittedBody['messages'][0]['messageId'], 'สถานะ', [], [], $now); throw new RuntimeException('budget was not enforced'); } catch (HubNativeAgentException $error) { m9_assert($error->codeName === 'BUDGET_EXHAUSTED', 'budget hard stop reserves a bounded request before it can exceed the owner limit'); }
    m9_assert((int) $pdo->query("SELECT COUNT(*) FROM control_provider_usage WHERE provider_id = 'openai'")->fetchColumn() >= 2, 'sanitized provider usage is auditable');
    m9_assert($pdo->query('PRAGMA integrity_check')->fetchColumn() === 'ok' && $pdo->query('PRAGMA foreign_key_check')->fetchAll() === [], 'integrity and foreign keys remain clean');
    fwrite(STDOUT, "AWH M9 final product: PASS\n");
} finally {
    putenv('AWH_CONTROL_ORIGIN'); putenv('AWH_ATTACHMENT_ROOT');
    foreach (glob($root . '/attachments/*/*.bin') ?: [] as $file) @unlink($file);
    foreach (glob($root . '/attachments/*') ?: [] as $dir) @rmdir($dir);
    @rmdir($root . '/attachments'); @unlink($db); @unlink($root . '/fixture.png'); @unlink($root . '/brief.txt'); @unlink($root . '/private.pem'); @rmdir($root);
}
