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
require_once dirname(__DIR__) . '/src/HubWorkspaceProductMigration.php';
require_once dirname(__DIR__) . '/src/HubEnrollmentService.php';
require_once dirname(__DIR__) . '/src/HubOwnerAuthService.php';
require_once dirname(__DIR__) . '/src/HubControlPlaneService.php';

function m13_assert(bool $ok, string $message): void { if (!$ok) throw new RuntimeException($message); }
function m13_clean(string $root): void { if (!is_dir($root)) return; $it = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($root, FilesystemIterator::SKIP_DOTS), RecursiveIteratorIterator::CHILD_FIRST); foreach ($it as $file) { $path = $file->getPathname(); $file->isDir() ? @rmdir($path) : @unlink($path); } @rmdir($root); }

if (!in_array('sqlite', PDO::getAvailableDrivers(), true)) { fwrite(STDOUT, "AWH M13 Workspace Product: SKIP pdo_sqlite unavailable\n"); exit(77); }
$root = rtrim(sys_get_temp_dir(), '/') . '/awh-m13-' . bin2hex(random_bytes(6));
$base = dirname(__DIR__); $db = $root . '/awh.sqlite'; $now = gmdate('c');
$owner = '223b45c0-23e1-408d-ae0f-ac5eca7f6900'; $project = '113b45c0-23e1-408d-ae0f-ac5eca7f6900';
$ownerPassword = 'owner correct battery staple'; $teacherTemp = 'teacher temporary pass'; $teacherPassword = 'teacher permanent password';
try {
    mkdir($root, 0700, true);
    foreach (['vault','attachments','credentials','artifacts','workspaces'] as $name) mkdir($root . '/' . $name, 0700, true);
    putenv('AWH_PROJECT_VAULT_ROOT=' . $root . '/vault'); putenv('AWH_ATTACHMENT_ROOT=' . $root . '/attachments');
    putenv('AWH_PROVIDER_CREDENTIAL_ROOT=' . $root . '/credentials'); putenv('AWH_ARTIFACT_ROOT=' . $root . '/artifacts'); putenv('AWH_TASK_WORKSPACE_ROOT=' . $root . '/workspaces');
    $pdo = new PDO('sqlite:' . $db, null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC]);
    $pdo->exec('PRAGMA foreign_keys = ON'); $pdo->exec(file_get_contents($base . '/schema.sql'));
    foreach (['enrollment_rate_limits','device_project_memberships','device_tokens','pairing_projects','pairing_codes','user_project_memberships','device_enrollments','owner_bootstrap','hub_users'] as $table) $pdo->exec('DROP TABLE IF EXISTS ' . $table);
    $pdo->prepare('INSERT INTO projects(project_id,name,type,created_at,source_revision,observed_at,provenance) VALUES(:id,:name,:type,:at,NULL,:at,:source)')->execute(['id'=>$project,'name'=>'M13 Fixture','type'=>'php','at'=>$now,'source'=>'m13-test']);
    m13_assert(HubSchemaMigration::apply($db, $base . '/migrations/001_m3e_enrollment.sql', $now, false, $base . '/schema.sql') === 'applied', 'M3E');
    m13_assert(HubEnrollmentApiMigration::apply($db, $base . '/migrations/002_m3e2_enrollment_api.sql', $now) === 'applied', 'M3E2');
    HubEnrollmentService::openExisting($db)->initializeOwner($owner, 'Art Owner', [$project], $now);
    m13_assert(HubControlPlaneMigration::apply($db, $base . '/migrations/003_m4_control_plane.sql', $now) === 'applied', 'M4');
    m13_assert(HubOwnerAuthMigration::apply($db, $base . '/migrations/004_owner_auth.sql', $now) === 'applied', 'M5');
    HubOwnerAuthService::openExisting($db)->provisionInitial('art', $ownerPassword, $now);
    foreach ([[HubAssistantWorkstreamMigration::class,'005_assistant_workstream.sql'],[HubWorkspaceContinuityMigration::class,'006_workspace_continuity.sql'],[HubUnifiedWorkspaceMigration::class,'007_unified_workspace.sql']] as [$class,$sql]) m13_assert($class::apply($db, $base . '/migrations/' . $sql, $now) === 'applied', $sql);
    m13_assert(HubFinalProductMigration::apply($db, $base . '/migrations/008_final_product.sql', $now) === 'applied', 'M9');
    m13_assert(HubFoundingMemoryMigration::apply($db, $base . '/migrations/009_founding_memory.sql', $now) === 'applied', 'M10');
    m13_assert(HubSelfServiceMigration::apply($db, $base . '/migrations/010_self_service.sql', $now) === 'applied', 'M11');
    m13_assert(HubCentralProjectAuthorityMigration::apply($db, $base . '/migrations/011_central_project_authority.sql', $now) === 'applied', 'M12');
    m13_assert(HubWorkspaceProductMigration::apply($db, $base . '/migrations/012_workspace_product.sql', $now) === 'applied', 'M13');
    m13_assert(HubWorkspaceProductMigration::apply($db, $base . '/migrations/012_workspace_product.sql', $now) === 'already-applied', 'M13 idempotent');
    m13_assert((int) $pdo->query('PRAGMA user_version')->fetchColumn() === 13, 'schema version 13');
    m13_assert($pdo->query("SELECT workspace_role FROM control_user_profiles WHERE user_id='$owner'")->fetchColumn() === 'OWNER', 'owner workspace role migrated');
    m13_assert($pdo->query('PRAGMA integrity_check')->fetchColumn() === 'ok' && $pdo->query('PRAGMA foreign_key_check')->fetchAll() === [], 'M13 migration integrity');

    $auth = HubOwnerAuthService::openExisting($db); $control = HubControlPlaneService::openExisting($db);
    $ownerSession = $auth->login('art', $ownerPassword, false, 'm13-owner', $now);
    m13_assert(($ownerSession['role'] ?? null) === 'OWNER' && ($ownerSession['mustChangePassword'] ?? true) === false, 'owner conventional login');
    $dbView = $control->databaseOverview($ownerSession['sessionToken'], $now);
    m13_assert(($dbView['database']['schemaVersion'] ?? null) === 13 && ($dbView['database']['rawSqlEnabled'] ?? true) === false && ($dbView['database']['health'] ?? null) === 'HEALTHY', 'owner database center is guarded and healthy');
    $teacherCreated = $auth->createUser($ownerSession['sessionToken'], $ownerSession['csrfToken'], ['schemaVersion'=>1,'displayName'=>'Teacher One','username'=>'teacher.one','email'=>'teacher.one@example.test','temporaryPassword'=>$teacherTemp,'role'=>'TEACHER','projectIds'=>[$project]], $now);
    m13_assert(($teacherCreated['role'] ?? null) === 'TEACHER' && ($teacherCreated['mustChangePassword'] ?? false) === true, 'teacher created without invitation UX');
    $teacherTempSession = $auth->login('teacher.one@example.test', $teacherTemp, false, 'm13-teacher-temp', $now);
    m13_assert(($teacherTempSession['role'] ?? null) === 'TEACHER' && ($teacherTempSession['mustChangePassword'] ?? false) === true, 'email login accepts temporary password only for first-login gate');
    try { $control->listProjectsForSession($teacherTempSession['sessionToken'], $now); throw new RuntimeException('temporary password reached workspace'); }
    catch (HubControlPlaneException $error) { m13_assert($error->codeName === 'PASSWORD_CHANGE_REQUIRED', 'temporary password is backend-gated'); }
    $auth->changePassword($teacherTempSession['sessionToken'], $teacherTempSession['csrfToken'], $teacherTemp, $teacherPassword);
    try { $auth->login('teacher.one', $teacherTemp, false, 'm13-old-temp', $now); throw new RuntimeException('temporary password survived change'); }
    catch (HubOwnerAuthException $error) { m13_assert($error->codeName === 'AUTH_FAILED', 'temporary password is invalidated'); }
    $teacher = $auth->login('teacher.one@example.test', $teacherPassword, false, 'm13-teacher', $now);
    $identity = $auth->identity($teacher['sessionToken']);
    m13_assert(($teacher['mustChangePassword'] ?? true) === false && ($identity['features']['ai.chat'] ?? false) === true && ($identity['features']['developer.use'] ?? true) === false, 'teacher receives human workspace feature policy');
    $teacherProjects = $control->listProjectsForSession($teacher['sessionToken'], $now)['projects'];
    $caps = $teacherProjects[0]['capabilities'] ?? [];
    m13_assert(in_array('conversation.write', $caps, true) && in_array('attachment.upload', $caps, true) && !in_array('approval.decide', $caps, true), 'teacher project capabilities are bounded');
    $conversation = $control->createConversation($teacher['sessionToken'], $teacher['csrfToken'], ['schemaVersion'=>2,'projectId'=>$project,'title'=>'Teacher Work'], $now);
    m13_assert(($conversation['conversation']['title'] ?? null) === 'Teacher Work', 'teacher can use AI workspace on granted project');
    $auth->updateManagedUserFeatures($ownerSession['sessionToken'], $ownerSession['csrfToken'], $teacherCreated['userId'], ['schemaVersion'=>1,'features'=>['ai.chat'=>false]], $now);
    $teacherBlocked = $auth->login('teacher.one', $teacherPassword, false, 'm13-teacher-blocked', $now);
    m13_assert(($auth->identity($teacherBlocked['sessionToken'])['features']['ai.chat'] ?? true) === false, 'feature override persists in auth authority');
    try { $control->createConversation($teacherBlocked['sessionToken'], $teacherBlocked['csrfToken'], ['schemaVersion'=>2,'projectId'=>$project,'title'=>'Blocked'], $now); throw new RuntimeException('disabled AI feature reached conversation write'); }
    catch (HubControlPlaneException $error) { m13_assert($error->codeName === 'FEATURE_FORBIDDEN', 'feature override is enforced by backend'); }
    try { $control->databaseOverview($teacherBlocked['sessionToken'], $now); throw new RuntimeException('teacher reached database center'); }
    catch (HubControlPlaneException $error) { m13_assert($error->codeName === 'OWNER_FORBIDDEN', 'database center is owner-only'); }

    $viewerTemp = 'viewer temporary pass'; $viewerPassword = 'viewer permanent password';
    $viewerCreated = $auth->createUser($ownerSession['sessionToken'], $ownerSession['csrfToken'], ['schemaVersion'=>1,'displayName'=>'Viewer One','username'=>'viewer.one','email'=>null,'temporaryPassword'=>$viewerTemp,'role'=>'VIEWER','projectIds'=>[$project]], $now);
    $viewerFirst = $auth->login('viewer.one', $viewerTemp, false, 'm13-viewer-temp', $now); $auth->changePassword($viewerFirst['sessionToken'], $viewerFirst['csrfToken'], $viewerTemp, $viewerPassword);
    $viewer = $auth->login('viewer.one', $viewerPassword, false, 'm13-viewer', $now);
    try { $control->createConversation($viewer['sessionToken'], $viewer['csrfToken'], ['schemaVersion'=>2,'projectId'=>$project,'title'=>'No Write'], $now); throw new RuntimeException('viewer created conversation'); }
    catch (HubControlPlaneException $error) { m13_assert(in_array($error->codeName, ['FEATURE_FORBIDDEN','PROJECT_FORBIDDEN'], true), 'viewer cannot create conversation'); }

    $adminTemp = 'admin temporary pass'; $adminPassword = 'admin permanent password';
    $adminCreated = $auth->createUser($ownerSession['sessionToken'], $ownerSession['csrfToken'], ['schemaVersion'=>1,'displayName'=>'Admin One','username'=>'admin.one','email'=>'admin.one@example.test','temporaryPassword'=>$adminTemp,'role'=>'ADMIN','projectIds'=>[$project]], $now);
    $adminFirst = $auth->login('admin.one', $adminTemp, false, 'm13-admin-temp', $now); $auth->changePassword($adminFirst['sessionToken'], $adminFirst['csrfToken'], $adminTemp, $adminPassword);
    $admin = $auth->login('admin.one@example.test', $adminPassword, false, 'm13-admin', $now);
    $staff = $auth->createUser($admin['sessionToken'], $admin['csrfToken'], ['schemaVersion'=>1,'displayName'=>'Staff One','username'=>'staff.one','email'=>null,'temporaryPassword'=>'staff temporary pass','role'=>'STAFF','projectIds'=>[]], $now);
    m13_assert(($staff['role'] ?? null) === 'STAFF', 'admin can create ordinary staff account');
    try { $auth->createUser($admin['sessionToken'], $admin['csrfToken'], ['schemaVersion'=>1,'displayName'=>'Admin Two','username'=>'admin.two','email'=>null,'temporaryPassword'=>'another admin pass','role'=>'ADMIN','projectIds'=>[]], $now); throw new RuntimeException('admin created peer admin'); }
    catch (HubOwnerAuthException $error) { m13_assert($error->codeName === 'USER_ACCESS_FORBIDDEN', 'admin cannot create peer admin'); }
    $auth->setManagedUserEnabled($ownerSession['sessionToken'], $ownerSession['csrfToken'], $viewerCreated['userId'], ['schemaVersion'=>1,'enabled'=>false], $now);
    try { $auth->login('viewer.one', $viewerPassword, false, 'm13-viewer-disabled', $now); throw new RuntimeException('disabled user logged in'); }
    catch (HubOwnerAuthException $error) { m13_assert($error->codeName === 'AUTH_FAILED', 'disabled user login fails closed'); }

    $people = $auth->people($ownerSession['sessionToken'], $now)['people'];
    m13_assert(count($people) >= 5 && count(array_filter($people, static fn(array $row): bool => ($row['role'] ?? null) === 'TEACHER')) >= 1, 'user registry exposes workspace roles');
    m13_assert($pdo->query('PRAGMA integrity_check')->fetchColumn() === 'ok' && $pdo->query('PRAGMA foreign_key_check')->fetchAll() === [], 'M13 runtime preserves database integrity');
    fwrite(STDOUT, "AWH M13 Workspace Product: PASS\n");
} finally {
    foreach (['AWH_PROJECT_VAULT_ROOT','AWH_ATTACHMENT_ROOT','AWH_PROVIDER_CREDENTIAL_ROOT','AWH_ARTIFACT_ROOT','AWH_TASK_WORKSPACE_ROOT'] as $key) putenv($key);
    m13_clean($root);
}
