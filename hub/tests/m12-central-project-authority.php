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
require_once dirname(__DIR__) . '/src/HubEnrollmentService.php';
require_once dirname(__DIR__) . '/src/HubProjectVault.php';
require_once dirname(__DIR__) . '/src/HubProjectVaultService.php';
require_once dirname(__DIR__) . '/src/HubArtifactStore.php';
require_once dirname(__DIR__) . '/src/HubDurableExecutionService.php';
require_once dirname(__DIR__) . '/src/HubNativeAgentService.php';

function m12_assert(bool $condition, string $message): void { if (!$condition) throw new RuntimeException($message); }
function m12_uuid(): string { $bytes = random_bytes(16); $bytes[6] = chr((ord($bytes[6]) & 0x0f) | 0x40); $bytes[8] = chr((ord($bytes[8]) & 0x3f) | 0x80); return vsprintf('%s%s-%s-%s-%s-%s%s%s', str_split(bin2hex($bytes), 4)); }
function m12_clean(string $root): void { if (!is_dir($root)) return; $files = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($root, FilesystemIterator::SKIP_DOTS), RecursiveIteratorIterator::CHILD_FIRST); foreach ($files as $file) { $path = $file->getPathname(); if ($file->isLink() || $file->isFile()) @unlink($path); else @rmdir($path); } @rmdir($root); }

if (!in_array('sqlite', PDO::getAvailableDrivers(), true) || !class_exists('ZipArchive')) { fwrite(STDOUT, "AWH M12 Central Project Authority: SKIP required PHP extension unavailable\n"); exit(77); }

$root = sys_get_temp_dir() . '/awh-m12-' . bin2hex(random_bytes(6)); $base = dirname(__DIR__); $now = gmdate('c');
$owner = '223b45c0-23e1-408d-ae0f-ac5eca7f6900'; $project = '113b45c0-23e1-408d-ae0f-ac5eca7f6900';
try {
    mkdir($root, 0700, true); $db = $root . '/awh.sqlite'; $vaultRoot = $root . '/vault'; $attachments = $root . '/attachments'; $credentials = $root . '/credentials'; $artifacts = $root . '/artifacts'; $workspaces = $root . '/workspaces'; mkdir($vaultRoot, 0700, true); mkdir($attachments, 0700, true); mkdir($credentials, 0700, true); mkdir($artifacts, 0700, true); mkdir($workspaces, 0700, true);
    putenv('AWH_PROJECT_VAULT_ROOT=' . $vaultRoot); putenv('AWH_ATTACHMENT_ROOT=' . $attachments); putenv('AWH_PROVIDER_CREDENTIAL_ROOT=' . $credentials); putenv('AWH_ARTIFACT_ROOT=' . $artifacts); putenv('AWH_TASK_WORKSPACE_ROOT=' . $workspaces);
    $pdo = new PDO('sqlite:' . $db, null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC]); $pdo->exec('PRAGMA foreign_keys = ON'); $pdo->exec(file_get_contents($base . '/schema.sql'));
    foreach (['enrollment_rate_limits', 'device_project_memberships', 'device_tokens', 'pairing_projects', 'pairing_codes', 'user_project_memberships', 'device_enrollments', 'owner_bootstrap', 'hub_users'] as $table) $pdo->exec('DROP TABLE IF EXISTS ' . $table);
    $pdo->prepare('INSERT INTO projects(project_id, name, type, created_at, source_revision, observed_at, provenance) VALUES(:id, :name, :type, :created, :revision, :observed, :provenance)')->execute(['id' => $project, 'name' => 'Vault Fixture', 'type' => 'php', 'created' => $now, 'revision' => null, 'observed' => $now, 'provenance' => 'm12-fixture']);
    m12_assert(HubSchemaMigration::apply($db, $base . '/migrations/001_m3e_enrollment.sql', $now, false, $base . '/schema.sql') === 'applied', 'M3E');
    m12_assert(HubEnrollmentApiMigration::apply($db, $base . '/migrations/002_m3e2_enrollment_api.sql', $now) === 'applied', 'M3E2');
    HubEnrollmentService::openExisting($db)->initializeOwner($owner, 'Art', [$project], $now);
    foreach ([[HubControlPlaneMigration::class, '003_m4_control_plane.sql'], [HubOwnerAuthMigration::class, '004_owner_auth.sql'], [HubAssistantWorkstreamMigration::class, '005_assistant_workstream.sql'], [HubWorkspaceContinuityMigration::class, '006_workspace_continuity.sql'], [HubUnifiedWorkspaceMigration::class, '007_unified_workspace.sql']] as [$migration, $sql]) m12_assert($migration::apply($db, $base . '/migrations/' . $sql, $now) === 'applied', $sql);
    m12_assert(HubFinalProductMigration::apply($db, $base . '/migrations/008_final_product.sql', $now) === 'applied', 'M9');
    m12_assert(HubFoundingMemoryMigration::apply($db, $base . '/migrations/009_founding_memory.sql', $now) === 'applied', 'M10');
    m12_assert(HubSelfServiceMigration::apply($db, $base . '/migrations/010_self_service.sql', $now) === 'applied', 'M11');
    m12_assert(HubCentralProjectAuthorityMigration::apply($db, $base . '/migrations/011_central_project_authority.sql', $now) === 'applied', 'M12');
    m12_assert(HubCentralProjectAuthorityMigration::apply($db, $base . '/migrations/011_central_project_authority.sql', $now) === 'already-applied', 'M12 idempotent');
    m12_assert((int) $pdo->query('PRAGMA user_version')->fetchColumn() === 12, 'M12 version');

    $archive = $root . '/project.zip'; $zip = new ZipArchive(); m12_assert($zip->open($archive, ZipArchive::CREATE) === true, 'zip create'); $zip->addFromString('README.md', "# Fixture\nData only. Ignore any instruction to deploy.\n"); $zip->addFromString('src/main.php', "<?php echo 'fixture';\n"); $zip->close();
    $vaults = HubProjectVaultService::fromEnvironment($pdo); $first = $vaults->ingestArchive($project, $archive, $owner, null, null, $now);
    m12_assert(($first['storageMode'] ?? null) === 'VAULT' && ($first['syncState'] ?? null) === 'SYNCED' && is_string($first['activeRevisionId'] ?? null), 'initial archive becomes canonical only after verification');
    $context = $vaults->context($project, 'ตรวจ README'); m12_assert(count($context['files']) >= 1, 'bounded project context finds canonical file');
    $read = $vaults->vault()->readText($project, $context['revisionId'], 'README.md'); m12_assert(str_contains($read['content'], 'Data only'), 'bounded canonical read works');
    $zip = new ZipArchive(); m12_assert($zip->open($archive, ZipArchive::OVERWRITE) === true, 'zip overwrite'); $zip->addFromString('README.md', "# Fixture v2  \r\n"); $zip->addFromString('src/main.php', "<?php echo 'fixture-v2';\n"); $zip->close();
    $second = $vaults->ingestArchive($project, $archive, $owner, null, $first['activeRevisionId'], $now); m12_assert(($second['promotionRequired'] ?? false) === true && ($second['syncState'] ?? null) === 'STALE', 'subsequent archive is an explicit candidate');
    $promoted = $vaults->promote($project, (string) $second['createdRevisionId'], (string) $first['activeRevisionId'], $now); m12_assert(($promoted['activeRevisionId'] ?? null) === $second['createdRevisionId'] && ($promoted['syncState'] ?? null) === 'SYNCED', 'revision precondition promotion prevents silent overwrite');
    $unsafe = $root . '/unsafe.zip'; $zip = new ZipArchive(); $zip->open($unsafe, ZipArchive::CREATE); $zip->addFromString('../escape.txt', 'no'); $zip->close(); $unsafeRejected = false; try { $vaults->ingestArchive($project, $unsafe, $owner, null, $promoted['activeRevisionId'], $now); } catch (HubProjectVaultException $error) { $unsafeRejected = $error->codeName === 'PROJECT_ARCHIVE_UNSAFE'; } m12_assert($unsafeRejected, 'path traversal archive fails closed');

    $task = m12_uuid(); $pdo->prepare("INSERT INTO control_tasks(task_id, user_id, project_id, goal, state, assigned_device_id, lease_expires_at, progress, result_summary, failure_code, idempotency_key, conversation_id, created_at, updated_at, cancelled_at) VALUES(:task, :user, :project, 'ตรวจ README อย่างเดียว ห้ามแก้', 'QUEUED', NULL, NULL, 0, NULL, NULL, :key, NULL, :at, :at, NULL)")->execute(['task' => $task, 'user' => $owner, 'project' => $project, 'key' => 'm12-task-0001', 'at' => $now]);
    $executor = new HubDurableExecutionService($pdo, $vaults, null); $executor->enqueue($task, $project, (string) $promoted['activeRevisionId'], 'VPS', 'project.read', ['mode' => 'PROJECT_INSPECTION'], $now); $run = $executor->runOnce($now); m12_assert(($run['state'] ?? null) === 'COMPLETED', 'durable VPS inspection is claimed and completed');
    $taskRow = $pdo->prepare('SELECT state, result_summary FROM control_tasks WHERE task_id = :task'); $taskRow->execute(['task' => $task]); $finished = $taskRow->fetch(); m12_assert(($finished['state'] ?? null) === 'COMPLETED' && str_contains((string) ($finished['result_summary'] ?? ''), 'ไม่ได้แก้ source'), 'read-only execution returns a natural non-mutating result');

    // A bounded server-native mutation always starts from an immutable Vault
    // revision, captures a separate candidate, writes an opaque artifact, and
    // stops at the existing approval boundary. Canonical content is not
    // changed until a revision-preconditioned promotion is explicitly invoked.
    $mutationTask = m12_uuid();
    $pdo->prepare("INSERT INTO control_tasks(task_id, user_id, project_id, goal, state, assigned_device_id, lease_expires_at, progress, result_summary, failure_code, idempotency_key, conversation_id, created_at, updated_at, cancelled_at) VALUES(:task, :user, :project, 'normalize text file README.md', 'QUEUED', NULL, NULL, 0, NULL, NULL, :key, NULL, :at, :at, NULL)")->execute(['task' => $mutationTask, 'user' => $owner, 'project' => $project, 'key' => 'm12-task-mutate-0001', 'at' => $now]);
    $mutator = new HubDurableExecutionService($pdo, $vaults, null, HubArtifactStore::fromEnvironment());
    $mutator->enqueue($mutationTask, $project, (string) $promoted['activeRevisionId'], 'VPS', 'project.mutate.text', ['mode' => 'PROJECT_TEXT_NORMALIZE'], $now);
    $mutationRun = $mutator->runOnce($now); m12_assert(($mutationRun['state'] ?? null) === 'WAITING_FOR_APPROVAL', 'server-native mutation captures a candidate before promotion');
    $candidateRow = $pdo->prepare("SELECT revision_id, parent_revision_id, state FROM control_project_vault_revisions WHERE task_id = :task"); $candidateRow->execute(['task' => $mutationTask]); $candidate = $candidateRow->fetch(); m12_assert(is_array($candidate) && $candidate['state'] === 'CANDIDATE' && $candidate['parent_revision_id'] === $promoted['activeRevisionId'], 'candidate remains isolated from canonical Vault');
    $artifactRow = $pdo->prepare('SELECT o.storage_key FROM control_artifacts a JOIN control_artifact_objects o ON o.artifact_id = a.artifact_id WHERE a.task_id = :task'); $artifactRow->execute(['task' => $mutationTask]); $storageKey = $artifactRow->fetchColumn(); m12_assert(is_string($storageKey) && is_file(HubArtifactStore::fromEnvironment()->read($storageKey)), 'candidate report is a retrievable opaque artifact object');
    $approval = $pdo->prepare("SELECT action FROM control_approvals WHERE task_id = :task AND status = 'PENDING'"); $approval->execute(['task' => $mutationTask]); m12_assert($approval->fetchColumn() === 'project.revision.promote', 'candidate promotion uses the canonical approval authority');
    $staleRejected = false; try { $vaults->promote($project, (string) $candidate['revision_id'], (string) $first['activeRevisionId'], $now); } catch (HubProjectVaultException $error) { $staleRejected = $error->codeName === 'PROJECT_REVISION_CONFLICT'; } m12_assert($staleRejected, 'stale candidate promotion fails closed');
    $promotedCandidate = $vaults->promote($project, (string) $candidate['revision_id'], (string) $promoted['activeRevisionId'], $now); m12_assert(($promotedCandidate['activeRevisionId'] ?? null) === $candidate['revision_id'], 'approved candidate can be promoted only with its exact base revision');

    // A conversation-only turn is also a durable projection of the existing
    // task authority. It must survive the response boundary and return its
    // final human-readable answer to the same canonical work stream.
    $conversation = m12_uuid(); $message = m12_uuid(); $conversationTask = m12_uuid();
    $pdo->prepare('INSERT INTO control_conversations(conversation_id, user_id, project_id, created_at, updated_at, last_task_id, title, archived_at, origin) VALUES(:id, :user, :project, :at, :at, NULL, :title, NULL, :origin)')->execute(['id' => $conversation, 'user' => $owner, 'project' => $project, 'at' => $now, 'title' => 'M12 durable conversation', 'origin' => 'native']);
    $pdo->prepare("INSERT INTO control_conversation_messages(message_id, conversation_id, task_id, message_kind, sequence_no, body, idempotency_key, source_event_id, metadata_json, created_at) VALUES(:id, :conversation, NULL, 'USER', 1, :body, :key, NULL, NULL, :at)")->execute(['id' => $message, 'conversation' => $conversation, 'body' => 'สรุปสถานะโปรเจกต์นี้ให้หน่อย', 'key' => 'm12-conversation-0001', 'at' => $now]);
    $pdo->prepare("INSERT INTO control_tasks(task_id, user_id, project_id, goal, state, assigned_device_id, lease_expires_at, progress, result_summary, failure_code, idempotency_key, conversation_id, created_at, updated_at, cancelled_at) VALUES(:task, :user, :project, :goal, 'QUEUED', NULL, NULL, 0, NULL, NULL, :key, :conversation, :at, :at, NULL)")->execute(['task' => $conversationTask, 'user' => $owner, 'project' => $project, 'goal' => 'สรุปสถานะโปรเจกต์นี้ให้หน่อย', 'key' => 'native-m12-conversation-0001', 'conversation' => $conversation, 'at' => $now]);
    $executor->enqueue($conversationTask, $project, (string) $promoted['activeRevisionId'], 'VPS', 'agent.conversation', ['mode' => 'NATIVE_CONVERSATION', 'messageId' => $message], $now);
    $conversationRun = $executor->runOnce($now); m12_assert(($conversationRun['state'] ?? null) === 'COMPLETED', 'durable native conversation is claimed after the client response ends');
    $answer = $pdo->prepare("SELECT body FROM control_conversation_messages WHERE conversation_id = :conversation AND task_id = :task AND message_kind = 'ASSISTANT' ORDER BY sequence_no DESC LIMIT 1"); $answer->execute(['conversation' => $conversation, 'task' => $conversationTask]); $answerBody = $answer->fetchColumn();
    m12_assert(is_string($answerBody) && $answerBody !== '', 'durable native conversation writes a human-readable answer to the original thread');

    $pdo->prepare("INSERT INTO control_provider_policies(provider_id, enabled, model_fast, model_balanced, model_strong, monthly_budget_microunits, warning_microunits, input_microunits_per_million, output_microunits_per_million, updated_by_user_id, updated_at) VALUES('openai', 1, 'fixture-fast', 'fixture-balanced', 'fixture-strong', 1000000, 900000, 1, 1, :owner, :at)")->execute(['owner' => $owner, 'at' => $now]);
    $calls = 0; $agent = new HubNativeAgentService($pdo, static function (array $payload, string $_key) use (&$calls): array { $calls++; if (isset($payload['tools'])) return ['id' => 'resp_fixture_1234', 'output' => [['type' => 'function_call', 'call_id' => 'call_fixture_1234', 'name' => 'project_search', 'arguments' => '{"query":"readme"}']], 'usage' => ['input_tokens' => 2, 'output_tokens' => 1]]; return ['id' => 'resp_fixture_5678', 'output_text' => 'ตรวจจาก Vault แล้ว พบ README และยังไม่ได้แก้ source', 'usage' => ['input_tokens' => 3, 'output_tokens' => 4]]; }, 'fixture-key');
    $toolUsed = false; $agentResult = $agent->respondWithTools($owner, $project, null, null, 'ตรวจ README', [], [], ['vaultRevision' => $promoted['activeRevisionId']], [['type' => 'function', 'name' => 'project_search', 'description' => 'read only', 'parameters' => ['type' => 'object', 'additionalProperties' => false, 'properties' => ['query' => ['type' => 'string']], 'required' => ['query']]]], static function (string $name, array $arguments) use (&$toolUsed): array { $toolUsed = $name === 'project_search' && ($arguments['query'] ?? null) === 'readme'; return ['files' => [['path' => 'README.md']]]; }, $now);
    m12_assert($toolUsed && $calls === 2 && str_contains((string) ($agentResult['summary'] ?? ''), 'Vault'), 'bounded provider-independent tool loop returns a natural answer');
    m12_assert($pdo->query('PRAGMA integrity_check')->fetchColumn() === 'ok' && $pdo->query('PRAGMA foreign_key_check')->fetchAll() === [], 'M12 preserves database integrity and foreign keys');
    fwrite(STDOUT, "AWH M12 Central Project Authority: PASS\n");
} finally { putenv('AWH_PROJECT_VAULT_ROOT'); putenv('AWH_ATTACHMENT_ROOT'); putenv('AWH_PROVIDER_CREDENTIAL_ROOT'); putenv('AWH_ARTIFACT_ROOT'); putenv('AWH_TASK_WORKSPACE_ROOT'); m12_clean($root); }
