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
    $contentMatches = $vaults->vault()->search($project, $context['revisionId'], 'fixture');
    $contentHit = null; foreach ($contentMatches as $match) if (($match['path'] ?? null) === 'src/main.php' && ($match['match'] ?? null) === 'content') $contentHit = $match;
    m12_assert(is_array($contentHit) && ($contentHit['line'] ?? null) === 1 && str_contains((string) ($contentHit['snippet'] ?? ''), 'fixture'), 'Vault search finds bounded source content across files with line evidence');
    $pathMatches = $vaults->vault()->search($project, $context['revisionId'], 'README');
    m12_assert(($pathMatches[0]['path'] ?? null) === 'README.md' && ($pathMatches[0]['match'] ?? null) === 'path', 'Vault search keeps deterministic filename matches first');
    $zip = new ZipArchive(); m12_assert($zip->open($archive, ZipArchive::OVERWRITE) === true, 'zip overwrite'); $zip->addFromString('README.md', "# Fixture v2  \r\n"); $zip->addFromString('src/main.php', "<?php echo 'fixture-v2';\n"); $zip->close();
    $second = $vaults->ingestArchive($project, $archive, $owner, null, $first['activeRevisionId'], $now); m12_assert(($second['promotionRequired'] ?? false) === true && ($second['syncState'] ?? null) === 'STALE', 'subsequent archive is an explicit candidate');
    $promoted = $vaults->promote($project, (string) $second['createdRevisionId'], (string) $first['activeRevisionId'], $now); m12_assert(($promoted['activeRevisionId'] ?? null) === $second['createdRevisionId'] && ($promoted['syncState'] ?? null) === 'SYNCED', 'revision precondition promotion prevents silent overwrite');
    $unsafe = $root . '/unsafe.zip'; $zip = new ZipArchive(); $zip->open($unsafe, ZipArchive::CREATE); $zip->addFromString('../escape.txt', 'no'); $zip->close(); $unsafeRejected = false; try { $vaults->ingestArchive($project, $unsafe, $owner, null, $promoted['activeRevisionId'], $now); } catch (HubProjectVaultException $error) { $unsafeRejected = $error->codeName === 'PROJECT_ARCHIVE_UNSAFE'; } m12_assert($unsafeRejected, 'path traversal archive fails closed');

    // A central worker receives a ZIP derived from the immutable Vault
    // revision, not a local path. A returned ZIP becomes a candidate only.
    $transfer = $root . '/transfer.zip'; $transferMeta = $vaults->vault()->archive($project, (string) $promoted['activeRevisionId'], $transfer); m12_assert(is_file($transfer) && $transferMeta['fileCount'] === 2, 'immutable Vault revision creates a bounded worker transfer archive');
    $workerCandidateTask = m12_uuid(); $pdo->prepare("INSERT INTO control_tasks(task_id, user_id, project_id, goal, state, assigned_device_id, lease_expires_at, progress, result_summary, failure_code, idempotency_key, conversation_id, created_at, updated_at, cancelled_at) VALUES(:task, :user, :project, 'worker fixture', 'QUEUED', NULL, NULL, 0, NULL, NULL, :key, NULL, :at, :at, NULL)")->execute(['task' => $workerCandidateTask, 'user' => $owner, 'project' => $project, 'key' => 'm12-task-worker-archive-0001', 'at' => $now]);
    $workerArchive = $root . '/worker-candidate.zip'; $zip = new ZipArchive(); m12_assert($zip->open($workerArchive, ZipArchive::CREATE) === true, 'worker candidate zip create'); $zip->addFromString('README.md', "# Worker candidate\n"); $zip->addFromString('src/main.php', "<?php echo 'worker';\n"); $zip->close();
    $workerCandidate = $vaults->captureTaskArchive($project, $workerArchive, $owner, $workerCandidateTask, (string) $promoted['activeRevisionId'], $now); m12_assert($workerCandidate['changed'] === true && $workerCandidate['parentRevisionId'] === $promoted['activeRevisionId'], 'worker archive becomes a separate revision-checked candidate'); $vaults->rejectCandidate($project, (string) $workerCandidate['revisionId'], $now);

    $task = m12_uuid(); $pdo->prepare("INSERT INTO control_tasks(task_id, user_id, project_id, goal, state, assigned_device_id, lease_expires_at, progress, result_summary, failure_code, idempotency_key, conversation_id, created_at, updated_at, cancelled_at) VALUES(:task, :user, :project, 'ตรวจ README อย่างเดียว ห้ามแก้', 'QUEUED', NULL, NULL, 0, NULL, NULL, :key, NULL, :at, :at, NULL)")->execute(['task' => $task, 'user' => $owner, 'project' => $project, 'key' => 'm12-task-0001', 'at' => $now]);
    $executor = new HubDurableExecutionService($pdo, $vaults, null, HubArtifactStore::fromEnvironment()); $executor->enqueue($task, $project, (string) $promoted['activeRevisionId'], 'VPS', 'project.read', ['mode' => 'PROJECT_INSPECTION'], $now); $run = $executor->runOnce($now); m12_assert(($run['state'] ?? null) === 'COMPLETED', 'durable VPS inspection is claimed and completed');
    $taskRow = $pdo->prepare('SELECT state, result_summary FROM control_tasks WHERE task_id = :task'); $taskRow->execute(['task' => $task]); $finished = $taskRow->fetch(); m12_assert(($finished['state'] ?? null) === 'COMPLETED' && str_contains((string) ($finished['result_summary'] ?? ''), 'ไม่ได้แก้ source'), 'read-only execution returns a natural non-mutating result');

    // Root-cause inspection must use the same immutable Vault evidence path:
    // content search first, then an exact bounded file read, with no mutation.
    $pdo->prepare("INSERT INTO control_provider_policies(provider_id, enabled, model_fast, model_balanced, model_strong, monthly_budget_microunits, warning_microunits, input_microunits_per_million, output_microunits_per_million, updated_by_user_id, updated_at) VALUES('openai', 1, 'fixture-fast', 'fixture-balanced', 'fixture-strong', 100000000, 90000000, 1000000, 1000000, :owner, :at)")->execute(['owner' => $owner, 'at' => $now]);
    $inspectionCalls = 0;
    $inspectionAgent = new HubNativeAgentService($pdo, static function (array $payload, string $_key) use (&$inspectionCalls): array {
        $inspectionCalls++;
        if ($inspectionCalls === 1) return ['id' => 'resp_inspect_search_1234', 'output' => [['type' => 'function_call', 'call_id' => 'call_inspect_search_1234', 'name' => 'project_search', 'arguments' => '{"query":"fixture-v2"}']], 'usage' => ['input_tokens' => 3, 'output_tokens' => 2]];
        if ($inspectionCalls === 2) return ['id' => 'resp_inspect_read_1234', 'output' => [['type' => 'function_call', 'call_id' => 'call_inspect_read_1234', 'name' => 'project_read_text', 'arguments' => '{"path":"src/main.php"}']], 'usage' => ['input_tokens' => 3, 'output_tokens' => 2]];
        return ['id' => 'resp_inspect_done_1234', 'output_text' => 'Root cause evidence: src/main.php line 1 contains fixture-v2; no mutation performed.', 'usage' => ['input_tokens' => 3, 'output_tokens' => 3]];
    }, 'fixture-key');
    $inspectionTask = m12_uuid();
    $pdo->prepare("INSERT INTO control_tasks(task_id, user_id, project_id, goal, state, assigned_device_id, lease_expires_at, progress, result_summary, failure_code, idempotency_key, conversation_id, created_at, updated_at, cancelled_at) VALUES(:task, :user, :project, 'หาสาเหตุ fixture-v2 จาก source จริง', 'QUEUED', NULL, NULL, 0, NULL, NULL, :key, NULL, :at, :at, NULL)")->execute(['task' => $inspectionTask, 'user' => $owner, 'project' => $project, 'key' => 'm12-task-root-cause-0001', 'at' => $now]);
    $inspector = new HubDurableExecutionService($pdo, $vaults, $inspectionAgent, HubArtifactStore::fromEnvironment()); $inspector->enqueue($inspectionTask, $project, (string) $promoted['activeRevisionId'], 'VPS', 'project.search', ['mode' => 'PROJECT_INSPECTION'], $now);
    $inspectionRun = $inspector->runOnce($now); m12_assert(($inspectionRun['state'] ?? null) === 'COMPLETED' && $inspectionCalls === 3, 'root-cause inspection performs bounded content search then exact source read');
    $inspectionRow = $pdo->prepare('SELECT state,result_summary FROM control_tasks WHERE task_id=:task'); $inspectionRow->execute(['task' => $inspectionTask]); $inspectionDone = $inspectionRow->fetch();
    m12_assert(($inspectionDone['state'] ?? null) === 'COMPLETED' && str_contains((string) ($inspectionDone['result_summary'] ?? ''), 'src/main.php line 1'), 'root-cause inspection returns concrete source evidence');
    $inspectionArtifact = $pdo->prepare("SELECT a.kind,o.storage_key FROM control_artifacts a JOIN control_artifact_objects o ON o.artifact_id=a.artifact_id WHERE a.task_id=:task AND a.kind='project-inspection'"); $inspectionArtifact->execute(['task'=>$inspectionTask]); $inspectionObject=$inspectionArtifact->fetch();
    m12_assert(is_array($inspectionObject) && ($inspectionObject['kind']??null)==='project-inspection', 'root-cause inspection persists one canonical artifact record');
    $inspectionEvidence=json_decode((string)file_get_contents(HubArtifactStore::fromEnvironment()->read((string)$inspectionObject['storage_key'])),true,64,JSON_THROW_ON_ERROR);
    m12_assert(($inspectionEvidence['readOnly']??null)===true && ($inspectionEvidence['vaultRevisionId']??null)===$promoted['activeRevisionId'] && ($inspectionEvidence['evidence']['searches'][0]['query']??null)==='fixture-v2' && ($inspectionEvidence['evidence']['reads'][0]['path']??null)==='src/main.php', 'inspection artifact binds search/read evidence to the exact immutable revision');
    $inspectionReadEvidence=$inspectionEvidence['evidence']['reads'][0]??null; $inspectionSearchMatch=$inspectionEvidence['evidence']['searches'][0]['matches'][0]??null;
    m12_assert(is_array($inspectionReadEvidence) && !array_key_exists('content',$inspectionReadEvidence) && is_string($inspectionReadEvidence['sha256']??null) && strlen((string)$inspectionReadEvidence['sha256'])===64, 'inspection read evidence records hashes and metadata, not copied source payloads');
    m12_assert(!is_array($inspectionSearchMatch) || !isset($inspectionSearchMatch['snippet']) || strlen((string)$inspectionSearchMatch['snippet'])<=240, 'inspection search evidence keeps snippets bounded');
    m12_assert($vaults->activeRevision($project) === $promoted['activeRevisionId'], 'root-cause inspection leaves canonical source unchanged');
    $pdo->exec("DELETE FROM control_provider_policies WHERE provider_id='openai'");

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

    // Text/code edits can run entirely on the VPS Vault without an enrolled
    // device. The provider receives only bounded search/read/write-text tools;
    // its output becomes an isolated candidate and never canonical source.
    $pdo->prepare("INSERT INTO control_provider_policies(provider_id, enabled, model_fast, model_balanced, model_strong, monthly_budget_microunits, warning_microunits, input_microunits_per_million, output_microunits_per_million, updated_by_user_id, updated_at) VALUES('openai', 1, 'fixture-fast', 'fixture-balanced', 'fixture-strong', 100000000, 90000000, 1000000, 1000000, :owner, :at)")->execute(['owner' => $owner, 'at' => $now]);
    $editCalls = 0;
    $editAgent = new HubNativeAgentService($pdo, static function (array $payload, string $_key) use (&$editCalls): array {
        $editCalls++;
        if ($editCalls === 1) return ['id' => 'resp_edit_read_1234', 'output' => [['type' => 'function_call', 'call_id' => 'call_edit_read_1234', 'name' => 'project_read_text', 'arguments' => '{"path":"src/main.php"}']], 'usage' => ['input_tokens' => 3, 'output_tokens' => 2]];
        if ($editCalls === 2) return ['id' => 'resp_edit_write_1234', 'output' => [['type' => 'function_call', 'call_id' => 'call_edit_write_1234', 'name' => 'project_write_text', 'arguments' => json_encode(['path' => 'src/main.php', 'content' => "<?php echo 'vps-assisted';\n"], JSON_THROW_ON_ERROR)]], 'usage' => ['input_tokens' => 4, 'output_tokens' => 3]];
        return ['id' => 'resp_edit_done_1234', 'output_text' => 'แก้ src/main.php ตามคำขอแล้ว', 'usage' => ['input_tokens' => 3, 'output_tokens' => 3]];
    }, 'fixture-key');
    $assistedTask = m12_uuid(); $activeForAssisted = (string) $vaults->activeRevision($project);
    $pdo->prepare("INSERT INTO control_tasks(task_id, user_id, project_id, goal, state, assigned_device_id, lease_expires_at, progress, result_summary, failure_code, idempotency_key, conversation_id, created_at, updated_at, cancelled_at) VALUES(:task, :user, :project, 'แก้ src/main.php ให้แสดง vps-assisted', 'QUEUED', NULL, NULL, 0, NULL, NULL, :key, NULL, :at, :at, NULL)")->execute(['task' => $assistedTask, 'user' => $owner, 'project' => $project, 'key' => 'm12-task-assisted-0001', 'at' => $now]);
    $assisted = new HubDurableExecutionService($pdo, $vaults, $editAgent, HubArtifactStore::fromEnvironment());
    $assisted->enqueue($assistedTask, $project, $activeForAssisted, 'VPS', 'project.mutate.assisted', ['mode' => 'PROJECT_ASSISTED_EDIT'], $now);
    $assistedRun = $assisted->runOnce($now); m12_assert(($assistedRun['state'] ?? null) === 'WAITING_FOR_APPROVAL' && $editCalls === 3, 'provider-assisted text edit completes on VPS without a device worker');
    $assistedCandidateQuery = $pdo->prepare("SELECT revision_id, parent_revision_id, state FROM control_project_vault_revisions WHERE task_id=:task"); $assistedCandidateQuery->execute(['task' => $assistedTask]); $assistedCandidate = $assistedCandidateQuery->fetch();
    m12_assert(is_array($assistedCandidate) && $assistedCandidate['state'] === 'CANDIDATE' && $assistedCandidate['parent_revision_id'] === $activeForAssisted, 'assisted edit remains an isolated candidate revision');
    $assistedRead = $vaults->vault()->readText($project, (string) $assistedCandidate['revision_id'], 'src/main.php'); m12_assert(str_contains($assistedRead['content'], 'vps-assisted'), 'assisted edit writes only the candidate workspace');
    m12_assert($vaults->activeRevision($project) === $activeForAssisted, 'assisted edit never silently replaces canonical Vault source');
    $unsafeToolPath = false; try { $vaults->vault()->toolTextPath('../secret.txt'); } catch (HubProjectVaultException) { $unsafeToolPath = true; } m12_assert($unsafeToolPath, 'assisted edit tool path traversal fails closed');

    $secretCalls = 0; $fakeSecret = 'sk-' . str_repeat('A', 24);
    $secretAgent = new HubNativeAgentService($pdo, static function (array $payload, string $_key) use (&$secretCalls, $fakeSecret): array {
        $secretCalls++;
        if ($secretCalls === 1) return ['id' => 'resp_secret_write_1234', 'output' => [['type' => 'function_call', 'call_id' => 'call_secret_write_1234', 'name' => 'project_write_text', 'arguments' => json_encode(['path' => 'src/secret-test.php', 'content' => "<?php \$token='" . $fakeSecret . "';\n"], JSON_THROW_ON_ERROR)]], 'usage' => ['input_tokens' => 3, 'output_tokens' => 2]];
        return ['id' => 'resp_secret_done_1234', 'output_text' => 'should not complete', 'usage' => ['input_tokens' => 1, 'output_tokens' => 1]];
    }, 'fixture-key');
    $secretTask = m12_uuid();
    $pdo->prepare("INSERT INTO control_tasks(task_id, user_id, project_id, goal, state, assigned_device_id, lease_expires_at, progress, result_summary, failure_code, idempotency_key, conversation_id, created_at, updated_at, cancelled_at) VALUES(:task, :user, :project, 'แก้ไฟล์ทดสอบ credential gate', 'QUEUED', NULL, NULL, 0, NULL, NULL, :key, NULL, :at, :at, NULL)")->execute(['task' => $secretTask, 'user' => $owner, 'project' => $project, 'key' => 'm12-task-secret-gate-0001', 'at' => $now]);
    $secretExecutor = new HubDurableExecutionService($pdo, $vaults, $secretAgent, HubArtifactStore::fromEnvironment());
    $secretExecutor->enqueue($secretTask, $project, $activeForAssisted, 'VPS', 'project.mutate.assisted', ['mode' => 'PROJECT_ASSISTED_EDIT'], $now);
    $secretRun = $secretExecutor->runOnce($now); m12_assert(($secretRun['state'] ?? null) === 'FAILED' && $secretCalls === 1, 'credential-like assisted edit fails closed without retrying provider output');
    $secretCandidate = $pdo->prepare('SELECT count(*) FROM control_project_vault_revisions WHERE task_id=:task'); $secretCandidate->execute(['task' => $secretTask]); m12_assert((int) $secretCandidate->fetchColumn() === 0, 'credential-like assisted edit never creates a candidate revision');
    $secretTaskState = $pdo->prepare('SELECT state,failure_code FROM control_tasks WHERE task_id=:task'); $secretTaskState->execute(['task' => $secretTask]); $secretState = $secretTaskState->fetch(); m12_assert(($secretState['state'] ?? null) === 'FAILED' && ($secretState['failure_code'] ?? null) === 'CANDIDATE_SECRET_CONTENT', 'credential gate records a terminal canonical task failure');
    $pdo->exec("DELETE FROM control_provider_policies WHERE provider_id='openai'");

    // Native conversation provider failures must never become a successful
    // deterministic answer. Temporary failures retry the same persisted task
    // at most three times, then pause without duplicating work.
    $conversation = m12_uuid(); $message = m12_uuid(); $conversationTask = m12_uuid();
    $pdo->prepare('INSERT INTO control_conversations(conversation_id, user_id, project_id, created_at, updated_at, last_task_id, title, archived_at, origin) VALUES(:id, :user, :project, :at, :at, NULL, :title, NULL, :origin)')->execute(['id' => $conversation, 'user' => $owner, 'project' => $project, 'at' => $now, 'title' => 'M12 durable conversation', 'origin' => 'native']);
    $pdo->prepare("INSERT INTO control_conversation_messages(message_id, conversation_id, task_id, message_kind, sequence_no, body, idempotency_key, source_event_id, metadata_json, created_at) VALUES(:id, :conversation, NULL, 'USER', 1, :body, :key, NULL, NULL, :at)")->execute(['id' => $message, 'conversation' => $conversation, 'body' => 'สรุปสถานะโปรเจกต์นี้ให้หน่อย', 'key' => 'm12-conversation-0001', 'at' => $now]);
    $pdo->prepare("INSERT INTO control_tasks(task_id, user_id, project_id, goal, state, assigned_device_id, lease_expires_at, progress, result_summary, failure_code, idempotency_key, conversation_id, created_at, updated_at, cancelled_at) VALUES(:task, :user, :project, :goal, 'QUEUED', NULL, NULL, 0, NULL, NULL, :key, :conversation, :at, :at, NULL)")->execute(['task' => $conversationTask, 'user' => $owner, 'project' => $project, 'goal' => 'สรุปสถานะโปรเจกต์นี้ให้หน่อย', 'key' => 'native-m12-conversation-0001', 'conversation' => $conversation, 'at' => $now]);
    $executor->enqueue($conversationTask, $project, (string) $promoted['activeRevisionId'], 'VPS', 'agent.conversation', ['mode' => 'NATIVE_CONVERSATION', 'messageId' => $message], $now);
    m12_assert(($executor->runOnce($now)['state'] ?? null) === 'QUEUED', 'temporary provider failure requeues the same native task');
    m12_assert($executor->runOnce($now) === null, 'temporary provider retry observes deterministic backoff instead of hot-looping');
    $retry2 = gmdate('c', strtotime($now) + 61);
    m12_assert(($executor->runOnce($retry2)['state'] ?? null) === 'QUEUED', 'temporary provider retry stays bounded on the same task after first backoff');
    m12_assert($executor->runOnce($retry2) === null, 'second provider retry observes the longer deterministic backoff');
    $retry3 = gmdate('c', strtotime($retry2) + 301);
    m12_assert(($executor->runOnce($retry3)['state'] ?? null) === 'WAITING_FOR_CAPABILITY', 'temporary provider retry pauses after the third attempt');
    $failedConversation = $pdo->prepare('SELECT t.state AS task_state, t.failure_code, e.state AS execution_state, e.attempt_count FROM control_tasks t JOIN control_task_executions e ON e.task_id=t.task_id WHERE t.task_id=:task'); $failedConversation->execute(['task' => $conversationTask]); $failedConversationRow = $failedConversation->fetch();
    m12_assert(is_array($failedConversationRow) && $failedConversationRow['task_state'] === 'WAITING_FOR_WORKER' && $failedConversationRow['execution_state'] === 'WAITING_FOR_CAPABILITY' && (int) $failedConversationRow['attempt_count'] === 3 && $failedConversationRow['failure_code'] === 'PROVIDER_UNAVAILABLE', 'retry exhaustion is truthful and preserves the task');
    $fakeSuccess = $pdo->prepare("SELECT COUNT(*) FROM control_conversation_messages WHERE conversation_id=:conversation AND task_id=:task AND message_kind IN ('ASSISTANT','RESULT')"); $fakeSuccess->execute(['conversation' => $conversation, 'task' => $conversationTask]); m12_assert((int) $fakeSuccess->fetchColumn() === 0, 'provider failure never emits a successful assistant result');

    $pdo->prepare("INSERT INTO control_provider_policies(provider_id, enabled, model_fast, model_balanced, model_strong, monthly_budget_microunits, warning_microunits, input_microunits_per_million, output_microunits_per_million, updated_by_user_id, updated_at) VALUES('openai', 1, 'fixture-fast', 'fixture-balanced', 'fixture-strong', 100000000, 90000000, 1000000, 1000000, :owner, :at)")->execute(['owner' => $owner, 'at' => $now]);
    $historyPayload = null;
    $historyAgent = new HubNativeAgentService($pdo, static function (array $payload, string $_key) use (&$historyPayload): array { $historyPayload = $payload; return ['id' => 'resp_history_1234', 'output_text' => 'history schema ok', 'usage' => ['input_tokens' => 3, 'output_tokens' => 2]]; }, 'fixture-key');
    $historyAgent->respond($owner, $project, $conversation, $message, 'คำถามล่าสุด', [['role' => 'user', 'body' => 'คำถามก่อนหน้า'], ['role' => 'assistant', 'body' => 'คำตอบก่อนหน้า']], [], $now, []);
    $historyInput = is_array($historyPayload['input'] ?? null) ? $historyPayload['input'] : [];
    $assistantHistoryType = null; $userHistoryType = null;
    foreach ($historyInput as $item) { if (!is_array($item) || !is_array($item['content'] ?? null) || !is_string($item['role'] ?? null)) continue; $type = $item['content'][0]['type'] ?? null; if ($item['role'] === 'assistant') $assistantHistoryType = $type; elseif ($item['role'] === 'user' && $userHistoryType === null) $userHistoryType = $type; }
    m12_assert($assistantHistoryType === 'output_text' && $userHistoryType === 'input_text', 'Responses history uses output_text for assistant turns and input_text for user turns');

    $calls = 0; $statelessContinuation = false; $agent = new HubNativeAgentService($pdo, static function (array $payload, string $_key) use (&$calls, &$statelessContinuation): array { $calls++; if ($calls === 1) return ['id' => 'resp_fixture_1234', 'output' => [['type' => 'function_call', 'call_id' => 'call_fixture_1234', 'name' => 'project_search', 'arguments' => '{"query":"readme"}']], 'usage' => ['input_tokens' => 2, 'output_tokens' => 1]]; $input = is_array($payload['input'] ?? null) ? $payload['input'] : []; $hasToolOutput = false; foreach ($input as $item) if (is_array($item) && ($item['type'] ?? null) === 'function_call_output') $hasToolOutput = true; $statelessContinuation = !isset($payload['previous_response_id']) && isset($payload['tools']) && ($payload['store'] ?? null) === false && $hasToolOutput; return ['id' => 'resp_fixture_5678', 'output_text' => 'ตรวจจาก Vault แล้ว พบ README และยังไม่ได้แก้ source', 'usage' => ['input_tokens' => 3, 'output_tokens' => 4]]; }, 'fixture-key');
    $successConversation = m12_uuid(); $successMessage = m12_uuid(); $successTask = m12_uuid();
    $pdo->prepare('INSERT INTO control_conversations(conversation_id, user_id, project_id, created_at, updated_at, last_task_id, title, archived_at, origin) VALUES(:id, :user, :project, :at, :at, NULL, :title, NULL, :origin)')->execute(['id' => $successConversation, 'user' => $owner, 'project' => $project, 'at' => $now, 'title' => 'M12 provider success', 'origin' => 'native']);
    $pdo->prepare("INSERT INTO control_conversation_messages(message_id, conversation_id, task_id, message_kind, sequence_no, body, idempotency_key, source_event_id, metadata_json, created_at) VALUES(:id, :conversation, NULL, 'USER', 1, :body, :key, NULL, NULL, :at)")->execute(['id' => $successMessage, 'conversation' => $successConversation, 'body' => 'ตอบด้วย AI', 'key' => 'm12-conversation-success-0001', 'at' => $now]);
    $pdo->prepare("INSERT INTO control_tasks(task_id, user_id, project_id, goal, state, assigned_device_id, lease_expires_at, progress, result_summary, failure_code, idempotency_key, conversation_id, created_at, updated_at, cancelled_at) VALUES(:task, :user, :project, :goal, 'QUEUED', NULL, NULL, 0, NULL, NULL, :key, :conversation, :at, :at, NULL)")->execute(['task' => $successTask, 'user' => $owner, 'project' => $project, 'goal' => 'ตอบด้วย AI', 'key' => 'native-m12-conversation-success-0001', 'conversation' => $successConversation, 'at' => $now]);
    $conversationAgent = new HubNativeAgentService($pdo, static fn (array $_payload, string $_key): array => ['id' => 'resp_native_success_1234', 'output_text' => 'ตรวจจาก Vault แล้ว พบ README และยังไม่ได้แก้ source', 'usage' => ['input_tokens' => 3, 'output_tokens' => 4]], 'fixture-key');
    $agentExecutor = new HubDurableExecutionService($pdo, $vaults, $conversationAgent, HubArtifactStore::fromEnvironment()); $agentExecutor->enqueue($successTask, $project, (string) $promoted['activeRevisionId'], 'VPS', 'agent.conversation', ['mode' => 'NATIVE_CONVERSATION', 'messageId' => $successMessage], $now);
    m12_assert(($agentExecutor->runOnce($now)['state'] ?? null) === 'COMPLETED', 'real provider-shaped native response is the only path to completed conversation');
    $successAnswer = $pdo->prepare("SELECT body FROM control_conversation_messages WHERE conversation_id=:conversation AND task_id=:task AND message_kind='ASSISTANT' ORDER BY sequence_no DESC LIMIT 1"); $successAnswer->execute(['conversation' => $successConversation, 'task' => $successTask]); m12_assert(str_contains((string) $successAnswer->fetchColumn(), 'Vault'), 'successful native conversation writes actual provider text');

    $invalidAgent = new HubNativeAgentService($pdo, static fn (array $_payload, string $_key): array => ['usage' => ['input_tokens' => 11, 'output_tokens' => 3]], 'fixture-key');
    $failedUsageBefore = (int) $invalidAgent->status($owner, $now)['budget']['usedMicrounits'];
    try { $invalidAgent->respond($owner, $project, $successConversation, $successMessage, 'invalid response fixture', [], [], $now, []); throw new RuntimeException('invalid provider output was accepted'); }
    catch (HubNativeAgentException $error) { m12_assert($error->codeName === 'PROVIDER_FAILED', 'invalid provider output fails closed'); }
    $failedUsage = $pdo->query("SELECT status, input_tokens, output_tokens, estimated_microunits FROM control_provider_usage ORDER BY rowid DESC LIMIT 1")->fetch();
    m12_assert(is_array($failedUsage) && $failedUsage['status'] === 'FAILED' && (int) $failedUsage['input_tokens'] === 11 && (int) $failedUsage['output_tokens'] === 3 && (int) $failedUsage['estimated_microunits'] === 14, 'billable failed response is recorded as FAILED with known usage');
    m12_assert((int) $invalidAgent->status($owner, $now)['budget']['usedMicrounits'] >= $failedUsageBefore + 14, 'failed billable usage remains inside the budget guard');

    $failureAdapter = new HubOpenAiProviderAdapter();
    $failureMethod = (new ReflectionClass(HubOpenAiProviderAdapter::class))->getMethod('failure'); $failureMethod->setAccessible(true);
    $quotaFailure = $failureMethod->invoke($failureAdapter, 429, ['error' => ['type' => 'insufficient_quota', 'code' => 'insufficient_quota', 'message' => 'raw message must never persist']], 'fixture-fast');
    $rateFailure = $failureMethod->invoke($failureAdapter, 429, ['error' => ['type' => 'rate_limit_error', 'code' => 'rate_limit_exceeded']], 'fixture-fast');
    $permissionFailure = $failureMethod->invoke($failureAdapter, 403, ['error' => ['type' => 'permission_error', 'code' => 'project_forbidden']], 'fixture-fast');
    m12_assert($quotaFailure['code'] === 'PROVIDER_QUOTA_EXHAUSTED' && $rateFailure['code'] === 'PROVIDER_RATE_LIMITED' && $permissionFailure['code'] === 'PROVIDER_PERMISSION_DENIED', 'provider diagnostics distinguish quota, rate limit, and permission failures');
    m12_assert(!str_contains(json_encode([$quotaFailure, $rateFailure, $permissionFailure], JSON_THROW_ON_ERROR), 'raw message'), 'sanitized provider diagnostic never retains raw provider messages');
    $toolUsed = false; $agentResult = $agent->respondWithTools($owner, $project, null, null, 'ตรวจ README', [], [], ['vaultRevision' => $promoted['activeRevisionId']], [['type' => 'function', 'name' => 'project_search', 'description' => 'read only', 'parameters' => ['type' => 'object', 'additionalProperties' => false, 'properties' => ['query' => ['type' => 'string']], 'required' => ['query']]]], static function (string $name, array $arguments) use (&$toolUsed): array { $toolUsed = $name === 'project_search' && ($arguments['query'] ?? null) === 'readme'; return ['files' => [['path' => 'README.md']]]; }, $now);
    m12_assert($toolUsed && $calls === 2 && $statelessContinuation && str_contains((string) ($agentResult['summary'] ?? ''), 'Vault'), 'bounded provider-independent tool loop uses stateless continuation and returns a natural answer');

    // A provider failure in the planner must still preserve the bounded
    // continuation contract. The planner fallback is scalar NEXT text, so
    // the canonical materializer remains reachable without claiming AI work.
    $continuationConversation = m12_uuid(); $continuationRoot = m12_uuid(); $pdo->prepare('INSERT INTO control_conversations(conversation_id, user_id, project_id, created_at, updated_at, last_task_id, title, archived_at, origin) VALUES(:id, :user, :project, :at, :at, NULL, :title, NULL, :origin)')->execute(['id' => $continuationConversation, 'user' => $owner, 'project' => $project, 'at' => $now, 'title' => 'M12 continuation fallback', 'origin' => 'native']);
    $pdo->prepare("INSERT INTO control_tasks(task_id, user_id, project_id, goal, state, assigned_device_id, lease_expires_at, progress, result_summary, failure_code, idempotency_key, conversation_id, created_at, updated_at, cancelled_at) VALUES(:task, :user, :project, 'ตรวจ README ต่อเนื่องแบบ read-only', 'QUEUED', NULL, NULL, 0, NULL, NULL, :key, :conversation, :at, :at, NULL)")->execute(['task' => $continuationRoot, 'user' => $owner, 'project' => $project, 'key' => 'm12-continuation-fallback-0001', 'conversation' => $continuationConversation, 'at' => $now]);
    $continuationMaterialized = null; $continuationFailureAgent = new HubNativeAgentService($pdo, static fn (array $_payload, string $_key): array => ['usage' => ['input_tokens' => 2, 'output_tokens' => 1]], 'fixture-key');
    $continuationExecutor = new HubDurableExecutionService($pdo, $vaults, $continuationFailureAgent, HubArtifactStore::fromEnvironment(), static function (array $request) use (&$continuationMaterialized): array { $continuationMaterialized = $request; return ['taskId' => $request['parentTaskId']]; });
    $continuationExecutor->enqueue($continuationRoot, $project, (string) $promoted['activeRevisionId'], 'VPS', 'project.read', ['mode' => 'PROJECT_INSPECTION', 'continuation' => ['enabled' => true, 'rootTaskId' => $continuationRoot, 'step' => 0, 'maxSteps' => 6]], $now);
    m12_assert(($continuationExecutor->runOnce($now)['state'] ?? null) === 'COMPLETED', 'provider-failed inspection still completes via deterministic read-only fallback');
    m12_assert(is_array($continuationMaterialized) && ($continuationMaterialized['rootTaskId'] ?? null) === $continuationRoot && ($continuationMaterialized['step'] ?? null) === 1 && str_starts_with((string) ($continuationMaterialized['goal'] ?? ''), 'ตรวจ Project Vault'), 'provider-failed planner preserves canonical continuation lineage through the materializer');
    m12_assert($pdo->query('PRAGMA integrity_check')->fetchColumn() === 'ok' && $pdo->query('PRAGMA foreign_key_check')->fetchAll() === [], 'M12 preserves database integrity and foreign keys');
    fwrite(STDOUT, "AWH M12 Central Project Authority: PASS\n");
} finally { putenv('AWH_PROJECT_VAULT_ROOT'); putenv('AWH_ATTACHMENT_ROOT'); putenv('AWH_PROVIDER_CREDENTIAL_ROOT'); putenv('AWH_ARTIFACT_ROOT'); putenv('AWH_TASK_WORKSPACE_ROOT'); m12_clean($root); }
