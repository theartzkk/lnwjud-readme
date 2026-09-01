<?php

declare(strict_types=1);

require_once __DIR__ . '/HubProviderCredentialStore.php';
require_once __DIR__ . '/HubCapabilityRegistryService.php';
require_once __DIR__ . '/HubArtifactStore.php';

final class HubAiPassFindingsException extends RuntimeException
{
    public function __construct(string $message, public readonly string $codeName = 'CLOUD_FINDINGS_INVALID') { parent::__construct($message); }
}

/** Pure validator for existing scripts/review/aipass-findings.schema.json contract. */
final class HubAiPassFindingsValidator
{
    private const MAX_BYTES = 65536;
    private const VERDICTS = ['PASS','REVIEW','BLOCK'];
    private const SEVERITIES = ['P0','P1','P2'];
    private const SCORE_KEYS = ['chat','mobile','agentic','artifact','recovery'];
    private const LAYERS = ['intent-router','conversation','task-execution','artifact','navigation','composer','copy','mobile-layout','recovery','accessibility','architecture','unknown'];

    /** @return array<string,mixed> */
    public static function validateJson(string $json, string $expectedRevision): array
    {
        if ($json === '' || strlen($json) > self::MAX_BYTES || preg_match('/^[0-9a-f]{40}$/', $expectedRevision) !== 1) self::fail('document');
        try { $value = json_decode($json, true, 32, JSON_THROW_ON_ERROR); } catch (Throwable) { self::fail('json'); }
        if (!is_array($value) || array_is_list($value)) self::fail('object');
        self::exactKeys($value, ['schemaVersion','revision','reviewer','verdict','scores','findings']);
        if (($value['schemaVersion'] ?? null) !== 1 || ($value['revision'] ?? null) !== $expectedRevision) self::fail('revision');
        self::text($value['reviewer'] ?? null, 2, 80, 'reviewer');
        $verdict = $value['verdict'] ?? null; if (!is_string($verdict) || !in_array($verdict, self::VERDICTS, true)) self::fail('verdict');
        $scores = $value['scores'] ?? null; if (!is_array($scores) || array_is_list($scores)) self::fail('scores'); self::exactKeys($scores, self::SCORE_KEYS);
        foreach (self::SCORE_KEYS as $key) if (!is_int($scores[$key] ?? null) || $scores[$key] < 0 || $scores[$key] > 100) self::fail('scores.'.$key);
        $findings = $value['findings'] ?? null; if (!is_array($findings) || !array_is_list($findings) || count($findings) > 30) self::fail('findings');
        $p0 = 0; $p1 = 0;
        foreach ($findings as $index => $finding) {
            if (!is_array($finding) || array_is_list($finding)) self::fail('finding '.$index);
            self::exactKeys($finding, ['id','severity','scenario','problem','evidence','expected','fixLayer','confidence','sourcePaths'], ['sourcePaths']);
            if (!is_string($finding['id'] ?? null) || preg_match('/^[a-z0-9-]{3,64}$/', $finding['id']) !== 1) self::fail('finding '.$index.' id');
            $severity = $finding['severity'] ?? null; if (!is_string($severity) || !in_array($severity, self::SEVERITIES, true)) self::fail('finding '.$index.' severity');
            if ($severity === 'P0') $p0++; elseif ($severity === 'P1') $p1++;
            self::text($finding['scenario'] ?? null, 2, 80, 'finding '.$index.' scenario');
            foreach (['problem','evidence','expected'] as $key) self::text($finding[$key] ?? null, 5, 600, 'finding '.$index.' '.$key);
            if (!is_string($finding['fixLayer'] ?? null) || !in_array($finding['fixLayer'], self::LAYERS, true)) self::fail('finding '.$index.' fixLayer');
            $confidence = $finding['confidence'] ?? null; if (!is_int($confidence) && !is_float($confidence) || !is_finite((float)$confidence) || $confidence < 0 || $confidence > 1) self::fail('finding '.$index.' confidence');
            if (array_key_exists('sourcePaths', $finding)) {
                $paths = $finding['sourcePaths']; if (!is_array($paths) || !array_is_list($paths) || count($paths) > 8) self::fail('finding '.$index.' sourcePaths');
                foreach ($paths as $path) { if (!is_string($path) || preg_match('/[\x00-\x1f\x7f]/u',$path) || (function_exists('mb_strlen')?mb_strlen($path,'UTF-8'):strlen($path)) > 240) self::fail('finding '.$index.' sourcePaths'); }
            }
        }
        if ($p0 > 0 && $verdict !== 'BLOCK') self::fail('P0 requires BLOCK');
        if ($verdict === 'PASS' && ($p0 > 0 || $p1 > 0)) self::fail('PASS cannot include P0/P1');
        return $value;
    }

    private static function exactKeys(array $value, array $allowed, array $optional = []): void
    {
        $required = array_values(array_diff($allowed, $optional));
        foreach ($required as $key) if (!array_key_exists($key, $value)) self::fail('missing '.$key);
        foreach (array_keys($value) as $key) if (!in_array($key, $allowed, true)) self::fail('unexpected '.$key);
    }
    private static function text(mixed $value, int $min, int $max, string $field): string
    {
        if (!is_string($value) || preg_match('/[\x00-\x1f\x7f]/u', $value)) self::fail($field);
        $length = function_exists('mb_strlen') ? mb_strlen($value, 'UTF-8') : strlen($value);
        if ($length < $min || $length > $max || trim($value) === '') self::fail($field);
        return $value;
    }
    private static function fail(string $field): never { throw new HubAiPassFindingsException('AIPass findings are invalid: '.$field); }
}


final class HubCloudWorkflowException extends RuntimeException
{
    /** @param array<string,mixed> $diagnostic */
    public function __construct(string $message, public readonly string $codeName = 'CLOUD_WORKFLOW_FAILED', public readonly array $diagnostic = []) { parent::__construct($message); }
}

/**
 * GitHub Actions is an ON_DEMAND execution provider only. Canonical work,
 * state and files remain in AWH task/execution/artifact authorities.
 */
final class HubCloudWorkflowService
{
    private const PROVIDER_ID = 'github-actions';
    private const LEASE_SECONDS = 1800;
    private const MAX_BATCH = 4;
    private const MAX_QA_OUTER_BYTES = 1048576;
    private const MAX_QA_EVIDENCE_BYTES = 65536;
    private const MAX_REVIEW_OUTER_BYTES = 67108864;
    private const MAX_REVIEW_PACK_BYTES = 50331648;
    private const MAX_REVIEW_UNCOMPRESSED_BYTES = 209715200;
    private const CAPABILITIES = ['qa.cloud', 'review.visual'];
    private const WORKFLOWS = [
        'qa.cloud' => 'awh-cloud-qa.yml',
        'review.visual' => 'awh-cloud-review.yml',
    ];
    /** @var null|Closure(array<string,mixed>):array<string,mixed> */
    private readonly ?Closure $transport;
    private readonly HubProviderCredentialStore $credentials;

    /** @param null|callable(array<string,mixed>):array<string,mixed> $transport */
    public function __construct(private readonly PDO $pdo, private readonly HubArtifactStore $artifacts, ?callable $transport = null)
    {
        $this->transport = $transport === null ? null : Closure::fromCallable($transport);
        $this->credentials = HubProviderCredentialStore::fromEnvironment(self::PROVIDER_ID);
    }

    public static function fromEnvironment(PDO $pdo, ?callable $transport = null): self
    {
        return new self($pdo, HubArtifactStore::fromEnvironment(), $transport);
    }

    public function configured(): bool
    {
        try { return $this->credentials->configured(); } catch (Throwable) { return false; }
    }

    /** @return array<string,mixed> */
    public function status(?string $now = null): array
    {
        $configured = $this->configured();
        $latest = $this->pdo->query("SELECT e.execution_id,e.task_id,e.project_id,e.required_capability,e.state,e.checkpoint_json,e.last_error_code,e.updated_at,t.goal FROM control_task_executions e JOIN control_tasks t ON t.task_id=e.task_id WHERE e.required_capability IN ('qa.cloud','review.visual') ORDER BY e.updated_at DESC,e.execution_id DESC LIMIT 8")->fetchAll();
        $items = [];
        foreach ($latest as $row) {
            $checkpoint = self::checkpoint((string)$row['checkpoint_json']);
            $items[] = [
                'executionId'=>(string)$row['execution_id'],'taskId'=>(string)$row['task_id'],'projectId'=>(string)$row['project_id'],
                'capability'=>(string)$row['required_capability'],'state'=>(string)$row['state'],'goal'=>(string)$row['goal'],
                'revision'=>is_string($checkpoint['revision'] ?? null) ? $checkpoint['revision'] : null,
                'profile'=>is_string($checkpoint['profile'] ?? null) ? $checkpoint['profile'] : null,
                'updatedAt'=>(string)$row['updated_at'],'failureCode'=>$row['last_error_code'],
            ];
        }
        return ['schemaVersion'=>1,'configured'=>$configured,'state'=>$configured?'READY':'NOT_CONFIGURED','provider'=>'AWH Cloud','capabilities'=>self::CAPABILITIES,'recent'=>$items,'generatedAt'=>self::timestamp($now ?? gmdate('c'))];
    }

    public function saveCredential(string $secret, ?string $now = null): array
    {
        $this->credentials->replace($secret);
        $this->advertise($now);
        return ['configured'=>true,'provider'=>'AWH Cloud'];
    }

    public function removeCredential(?string $now = null): array
    {
        $this->credentials->remove();
        if (HubCapabilityRegistryService::schemaPresent($this->pdo)) {
            $at = self::timestamp($now ?? gmdate('c'));
            $this->pdo->prepare('UPDATE control_execution_providers SET enabled=0,observed_at=:at,expires_at=:at WHERE provider_id=:id')->execute(['at'=>$at,'id'=>self::PROVIDER_ID]);
        }
        return ['configured'=>false,'provider'=>'AWH Cloud'];
    }

    public function canonicalRevision(): string
    {
        if (!$this->configured()) throw new HubCloudWorkflowException('AWH Cloud is not configured','CLOUD_NOT_CONFIGURED');
        $response = $this->api('GET', '/commits/' . rawurlencode($this->ref()));
        if (($response['status'] ?? 0) !== 200) throw new HubCloudWorkflowException('Cloud source revision is unavailable', self::httpCode((int)($response['status'] ?? 0)));
        $body = self::jsonObject((string)($response['body'] ?? ''));
        return self::revision((string)($body['sha'] ?? ''));
    }

    public function advertise(?string $now = null): void
    {
        if (!$this->configured() || !HubCapabilityRegistryService::schemaPresent($this->pdo)) return;
        $at = self::timestamp($now ?? gmdate('c'));
        (new HubCapabilityRegistryService($this->pdo))->advertiseProvider(self::PROVIDER_ID,'BURST','AWH Cloud','ON_DEMAND','INCLUDED',20,self::CAPABILITIES,$at,null,['authority'=>'control-task-executions','backend'=>'github-actions']);
    }

    /** @return array<string,mixed> */
    public function tick(?string $now = null): array
    {
        $at = self::timestamp($now ?? gmdate('c'));
        if (!$this->configured()) return ['schemaVersion'=>1,'state'=>'NOT_CONFIGURED','processed'=>0];
        $this->advertise($at);
        $results = [];
        foreach ($this->claimBatch($at) as $row) {
            try {
                $results[] = $this->advance($row, $at);
            } catch (HubCloudWorkflowException $error) {
                if ($this->cancellationRequested((string)$row['execution_id'])) {
                    $this->markCancelled($row, $at);
                    $results[] = ['executionId'=>(string)$row['execution_id'],'taskId'=>(string)$row['task_id'],'state'=>'CANCELLED','code'=>'CANCELLED_BY_OWNER'];
                } else {
                    $this->fail($row, $error->codeName, $at);
                    $results[] = ['executionId'=>(string)$row['execution_id'],'taskId'=>(string)$row['task_id'],'state'=>'FAILED','code'=>$error->codeName];
                }
            }
        }
        return ['schemaVersion'=>1,'state'=>'READY','processed'=>count($results),'results'=>$results];
    }

    /**
     * Claim canonical executions with optimistic compare-and-swap.  No cloud
     * queue or provider-owned job table is introduced; `control_task_executions`
     * remains the lease and lifecycle authority.
     *
     * @return list<array<string,mixed>>
     */
    private function claimBatch(string $at): array
    {
        $registry = new HubCapabilityRegistryService($this->pdo);
        $expires = gmdate('c', strtotime($at) + self::LEASE_SECONDS);
        $q = $this->pdo->prepare("SELECT e.*,t.user_id,t.goal,t.conversation_id,t.state AS task_state FROM control_task_executions e JOIN control_tasks t ON t.task_id=e.task_id WHERE e.required_capability IN ('qa.cloud','review.visual') AND ((e.state IN ('QUEUED','WAITING_FOR_CAPABILITY')) OR (e.state='RUNNING' AND e.lease_owner LIKE 'cloud:github-actions:%')) AND t.state NOT IN ('COMPLETED','FAILED','CANCELLED') ORDER BY e.created_at,e.execution_id LIMIT 12");
        $q->execute(); $claimed = [];
        foreach ($q->fetchAll() as $row) {
            if (count($claimed) >= self::MAX_BATCH) break;
            $capability = (string)$row['required_capability'];
            $route = $registry->route($capability, $at);
            if (!is_array($route) || ($route['providerId'] ?? null) !== self::PROVIDER_ID) continue;
            $owner = 'cloud:' . self::PROVIDER_ID . ':' . substr(hash('sha256', (string)$row['execution_id'] . "\n" . $at . "\n" . bin2hex(random_bytes(8))), 0, 24);
            if ((string)$row['state'] === 'RUNNING') {
                $claim = $this->pdo->prepare("UPDATE control_task_executions SET lease_owner=:owner,lease_expires_at=:expires,updated_at=:at WHERE execution_id=:id AND state='RUNNING' AND lease_owner=:previous");
                $claim->execute(['owner'=>$owner,'expires'=>$expires,'at'=>$at,'id'=>$row['execution_id'],'previous'=>$row['lease_owner']]);
            } else {
                $claim = $this->pdo->prepare("UPDATE control_task_executions SET state='RUNNING',lease_owner=:owner,lease_expires_at=:expires,attempt_count=attempt_count+1,last_error_code=NULL,updated_at=:at WHERE execution_id=:id AND state=:state AND lease_owner IS NULL");
                $claim->execute(['owner'=>$owner,'expires'=>$expires,'at'=>$at,'id'=>$row['execution_id'],'state'=>$row['state']]);
            }
            if ($claim->rowCount() !== 1) continue;
            $this->pdo->prepare("UPDATE control_tasks SET state='RUNNING',progress=CASE WHEN progress<10 THEN 10 ELSE progress END,failure_code=NULL,updated_at=:at WHERE task_id=:task AND state NOT IN ('COMPLETED','FAILED','CANCELLED')")->execute(['at'=>$at,'task'=>$row['task_id']]);
            $registry->ensureExecutionEnvelope((string)$row['execution_id'], $at);
            $registry->updateEnvelopeState((string)$row['execution_id'], 'ACTIVE', $expires, $at);
            $wasRunning = (string)$row['state'] === 'RUNNING';
            $row['state'] = 'RUNNING'; $row['lease_owner'] = $owner; $row['lease_expires_at'] = $expires;
            $row['attempt_count'] = (int)$row['attempt_count'] + ($wasRunning ? 0 : 1);
            $claimed[] = $row;
        }
        return $claimed;
    }

    /** @param array<string,mixed> $row @return array<string,mixed> */
    private function advance(array $row, string $at): array
    {
        $checkpoint = self::checkpoint((string)$row['checkpoint_json']);
        $revision = self::revision((string)($checkpoint['revision'] ?? ''));
        $capability = (string)$row['required_capability'];
        $workflow = self::workflowFor($capability);
        $profile = in_array(($checkpoint['profile'] ?? null), ['daily','final'], true) ? (string)$checkpoint['profile'] : 'daily';
        $executionId = (string)$row['execution_id'];
        $runId = isset($checkpoint['runId']) && is_int($checkpoint['runId']) ? $checkpoint['runId'] : null;
        if (is_string($row['cancellation_requested_at'] ?? null)) return $this->cancelExecution($row, $checkpoint, $workflow, $executionId, $revision, $at);
        if ($runId === null && !is_string($checkpoint['dispatchedAt'] ?? null)) {
            $this->dispatch($workflow, $capability, $executionId, $revision, $profile);
            $checkpoint['provider'] = self::PROVIDER_ID;
            $checkpoint['workflow'] = $workflow;
            $checkpoint['revision'] = $revision;
            $checkpoint['profile'] = $profile;
            $checkpoint['dispatchedAt'] = $at;
            $this->updateRunning($row, $checkpoint, $at, 20, 'กำลังตรวจบน AWH Cloud');
            return ['executionId'=>(string)$row['execution_id'],'taskId'=>(string)$row['task_id'],'state'=>'RUNNING','phase'=>'DISPATCHED'];
        }
        if ($runId === null) {
            $run = $this->discoverRun($workflow, $executionId, $revision, $profile, (string)$checkpoint['dispatchedAt']);
            if ($run === null) {
                $this->updateRunning($row, $checkpoint, $at, 25, 'AWH Cloud กำลังเริ่มงาน');
                return ['executionId'=>(string)$row['execution_id'],'taskId'=>(string)$row['task_id'],'state'=>'RUNNING','phase'=>'DISCOVERING'];
            }
            $runId = (int)$run['id']; $checkpoint['runId'] = $runId;
            $this->updateRunning($row, $checkpoint, $at, 35, 'AWH Cloud เริ่มตรวจแล้ว');
        } else $run = $this->workflowRun($runId);
        $this->assertRunIdentity($run, $workflow, $executionId, $revision, $profile);
        if ($this->cancellationRequested($executionId)) return $this->cancelExecution($row, $checkpoint, $workflow, $executionId, $revision, $at, $run);
        $status = strtolower((string)($run['status'] ?? ''));
        if ($status !== 'completed') {
            $checkpoint['lastObservedAt'] = $at;
            $this->updateRunning($row, $checkpoint, $at, 55, 'AWH Cloud กำลังตรวจและสร้างหลักฐาน');
            return ['executionId'=>(string)$row['execution_id'],'taskId'=>(string)$row['task_id'],'state'=>'RUNNING','phase'=>'RUNNING'];
        }
        $conclusion = strtolower((string)($run['conclusion'] ?? ''));
        if ($conclusion !== 'success') throw new HubCloudWorkflowException('Cloud review failed', 'CLOUD_RUN_FAILED', ['conclusion'=>$conclusion]);
        if ($capability === 'review.visual') $this->storeReviewArtifact($row, $runId, $executionId, $workflow, $revision, $profile, $at);
        elseif ($capability === 'qa.cloud') $this->storeQaArtifact($row, $runId, $executionId, $workflow, $revision, $at);
        $summary = (string)$row['required_capability'] === 'review.visual' ? 'AWH ตรวจหน้าจอบน Cloud เสร็จแล้ว และเก็บ Review Pack ไว้ในไฟล์ของงานนี้' : 'AWH ตรวจระบบบน Cloud เสร็จแล้ว และเก็บหลักฐาน QA ไว้ในไฟล์ของงานนี้';
        $this->complete($row, $summary, $at);
        return ['executionId'=>(string)$row['execution_id'],'taskId'=>(string)$row['task_id'],'state'=>'COMPLETED','phase'=>'COMPLETED'];
    }

    private function dispatch(string $workflow, string $capability, string $executionId, string $revision, string $profile): void
    {
        $inputs = ['revision'=>$revision, 'execution_id'=>$executionId];
        if ($capability === 'review.visual') $inputs['review_profile'] = $profile;
        $response = $this->api('POST', '/actions/workflows/' . rawurlencode($workflow) . '/dispatches', [
            'ref' => $this->ref(),
            'inputs' => $inputs,
        ]);
        if (($response['status'] ?? 0) !== 204) throw new HubCloudWorkflowException('Cloud workflow dispatch failed', self::httpCode((int)($response['status'] ?? 0)));
    }

    /** @return array<string,mixed>|null */
    private function discoverRun(string $workflow, string $executionId, string $revision, string $profile, string $dispatchedAt): ?array
    {
        $response = $this->api('GET', '/actions/workflows/' . rawurlencode($workflow) . '/runs?event=workflow_dispatch&branch=' . rawurlencode($this->ref()) . '&per_page=30');
        if (($response['status'] ?? 0) !== 200) throw new HubCloudWorkflowException('Cloud workflow discovery failed', self::httpCode((int)($response['status'] ?? 0)));
        $body = self::jsonObject((string)($response['body'] ?? '')); $matches = []; $expectedTitle = self::runTitle($workflow, $executionId, $revision, $profile);
        foreach (($body['workflow_runs'] ?? []) as $run) {
            if (!is_array($run) || !is_int($run['id'] ?? null)) continue;
            $title = is_string($run['display_title'] ?? null) ? (string)$run['display_title'] : '';
            $created = is_string($run['created_at'] ?? null) ? strtotime((string)$run['created_at']) : false;
            $dispatch = strtotime($dispatchedAt);
            if (!hash_equals($expectedTitle, $title)) continue;
            if ($created !== false && $dispatch !== false && $created < $dispatch - 30) continue;
            $matches[] = $run;
        }
        if ($matches === []) return null;
        usort($matches, static fn(array $a,array $b): int => ((int)$b['id']) <=> ((int)$a['id']));
        return $matches[0];
    }

    /** @return array<string,mixed> */
    private function workflowRun(int $runId): array
    {
        if ($runId < 1) throw new HubCloudWorkflowException('Cloud run reference is invalid', 'CLOUD_CHECKPOINT_INVALID');
        $response = $this->api('GET', '/actions/runs/' . $runId);
        if (($response['status'] ?? 0) !== 200) throw new HubCloudWorkflowException('Cloud run status is unavailable', self::httpCode((int)($response['status'] ?? 0)));
        return self::jsonObject((string)($response['body'] ?? ''));
    }

    /** @param array<string,mixed> $row */
    private function storeQaArtifact(array $row, int $runId, string $executionId, string $workflow, string $revision, string $at): void
    {
        $response = $this->api('GET', '/actions/runs/' . $runId . '/artifacts');
        if (($response['status'] ?? 0) !== 200) throw new HubCloudWorkflowException('Cloud QA artifact list is unavailable', self::httpCode((int)($response['status'] ?? 0)));
        $body = self::jsonObject((string)($response['body'] ?? ''));
        $wanted = 'AWH-CLOUD-QA-' . $revision; $artifactRef = null;
        foreach (($body['artifacts'] ?? []) as $item) if (is_array($item) && ($item['name'] ?? null) === $wanted && is_int($item['id'] ?? null) && ($item['expired'] ?? false) !== true) { $artifactRef = (int)$item['id']; break; }
        if ($artifactRef === null) throw new HubCloudWorkflowException('Cloud QA artifact is missing', 'CLOUD_ARTIFACT_MISSING');
        $download = $this->api('GET', '/actions/artifacts/' . $artifactRef . '/zip', null, true);
        $outerBytes = is_string($download['body'] ?? null) ? strlen((string)$download['body']) : 0;
        if (($download['status'] ?? 0) !== 200 || $outerBytes < 100 || $outerBytes > self::MAX_QA_OUTER_BYTES) throw new HubCloudWorkflowException('Cloud QA artifact download failed', self::httpCode((int)($download['status'] ?? 0)));
        $outer = tempnam(sys_get_temp_dir(), 'awh-cloud-qa-'); $evidence = null;
        if (!is_string($outer)) throw new HubCloudWorkflowException('Cloud QA artifact staging failed', 'CLOUD_ARTIFACT_INVALID');
        try {
            if (@file_put_contents($outer, (string)$download['body'], LOCK_EX) === false) throw new HubCloudWorkflowException('Cloud QA artifact staging failed', 'CLOUD_ARTIFACT_INVALID');
            $zip = new ZipArchive(); if ($zip->open($outer) !== true) throw new HubCloudWorkflowException('Cloud QA artifact archive is invalid', 'CLOUD_ARTIFACT_INVALID');
            if ($zip->numFiles < 1 || $zip->numFiles > 4) { $zip->close(); throw new HubCloudWorkflowException('Cloud QA artifact archive is invalid', 'CLOUD_ARTIFACT_INVALID'); }
            $entry = 'AWH-CLOUD-QA.json'; $index = $zip->locateName($entry, ZipArchive::FL_NOCASE);
            if ($index === false) { $zip->close(); throw new HubCloudWorkflowException('Cloud QA evidence is missing', 'CLOUD_ARTIFACT_INVALID'); }
            $stat = $zip->statIndex((int)$index); $entrySize = is_array($stat) && is_int($stat['size'] ?? null) ? (int)$stat['size'] : 0;
            if ($entrySize < 1 || $entrySize > self::MAX_QA_EVIDENCE_BYTES) { $zip->close(); throw new HubCloudWorkflowException('Cloud QA evidence is invalid', 'CLOUD_ARTIFACT_INVALID'); }
            $raw = $zip->getFromIndex((int)$index, self::MAX_QA_EVIDENCE_BYTES + 1); $zip->close();
            if (!is_string($raw) || strlen($raw) !== $entrySize) throw new HubCloudWorkflowException('Cloud QA evidence is invalid', 'CLOUD_ARTIFACT_INVALID');
            $metadata = self::jsonObject($raw); $keys = array_keys($metadata); sort($keys); $expected = ['executionId','revision','schemaVersion','status','workflow']; sort($expected);
            if ($keys !== $expected || ($metadata['schemaVersion'] ?? null) !== 1 || ($metadata['revision'] ?? null) !== $revision || ($metadata['executionId'] ?? null) !== $executionId || ($metadata['status'] ?? null) !== 'PASS' || ($metadata['workflow'] ?? null) !== $workflow) throw new HubCloudWorkflowException('Cloud QA evidence does not match the execution', 'CLOUD_ARTIFACT_INVALID');
            $evidence = tempnam(sys_get_temp_dir(), 'awh-cloud-qa-evidence-');
            if (!is_string($evidence) || @file_put_contents($evidence, $raw, LOCK_EX) === false || !@chmod($evidence, 0600)) throw new HubCloudWorkflowException('Cloud QA evidence staging failed', 'CLOUD_ARTIFACT_INVALID');
            if ($this->cancellationRequested((string)$row['execution_id'])) throw new HubCloudWorkflowException('Cloud result arrived after cancellation','CLOUD_CANCELLED');
            $this->persistArtifactBundle($row, [['file'=>$evidence,'name'=>'AWH-CLOUD-QA-'.$revision.'.json','kind'=>'cloud-qa-evidence','mime'=>'application/json']], $at);
        } finally { @unlink($outer); if (is_string($evidence) && is_file($evidence)) @unlink($evidence); }
    }

    /** @param array<string,mixed> $row */
    private function storeReviewArtifact(array $row, int $runId, string $executionId, string $workflow, string $revision, string $profile, string $at): void
    {
        $response = $this->api('GET', '/actions/runs/' . $runId . '/artifacts');
        if (($response['status'] ?? 0) !== 200) throw new HubCloudWorkflowException('Cloud artifact list is unavailable', self::httpCode((int)($response['status'] ?? 0)));
        $body = self::jsonObject((string)($response['body'] ?? ''));
        $wanted = 'AWH-AIPASS-REVIEW-' . $revision; $artifactRef = null;
        foreach (($body['artifacts'] ?? []) as $item) if (is_array($item) && ($item['name'] ?? null) === $wanted && is_int($item['id'] ?? null) && ($item['expired'] ?? false) !== true) { $artifactRef = (int)$item['id']; break; }
        if ($artifactRef === null) throw new HubCloudWorkflowException('Cloud review artifact is missing', 'CLOUD_ARTIFACT_MISSING');
        $download = $this->api('GET', '/actions/artifacts/' . $artifactRef . '/zip', null, true);
        $outerBytes = is_string($download['body'] ?? null) ? strlen((string)$download['body']) : 0;
        if (($download['status'] ?? 0) !== 200 || $outerBytes < 100 || $outerBytes > self::MAX_REVIEW_OUTER_BYTES) throw new HubCloudWorkflowException('Cloud review artifact download failed', self::httpCode((int)($download['status'] ?? 0)));
        $outer = tempnam(sys_get_temp_dir(), 'awh-cloud-'); $innerDir = sys_get_temp_dir() . '/awh-cloud-' . bin2hex(random_bytes(8));
        if (!is_string($outer) || !@mkdir($innerDir, 0700)) throw new HubCloudWorkflowException('Cloud artifact staging failed', 'CLOUD_ARTIFACT_INVALID');
        try {
            if (@file_put_contents($outer, (string)$download['body'], LOCK_EX) === false) throw new HubCloudWorkflowException('Cloud artifact staging failed', 'CLOUD_ARTIFACT_INVALID');
            $zip = new ZipArchive(); if ($zip->open($outer) !== true) throw new HubCloudWorkflowException('Cloud artifact archive is invalid', 'CLOUD_ARTIFACT_INVALID');
            $metadataRaw = $zip->getFromName('AWH-CLOUD-REVIEW.json');
            if (!is_string($metadataRaw)) { $zip->close(); throw new HubCloudWorkflowException('Cloud review metadata is missing', 'CLOUD_ARTIFACT_INVALID'); }
            $metadata = self::jsonObject($metadataRaw);
            if (($metadata['schemaVersion'] ?? null)!==1 || ($metadata['revision'] ?? null)!==$revision || ($metadata['executionId'] ?? null)!==$executionId || ($metadata['workflow'] ?? null)!==$workflow || ($metadata['profile'] ?? null)!==$profile) { $zip->close(); throw new HubCloudWorkflowException('Cloud review metadata does not match the execution', 'CLOUD_ARTIFACT_INVALID'); }
            $findingsRaw = $zip->getFromName('AIPASS-FINDINGS.json');
            if ($findingsRaw !== false) {
                if (!is_string($findingsRaw) || strlen($findingsRaw) > 65536) { $zip->close(); throw new HubCloudWorkflowException('Cloud findings evidence is invalid', 'CLOUD_FINDINGS_INVALID'); }
                try { HubAiPassFindingsValidator::validateJson($findingsRaw, $revision); }
                catch (HubAiPassFindingsException $error) { $zip->close(); throw new HubCloudWorkflowException('Cloud findings evidence is invalid', $error->codeName); }
                $findingsFile = $innerDir . '/findings.json';
                if (@file_put_contents($findingsFile, $findingsRaw, LOCK_EX) === false || !@chmod($findingsFile, 0600)) { $zip->close(); throw new HubCloudWorkflowException('Cloud findings staging failed', 'CLOUD_ARTIFACT_INVALID'); }
            }
            $entry = 'AWH-AIPASS-REVIEW-' . $revision . '.zip'; $index = $zip->locateName($entry, ZipArchive::FL_NOCASE); if ($index === false) { $zip->close(); throw new HubCloudWorkflowException('Cloud review pack is missing', 'CLOUD_ARTIFACT_INVALID'); }
            $stat = $zip->statIndex((int)$index); $entrySize = is_array($stat) && is_int($stat['size'] ?? null) ? (int)$stat['size'] : 0;
            if ($entrySize < 1 || $entrySize > self::MAX_REVIEW_PACK_BYTES) { $zip->close(); throw new HubCloudWorkflowException('Cloud review pack exceeds the safe limit', 'CLOUD_ARTIFACT_INVALID'); }
            $stream = $zip->getStream($entry); if ($stream === false) { $zip->close(); throw new HubCloudWorkflowException('Cloud review pack is unreadable', 'CLOUD_ARTIFACT_INVALID'); }
            $inner = $innerDir . '/review.zip'; $out = fopen($inner, 'xb'); if ($out === false) { fclose($stream); $zip->close(); throw new HubCloudWorkflowException('Cloud review pack staging failed', 'CLOUD_ARTIFACT_INVALID'); }
            $copied = stream_copy_to_stream($stream, $out, self::MAX_REVIEW_PACK_BYTES + 1); fclose($stream); fclose($out); $zip->close();
            if (!is_int($copied) || $copied !== $entrySize || $copied > self::MAX_REVIEW_PACK_BYTES) throw new HubCloudWorkflowException('Cloud review pack copy is invalid', 'CLOUD_ARTIFACT_INVALID');
            self::validateReviewPackArchive($inner);
            if ($this->cancellationRequested((string)$row['execution_id'])) throw new HubCloudWorkflowException('Cloud result arrived after cancellation','CLOUD_CANCELLED');
            $bundle = [['file'=>$inner,'name'=>$entry,'kind'=>'visual-review-pack','mime'=>'application/zip']];
            if (isset($findingsFile) && is_file($findingsFile)) $bundle[] = ['file'=>$findingsFile,'name'=>'AIPASS-FINDINGS-'.$revision.'.json','kind'=>'aipass-findings','mime'=>'application/json'];
            $this->persistArtifactBundle($row, $bundle, $at);
        } finally { @unlink($outer); if (isset($inner) && is_file($inner)) @unlink($inner); if (isset($findingsFile) && is_file($findingsFile)) @unlink($findingsFile); @rmdir($innerDir); }
    }

    /** @param array<string,mixed> $row @param list<array{file:string,name:string,kind:string,mime:string}> $bundle */
    private function persistArtifactBundle(array $row, array $bundle, string $at): void
    {
        if ($bundle === [] || count($bundle) > 4) throw new HubCloudWorkflowException('Cloud artifact bundle is invalid', 'CLOUD_ARTIFACT_INVALID');
        $pending = [];
        foreach ($bundle as $spec) {
            $file = $spec['file']; $size = @filesize($file); $sha = @hash_file('sha256', $file);
            if (!is_int($size) || $size < 1 || !is_string($sha) || preg_match('/^[0-9a-f]{64}$/', $sha) !== 1) throw new HubCloudWorkflowException('Cloud artifact verification failed', 'CLOUD_ARTIFACT_INVALID');
            $existing = $this->pdo->prepare('SELECT artifact_id FROM control_artifacts WHERE task_id=:task AND kind=:kind AND sha256=:sha LIMIT 1');
            $existing->execute(['task'=>$row['task_id'],'kind'=>$spec['kind'],'sha'=>$sha]); if ($existing->fetchColumn() !== false) continue;
            $artifactId = self::uuid(); $stored = $this->artifacts->storeFile($artifactId, $file);
            $pending[] = $spec + ['artifactId'=>$artifactId,'sha'=>$sha,'stored'=>$stored];
        }
        if ($pending === []) return;
        $removeAfter = [];
        try {
            $this->pdo->exec('BEGIN IMMEDIATE');
            $cancel = $this->pdo->prepare("SELECT 1 FROM control_task_executions e JOIN control_tasks t ON t.task_id=e.task_id WHERE e.execution_id=:execution AND e.task_id=:task AND e.cancellation_requested_at IS NULL AND t.state<>'CANCELLED'");
            $cancel->execute(['execution'=>$row['execution_id'],'task'=>$row['task_id']]); if ($cancel->fetchColumn() === false) throw new HubCloudWorkflowException('Cloud result arrived after cancellation','CLOUD_CANCELLED');
            foreach ($pending as $item) {
                $existing = $this->pdo->prepare('SELECT artifact_id FROM control_artifacts WHERE task_id=:task AND kind=:kind AND sha256=:sha LIMIT 1');
                $existing->execute(['task'=>$row['task_id'],'kind'=>$item['kind'],'sha'=>$item['sha']]);
                if ($existing->fetchColumn() !== false) { $removeAfter[] = $item['stored']['storageKey']; continue; }
                $this->pdo->prepare('INSERT INTO control_artifacts(artifact_id,task_id,project_id,kind,name,sha256,size_bytes,relative_ref,created_at) VALUES(:id,:task,:project,:kind,:name,:sha,:size,NULL,:at)')->execute(['id'=>$item['artifactId'],'task'=>$row['task_id'],'project'=>$row['project_id'],'kind'=>$item['kind'],'name'=>$item['name'],'sha'=>$item['stored']['sha256'],'size'=>$item['stored']['sizeBytes'],'at'=>$at]);
                $this->pdo->prepare('INSERT INTO control_artifact_objects(artifact_id,storage_key,mime_type,retained_until,deleted_at) VALUES(:id,:key,:mime,NULL,NULL)')->execute(['id'=>$item['artifactId'],'key'=>$item['stored']['storageKey'],'mime'=>$item['mime']]);
            }
            $this->pdo->exec('COMMIT');
            foreach ($removeAfter as $key) $this->artifacts->remove($key);
        } catch (Throwable $error) {
            if ($this->pdo->inTransaction()) $this->pdo->rollBack();
            foreach ($pending as $item) $this->artifacts->remove($item['stored']['storageKey']);
            if ($error instanceof HubCloudWorkflowException) throw $error;
            throw new HubCloudWorkflowException('Cloud artifact bundle could not be committed', 'CLOUD_ARTIFACT_INVALID');
        }
    }

    /** @param array<string,mixed> $row @param array<string,mixed> $checkpoint */
    private function updateRunning(array $row, array $checkpoint, string $at, int $progress, string $message): void
    {
        $expires = gmdate('c', strtotime($at) + self::LEASE_SECONDS); $json = json_encode($checkpoint, JSON_UNESCAPED_UNICODE|JSON_UNESCAPED_SLASHES|JSON_THROW_ON_ERROR);
        $owner = (string)($row['lease_owner'] ?? '');
        $update = $this->pdo->prepare("UPDATE control_task_executions SET state='RUNNING',lease_expires_at=:expires,checkpoint_json=:checkpoint,last_error_code=NULL,updated_at=:at WHERE execution_id=:id AND state='RUNNING' AND lease_owner=:owner");
        $update->execute(['expires'=>$expires,'checkpoint'=>$json,'at'=>$at,'id'=>$row['execution_id'],'owner'=>$owner]);
        if ($update->rowCount() !== 1) throw new HubCloudWorkflowException('Cloud execution lease was lost','CLOUD_LEASE_LOST');
        $this->pdo->prepare("UPDATE control_tasks SET state='RUNNING',progress=:progress,failure_code=NULL,updated_at=:at WHERE task_id=:task AND state NOT IN ('COMPLETED','FAILED','CANCELLED')")->execute(['progress'=>$progress,'at'=>$at,'task'=>$row['task_id']]);
        $this->event((string)$row['task_id'],'RUNNING',$progress,$message,$at);
        if (HubCapabilityRegistryService::schemaPresent($this->pdo)) (new HubCapabilityRegistryService($this->pdo))->updateEnvelopeState((string)$row['execution_id'],'ACTIVE',$expires,$at);
    }

    /** @param array<string,mixed> $row */
    private function complete(array $row, string $summary, string $at): void
    {
        $owner = (string)($row['lease_owner'] ?? '');
        $update = $this->pdo->prepare("UPDATE control_task_executions SET state='COMPLETED',lease_owner=NULL,lease_expires_at=NULL,last_error_code=NULL,updated_at=:at WHERE execution_id=:id AND state='RUNNING' AND lease_owner=:owner AND cancellation_requested_at IS NULL");
        $update->execute(['at'=>$at,'id'=>$row['execution_id'],'owner'=>$owner]);
        if ($update->rowCount() !== 1) throw new HubCloudWorkflowException('Cloud execution lease was lost or cancellation won','CLOUD_LEASE_LOST');
        $this->pdo->prepare("UPDATE control_tasks SET state='COMPLETED',progress=100,result_summary=:summary,failure_code=NULL,lease_expires_at=NULL,updated_at=:at WHERE task_id=:task")->execute(['summary'=>$summary,'at'=>$at,'task'=>$row['task_id']]);
        $this->event((string)$row['task_id'],'COMPLETED',100,$summary,$at);
        if (HubCapabilityRegistryService::schemaPresent($this->pdo)) (new HubCapabilityRegistryService($this->pdo))->updateEnvelopeState((string)$row['execution_id'],'RELEASED',null,$at);
    }

    /** @param array<string,mixed> $row @param array<string,mixed> $checkpoint @param null|array<string,mixed> $knownRun @return array<string,mixed> */
    private function cancelExecution(array $row, array $checkpoint, string $workflow, string $executionId, string $revision, string $at, ?array $knownRun = null): array
    {
        $profile = in_array(($checkpoint['profile'] ?? null), ['daily','final'], true) ? (string)$checkpoint['profile'] : 'daily';
        $runId = isset($checkpoint['runId']) && is_int($checkpoint['runId']) ? $checkpoint['runId'] : null;
        if (!is_string($checkpoint['dispatchedAt'] ?? null)) {
            $this->markCancelled($row,$at);
            return ['executionId'=>$executionId,'taskId'=>(string)$row['task_id'],'state'=>'CANCELLED','phase'=>'CANCELLED_BEFORE_DISPATCH'];
        }
        $run = $knownRun;
        if ($runId === null) {
            $run = $this->discoverRun($workflow,$executionId,$revision,$profile,(string)$checkpoint['dispatchedAt']);
            if ($run === null) {
                $checkpoint['cancelObservedAt']=$at;
                $this->updateRunning($row,$checkpoint,$at,25,'AWH Cloud กำลังยกเลิกงาน');
                return ['executionId'=>$executionId,'taskId'=>(string)$row['task_id'],'state'=>'RUNNING','phase'=>'CANCELLING_DISCOVERY'];
            }
            $runId=(int)$run['id']; $checkpoint['runId']=$runId;
        } elseif ($run === null) $run=$this->workflowRun($runId);
        $this->assertRunIdentity($run,$workflow,$executionId,$revision,$profile);
        if (strtolower((string)($run['status']??'')) !== 'completed') {
            $response=$this->api('POST','/actions/runs/'.$runId.'/cancel');
            $status=(int)($response['status']??0);
            if (!in_array($status,[202,409],true)) {
                $checkpoint['cancelAttempts']=max(0,(int)($checkpoint['cancelAttempts']??0))+1;
                $this->updateRunning($row,$checkpoint,$at,25,'AWH Cloud กำลังยกเลิกงาน');
                return ['executionId'=>$executionId,'taskId'=>(string)$row['task_id'],'state'=>'RUNNING','phase'=>'CANCELLING_REMOTE'];
            }
        }
        $this->markCancelled($row,$at);
        return ['executionId'=>$executionId,'taskId'=>(string)$row['task_id'],'state'=>'CANCELLED','phase'=>'CANCELLED'];
    }

    private function cancellationRequested(string $executionId): bool
    {
        $q=$this->pdo->prepare('SELECT cancellation_requested_at FROM control_task_executions WHERE execution_id=:id');$q->execute(['id'=>$executionId]);$value=$q->fetchColumn();return is_string($value)&&$value!=='';
    }

    /** @param array<string,mixed> $row */
    private function markCancelled(array $row, string $at): void
    {
        $owner=(string)($row['lease_owner']??'');
        $update=$this->pdo->prepare("UPDATE control_task_executions SET state='CANCELLED',lease_owner=NULL,lease_expires_at=NULL,last_error_code=NULL,updated_at=:at WHERE execution_id=:id AND state='RUNNING' AND lease_owner=:owner AND cancellation_requested_at IS NOT NULL");
        $update->execute(['at'=>$at,'id'=>$row['execution_id'],'owner'=>$owner]); if($update->rowCount()!==1)return;
        $this->pdo->prepare("UPDATE control_tasks SET state='CANCELLED',progress=0,result_summary='ยกเลิกงาน Cloud แล้ว ผลลัพธ์ที่มาถึงภายหลังจะไม่ถูกนำเข้า AWH',failure_code=NULL,lease_expires_at=NULL,cancelled_at=COALESCE(cancelled_at,:at),updated_at=:at WHERE task_id=:task AND state NOT IN ('COMPLETED','FAILED','CANCELLED')")->execute(['at'=>$at,'task'=>$row['task_id']]);
        $this->event((string)$row['task_id'],'CANCELLED',0,'ยกเลิกงาน AWH Cloud แล้ว',$at);
        if(HubCapabilityRegistryService::schemaPresent($this->pdo))(new HubCapabilityRegistryService($this->pdo))->updateEnvelopeState((string)$row['execution_id'],'CANCELLED',null,$at);
    }

    /** @param array<string,mixed> $row */
    private function fail(array $row, string $code, string $at): void
    {
        $owner = (string)($row['lease_owner'] ?? '');
        $update = $this->pdo->prepare("UPDATE control_task_executions SET state='FAILED',lease_owner=NULL,lease_expires_at=NULL,last_error_code=:code,updated_at=:at WHERE execution_id=:id AND state='RUNNING' AND lease_owner=:owner");
        $update->execute(['code'=>$code,'at'=>$at,'id'=>$row['execution_id'],'owner'=>$owner]);
        if ($update->rowCount() !== 1) return;
        $this->pdo->prepare("UPDATE control_tasks SET state='FAILED',progress=0,failure_code=:code,result_summary='AWH Cloud ตรวจงานนี้ไม่สำเร็จ งานเดิมและ Source of Truth ยังไม่ถูกเปลี่ยน',lease_expires_at=NULL,updated_at=:at WHERE task_id=:task")->execute(['code'=>$code,'at'=>$at,'task'=>$row['task_id']]);
        $this->event((string)$row['task_id'],'FAILED',0,'AWH Cloud หยุดงานนี้ไว้อย่างปลอดภัย',$at);
        if (HubCapabilityRegistryService::schemaPresent($this->pdo)) (new HubCapabilityRegistryService($this->pdo))->updateEnvelopeState((string)$row['execution_id'],'RELEASED',null,$at);
    }

    private function event(string $taskId, string $state, int $progress, string $message, string $at): void
    {
        $this->pdo->prepare('INSERT INTO control_task_events(event_id,task_id,state,progress,message,occurred_at) VALUES(:id,:task,:state,:progress,:message,:at)')->execute(['id'=>self::uuid(),'task'=>$taskId,'state'=>$state,'progress'=>$progress,'message'=>$message,'at'=>$at]);
    }

    /** @param array<string,mixed>|null $payload @return array<string,mixed> */
    private function api(string $method, string $path, ?array $payload = null, bool $binary = false): array
    {
        $request = ['method'=>$method,'url'=>'https://api.github.com/repos/'.$this->repository().$path,'headers'=>['Accept'=>'application/vnd.github+json','Authorization'=>'Bearer '.$this->credentials->read(),'X-GitHub-Api-Version'=>'2022-11-28','User-Agent'=>'AWH-Cloud-Control'],'body'=>$payload===null?null:json_encode($payload,JSON_UNESCAPED_SLASHES|JSON_THROW_ON_ERROR),'binary'=>$binary];
        if ($this->transport !== null) return ($this->transport)($request);
        return self::curl($request);
    }

    /** @param array<string,mixed> $request @return array<string,mixed> */
    private static function curl(array $request): array
    {
        if (!function_exists('curl_init')) throw new HubCloudWorkflowException('Cloud HTTP client is unavailable','CLOUD_HTTP_UNAVAILABLE');
        $handle = curl_init((string)$request['url']); if ($handle === false) throw new HubCloudWorkflowException('Cloud HTTP client is unavailable','CLOUD_HTTP_UNAVAILABLE');
        $headers = []; foreach (($request['headers'] ?? []) as $key=>$value) $headers[] = $key . ': ' . $value;
        $body = $request['body'] ?? null; $method = strtoupper((string)$request['method']);
        $options=[CURLOPT_RETURNTRANSFER=>true,CURLOPT_FOLLOWLOCATION=>true,CURLOPT_MAXREDIRS=>3,CURLOPT_CONNECTTIMEOUT=>10,CURLOPT_TIMEOUT=>45,CURLOPT_CUSTOMREQUEST=>$method,CURLOPT_HTTPHEADER=>$headers];
        if (defined('CURLOPT_UNRESTRICTED_AUTH')) $options[CURLOPT_UNRESTRICTED_AUTH]=false;
        if (defined('CURLOPT_PROTOCOLS') && defined('CURLPROTO_HTTPS')) $options[CURLOPT_PROTOCOLS]=CURLPROTO_HTTPS;
        if (defined('CURLOPT_REDIR_PROTOCOLS') && defined('CURLPROTO_HTTPS')) $options[CURLOPT_REDIR_PROTOCOLS]=CURLPROTO_HTTPS;
        curl_setopt_array($handle,$options);
        if (is_string($body)) { $headers[]='Content-Type: application/json'; curl_setopt($handle,CURLOPT_HTTPHEADER,$headers); curl_setopt($handle,CURLOPT_POSTFIELDS,$body); }
        $response = curl_exec($handle); $status = (int)curl_getinfo($handle,CURLINFO_RESPONSE_CODE); $error = curl_error($handle); curl_close($handle);
        if (!is_string($response)) throw new HubCloudWorkflowException('Cloud request failed','CLOUD_HTTP_UNAVAILABLE',['transport'=>$error===''?'curl':substr($error,0,80)]);
        return ['status'=>$status,'body'=>$response];
    }

    /** @param array<string,mixed> $run */
    private function assertRunIdentity(array $run, string $workflow, string $executionId, string $revision, string $profile): void
    {
        if (($run['event'] ?? null) !== 'workflow_dispatch') throw new HubCloudWorkflowException('Cloud run identity is invalid','CLOUD_RUN_MISMATCH');
        $title = is_string($run['display_title'] ?? null) ? (string)$run['display_title'] : '';
        if (!hash_equals(self::runTitle($workflow, $executionId, $revision, $profile), $title)) throw new HubCloudWorkflowException('Cloud run identity is invalid','CLOUD_RUN_MISMATCH');
    }

    private static function runTitle(string $workflow, string $executionId, string $revision, string $profile): string
    {
        if ($workflow === self::WORKFLOWS['qa.cloud']) return 'AWH Cloud QA ' . $executionId . ' ' . $revision;
        if ($workflow === self::WORKFLOWS['review.visual']) return 'AWH Cloud Review ' . $executionId . ' ' . $profile . ' ' . $revision;
        throw new HubCloudWorkflowException('Cloud workflow identity is invalid','CLOUD_CAPABILITY_INVALID');
    }

    private static function validateReviewPackArchive(string $path): void
    {
        $zip = new ZipArchive(); if ($zip->open($path) !== true) throw new HubCloudWorkflowException('Cloud review pack is invalid','CLOUD_ARTIFACT_INVALID');
        $total = 0; $count = $zip->numFiles;
        if ($count < 1 || $count > 500) { $zip->close(); throw new HubCloudWorkflowException('Cloud review pack entry count is invalid','CLOUD_ARTIFACT_INVALID'); }
        for ($i=0; $i<$count; $i++) {
            $stat = $zip->statIndex($i); if (!is_array($stat) || !is_string($stat['name'] ?? null) || !is_int($stat['size'] ?? null)) { $zip->close(); throw new HubCloudWorkflowException('Cloud review pack entry is invalid','CLOUD_ARTIFACT_INVALID'); }
            $name = (string)$stat['name']; $size = (int)$stat['size'];
            if ($name === '' || str_starts_with($name,'/') || preg_match('#(?:^|/)\.\.(?:/|$)#',$name)===1 || str_contains($name,"\0") || $size < 0 || $size > self::MAX_REVIEW_OUTER_BYTES) { $zip->close(); throw new HubCloudWorkflowException('Cloud review pack contains an unsafe entry','CLOUD_ARTIFACT_INVALID'); }
            $total += $size; if ($total > self::MAX_REVIEW_UNCOMPRESSED_BYTES) { $zip->close(); throw new HubCloudWorkflowException('Cloud review pack expands beyond the safe limit','CLOUD_ARTIFACT_INVALID'); }
        }
        $zip->close();
    }

    private static function workflowFor(string $capability): string
    {
        if (!array_key_exists($capability,self::WORKFLOWS)) throw new HubCloudWorkflowException('Cloud capability is invalid','CLOUD_CAPABILITY_INVALID');
        return self::WORKFLOWS[$capability];
    }

    private function repository(): string
    {
        $value = getenv('AWH_GITHUB_REPOSITORY'); if (!is_string($value) || $value === '') $value = 'theartzkk/lnwjud-readme';
        if (preg_match('#^[A-Za-z0-9_.-]{1,100}/[A-Za-z0-9_.-]{1,100}$#',$value)!==1) throw new HubCloudWorkflowException('Cloud repository configuration is invalid','CLOUD_CONFIG_INVALID');
        return $value;
    }

    private function ref(): string
    {
        $value = getenv('AWH_GITHUB_REF'); if (!is_string($value) || $value === '') $value = 'awh/api-independence';
        if (preg_match('/^[A-Za-z0-9._\/-]{1,160}$/',$value)!==1 || str_contains($value,'..')) throw new HubCloudWorkflowException('Cloud ref configuration is invalid','CLOUD_CONFIG_INVALID');
        return $value;
    }

    /** @return array<string,mixed> */
    private static function checkpoint(string $json): array
    {
        try { $value=json_decode($json,true,32,JSON_THROW_ON_ERROR); } catch (Throwable) { throw new HubCloudWorkflowException('Cloud checkpoint is invalid','CLOUD_CHECKPOINT_INVALID'); }
        if (!is_array($value) || array_is_list($value)) throw new HubCloudWorkflowException('Cloud checkpoint is invalid','CLOUD_CHECKPOINT_INVALID');
        return $value;
    }

    /** @return array<string,mixed> */
    private static function jsonObject(string $json): array
    {
        try { $value=json_decode($json,true,64,JSON_THROW_ON_ERROR); } catch (Throwable) { throw new HubCloudWorkflowException('Cloud response is invalid','CLOUD_RESPONSE_INVALID'); }
        if (!is_array($value) || array_is_list($value)) throw new HubCloudWorkflowException('Cloud response is invalid','CLOUD_RESPONSE_INVALID');
        return $value;
    }

    private static function revision(string $value): string
    {
        $value=strtolower(trim($value)); if (preg_match('/^[0-9a-f]{40}$/',$value)!==1) throw new HubCloudWorkflowException('Cloud revision is invalid','CLOUD_CHECKPOINT_INVALID'); return $value;
    }

    private static function timestamp(string $value): string
    {
        if (strtotime($value)===false) throw new HubCloudWorkflowException('Cloud time is invalid','CLOUD_CHECKPOINT_INVALID'); return gmdate('c',strtotime($value));
    }

    private static function httpCode(int $status): string
    {
        return match ($status) { 401=>'CLOUD_AUTH_FAILED',403=>'CLOUD_PERMISSION_DENIED',404=>'CLOUD_WORKFLOW_NOT_FOUND',409=>'CLOUD_CONFLICT',422=>'CLOUD_REQUEST_INVALID',429=>'CLOUD_RATE_LIMITED',default=>$status>=500?'CLOUD_UNAVAILABLE':'CLOUD_REQUEST_FAILED' };
    }

    private static function uuid(): string
    {
        $bytes=random_bytes(16); $bytes[6]=chr((ord($bytes[6])&15)|64); $bytes[8]=chr((ord($bytes[8])&63)|128); return vsprintf('%s%s-%s-%s-%s-%s%s%s',str_split(bin2hex($bytes),4));
    }
}
