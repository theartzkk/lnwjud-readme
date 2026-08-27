from pathlib import Path

root = Path(__file__).resolve().parents[2]
service = root / 'hub/src/HubControlPlaneService.php'
router = root / 'hub/src/HubControlPlaneRouter.php'
s = service.read_text()

if 'materializeAutomationSubmission' not in s:
    old = "require_once __DIR__ . '/HubFoundingMemoryService.php';\n"
    assert old in s
    s = s.replace(old, old + "require_once __DIR__ . '/HubAutomationRegistryService.php';\n", 1)

    old = "    private readonly ?HubCapabilityRegistryService $capabilities;\n"
    assert old in s
    s = s.replace(old, old + "    private readonly ?HubAutomationRegistryService $automations;\n", 1)

    old = "        $this->capabilities = HubCapabilityRegistryService::schemaPresent($pdo) ? new HubCapabilityRegistryService($pdo) : null;\n"
    assert old in s
    s = s.replace(old, old + "        $this->automations = $this->automationSchemaPresent() ? new HubAutomationRegistryService($pdo) : null;\n", 1)

    start = s.index("    public function submitTask(string $sessionToken")
    end = s.index("\n    /** @return array{schemaVersion:int,conversation:?array", start)
    task = '''    public function submitTask(string $sessionToken, string $csrfToken, array $payload, ?string $now = null): array
    {
        $session = $this->authorizeSession($sessionToken, $csrfToken, $now);
        return $this->submitTaskForUser((string) $session['user_id'], $payload, $now);
    }

    private function submitTaskForUser(string $userId, array $payload, ?string $now = null): array
    {
        self::exactKeys($payload, ['goal', 'idempotencyKey', 'projectId', 'schemaVersion']);
        if (($payload['schemaVersion'] ?? null) !== 1) throw new HubControlPlaneException('Unsupported task schema', 'SCHEMA_VERSION');
        $projectId = self::uuid((string) ($payload['projectId'] ?? ''));
        $goal = self::goal((string) ($payload['goal'] ?? ''));
        $idempotency = self::idempotency((string) ($payload['idempotencyKey'] ?? ''));
        $this->assertProjectMember($userId, $projectId);
        $now = self::timestamp($now ?? gmdate('c'));
        $existing = $this->pdo->prepare('SELECT * FROM control_tasks WHERE user_id = :user AND idempotency_key = :key');
        $existing->execute(['user' => $userId, 'key' => $idempotency]);
        $row = $existing->fetch();
        if (is_array($row)) return $this->taskRow($row);
        $taskId = self::uuidFromBytes(random_bytes(16)); $vaultRevision = $this->centralVaultRevision($projectId); $serverInspection = $vaultRevision !== null && self::isServerInspection($goal); $serverTextMutation = $vaultRevision !== null && self::isServerTextNormalization($goal); $serverAssistedEdit = $vaultRevision !== null && self::isServerAssistedEdit($goal);
        try {
            $insert = $this->pdo->prepare('INSERT INTO control_tasks(task_id, user_id, project_id, goal, state, assigned_device_id, lease_expires_at, progress, result_summary, failure_code, idempotency_key, created_at, updated_at, cancelled_at) VALUES(:id, :user, :project, :goal, :state, NULL, NULL, 0, NULL, NULL, :key, :created, :updated, NULL)');
            $state = ($serverInspection || $serverTextMutation || $serverAssistedEdit) ? 'QUEUED' : 'WAITING_FOR_WORKER'; $insert->execute(['id' => $taskId, 'user' => $userId, 'project' => $projectId, 'goal' => $goal, 'state' => $state, 'key' => $idempotency, 'created' => $now, 'updated' => $now]);
            if ($vaultRevision !== null) $this->execution->enqueue($taskId, $projectId, $vaultRevision, ($serverInspection || $serverTextMutation || $serverAssistedEdit) ? 'VPS' : 'CODEX', $serverTextMutation ? 'project.mutate.text' : ($serverAssistedEdit ? 'project.mutate.assisted' : ($serverInspection ? 'project.read' : 'codex:cli')), ['mode' => $serverTextMutation ? 'PROJECT_TEXT_NORMALIZE' : ($serverAssistedEdit ? 'PROJECT_ASSISTED_EDIT' : ($serverInspection ? 'PROJECT_INSPECTION' : 'ENGINEERING_SPECIALIST'))], $now);
            $this->event($taskId, $state, 0, $vaultRevision !== null && !$serverInspection && !$serverTextMutation ? 'waiting for an engineering specialist capability' : 'received', $now);
        } catch (Throwable) { throw new HubControlPlaneException('Task could not be queued', 'TASK_CREATE_FAILED'); }
        return $this->taskById($taskId, $userId);
    }

    /** Canonical server-side materializer used only by the bounded automation scheduler. */
    public function materializeAutomationSubmission(string $userId, array $definition, string $occurrenceAt, ?string $now = null): array
    {
        if ($this->automations === null) throw new HubControlPlaneException('Automation registry is not ready', 'AUTOMATION_SCHEMA_NOT_READY');
        $userId = self::uuid($userId);
        self::exactKeys($definition, ['automationId','condition','conversationId','enabled','goal','name','projectId','schedule','schemaVersion','timingMode']);
        if (($definition['schemaVersion'] ?? null) !== 1 || ($definition['enabled'] ?? null) !== true) throw new HubControlPlaneException('Automation definition is not active', 'AUTOMATION_INVALID');
        $automationId = self::uuid((string)($definition['automationId'] ?? ''));
        try { $stored = $this->automations->get($userId, $automationId); } catch (HubAutomationRegistryException) { throw new HubControlPlaneException('Automation definition is unavailable', 'AUTOMATION_INVALID'); }
        if (!is_array($stored['definition'] ?? null) || $stored['definition'] !== $definition || ($stored['archivedAt'] ?? null) !== null) throw new HubControlPlaneException('Automation definition changed before materialization', 'AUTOMATION_INVALID');
        $projectId = self::uuid((string)($definition['projectId'] ?? ''));
        $goal = self::goal((string)($definition['goal'] ?? ''));
        $occurrence = self::timestamp($occurrenceAt);
        $canonicalOccurrence = gmdate('Y-m-d\\TH:i:s.000\\Z', strtotime($occurrence));
        $key = 'automation.' . substr(hash('sha256', $automationId . "\\n" . $canonicalOccurrence), 0, 40);
        if (is_string($definition['conversationId'] ?? null)) {
            $conversationId = self::uuid((string)$definition['conversationId']);
            $result = $this->submitConversationForUser($userId, ['schemaVersion'=>3,'projectId'=>$projectId,'conversationId'=>$conversationId,'message'=>$goal,'attachmentIds'=>[],'idempotencyKey'=>$key], $now);
            return ['schemaVersion'=>1,'kind'=>'CONVERSATION','idempotencyKey'=>$key,'result'=>$result];
        }
        $result = $this->submitTaskForUser($userId, ['schemaVersion'=>1,'projectId'=>$projectId,'goal'=>$goal,'idempotencyKey'=>$key], $now);
        return ['schemaVersion'=>1,'kind'=>'TASK','idempotencyKey'=>$key,'result'=>$result];
    }

'''
    s = s[:start] + task + s[end:]

    anchor = "    /** Hub-authoritative project list for an enrolled Desktop device. Local folders are optional capabilities, not project authority. */\n"
    assert anchor in s
    api = '''    public function automations(string $sessionToken, ?string $now = null): array
    {
        $session = $this->sessionRow($sessionToken, $now); $this->assertOwner((string)$session['user_id']);
        if ($this->automations === null) return ['schemaVersion'=>1,'available'=>false,'automations'=>[]];
        return ['schemaVersion'=>1,'available'=>true,'automations'=>$this->automations->listForUser((string)$session['user_id'])];
    }

    public function createAutomation(string $sessionToken, string $csrfToken, array $payload, ?string $now = null): array
    {
        $session = $this->authorizeSession($sessionToken, $csrfToken, $now); $this->assertOwner((string)$session['user_id']); self::exactKeys($payload, ['definition','schemaVersion']);
        if (($payload['schemaVersion'] ?? null) !== 1 || !is_array($payload['definition'] ?? null)) throw new HubControlPlaneException('Automation payload is invalid', 'AUTOMATION_INVALID');
        return ['schemaVersion'=>1,'automation'=>$this->automationCall(fn(HubAutomationRegistryService $r) => $r->create((string)$session['user_id'], $payload['definition'], $now))];
    }

    public function replaceAutomation(string $sessionToken, string $csrfToken, string $automationId, array $payload, ?string $now = null): array
    {
        $session = $this->authorizeSession($sessionToken, $csrfToken, $now); $this->assertOwner((string)$session['user_id']); self::exactKeys($payload, ['definition','schemaVersion']);
        if (($payload['schemaVersion'] ?? null) !== 1 || !is_array($payload['definition'] ?? null)) throw new HubControlPlaneException('Automation payload is invalid', 'AUTOMATION_INVALID');
        return ['schemaVersion'=>1,'automation'=>$this->automationCall(fn(HubAutomationRegistryService $r) => $r->replace((string)$session['user_id'], self::uuid($automationId), $payload['definition'], $now))];
    }

    public function setAutomationEnabled(string $sessionToken, string $csrfToken, string $automationId, array $payload, ?string $now = null): array
    {
        $session = $this->authorizeSession($sessionToken, $csrfToken, $now); $this->assertOwner((string)$session['user_id']); self::exactKeys($payload, ['enabled','schemaVersion']);
        if (($payload['schemaVersion'] ?? null) !== 1 || !is_bool($payload['enabled'] ?? null)) throw new HubControlPlaneException('Automation enabled state is invalid', 'AUTOMATION_INVALID');
        return ['schemaVersion'=>1,'automation'=>$this->automationCall(fn(HubAutomationRegistryService $r) => $r->setEnabled((string)$session['user_id'], self::uuid($automationId), (bool)$payload['enabled'], $now))];
    }

    public function archiveAutomation(string $sessionToken, string $csrfToken, string $automationId, array $payload, ?string $now = null): array
    {
        $session = $this->authorizeSession($sessionToken, $csrfToken, $now); $this->assertOwner((string)$session['user_id']); self::exactKeys($payload, ['schemaVersion']);
        if (($payload['schemaVersion'] ?? null) !== 1) throw new HubControlPlaneException('Automation archive schema is invalid', 'AUTOMATION_INVALID');
        return ['schemaVersion'=>1,'automation'=>$this->automationCall(fn(HubAutomationRegistryService $r) => $r->archive((string)$session['user_id'], self::uuid($automationId), $now))];
    }

'''
    s = s.replace(anchor, api + anchor, 1)

    anchor = "    private function anywhereExecutionSchemaPresent(): bool { return HubCapabilityRegistryService::schemaPresent($this->pdo); }\n"
    assert anchor in s
    helper = '''    private function automationSchemaPresent(): bool { try { return (int)$this->pdo->query('PRAGMA user_version')->fetchColumn() >= 15 && $this->pdo->query("SELECT 1 FROM sqlite_master WHERE type='table' AND name='control_automations'")->fetchColumn() === 1; } catch (Throwable) { return false; } }
    /** @param callable(HubAutomationRegistryService):array<string,mixed> $operation @return array<string,mixed> */
    private function automationCall(callable $operation): array
    {
        if ($this->automations === null) throw new HubControlPlaneException('Automation registry is not ready', 'AUTOMATION_SCHEMA_NOT_READY');
        try { return $operation($this->automations); }
        catch (HubAutomationRegistryException $error) {
            $map=['PROJECT_ACCESS_DENIED'=>'PROJECT_FORBIDDEN','CONVERSATION_ACCESS_DENIED'=>'PROJECT_FORBIDDEN','AUTOMATION_NOT_FOUND'=>'AUTOMATION_NOT_FOUND','AUTOMATION_ARCHIVED'=>'AUTOMATION_CONFLICT','AUTOMATION_CONFLICT'=>'AUTOMATION_CONFLICT'];
            throw new HubControlPlaneException('Automation request was rejected', $map[$error->codeName] ?? 'AUTOMATION_INVALID');
        }
    }
'''
    s = s.replace(anchor, anchor + helper, 1)
    service.write_text(s)

r = router.read_text()
if "/api/v1/control/automations') return" not in r:
    old = "                if ($path === '/api/v1/control/tasks') return self::response(200, $service->listTasks($sessionToken) + ['requestId' => $requestId], $headers);\n"
    assert old in r
    r = r.replace(old, old + "                if ($path === '/api/v1/control/automations') return self::response(200, $service->automations($sessionToken) + ['requestId' => $requestId], $headers);\n", 1)
    old = "            if ($path === '/api/v1/control/tasks') { self::sameOrigin($server); return self::response(201, $service->submitTask(self::cookie($server, '__Host-awh_control_session'), self::csrf($server), $payload) + ['requestId' => $requestId], $headers); }\n"
    assert old in r
    routes = """            if ($path === '/api/v1/control/automations') { self::sameOrigin($server); return self::response(201, $service->createAutomation(self::cookie($server, '__Host-awh_control_session'), self::csrf($server), $payload) + ['requestId' => $requestId], $headers); }
            if (preg_match('#^/api/v1/control/automations/(' . self::UUID . ')$#i', $path, $match) === 1) { self::sameOrigin($server); return self::response(200, $service->replaceAutomation(self::cookie($server, '__Host-awh_control_session'), self::csrf($server), $match[1], $payload) + ['requestId' => $requestId], $headers); }
            if (preg_match('#^/api/v1/control/automations/(' . self::UUID . ')/enabled$#i', $path, $match) === 1) { self::sameOrigin($server); return self::response(200, $service->setAutomationEnabled(self::cookie($server, '__Host-awh_control_session'), self::csrf($server), $match[1], $payload) + ['requestId' => $requestId], $headers); }
            if (preg_match('#^/api/v1/control/automations/(' . self::UUID . ')/archive$#i', $path, $match) === 1) { self::sameOrigin($server); return self::response(200, $service->archiveAutomation(self::cookie($server, '__Host-awh_control_session'), self::csrf($server), $match[1], $payload) + ['requestId' => $requestId], $headers); }
""" + old
    r = r.replace(old, routes, 1)
    r = r.replace("'TASK_NOT_FOUND', 'CONVERSATION_NOT_FOUND', 'APPROVAL_NOT_FOUND'", "'TASK_NOT_FOUND', 'CONVERSATION_NOT_FOUND', 'AUTOMATION_NOT_FOUND', 'APPROVAL_NOT_FOUND'", 1)
    r = r.replace("'PROJECT_REVISION_CONFLICT', 'TASK_WORKSPACE_CONFLICT', 'PROVIDER_CREDENTIAL_STATE_UNCERTAIN' => 409", "'PROJECT_REVISION_CONFLICT', 'TASK_WORKSPACE_CONFLICT', 'PROVIDER_CREDENTIAL_STATE_UNCERTAIN', 'AUTOMATION_CONFLICT' => 409", 1)
    r = r.replace("'EXECUTION_INVALID', 'TASK_WORKSPACE_INVALID' => 400", "'EXECUTION_INVALID', 'TASK_WORKSPACE_INVALID', 'AUTOMATION_INVALID' => 400", 1)
    r = r.replace("'EXECUTION_CLAIM_FAILED' => 503", "'EXECUTION_CLAIM_FAILED', 'AUTOMATION_SCHEMA_NOT_READY' => 503", 1)
    router.write_text(r)

print('V18_BACKEND_PATCHED')
