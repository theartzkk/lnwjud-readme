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
require_once dirname(__DIR__) . '/src/HubEnrollmentService.php';
require_once dirname(__DIR__) . '/src/HubOwnerAuthService.php';
require_once dirname(__DIR__) . '/src/HubOwnerAuthRouter.php';
require_once dirname(__DIR__) . '/src/HubControlPlaneService.php';
require_once dirname(__DIR__) . '/src/HubControlPlaneRouter.php';
require_once dirname(__DIR__) . '/src/HubFoundingMemoryService.php';
require_once dirname(__DIR__) . '/src/HubNativeAgentService.php';
require_once dirname(__DIR__) . '/src/HubProviderCredentialStore.php';

function m11_assert(bool $condition, string $message): void { if (!$condition) throw new RuntimeException($message); }
function m11_json(array $value): string { return json_encode($value, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR); }
function m11_body(array $response): array { return json_decode((string) $response['body'], true, 32, JSON_THROW_ON_ERROR); }
function m11_browser(string $session, string $csrf): array { return ['CONTENT_TYPE' => 'application/json', 'HTTP_ORIGIN' => 'https://awh.test', 'HTTP_COOKIE' => '__Host-awh_control_session=' . $session . '; awh_csrf=' . $csrf, 'HTTP_X_AWH_CSRF' => $csrf]; }
function m11_read_browser(string $session): array { return ['HTTP_COOKIE' => '__Host-awh_control_session=' . $session, 'HTTP_SEC_FETCH_SITE' => 'same-origin']; }
function m11_control(HubControlPlaneService $service, string $method, string $uri, array $server, array $payload = []): array { return HubControlPlaneRouter::dispatch($method, $uri, $server, $service, m11_json($payload)); }
function m11_auth(HubOwnerAuthService $service, string $method, string $uri, array $server, array $payload = []): array { return HubOwnerAuthRouter::dispatch($method, $uri, $server, $service, m11_json($payload)); }

if (!in_array('sqlite', PDO::getAvailableDrivers(), true)) { fwrite(STDOUT, "AWH M11 Self Service: SKIP pdo_sqlite extension unavailable\n"); exit(77); }

$root = sys_get_temp_dir() . '/awh-m11-' . bin2hex(random_bytes(6));
mkdir($root, 0700, true);
$db = $root . '/awh.sqlite'; $attachments = $root . '/attachments'; $credentials = $root . '/provider-credentials';
mkdir($attachments, 0750, true);
$base = dirname(__DIR__); $now = gmdate('c');
$owner = '223b45c0-23e1-408d-ae0f-ac5eca7f6900'; $device = '423b45c0-23e1-408d-ae0f-ac5eca7f6900'; $otherDevice = '523b45c0-23e1-408d-ae0f-ac5eca7f6900';
$project = '113b45c0-23e1-408d-ae0f-ac5eca7f6900'; $otherProject = '723b45c0-23e1-408d-ae0f-ac5eca7f6900';
$ownerPassword = 'owner-fixture-' . bin2hex(random_bytes(12)); $collaboratorPassword = 'collaborator-fixture-' . bin2hex(random_bytes(12));
putenv('AWH_CONTROL_ORIGIN=https://awh.test'); putenv('AWH_ATTACHMENT_ROOT=' . $attachments); putenv('AWH_PROVIDER_CREDENTIAL_ROOT=' . $credentials);

try {
    $pdo = new PDO('sqlite:' . $db, null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC]); $pdo->exec('PRAGMA foreign_keys = ON'); $pdo->exec(file_get_contents($base . '/schema.sql'));
    foreach (['enrollment_rate_limits', 'device_project_memberships', 'device_tokens', 'pairing_projects', 'pairing_codes', 'user_project_memberships', 'device_enrollments', 'owner_bootstrap', 'hub_users'] as $table) $pdo->exec('DROP TABLE IF EXISTS ' . $table);
    $pdo->exec("INSERT INTO projects VALUES('$project', 'Fixture Project', 'php', '$now', NULL, '$now', 'm11-fixture')");
    $pdo->exec("INSERT INTO projects VALUES('$otherProject', 'Private Project', 'node', '$now', NULL, '$now', 'm11-fixture')");
    m11_assert(HubSchemaMigration::apply($db, $base . '/migrations/001_m3e_enrollment.sql', $now, false, $base . '/schema.sql') === 'applied', 'M3E migration');
    m11_assert(HubEnrollmentApiMigration::apply($db, $base . '/migrations/002_m3e2_enrollment_api.sql', $now) === 'applied', 'M3E.2 migration');
    $enrollment = HubEnrollmentService::openExisting($db); $initial = $enrollment->initializeOwner($owner, 'Art Owner', [$project, $otherProject], $now);
    $enrollment->enrollDevice(['schemaVersion' => 1, 'pairingCode' => $initial['initialPairingCode'], 'deviceId' => $device, 'displayName' => 'Owner Mac', 'platform' => 'darwin', 'arch' => 'arm64', 'appVersion' => '1.0.0'], $now);
    foreach ([[HubControlPlaneMigration::class, '003_m4_control_plane.sql'], [HubOwnerAuthMigration::class, '004_owner_auth.sql'], [HubAssistantWorkstreamMigration::class, '005_assistant_workstream.sql'], [HubWorkspaceContinuityMigration::class, '006_workspace_continuity.sql'], [HubUnifiedWorkspaceMigration::class, '007_unified_workspace.sql']] as [$migration, $sql]) m11_assert($migration::apply($db, $base . '/migrations/' . $sql, $now) === 'applied', $sql);
    m11_assert(HubFinalProductMigration::apply($db, $base . '/migrations/008_final_product.sql', $now) === 'applied', 'M9 migration');
    m11_assert(HubFoundingMemoryMigration::apply($db, $base . '/migrations/009_founding_memory.sql', $now) === 'applied', 'M10 migration');
    m11_assert(HubFoundingMemoryMigration::importDefaultSeed($db, $now)['status'] === 'imported', 'M10 seed');
    m11_assert(HubSelfServiceMigration::apply($db, $base . '/migrations/010_self_service.sql', $now) === 'applied', 'M11 migration');
    m11_assert(HubSelfServiceMigration::apply($db, $base . '/migrations/010_self_service.sql', $now) === 'already-applied', 'M11 idempotent migration');
    m11_assert((int) $pdo->query('PRAGMA user_version')->fetchColumn() === 11, 'M11 monotonic schema version');
    m11_assert((int) $pdo->query("SELECT COUNT(*) FROM awh_schema_migrations WHERE migration_id IN ('m3e.1-enrollment','m3e.2-enrollment-api','m4-control-plane','m5-owner-auth','m6-assistant-workstream','m7-workspace-continuity','m8-unified-workspace','m9-final-product','m10-founding-memory','m11-self-service')")->fetchColumn() === 10, 'all canonical migration ledgers retained');

    $auth = HubOwnerAuthService::openExisting($db); $auth->provisionInitial('art', $ownerPassword, $now); $ownerSession = $auth->login('art', $ownerPassword, true, 'm11-owner', $now); $browser = m11_browser($ownerSession['sessionToken'], $ownerSession['csrfToken']);
    $control = HubControlPlaneService::openExisting($db);
    $profile = m11_body(m11_auth($auth, 'GET', '/api/v1/auth/profile', m11_read_browser($ownerSession['sessionToken'])));
    m11_assert(($profile['displayName'] ?? null) === 'Art Owner', 'owner profile uses existing canonical identity');
    $updatedProfile = m11_body(m11_auth($auth, 'POST', '/api/v1/auth/profile', $browser, ['schemaVersion' => 1, 'displayName' => 'Art']));
    m11_assert(($updatedProfile['displayName'] ?? null) === 'Art' && (string) $pdo->query("SELECT display_name FROM hub_users WHERE user_id = '$owner'")->fetchColumn() === 'Art', 'profile edit updates existing owner only');

    $identity = m11_body(m11_control($control, 'GET', '/api/v1/control/product-identity', m11_read_browser($ownerSession['sessionToken'])));
    m11_assert(($identity['identity']['founderName'] ?? null) === 'Art' && str_contains((string) ($identity['identity']['founderCredit'] ?? ''), 'Founder'), 'canonical product founder identity is retrievable');
    m11_assert(m11_control($control, 'POST', '/api/v1/control/settings', $browser, ['schemaVersion' => 2, 'settingKey' => 'founderName', 'value' => 'Founder Fixture'])['status'] === 200, 'founder metadata is revisioned product configuration');
    $productConversation = m11_body(m11_control($control, 'POST', '/api/v1/control/conversations/new', $browser, ['schemaVersion' => 2, 'projectId' => $project, 'title' => 'Product identity']))['conversation']['conversationId'];
    $answer = m11_control($control, 'POST', '/api/v1/control/conversations', $browser, ['schemaVersion' => 3, 'projectId' => $project, 'conversationId' => $productConversation, 'message' => 'ใครคิดระบบนี้ขึ้นมา?', 'attachmentIds' => [], 'idempotencyKey' => 'm11-founder-0001']);
    m11_assert($answer['status'] === 201 && str_contains($answer['body'], 'Founder Fixture'), 'founder answer derives from canonical metadata, not a UI literal');

    $memory = m11_body(m11_control($control, 'POST', '/api/v1/control/memory/create', $browser, ['schemaVersion' => 1, 'scope' => 'owner', 'projectId' => null, 'category' => 'WORKING_PREFERENCE', 'content' => 'ตอบแบบกระชับและยืนยัน Source of Truth ก่อนแก้', 'tags' => ['preference']]));
    $memoryId = $memory['memory']['memoryId'] ?? null; m11_assert(is_string($memoryId), 'owner preference is created in canonical M10 memory');
    $changed = m11_control($control, 'POST', '/api/v1/control/memory', $browser, ['schemaVersion' => 1, 'memoryId' => $memoryId, 'action' => 'EDIT', 'content' => 'ตอบแบบกระชับและตรวจ Source of Truth ล่าสุดก่อนแก้', 'tags' => ['preference'], 'sharingPolicy' => null, 'pinned' => null]);
    m11_assert($changed['status'] === 200, 'owner can correct memory through the M10 authority');
    $memoryService = new HubFoundingMemoryService($pdo); $context = $memoryService->promptContext($owner, true, $project, 'ช่วยทำต่อ');
    m11_assert(str_contains(json_encode($context, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR), 'Source of Truth ล่าสุด'), 'working preference is retrieved for a new follow-up context');
    $sensitive = m11_control($control, 'POST', '/api/v1/control/memory/create', $browser, ['schemaVersion' => 1, 'scope' => 'owner', 'projectId' => null, 'category' => 'OWNER_PROFILE', 'content' => 'pass' . 'word: fixture-only', 'tags' => []]);
    m11_assert($sensitive['status'] === 400 && str_contains($sensitive['body'], 'MEMORY_SENSITIVE_EXCLUDED'), 'sensitive data is rejected from ordinary memory');

    $auth->stepUp($ownerSession['sessionToken'], $ownerSession['csrfToken'], $ownerPassword);
    $providerKey = 's' . 'k-' . str_repeat('a', 32);
    $credentialSet = m11_control($control, 'POST', '/api/v1/control/provider/credential', $browser, ['schemaVersion' => 1, 'action' => 'SET', 'secret' => $providerKey]);
    m11_assert($credentialSet['status'] === 200, 'provider credential save returns its sanitized success contract');
    m11_assert(!str_contains($credentialSet['body'], $providerKey), 'provider secret is write-only in the HTTP response');
    m11_assert((int) $pdo->query("SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'control_provider_credentials'")->fetchColumn() === 1 && (int) $pdo->query("SELECT COUNT(*) FROM control_provider_credentials WHERE configured = 1")->fetchColumn() === 1, 'only credential metadata is stored in SQLite');
    m11_assert((int) $pdo->query('SELECT COUNT(*) FROM control_provider_credentials WHERE provider_id = \'openai\'')->fetchColumn() === 1 && !str_contains((string) file_get_contents($db), $providerKey), 'credential plaintext is absent from the database');
    $credentialFile = $credentials . '/openai.key'; m11_assert(is_file($credentialFile) && !is_link($credentialFile) && ((fileperms($credentialFile) & 0777) === 0600), 'credential file is server-side and mode 0600');
    $fakeAgent = new HubNativeAgentService($pdo, static fn (array $_payload, string $_key): array => ['data' => []], null, new HubProviderCredentialStore($credentials));
    m11_assert($fakeAgent->testConnection($owner, $now)['status'] === 'PASS', 'provider connection boundary supports an injected deterministic transport');
    $routing = m11_body(m11_control($control, 'POST', '/api/v1/control/provider/project', $browser, ['schemaVersion' => 1, 'projectId' => $project, 'routingMode' => 'FAST']));
    m11_assert(($routing['routing']['routingMode'] ?? null) === 'FAST', 'owner can configure bounded project provider routing');
    $auto = m11_body(m11_control($control, 'POST', '/api/v1/control/provider/project', $browser, ['schemaVersion' => 1, 'projectId' => $project, 'routingMode' => 'AUTO']));
    m11_assert(($auto['routing']['routingMode'] ?? null) === 'AUTO' && ($auto['routing']['overridden'] ?? true) === false, 'project can return to global Auto routing');

    $invite = $auth->inviteUser($ownerSession['sessionToken'], $ownerSession['csrfToken'], ['displayName' => 'Collaborator', 'email' => null, 'projectIds' => [$project], 'role' => 'COLLABORATOR', 'username' => 'm11-collaborator'], $now);
    $auth->acceptInvitation(['schemaVersion' => 1, 'invitationCode' => $invite['invitationCode'], 'password' => $collaboratorPassword], $now, 'm11-invite'); $collaborator = $auth->login('m11-collaborator', $collaboratorPassword, false, 'm11-collaborator', $now);
    $collabRead = m11_read_browser($collaborator['sessionToken']); $collabWrite = m11_browser($collaborator['sessionToken'], $collaborator['csrfToken']);
    m11_assert(m11_control($control, 'GET', '/api/v1/control/memory?scope=owner', $collabRead)['status'] === 403, 'collaborator cannot read owner-private memory');
    m11_assert(m11_control($control, 'POST', '/api/v1/control/memory/create', $collabWrite, ['schemaVersion' => 1, 'scope' => 'owner', 'projectId' => null, 'category' => 'WORKING_PREFERENCE', 'content' => 'not allowed', 'tags' => []])['status'] === 403, 'collaborator cannot create owner memory');
    m11_assert(m11_control($control, 'GET', '/api/v1/control/provider', $collabRead)['status'] === 403, 'collaborator cannot read provider/budget state');
    m11_assert(m11_control($control, 'POST', '/api/v1/control/provider/credential', $collabWrite, ['schemaVersion' => 1, 'action' => 'REMOVE', 'secret' => null])['status'] === 403, 'collaborator cannot modify provider credentials');
    m11_assert(m11_control($control, 'GET', '/api/v1/control/settings', $collabRead)['status'] === 200, 'collaborator can read shared product presentation metadata');
    m11_assert(m11_control($control, 'POST', '/api/v1/control/settings', $collabWrite, ['schemaVersion' => 2, 'settingKey' => 'tagline', 'value' => 'not allowed'])['status'] === 403, 'collaborator cannot modify product metadata');
    $pdo->prepare('INSERT INTO devices(device_id, display_name, platform, arch, app_version, last_seen_at, revoked_at) VALUES(:id, :name, :platform, :arch, :version, :seen, NULL)')->execute(['id' => $otherDevice, 'name' => 'Private Worker', 'platform' => 'win32', 'arch' => 'x64', 'version' => '1', 'seen' => $now]);
    $pdo->prepare("INSERT INTO device_project_memberships(device_id, project_id, role, created_at, revoked_at) VALUES(:device, :project, 'owner', :at, NULL)")->execute(['device' => $otherDevice, 'project' => $otherProject, 'at' => $now]);
    $pdo->prepare("INSERT INTO control_workers(device_id, state, capabilities_json, last_seen_at, busy_task_id) VALUES(:device, 'READY', '[\"git\"]', :at, NULL)")->execute(['device' => $otherDevice, 'at' => $now]);
    $workers = m11_body(m11_control($control, 'GET', '/api/v1/control/workers', $collabRead));
    m11_assert(!str_contains(json_encode($workers, JSON_THROW_ON_ERROR), $otherDevice), 'worker list excludes devices that have only unrelated project bindings');

    $ownerStatus = m11_body(m11_control($control, 'GET', '/api/v1/control/owner/status', m11_read_browser($ownerSession['sessionToken'])));
    m11_assert(($ownerStatus['database']['state'] ?? null) === 'HEALTHY' && ($ownerStatus['export']['secretsIncluded'] ?? true) === false && ($ownerStatus['backup']['state'] ?? null) === 'DEPLOYMENT_MANAGED', 'owner self-service status is high-level, healthy and secret-free');
    $export = m11_body(m11_control($control, 'GET', '/api/v1/control/export', $collabRead));
    m11_assert(($export['security']['ownerPrivateMemoryIncluded'] ?? true) === false && !isset($export['memory']), 'collaborator export excludes owner-private memory');
    m11_assert($pdo->query('PRAGMA integrity_check')->fetchColumn() === 'ok' && $pdo->query('PRAGMA foreign_key_check')->fetchAll() === [], 'M11 preserves integrity and foreign keys');
    fwrite(STDOUT, "AWH M11 Self Service: PASS\n");
} finally {
    putenv('AWH_PROVIDER_CREDENTIAL_ROOT'); putenv('AWH_ATTACHMENT_ROOT');
}
