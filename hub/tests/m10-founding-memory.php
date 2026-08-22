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
require_once dirname(__DIR__) . '/src/HubEnrollmentService.php';
require_once dirname(__DIR__) . '/src/HubControlPlaneService.php';
require_once dirname(__DIR__) . '/src/HubControlPlaneRouter.php';
require_once dirname(__DIR__) . '/src/HubOwnerAuthService.php';

function m10_assert(bool $condition, string $message): void { if (!$condition) throw new RuntimeException($message); }
function m10_json(array $value): string { return json_encode($value, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR); }
function m10_control(HubControlPlaneService $service, string $method, string $uri, array $server, array $payload = []): array { return HubControlPlaneRouter::dispatch($method, $uri, $server, $service, m10_json($payload)); }
function m10_browser(string $session, string $csrf): array { return ['CONTENT_TYPE' => 'application/json', 'HTTP_ORIGIN' => 'https://awh.test', 'HTTP_COOKIE' => '__Host-awh_control_session=' . $session . '; awh_csrf=' . $csrf, 'HTTP_X_AWH_CSRF' => $csrf]; }
function m10_read_browser(string $session): array { return ['HTTP_COOKIE' => '__Host-awh_control_session=' . $session, 'HTTP_SEC_FETCH_SITE' => 'same-origin']; }
function m10_body(array $response): array { return json_decode((string) $response['body'], true, 32, JSON_THROW_ON_ERROR); }
function m10_memory(array $body, string $stableKey): array { foreach (($body['memories'] ?? []) as $memory) if (($memory['stableKey'] ?? null) === $stableKey) return $memory; throw new RuntimeException('missing founding memory ' . $stableKey); }

if (!in_array('sqlite', PDO::getAvailableDrivers(), true)) { fwrite(STDOUT, "AWH M10 Founding Memory: SKIP pdo_sqlite extension unavailable\n"); exit(77); }

$root = sys_get_temp_dir() . '/awh-m10-' . bin2hex(random_bytes(6));
mkdir($root, 0700, true);
$db = $root . '/awh.sqlite';
$attachments = $root . '/attachments';
mkdir($attachments, 0750, true);
$base = dirname(__DIR__);
$now = gmdate('c');
$newer = gmdate('c', strtotime($now) + 60);
$owner = '223b45c0-23e1-408d-ae0f-ac5eca7f6900';
$device = '423b45c0-23e1-408d-ae0f-ac5eca7f6900';
$project = '113b45c0-23e1-408d-ae0f-ac5eca7f6900';
$otherProject = '723b45c0-23e1-408d-ae0f-ac5eca7f6900';
$ownerPassword = 'owner-fixture-' . bin2hex(random_bytes(12));
$collaboratorPassword = 'collaborator-fixture-' . bin2hex(random_bytes(12));
putenv('AWH_CONTROL_ORIGIN=https://awh.test');
putenv('AWH_ATTACHMENT_ROOT=' . $attachments);

try {
    $pdo = new PDO('sqlite:' . $db, null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC]);
    $pdo->exec('PRAGMA foreign_keys = ON');
    $pdo->exec(file_get_contents($base . '/schema.sql'));
    foreach (['enrollment_rate_limits', 'device_project_memberships', 'device_tokens', 'pairing_projects', 'pairing_codes', 'user_project_memberships', 'device_enrollments', 'owner_bootstrap', 'hub_users'] as $table) $pdo->exec('DROP TABLE IF EXISTS ' . $table);
    $pdo->exec("INSERT INTO projects VALUES('$project', 'BAY EXCUSE X', 'php', '$now', NULL, '$now', 'm10-fixture')");
    $pdo->exec("INSERT INTO projects VALUES('$otherProject', 'Unrelated Project', 'node', '$now', NULL, '$now', 'm10-fixture')");

    m10_assert(HubSchemaMigration::apply($db, $base . '/migrations/001_m3e_enrollment.sql', $now, false, $base . '/schema.sql') === 'applied', 'M3E.1 migration');
    m10_assert(HubEnrollmentApiMigration::apply($db, $base . '/migrations/002_m3e2_enrollment_api.sql', $now) === 'applied', 'M3E.2 migration');
    $enrollment = HubEnrollmentService::openExisting($db);
    $initial = $enrollment->initializeOwner($owner, 'Art Owner', [$project, $otherProject], $now);
    $enrollment->enrollDevice(['schemaVersion' => 1, 'pairingCode' => $initial['initialPairingCode'], 'deviceId' => $device, 'displayName' => 'Mac', 'platform' => 'darwin', 'arch' => 'arm64', 'appVersion' => '1.0.0'], $now);
    foreach ([[HubControlPlaneMigration::class, '003_m4_control_plane.sql'], [HubOwnerAuthMigration::class, '004_owner_auth.sql'], [HubAssistantWorkstreamMigration::class, '005_assistant_workstream.sql'], [HubWorkspaceContinuityMigration::class, '006_workspace_continuity.sql'], [HubUnifiedWorkspaceMigration::class, '007_unified_workspace.sql']] as [$migration, $sql]) m10_assert($migration::apply($db, $base . '/migrations/' . $sql, $now) === 'applied', $sql);
    m10_assert(HubFinalProductMigration::apply($db, $base . '/migrations/008_final_product.sql', $now) === 'applied', 'M9 migration');
    m10_assert(HubFoundingMemoryMigration::apply($db, $base . '/migrations/009_founding_memory.sql', $now) === 'applied', 'M10 migration');
    m10_assert(HubFoundingMemoryMigration::apply($db, $base . '/migrations/009_founding_memory.sql', $now) === 'already-applied', 'M10 migration is idempotent');
    m10_assert((int) $pdo->query('PRAGMA user_version')->fetchColumn() === 10, 'global version remains monotonic');
    m10_assert((int) $pdo->query("SELECT COUNT(*) FROM awh_schema_migrations WHERE migration_id IN ('m3e.1-enrollment','m3e.2-enrollment-api','m4-control-plane','m5-owner-auth','m6-assistant-workstream','m7-workspace-continuity','m8-unified-workspace','m9-final-product','m10-founding-memory')")->fetchColumn() === 9, 'all compatibility ledgers remain');

    $firstImport = HubFoundingMemoryMigration::importDefaultSeed($db, $now);
    $countAfterFirst = (int) $pdo->query('SELECT COUNT(*) FROM control_memory_records')->fetchColumn();
    $secondImport = HubFoundingMemoryMigration::importDefaultSeed($db, $now);
    m10_assert($firstImport['status'] === 'imported' && $firstImport['inserted'] > 20 && $firstImport['excludedSensitive'] === 0, 'safe founding records are imported once');
    m10_assert($secondImport['status'] === 'already-imported' && (int) $pdo->query('SELECT COUNT(*) FROM control_memory_records')->fetchColumn() === $countAfterFirst, 'seed is idempotent by stable key and import batch');
    m10_assert((int) $pdo->query("SELECT COUNT(*) FROM control_memory_records WHERE project_id = '$project' AND scope = 'PROJECT'")->fetchColumn() >= 4, 'existing canonical BAY project is bound without creating a duplicate project');
    m10_assert((int) $pdo->query('SELECT COUNT(*) FROM projects')->fetchColumn() === 2, 'seed never creates a project');

    $auth = HubOwnerAuthService::openExisting($db);
    $auth->provisionInitial('art', $ownerPassword, $now);
    $ownerSession = $auth->login('art', $ownerPassword, true, 'm10-owner', $now);
    $browser = m10_browser($ownerSession['sessionToken'], $ownerSession['csrfToken']);
    $control = HubControlPlaneService::openExisting($db);
    $ownerMemoryResponse = m10_control($control, 'GET', '/api/v1/control/memory?scope=owner&q=awh.purpose', m10_read_browser($ownerSession['sessionToken']));
    $ownerMemory = m10_body($ownerMemoryResponse);
    m10_assert($ownerMemoryResponse['status'] === 200 && str_contains((string) m10_memory($ownerMemory, 'awh.purpose')['content'], 'Art’s Workspace Hub'), 'FOUNDING_PURPOSE is retrievable through the canonical owner memory route');
    $bayMemoryResponse = m10_control($control, 'GET', '/api/v1/control/memory?projectId=' . $project . '&scope=project&q=bay.frozen_constraints', m10_read_browser($ownerSession['sessionToken']));
    $bayMemory = m10_body($bayMemoryResponse);
    $bayRecord = m10_memory($bayMemory, 'bay.frozen_constraints');
    m10_assert($bayMemoryResponse['status'] === 200 && str_contains((string) $bayRecord['content'], 'ห้ามรื้อ healthy core'), 'PROJECT_RECALL returns only the relevant durable BAY constraint');
    $creativeMemory = m10_body(m10_control($control, 'GET', '/api/v1/control/memory?scope=owner&q=creative.pr_journal', m10_read_browser($ownerSession['sessionToken'])));
    m10_assert(str_contains((string) m10_memory($creativeMemory, 'creative.pr_journal')['content'], 'A4'), 'CREATIVE_STYLE is independently retrievable without project code details');

    $created = m10_control($control, 'POST', '/api/v1/control/conversations/new', $browser, ['schemaVersion' => 2, 'projectId' => $project, 'title' => 'Founding memory']);
    $conversation = m10_body($created)['conversation']['conversationId'];
    $purposeAnswer = m10_control($control, 'POST', '/api/v1/control/conversations', $browser, ['schemaVersion' => 3, 'projectId' => $project, 'conversationId' => $conversation, 'message' => 'เราสร้าง AWH ขึ้นมาทำไม?', 'attachmentIds' => [], 'idempotencyKey' => 'm10-purpose-0001']);
    m10_assert($purposeAnswer['status'] === 201 && str_contains($purposeAnswer['body'], 'Art’s Workspace Hub'), 'conversation fallback produces a natural founding answer when provider execution is unavailable');
    $secondConversation = m10_control($control, 'POST', '/api/v1/control/conversations/new', $browser, ['schemaVersion' => 2, 'projectId' => $project, 'title' => 'BAY follow-up']);
    $bayAnswer = m10_control($control, 'POST', '/api/v1/control/conversations', $browser, ['schemaVersion' => 3, 'projectId' => $project, 'conversationId' => m10_body($secondConversation)['conversation']['conversationId'], 'message' => 'BAY ตอนนี้มีหลักการอะไรที่ห้ามรื้อ?', 'attachmentIds' => [], 'idempotencyKey' => 'm10-bay-0001']);
    m10_assert($bayAnswer['status'] === 201 && str_contains($bayAnswer['body'], 'ห้ามรื้อ healthy core'), 'CROSS_THREAD durable project memory survives a new Work thread');
    $secondOwnerSession = $auth->login('art', $ownerPassword, false, 'm10-iphone-logical-client', $now);
    m10_assert(m10_control($control, 'GET', '/api/v1/control/memory?scope=owner&q=awh.purpose', m10_read_browser($secondOwnerSession['sessionToken']))['status'] === 200, 'CROSS_DEVICE logical client sees the same canonical Owner memory');

    $auth->stepUp($ownerSession['sessionToken'], $ownerSession['csrfToken'], $ownerPassword);
    $invite = $auth->inviteUser($ownerSession['sessionToken'], $ownerSession['csrfToken'], ['displayName' => 'Collaborator', 'email' => null, 'projectIds' => [$project], 'role' => 'COLLABORATOR', 'username' => 'founding-collab'], $now);
    $accepted = $auth->acceptInvitation(['schemaVersion' => 1, 'invitationCode' => $invite['invitationCode'], 'password' => $collaboratorPassword], $now, 'm10-invite');
    $collaboratorSession = $auth->login('founding-collab', $collaboratorPassword, false, 'm10-collaborator', $now);
    $collaboratorPrivate = m10_control($control, 'GET', '/api/v1/control/memory?scope=owner', m10_read_browser($collaboratorSession['sessionToken']));
    $collaboratorUnshared = m10_body(m10_control($control, 'GET', '/api/v1/control/memory?projectId=' . $project . '&scope=project', m10_read_browser($collaboratorSession['sessionToken'])));
    m10_assert($collaboratorPrivate['status'] === 403 && ($collaboratorUnshared['memories'] ?? []) === [], 'MULTI_USER_ISOLATION hides Owner private memory and unshared Project memory');
    $share = m10_control($control, 'POST', '/api/v1/control/memory', $browser, ['schemaVersion' => 1, 'memoryId' => $bayRecord['memoryId'], 'action' => 'SHARE', 'content' => null, 'tags' => null, 'sharingPolicy' => null, 'pinned' => null]);
    m10_assert($share['status'] === 200, 'Owner can explicitly share a bound Project record');
    $collaboratorShared = m10_body(m10_control($control, 'GET', '/api/v1/control/memory?projectId=' . $project . '&scope=project&q=bay.frozen_constraints', m10_read_browser($collaboratorSession['sessionToken'])));
    m10_assert(count($collaboratorShared['memories'] ?? []) === 1 && ($collaboratorShared['memories'][0]['stableKey'] ?? null) === 'bay.frozen_constraints', 'explicitly shared Project memory is visible only to authorized members');
    m10_assert(m10_control($control, 'GET', '/api/v1/control/memory?projectId=' . $otherProject . '&scope=project', m10_read_browser($collaboratorSession['sessionToken']))['status'] === 403, 'unrelated Project memory remains server-side isolated');
    m10_assert($accepted['userId'] !== $owner, 'collaborator identity is separate from canonical Owner');

    $staleRecord = ['stableKey' => 'fixture.stale-source', 'scope' => 'PROJECT', 'projectKey' => 'bay-excuse-x', 'category' => 'HISTORICAL_BASELINE', 'content' => 'Historical source revision; live project state must replace this claim.', 'tags' => ['fixture', 'truth'], 'sourceRevision' => str_repeat('a', 40), 'sharingPolicy' => 'OWNER_PRIVATE'];
    $staleImport = HubFoundingMemoryMigration::importRecords($pdo, $owner, [$staleRecord], '2.0', hash('sha256', 'm10-stale-fixture'), $now);
    $pdo->prepare('UPDATE projects SET source_revision = :revision, observed_at = :at WHERE project_id = :project')->execute(['revision' => str_repeat('b', 40), 'at' => $newer, 'project' => $project]);
    m10_assert(HubFoundingMemoryMigration::reconcileProjectSourceTruth($pdo, $project, $newer) >= 1, 'live Project Source of Truth supersedes stale memory');
    $staleRow = $pdo->query("SELECT freshness, superseded_by_source_revision FROM control_memory_records WHERE stable_key = 'fixture.stale-source'")->fetch();
    m10_assert(is_array($staleRow) && $staleRow['freshness'] === 'SUPERSEDED' && $staleRow['superseded_by_source_revision'] === str_repeat('b', 40), 'CURRENT_TRUTH_OVERRIDES_MEMORY marks stale source-bound memory instead of overwriting live project state');

    $sensitiveContent = 'pass' . 'word' . ':' . 'fixture-only';
    $sensitiveSeed = [['stableKey' => 'fixture.sensitive', 'scope' => 'OWNER', 'category' => 'FIXTURE', 'content' => $sensitiveContent, 'tags' => ['fixture'], 'sharingPolicy' => 'OWNER_PRIVATE']];
    $sensitiveImport = HubFoundingMemoryMigration::importRecords($pdo, $owner, $sensitiveSeed, '2.1', hash('sha256', 'm10-sensitive-fixture'), $now);
    m10_assert($sensitiveImport['excludedSensitive'] === 1 && (int) $pdo->query("SELECT COUNT(*) FROM control_memory_records WHERE stable_key = 'fixture.sensitive'")->fetchColumn() === 0, 'SENSITIVE_EXCLUSION rejects ordinary-memory import of secret-shaped material');
    $healthSeed = [['stableKey' => 'fixture.health', 'scope' => 'OWNER', 'category' => 'FIXTURE', 'content' => 'medical history: fixture-only', 'tags' => ['fixture'], 'sharingPolicy' => 'OWNER_PRIVATE']];
    $healthImport = HubFoundingMemoryMigration::importRecords($pdo, $owner, $healthSeed, '2.11', hash('sha256', 'm10-health-fixture'), $now);
    m10_assert($healthImport['excludedSensitive'] === 1 && (int) $pdo->query("SELECT COUNT(*) FROM control_memory_records WHERE stable_key = 'fixture.health'")->fetchColumn() === 0, 'SENSITIVE_EXCLUSION rejects health or medical material from ordinary memory');

    $rollbackSeed = [['stableKey' => 'fixture.rollback', 'scope' => 'OWNER', 'category' => 'FIXTURE', 'content' => 'A bounded import record for rollback proof.', 'tags' => ['fixture'], 'sharingPolicy' => 'OWNER_PRIVATE']];
    $rollbackImport = HubFoundingMemoryMigration::importRecords($pdo, $owner, $rollbackSeed, '2.2', hash('sha256', 'm10-rollback-fixture'), $now);
    $rollback = HubFoundingMemoryMigration::rollbackImport($db, $owner, $rollbackImport['batchId'], $now);
    m10_assert($rollback['status'] === 'rolled-back' && $rollback['removed'] === 1 && (int) $pdo->query("SELECT COUNT(*) FROM control_memory_records WHERE stable_key = 'fixture.rollback'")->fetchColumn() === 0, 'ROLLBACK_FOUNDING_IMPORT removes only the untouched bounded import batch');

    $pin = m10_control($control, 'POST', '/api/v1/control/memory', $browser, ['schemaVersion' => 1, 'memoryId' => m10_memory($ownerMemory, 'awh.purpose')['memoryId'], 'action' => 'PIN', 'content' => null, 'tags' => null, 'sharingPolicy' => null, 'pinned' => true]);
    m10_assert($pin['status'] === 200 && (m10_body($pin)['memory']['pinned'] ?? false) === true, 'MEMORY_USER_CONTROL pins durable memory with a revision');
    $edit = m10_control($control, 'POST', '/api/v1/control/memory', $browser, ['schemaVersion' => 1, 'memoryId' => m10_memory($ownerMemory, 'awh.purpose')['memoryId'], 'action' => 'EDIT', 'content' => 'AWH is Art’s durable, owner-controlled work surface.', 'tags' => ['awh', 'purpose'], 'sharingPolicy' => null, 'pinned' => null]);
    m10_assert($edit['status'] === 200 && (m10_body($edit)['memory']['authorityLevel'] ?? null) === 'owner_edited', 'MEMORY_USER_CONTROL corrects a durable memory without creating a parallel record');
    $outdated = m10_control($control, 'POST', '/api/v1/control/memory', $browser, ['schemaVersion' => 1, 'memoryId' => m10_memory($creativeMemory, 'creative.pr_journal')['memoryId'], 'action' => 'MARK_OUTDATED', 'content' => null, 'tags' => null, 'sharingPolicy' => null, 'pinned' => null]);
    m10_assert($outdated['status'] === 200 && (m10_body($outdated)['memory']['freshness'] ?? null) === 'stale', 'MEMORY_USER_CONTROL can mark a record for review');
    $forget = m10_control($control, 'POST', '/api/v1/control/memory', $browser, ['schemaVersion' => 1, 'memoryId' => m10_memory($creativeMemory, 'creative.pr_journal')['memoryId'], 'action' => 'FORGET', 'content' => null, 'tags' => null, 'sharingPolicy' => null, 'pinned' => null]);
    m10_assert($forget['status'] === 200 && (m10_body($forget)['memory']['freshness'] ?? null) === 'forgotten', 'MEMORY_USER_CONTROL forgets data without deleting unrelated memory');
    $imports = m10_control($control, 'GET', '/api/v1/control/memory/imports', m10_read_browser($ownerSession['sessionToken']));
    m10_assert($imports['status'] === 200 && str_contains($imports['body'], 'Founding Memory Migration') && !str_contains($imports['body'], $sensitiveContent), 'import report exposes provenance without secret-shaped source content');
    $export = m10_control($control, 'GET', '/api/v1/control/export', m10_read_browser($ownerSession['sessionToken']));
    m10_assert($export['status'] === 200 && str_contains($export['body'], 'awh.purpose') && !str_contains($export['body'], $sensitiveContent), 'safe workspace export includes authorized durable memory but excludes rejected sensitive input');
    m10_assert($pdo->query('PRAGMA integrity_check')->fetchColumn() === 'ok' && $pdo->query('PRAGMA foreign_key_check')->fetchAll() === [], 'M3E through M10 integrity and foreign keys remain clean');
    fwrite(STDOUT, "AWH M10 Founding Memory: PASS\n");
} finally {
    putenv('AWH_CONTROL_ORIGIN');
    putenv('AWH_ATTACHMENT_ROOT');
    @unlink($db);
    @rmdir($attachments);
    @rmdir($root);
}
